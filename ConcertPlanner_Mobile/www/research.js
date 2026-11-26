/** Research for mobile. Every provider is optional: failures are reported,
 * never silently treated as zero demand. No private API keys are persisted.
 * Native Capacitor builds enable CapacitorHttp; web browsers may enforce CORS.
 */
const NEWS_LIMIT = 42;
const TIMEOUT = 11000;
const AGENT_MARKET_ALIASES = [
  ['Sofia', 'София'], ['Plovdiv', 'Пловдив'], ['Varna', 'Варна'],
  ['Burgas', 'Бургас'], ['Ruse', 'Русе'], ['Stara Zagora', 'Стара Загора'],
  ['Veliko Tarnovo', 'Велико Търново'], ['Bansko', 'Банско'],
];
const normalized = text => String(text || '').normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
const termsFor = city => AGENT_MARKET_ALIASES.find(g => g.some(s => normalized(s) === normalized(city))) || [city];
const host = url => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };
const safeError = error => {
  if (error?.name === 'AbortError') return 'request timeout';
  if (error?.message?.startsWith('HTTP ')) return error.message.slice(0, 8);
  return 'network unavailable or site blocked';
};

async function request(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const res = await fetch(url, {
      method: 'GET', signal: controller.signal,
      headers: {'Accept': '*/*'}, ...options,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {clearTimeout(timer);}
}
async function requestJSON(url) {return JSON.parse(await request(url));}
const q = (text) => encodeURIComponent(text);
const strip = text => String(text ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
function extractRss(xmlString, provider) {
  const doc = new DOMParser().parseFromString(xmlString, 'application/xml');
  if (doc.querySelector('parsererror')) return [];
  return [...doc.querySelectorAll('item')].slice(0, 16).map(item => ({
    title: strip(item.querySelector('title')?.textContent),
    url: item.querySelector('link')?.textContent?.trim() || '',
    snippet: strip(item.querySelector('description')?.textContent).slice(0, 480),
    published: item.querySelector('pubDate')?.textContent || '', provider,
  })).filter(item => item.title && /^https?:\/\//.test(item.url));
}
function extractDuck(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return [...doc.querySelectorAll('.result')].slice(0, 16).map(box => {
    const a = box.querySelector('.result__a');
    let url = a?.getAttribute('href') || '';
    try {const u = new URL(url, 'https://duckduckgo.com'); url = u.searchParams.get('uddg') || u.href;} catch {}
    return {title: a?.textContent?.trim() || '', url,
      snippet: box.querySelector('.result__snippet')?.textContent?.replace(/\s+/g, ' ')?.trim() || '',
      provider: 'DuckDuckGo'};
  }).filter(item => item.title && /^https?:\/\//.test(item.url));
}
function exactArtist(artists, name) {
  return (artists || []).find(a => normalized(a.name) === normalized(name));
}

async function wikipedia(name) {
  let profile = null, views = null;
  const errors = [];
  try {
    const url = `https://en.wikipedia.org/w/api.php?action=query&format=json&generator=search&gsrsearch=${q('intitle:"'+name+'"')}&gsrlimit=5&prop=extracts%7Cinfo&exintro=1&explaintext=1&inprop=url&formatversion=2&origin=*`;
    const data = await requestJSON(url);
    const pages = data?.query?.pages || [];
    const page = pages.find(p => normalized(p.title) === normalized(name));
    if (page) profile = {name: page.title, description: strip(page.extract).slice(0, 950),
      url: page.fullurl || `https://en.wikipedia.org/wiki/${encodeURIComponent(page.title.replaceAll(' ','_'))}`};
  } catch (error) {errors.push('Wikipedia profile: ' + safeError(error));}
  if (!profile) {
    try {
      const data = await requestJSON(`https://en.wikipedia.org/api/rest_v1/page/summary/${q(name.replaceAll(' ','_'))}`);
      if (data.title && data.type !== 'disambiguation') profile = {
        name: data.title, description: data.extract || data.description || '',
        url: data?.content_urls?.desktop?.page || '',
      };
    } catch (error) {errors.push('Wikipedia summary: ' + safeError(error));}
  }
  if (profile) {
    try {
      const end = new Date(); end.setUTCDate(end.getUTCDate() - 1);
      const start = new Date(end); start.setUTCDate(start.getUTCDate() - 29);
      const d = date => date.toISOString().slice(0, 10).replaceAll('-', '');
      const title = q(profile.name.replaceAll(' ','_'));
      const data = await requestJSON(`https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/${title}/daily/${d(start)}/${d(end)}`);
      const items = (data.items || []).map(item => Number(item.views)).filter(Number.isFinite);
      if (items.length) views = Math.round(items.reduce((sum, x) => sum + x, 0) / items.length);
    } catch (error) {errors.push('Wikipedia pageviews: ' + safeError(error));}
  }
  return {profile, views, errors};
}
async function musicbrainz(name) {
  const url = `https://musicbrainz.org/ws/2/artist/?query=${q('artist:"'+name+'"')}&fmt=json&limit=5`;
  const data = await requestJSON(url);
  const artist = exactArtist(data.artists, name);
  if (!artist) return null;
  return {name: artist.name, country: artist.country || '', kind: artist.type || '',
    match: artist.score ?? 0,
    tags: (artist.tags || []).slice(0, 5).map(tag => tag.name),
    url: artist.id ? `https://musicbrainz.org/artist/${artist.id}` : ''};
}
async function lastFm(name, key) {
  if (!key) return null;
  const data = await requestJSON('https://ws.audioscrobbler.com/2.0/?' + new URLSearchParams({
    method:'artist.getinfo', artist:name, api_key:key, format:'json', autocorrect:'1',
  }));
  if (data.error) throw new Error(`HTTP ${data.error}`);
  const info = data.artist || {};
  return {listeners: Number(info.stats?.listeners || 0), plays: Number(info.stats?.playcount || 0),
    url: info.url || '', name: info.name || name};
}
async function ticketmaster(name, market, key) {
  if (!key) return null;
  const url = 'https://app.ticketmaster.com/discovery/v2/events.json?' + new URLSearchParams({
    apikey:key, keyword:name, size:'35', sort:'date,asc',
  });
  const data = await requestJSON(url);
  return (data?._embedded?.events || []).filter(event => {
    const attractions = event?._embedded?.attractions || [];
    return attractions.some(a => normalized(a.name) === normalized(name))
      || normalized(event.name).includes(normalized(name));
  }).slice(0, 16).map(event => {
    const venue = event?._embedded?.venues?.[0] || {};
    const city = venue?.city?.name || '';
    return {title: event.name || name, city, date: event?.dates?.start?.localDate || '',
      venue: venue.name || '', local: termsFor(market).some(t => normalized(city).includes(normalized(t))),
      url: event.url || ''};
  });
}

function uniqueSources(list) {
  const urls = new Set();
  return list.filter(item => {
    const url = (item.url || '').split('#')[0];
    if (!url || urls.has(url)) return false;
    urls.add(url);
    item.domain = host(url);
    return true;
  }).slice(0, NEWS_LIMIT);
}
function extractClues(sources, artist, market, capacity) {
  const clues = [];
  const artistN = normalized(artist);
  const cities = termsFor(market).map(normalized);
  const matchText = /(?:tickets?\s+sold|attendance|attended|crowd\s+of|sold\s+out\s+to|sold\s+out\s+.*?\s+people|продаден[иа]?\s+билета|посетител[иа]|зрител[иа])/i;
  for (const src of sources) {
    const text = `${src.title}. ${src.snippet}`;
    const lower = normalized(text);
    const local = cities.some(city => city && lower.includes(city));
    if (!local || !lower.includes(artistN) || !matchText.test(text)) continue;
    const re = /\b(\d{2,3}(?:[ ,.]\d{3})+|\d{2,6})\b/g;
    const numbers = [...text.matchAll(re)].map(m => Number(m[0].replace(/[ ,.]/g, '')))
      .filter(n => n >= 50 && n <= Math.max(100000, capacity * 10));
    if (!numbers.length) continue;
    clues.push({value: numbers[0], context: text.slice(0, 210), source: src.url,
      domain: src.domain || host(src.url)});
  }
  return clues.slice(0, 15);
}
function suggestForecast(clues, capacity) {
  // Conservative gating: two genuinely different domains, coherent local
  // evidence, and no automatic overwriting of the planning assumptions.
  const independent = new Map();
  for (const clue of clues) if (clue.domain && !independent.has(clue.domain)) {
    independent.set(clue.domain, clue.value);
  }
  const values = [...independent.values()].sort((a,b) => a-b);
  if (values.length < 2 || !capacity) return null;
  const median = values[Math.floor(values.length / 2)];
  const coherent = values.filter(v => v >= median / 1.8 && v <= median * 1.8);
  if (coherent.length < 2) return null;
  const base = Math.min(95, Math.max(15, median / capacity * 100));
  return {low: Math.max(0, +(base - 15).toFixed(1)),
    base: +base.toFixed(1), high: Math.min(100, +(base + 15).toFixed(1)),
    domains: coherent.length};
}

/** @param {{artist:string,city:string,capacity:number,lastfmKey?:string,ticketmasterKey?:string}} input
 * @param {(message:string,done:number,total:number)=>void} update
 */
export async function researchArtist(input, update = () => {}) {
  const artist = input.artist?.trim() || '';
  const market = input.city?.trim() || '';
  const capacity = Number(input.capacity);
  if (!artist || !market || !(capacity > 0)) throw new Error('Enter artist, city, and venue capacity first.');
  const aliases = termsFor(market);
  const searches = [
    {label:'Bing concert sales', provider:'Bing RSS', query:`"${artist}" "${market}" tickets sold attendance`},
    {label:'Bing local shows', provider:'Bing RSS', query:`"${artist}" "${market}" concert venue tickets`},
    {label:'Google news', provider:'Google News', query:`"${artist}" "${market}" live concert`},
    {label:'Google ticket news', provider:'Google News', query:`"${artist}" tickets sold live tour`},
    {label:'DuckDuckGo concert history', provider:'DuckDuckGo', query:`"${artist}" "${market}" gig audience`},
    {label:'DuckDuckGo box office', provider:'DuckDuckGo', query:`"${artist}" concert sold out capacity`},
  ];
  if (aliases.length > 1) {
    const alt = aliases.find(s => normalized(s) !== normalized(market));
    searches.push({label:'Local-language concert news', provider:'Google News', query:`"${artist}" "${alt}" концерт билети`});
    searches.push({label:'Local-language ticket search', provider:'Bing RSS', query:`"${artist}" "${alt}" концерт билети`});
  }
  const jobs = [
    {label:'Wikipedia', run:() => wikipedia(artist)},
    {label:'MusicBrainz', run:() => musicbrainz(artist)},
    ...searches.map(s => ({label:s.label, run: async () => {
      if (s.provider === 'DuckDuckGo') return extractDuck(await request(`https://html.duckduckgo.com/html/?q=${q(s.query)}`));
      if (s.provider === 'Google News') return extractRss(await request(`https://news.google.com/rss/search?q=${q(s.query)}&hl=en&gl=US&ceid=US:en`), s.provider);
      return extractRss(await request(`https://www.bing.com/search?format=rss&q=${q(s.query)}`), s.provider);
    } })),
  ];
  if (input.lastfmKey) jobs.push({label:'Last.fm', run:() => lastFm(artist, input.lastfmKey)});
  if (input.ticketmasterKey) jobs.push({label:'Ticketmaster', run:() => ticketmaster(artist, market, input.ticketmasterKey)});
  let done = 0;
  update('Searching independent sources…', done, jobs.length);
  const results = await Promise.all(jobs.map(async job => {
    try {return {label:job.label, status:'ok', data:await job.run()};}
    catch (error) {return {label:job.label, status:'failed', reason:safeError(error)};}
    finally {done++; update(`${done} of ${jobs.length} source checks finished`, done, jobs.length);}
  }));
  const match = name => results.find(r => r.label === name)?.data;
  const allSources = results.flatMap(r => Array.isArray(r.data) && r.label !== 'Ticketmaster' ? r.data : []);
  const sources = uniqueSources(allSources);
  const clues = extractClues(sources, artist, market, capacity);
  const forecast = suggestForecast(clues, capacity);
  const wiki = match('Wikipedia') || {profile:null, views:null, errors:[]};
  const mb = match('MusicBrainz') || null;
  const lastfm = match('Last.fm') || null;
  const events = match('Ticketmaster') || null;
  return {artist, market, capacity, timestamp:new Date().toISOString(),
    sources, clues, forecast, wiki, mb, lastfm, events,
    providerStatus:results.map(r => ({label:r.label, status:r.status,
      reason:r.reason || (!r.data ? 'No match returned' : undefined),
      hits:Array.isArray(r.data) ? r.data.length : undefined})),
  };
}

export function researchReportText(report) {
  const lines = [`CONCERT PLANNER — RESEARCH REPORT`, `Artist: ${report.artist} | Market: ${report.market} | Capacity: ${report.capacity}`,
    `Research date: ${report.timestamp}`, '', 'PROVIDER COVERAGE'];
  report.providerStatus.forEach(s => lines.push(`- ${s.label}: ${s.status}${s.reason ? ' ('+s.reason+')' : ''}${s.hits !== undefined ? ` | ${s.hits} results` : ''}`));
  lines.push('', 'ARTIST INFORMATION');
  if (report.wiki?.profile) lines.push('Wikipedia: '+report.wiki.profile.description, report.wiki.profile.url);
  if (report.wiki?.views != null) lines.push('Wikipedia average daily views (last 30 days): '+report.wiki.views);
  if (report.mb) lines.push('MusicBrainz: '+report.mb.name+' ('+report.mb.country+') '+report.mb.url);
  if (report.lastfm) lines.push('Last.fm listeners: '+report.lastfm.listeners+' | Plays: '+report.lastfm.plays);
  if (report.events) {lines.push('', 'TICKETMASTER LISTINGS (NOT TICKET SALES)'); for (const e of report.events) lines.push(`${e.date} | ${e.title} | ${e.city} | ${e.venue}\n${e.url}`);}
  lines.push('', 'LOCAL ATTENDANCE/TICKET CLUES (UNVERIFIED)');
  if (!report.clues.length) lines.push('No clear, market-specific numerical attendance reports extracted.');
  for (const c of report.clues) lines.push(`${c.value} | ${c.context}\n${c.source}`);
  lines.push('', 'SUGGESTED SCENARIOS');
  lines.push(report.forecast ? `Low ${report.forecast.low}% | Base ${report.forecast.base}% | High ${report.forecast.high}% (requires review)` : 'No defensible attendance scenario from independent evidence. Keep manual assumptions.');
  lines.push('', 'RESEARCH SOURCES');
  for (const s of report.sources) lines.push(`${s.title} [${s.provider}]\n${s.snippet}\n${s.url}\n`);
  lines.push('IMPORTANT: Online attention, venue capacities, and announced concerts are not verified local ticket sales. Validate each source before deciding on fees or capacity.');
  return lines.join('\n');
}
