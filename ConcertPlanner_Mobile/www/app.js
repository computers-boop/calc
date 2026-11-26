import {BUDGET_FIELDS, defaultDraft, normalizePlan, validatePlan,
  computeFinance, snapshot, summary, formatMoney, formatNumber} from './finance.js';
import {researchArtist, researchReportText} from './research.js';

const KEY = 'concertPlannerMobile.v1';
const main = document.getElementById('app-main');
const modal = document.getElementById('app-dialog');
const dialogBody = document.getElementById('dialog-content');
const toastNode = document.getElementById('toast');
const filePicker = document.getElementById('file-input');
const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c =>
  ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
const percent = n => Math.max(0, Math.min(100, n));
const valueOr = value => Number.isFinite(Number(value)) ? Number(value) : 0;

function getState() {
  try {
    const obj = JSON.parse(localStorage.getItem(KEY) || '{}');
    return {
      draft: normalizePlan(obj.draft || defaultDraft()),
      history: Array.isArray(obj.history) ? obj.history.filter(p => p && typeof p === 'object').slice(-100) : [],
      documents: Array.isArray(obj.documents) ? obj.documents.filter(p => p && typeof p === 'object').slice(-60) : [],
    };
  } catch {return {draft:defaultDraft(), history:[], documents:[]};}
}
const persisted = getState();
let draft = persisted.draft;
let history = persisted.history;
let documents = persisted.documents;
let currentTab = 'plan';
let currentLibraryTab = 'saved';
let scenario = 'base';
let calculation = null;
let researchResult = null;
let researchStatus = {busy:false, text:'', current:0, total:1};
let selectedSaved = new Set();
let selectedFiles = new Set();
let researchSettingsOpen = false;
let researchKeys = {lastfm:'', ticketmaster:''};
let toastTimer;

function persist() {
  try {localStorage.setItem(KEY, JSON.stringify({draft, history, documents}));}
  catch {toast('Local storage is full. Export important plans to JSON.');}
}
function toast(text) {
  clearTimeout(toastTimer);
  toastNode.textContent = text;
  toastNode.classList.add('visible');
  toastTimer = setTimeout(() => toastNode.classList.remove('visible'), 3500);
}
function sectionTitle(kicker, title, description, extra = '') {
  return `<div class="page-heading"><div><div class="eyebrow">${esc(kicker)}</div><h1>${esc(title)}</h1><p class="subtitle">${esc(description)}</p></div>${extra}</div>`;
}
function formField(label, key, options = {}) {
  const {num=false, placeholder='', min='0', step='any', help=''} = options;
  return `<label class="field"><span class="field-label">${esc(label)}</span>`+
    `<input data-field="${esc(key)}" type="${num ? 'number' : 'text'}" `+
    `${num ? `inputmode="decimal" step="${esc(step)}" min="${esc(min)}"` : ''}`+
    ` placeholder="${esc(placeholder)}" value="${esc(draft[key])}" autocomplete="off"/>`+
    `${help ? `<small class="inline-help">${esc(help)}</small>` : ''}</label>`;
}
function budgetField(label, key, options={}) {
  const {suffix='', note=''} = options;
  return `<label class="field"><span class="field-label">${esc(label)}${suffix ? ` <span class="tiny-text">${esc(suffix)}</span>` : ''}</span>`+
    `<input data-budget="${esc(key)}" type="number" inputmode="decimal" min="0" step="any" value="${esc(draft.budget[key])}"/>`+
    `${note ? `<small class="inline-help">${esc(note)}</small>` : ''}</label>`;
}
const money = (v, cur=draft.currency) => formatMoney(v, cur);
function stat(label, value, options = {}) {
  return `<div class="metric"><div class="metric-label">${esc(label)}</div>`+
    `<div class="metric-value${options.accent ? ' accent' : ''}${options.small ? ' small' : ''}">${esc(value)}</div>`+
    `${options.foot ? `<div class="metric-footnote">${esc(options.foot)}</div>` : ''}</div>`;
}
const card = (title, body, extra='') => `<section class="card"><div class="card-title-row"><h2>${title}</h2>${extra}</div>${body}</section>`;
const row = (label, val, style='') => `<div class="summary-row"><span>${esc(label)}</span><strong class="${style}">${esc(val)}</strong></div>`;
const safeDate = (timestamp) => {
  const d = new Date(timestamp); return Number.isNaN(d.valueOf()) ? 'Unknown date' : d.toLocaleDateString(undefined, {month:'short', day:'numeric', year:'numeric'});
};

function renderPlan() {
  const pct = valueOr(draft.base_attendance_pct);
  const cap = valueOr(draft.capacity);
  const supportFees = draft.support_artists.reduce((sum, a) => sum + Math.max(0, valueOr(a.fee)), 0);
  const artists = draft.support_artists.map((a, i) => `<div class="artist-row">
    <label class="field"><span class="field-label">Artist ${i+1}</span><input type="text" data-support-name="${i}" value="${esc(a.name)}" placeholder="Opening act name" autocomplete="off"/></label>
    <label class="field"><span class="field-label">Fee</span><input type="number" inputmode="decimal" step="any" min="0" data-support-fee="${i}" value="${esc(a.fee)}"/></label>
    <button class="remove-btn" data-action="remove-artist" data-index="${i}" aria-label="Remove support artist ${i+1}" type="button">×</button>
  </div>`).join('');
  return `<div class="page">
    <section class="hero"><div class="eyebrow">TOUR & EVENT PLANNING</div><h1>Make every show count.</h1><p class="subtitle">Build the lineup, estimate the audience, and see what your tickets need to earn.</p>
      <div class="hero-bottom"><span class="small-caption">${esc(draft.artist.trim() || 'New concert plan')} · ${esc(draft.city.trim() || 'Choose a city')}</span><span class="mini-pill"><span class="status-dot"></span> DRAFT</span></div>
    </section>
    <div class="metric-grid">${stat('Venue capacity', formatNumber(cap))}${stat('Expected guests', formatNumber(Math.round(cap*pct/100)), {accent:true})}${stat('Opening acts', draft.support_artists.filter(a=>a.name.trim()).length)}${stat('Support fees', money(supportFees), {small:true})}</div>
    ${card('Event essentials', `<div class="form-grid">
      ${formField('Headline artist', 'artist', {placeholder:'e.g. Artist / band name'})}
      ${formField('City / market', 'city', {placeholder:'e.g. Sofia'})}
      ${formField('Venue capacity', 'capacity', {num:true,step:'1'})}
      <label class="field"><span class="field-label">Financial currency</span><select data-field="currency">
        ${['EUR','BGN','USD','GBP'].map(c=>`<option value="${c}" ${draft.currency===c?'selected':''}>${c} ${({EUR:'€',BGN:'лв',USD:'$',GBP:'£'})[c]}</option>`).join('')}</select></label>
    </div>`, `<span class="label-chip">01 / EVENT</span>`)}
    ${card('Attendance assumptions', `<p class="section-caption">Percentage of venue capacity for each scenario. You can update these from research.</p>
      <div class="three-col">
       ${formField('Low %', 'low_attendance_pct', {num:true,min:0})}
       ${formField('Base %', 'base_attendance_pct', {num:true,min:0})}
       ${formField('High %', 'high_attendance_pct', {num:true,min:0})}
      </div><div class="line-stat"><span>Base attendance</span><strong id="base-guest-summary">${formatNumber(Math.round(cap * pct / 100))} guests</strong></div>`, `<span class="label-chip">02 / DEMAND</span>`)}
    ${card('Supporting artists / opening acts', `<p class="section-caption">Add each supporting act and their performance fee. These costs feed into all ticket prices.</p>
      <div id="artist-rows">${artists || '<div class="empty-artists">No support artists added yet.<br>Add your first opening act below.</div>'}</div>
      <button type="button" class="circle-add" data-action="add-artist">＋ Add support artist</button>
      <div class="line-stat"><span>Combined support fees</span><strong id="support-total">${money(supportFees)}</strong></div>`, `<span class="label-chip">03 / LINEUP</span>`)}
    <div class="sticky-action"><button class="btn btn-secondary" data-action="save">Save plan</button><button class="btn btn-primary" data-action="go" data-target="budget">Continue to budget →</button></div>
  </div>`;
}

function renderBudget() {
  const fees = draft.support_artists.reduce((sum,a) => sum + Math.max(0,valueOr(a.fee)),0);
  let preview = null;
  try {preview = computeFinance(draft);} catch {}
  return `<div class="page">
    ${sectionTitle('02 / FINANCIAL MODEL','Set the budget','Costs, income, fees, and profit targets — all on one screen.', `<span class="mini-pill">${esc(draft.currency)}</span>`)}
    <div class="metric-grid">${stat('Est. event cost', preview ? money(preview.totalCost) : '—', {accent:true,small:true})}${stat('Support artists', money(fees), {small:true})}</div>
    ${card('Artists & rights', `<div class="form-grid">
      ${budgetField('Headliner fee', 'artist_fee')}
      ${budgetField('Music rights', 'music_rights_pct', {suffix:'%'})}
      ${budgetField('Artist deposit', 'artist_deposit_pct', {suffix:'%'})}
    </div><div class="line-stat"><span>Support-artist fees (from Plan)</span><strong>${money(fees)}</strong></div>
    <p class="under-note">Like the original calculator, deposit and rights percentages apply only to the headliner. The deposit is included as an additional modeled cost.</p>`, `<span class="label-chip">TALENT</span>`)}
    ${card('Venue & operations', `<div class="form-grid">
      ${budgetField('Venue / rental', 'venue')}${budgetField('Production', 'production')}
      ${budgetField('Staffing', 'staffing')}${budgetField('Security', 'security')}
      ${budgetField('Insurance', 'insurance')}${budgetField('Travel', 'travel')}
      ${budgetField('Hospitality', 'hospitality')}
    </div>`, `<span class="label-chip">OPERATIONS</span>`)}
    ${card('Marketing & other costs', `<div class="form-grid">
      ${budgetField('Marketing', 'marketing')}${budgetField('Bar budget / cost', 'bar_budget')}
      ${budgetField('Other costs', 'other')}${budgetField('Contingency', 'contingency_pct', {suffix:'%'})}
    </div>`, `<span class="label-chip">COSTS</span>`)}
    ${card('Income & target', `<div class="form-grid">
      ${budgetField('Sponsor income', 'sponsor_money')}
      ${formField('Bar revenue per guest', 'bar_revenue_per_attendee', {num:true})}
      ${formField('Desired profit', 'target_profit', {num:true,min:'-999999999'})}
      ${budgetField('Ticketing fee', 'ticket_fee_pct', {suffix:'%'})}
      ${budgetField('Tax', 'tax_pct', {suffix:'%'})}
    </div>`, `<span class="label-chip">REVENUE</span>`)}
    <div class="callout"><strong>How the ticket target works</strong><br>Sponsors and bar revenue offset event costs. Ticket fees and tax reduce the portion of each ticket you keep.</div>
    <button class="btn btn-primary btn-full" data-action="calculate">Calculate ticket prices →</button>
  </div>`;
}

function renderResults() {
  try {calculation = computeFinance(draft);}
  catch (error) {
    calculation = null;
    return `<div class="page">${sectionTitle('03 / FINANCIAL RESULTS','Your numbers','Review the event model and ticket-price scenarios.')}
      <div class="callout warning"><strong>Review your inputs</strong><br>${esc(error.message)}</div>
      <button class="btn btn-primary" data-action="go" data-target="plan">Edit event details</button></div>`;
  }
  const c = calculation;
  const att = c.attendance[scenario];
  const max = Math.max(...c.scenarios.map(s=>Math.abs(s[scenario])),1);
  const rows = c.scenarios.map(s=>{
    const p = s[scenario];
    const positive = p >= 0;
    return `<div class="scenario-row"><div class="scenario-price">${money(s.price)}</div><div>
      <div class="scenario-profit ${positive?'is-positive':'is-negative'}">${p>=0?'+':''}${money(p)}</div>
      <div class="profit-bar"><span style="width:${Math.max(4,Math.abs(p)/max*100).toFixed(1)}%;background:${positive?'var(--green)':'var(--red)'}"></span></div>
    </div></div>`;
  }).join('');
  return `<div class="page">
    ${sectionTitle('03 / TICKET ECONOMICS','Financial results','Your latest budget and audience assumptions, calculated live.', `<span class="mini-pill">${esc(draft.currency)}</span>`)}
    <div class="metric-grid">
      ${stat('Total event cost',money(c.totalCost),{accent:true,small:true})}
      ${stat('Base ticket target',money(c.ticketNeeded.base),{small:true})}
      ${stat('Base attendance',formatNumber(c.attendance.base))}
      ${stat('Support fees',money(c.supportFees),{small:true})}
    </div>
    ${card('Required ticket price', `<p class="section-caption">Minimum ticket price to meet your profit target at each attendance level.</p>
      <div class="section-stack"><div class="two-col">
        ${stat(`Low · ${draft.low_attendance_pct}%`, money(c.ticketNeeded.low),{small:true})}
        ${stat(`Base · ${draft.base_attendance_pct}%`, money(c.ticketNeeded.base),{accent:true,small:true})}
      </div>${stat(`High · ${draft.high_attendance_pct}%`, money(c.ticketNeeded.high),{small:true,foot:`${formatNumber(c.attendance.high)} guests`})}</div>
    `, `<span class="label-chip">TARGET PRICES</span>`)}
    ${card('Ticket price scenarios', `<p class="section-caption">Select an attendance case to see estimated profit or loss at different public ticket prices.</p>
      <div class="segmented" role="group" aria-label="Attendance scenario">
        ${['low','base','high'].map(s=>`<button type="button" class="segment ${scenario===s?'selected':''}" aria-pressed="${scenario===s}" data-action="scenario" data-scenario="${s}">${s[0].toUpperCase()+s.slice(1)}</button>`).join('')}
      </div><div class="line-stat"><span>Assumed guests</span><strong>${formatNumber(att)} attendees</strong></div><div class="section-stack">${rows}</div>`, `<span class="label-chip">PROFIT / LOSS</span>`)}
    ${card('Cost & income breakdown', `<div class="summary-rows">
      ${row('Headliner fee',money(c.plan.budget.artist_fee))}${row('Supporting artists',money(c.supportFees))}
      ${row('Music rights',money(c.musicRights))}${row('Artist deposit',money(c.artistDeposit))}
      ${row('Base costs (incl. talent)',money(c.fixed))}${row('Contingency',money(c.contingency))}
      ${row('Total costs',money(c.totalCost))}${row('Sponsor income',money(c.plan.budget.sponsor_money))}
      ${row('Base bar revenue',money(c.barRevenue.base))}${row('Desired profit',money(c.plan.target_profit))}
    </div>`)}
    <div class="callout warning"><strong>Planning assumptions</strong><br>This model uses estimated attendance, not a guarantee of ticket sales. Values are in ${esc(draft.currency)}; changing the currency label does not convert amounts.</div>
    <div class="btn-row"><button class="btn btn-secondary" data-action="go" data-target="budget">Edit budget</button><button class="btn btn-primary" data-action="save">Save calculation</button></div>
  </div>`;
}

function renderResearch() {
  const r = researchResult;
  const running = researchStatus.busy;
  let report = '';
  if (r) {
    const countGood = r.providerStatus.filter(s=>s.status==='ok').length;
    const countFail = r.providerStatus.filter(s=>s.status==='failed').length;
    const artistProfile = r.wiki?.profile;
    const summaryHtml = `<div class="metric-grid">
      ${stat('Found sources',r.sources.length,{accent:true})}${stat('Provider checks',r.providerStatus.length)}
      ${stat('Successful checks',countGood)}${stat('Blocked / failed',countFail)}
    </div>`;
    const profileItems = [];
    if (artistProfile) profileItems.push(`<div class="report-card"><h3>Wikipedia · ${esc(artistProfile.name)}</h3><p>${esc(artistProfile.description || 'Artist profile available.')}</p>${artistProfile.url ? `<a class="text-link" href="${esc(artistProfile.url)}" target="_blank" rel="noopener noreferrer">View Wikipedia ↗</a>`:''}</div>`);
    if (r.wiki?.views != null) profileItems.push(`<div class="report-card"><h3>Public attention</h3><p>Wikipedia average daily article views over the previous 30 days: <strong>${formatNumber(r.wiki.views)}</strong>.</p><span class="tiny-text">Not equivalent to tickets sold.</span></div>`);
    if (r.mb) profileItems.push(`<div class="report-card"><h3>MusicBrainz · ${esc(r.mb.name)}</h3><p>${esc([r.mb.kind, r.mb.country, ...(r.mb.tags||[])].filter(Boolean).join(' · '))}</p>${r.mb.url?`<a class="text-link" href="${esc(r.mb.url)}" target="_blank" rel="noopener noreferrer">View artist record ↗</a>`:''}</div>`);
    if (r.lastfm) profileItems.push(`<div class="report-card"><h3>Last.fm listening signal</h3><p>${formatNumber(r.lastfm.listeners)} listeners · ${formatNumber(r.lastfm.plays)} plays (global, not local demand).</p></div>`);
    const evidence = r.clues.length
      ? r.clues.map(e=>`<div class="report-card"><h3>Possible crowd figure: ${formatNumber(e.value)}</h3><p>${esc(e.context)}</p><a class="text-link" href="${esc(e.source)}" target="_blank" rel="noopener noreferrer">Review original source ↗</a></div>`).join('')
      : `<div class="empty-state"><h3>No reliable numerical clues extracted</h3><p>Search sources can still be useful for learning about concerts and promoters. Keep manual attendance assumptions for now.</p></div>`;
    const suggestion = r.forecast ? `<div class="callout warning"><strong>Provisional audience scenario</strong><br>
      Low ${r.forecast.low}% · Base ${r.forecast.base}% · High ${r.forecast.high}%<br>
      Built from ${r.forecast.domains} distinct-domain numerical clues. Verify these reports before use.
      <div style="margin-top:12px"><button class="btn btn-primary btn-full" data-action="apply-forecast">Apply to event assumptions</button></div></div>`
      : `<div class="callout"><strong>Your current percentages are unchanged.</strong><br>Not enough independent, market-specific attendance figures were found to justify replacing them automatically.</div>`;
    const sources = r.sources.length ? r.sources.map((s,i)=>`<div class="report-card">
        <span class="label-chip">${esc(s.provider)} · ${i+1}</span>
        <h3 style="margin-top:9px">${esc(s.title)}</h3><p>${esc(s.snippet.slice(0,380) || 'No preview was supplied by this provider.')}</p>
        <a class="text-link report-source" href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.domain || 'View source')} ↗</a>
      </div>`).join('') : '<div class="callout warning">No readable search results were returned. In a web browser, some providers block cross-site requests. The packaged Android/iOS app can use native HTTP requests.</div>';
    report = `${summaryHtml}
      ${card('Forecast & limitations', `${suggestion}<p class="under-note">These are search-derived clues and must not be treated as confirmed actual sales.</p>`)}
      ${card('Artist databases', profileItems.length ? `<div class="section-stack">${profileItems.join('')}</div>` : '<p class="subtitle">No artist database profile could be verified.</p>')}
      ${card(`Ticket / attendance clues · ${r.clues.length}`,`<div class="section-stack">${evidence}</div>`)}
      ${r.events ? card(`Ticketmaster listed events · ${r.events.length}`, `<div class="section-stack">${r.events.length ? r.events.map(ev=>`<div class="report-card"><h3>${esc(ev.title)}</h3><p>${esc([ev.date,ev.city,ev.venue].filter(Boolean).join(' · '))}${ev.local?' · Same market':''}</p>${ev.url?`<a class="text-link" href="${esc(ev.url)}" target="_blank" rel="noopener noreferrer">View event ↗</a>`:''}</div>`).join('') : '<p class="subtitle">No matching events returned.</p>'}</div>`) : ''}
      ${card(`Research sources · ${r.sources.length}`, `<div class="section-stack">${sources}</div>`)}
      ${card('Provider coverage',`<div class="summary-rows">${r.providerStatus.map(s=>row(s.label, `${s.status==='ok'?'✓':'×'} ${s.status}${s.hits!==undefined?` · ${s.hits} hits`:''}${s.reason?` (${s.reason})`:''}`)).join('')}</div>`)}
      <button class="btn btn-secondary btn-full" data-action="export-research">Export research report (.txt)</button>`;
  } else if (!running) {
    report = `<div class="empty-state"><span class="empty-icon">⌕</span><h3>Research the concert market</h3><p>Explore artist data, concerts, and local ticketing news without losing your current budget inputs.</p></div>`;
  }
  return `<div class="page">
    ${sectionTitle('04 / ARTIST INTELLIGENCE','Internet research','Look up independent artist databases, venue news and ticketing mentions.')}
    ${card('Research target', `<div class="summary-rows">
      ${row('Headline artist', draft.artist.trim()||'Not set')}${row('Market',draft.city.trim()||'Not set')}
      ${row('Capacity',formatNumber(valueOr(draft.capacity)))}</div>
      <div class="btn-row" style="margin-top:14px"><button class="btn btn-secondary" data-action="go" data-target="plan">Edit event</button>
      <button class="btn btn-primary" ${running?'disabled':''} id="research-run" data-action="run-research">${running?'Searching…':'Search online sources'}</button></div>`)}
    <section class="card"><button class="expander" data-action="toggle-keys" aria-expanded="${researchSettingsOpen}"><span>Optional source API keys</span><span class="chevron">${researchSettingsOpen?'−':'＋'}</span></button>
      <div class="settings" ${researchSettingsOpen?'':'hidden'}>
        <p class="subtitle">Optional keys enable Last.fm listening signals and Ticketmaster event listings. They stay in memory for this session and are not added to saved concert files.</p>
        <label class="field"><span class="field-label">Last.fm API key</span><input data-api-key="lastfm" type="password" autocomplete="off" value="${esc(researchKeys.lastfm)}" placeholder="Optional"/></label>
        <label class="field"><span class="field-label">Ticketmaster Discovery API key</span><input data-api-key="ticketmaster" type="password" autocomplete="off" value="${esc(researchKeys.ticketmaster)}" placeholder="Optional"/></label>
      </div></section>
    ${running ? `<div class="card"><strong id="research-progress-text">${esc(researchStatus.text)}</strong>
      <div class="progress-track"><div id="research-progress-bar" style="width:${Math.round(researchStatus.current/researchStatus.total*100)}%"></div></div>
      <p class="tiny-text">External sources can be slow or unavailable. Your plan remains editable after the search.</p></div>`:''}
    ${report}
  </div>`;
}

function savedCard(plan) {
  const id = esc(plan.id);
  const isSelected = selectedSaved.has(plan.id);
  let figures = null;
  try {figures = summary(plan);} catch {}
  const acts = Array.isArray(plan.support_artists) ? plan.support_artists.filter(a=>a?.name).length : 0;
  return `<article class="list-card ${isSelected?'selected':''}">
    <input class="select-check" type="checkbox" data-select-saved="${id}" aria-label="Select ${esc(plan.artist||'Untitled show')} for comparison" ${isSelected?'checked':''}>
    <div class="list-body"><div class="list-title">${esc(plan.artist || 'Untitled concert')} <span style="color:var(--accent)">·</span> ${esc(plan.city || 'City not set')}</div>
      <div class="list-meta">${safeDate(plan.timestamp)} · ${formatNumber(valueOr(plan.capacity))} capacity · ${acts} support acts<br>
        ${figures ? `${money(figures.cost,figures.currency)} cost · ${money(figures.ticket,figures.currency)} base ticket target` : 'Saved concert plan'}</div>
      <div class="list-actions">
        <button class="btn btn-secondary btn-inline" data-action="load-saved" data-id="${id}">Load</button>
        <button class="btn btn-ghost btn-inline" data-action="export-saved" data-id="${id}">Export</button>
        <button class="btn btn-danger btn-inline" data-action="delete-saved" data-id="${id}">Delete</button>
      </div></div></article>`;
}
function fileCard(doc) {
  const id = esc(doc.id), hasCalc = !!doc.plans?.length;
  const isSelected = selectedFiles.has(doc.id);
  return `<article class="list-card ${isSelected?'selected':''}">
    <input class="select-check" type="checkbox" data-select-file="${id}" aria-label="Select ${esc(doc.name)} for comparison" ${isSelected?'checked':''} ${hasCalc?'':'disabled'}>
    <div class="list-body"><div class="list-title">${esc(doc.name)}</div><div class="list-meta">${safeDate(doc.importedAt)} · ${hasCalc?`${doc.plans.length} saved calculation${doc.plans.length===1?'':'s'}`:`${esc(doc.extension||'file')} document`}</div>
      <div class="list-actions">
        ${hasCalc ? `<button class="btn btn-secondary btn-inline" data-action="load-file" data-id="${id}">Load latest</button>`:''}
        ${doc.preview ? `<button class="btn btn-ghost btn-inline" data-action="preview-file" data-id="${id}">Preview</button>`:''}
        <button class="btn btn-danger btn-inline" data-action="delete-file" data-id="${id}">Remove</button>
      </div>${!hasCalc && !doc.preview ? `<p class="tiny-text">File added for reference; this format is not automatically extracted.</p>` : ''}
    </div></article>`;
}
function renderLibrary() {
  const saved = currentLibraryTab === 'saved';
  return `<div class="page">
    ${sectionTitle('05 / YOUR WORKSPACE','Saved library','Load old plans, export backups, compare calculations, or import desktop files.')}
    <div class="segmented two library-tabs" role="group" aria-label="Library type">
      <button class="segment ${saved?'selected':''}" aria-pressed="${saved}" data-action="library-tab" data-kind="saved">Saved plans (${history.length})</button>
      <button class="segment ${saved?'':'selected'}" aria-pressed="${!saved}" data-action="library-tab" data-kind="files">Documents (${documents.length})</button>
    </div>
    <div class="btn-row">
      ${saved ? `<button class="btn btn-secondary" data-action="save">Save current</button>` : `<button class="btn btn-secondary" data-action="pick-files">Import files</button>`}
      <button class="btn btn-primary" data-action="compare-library">Compare 2 selected (${saved?selectedSaved.size:selectedFiles.size})</button>
    </div>
    ${saved ? (history.length ? `<div class="section-stack">${[...history].reverse().map(savedCard).join('')}</div>`
      : `<div class="empty-state"><span class="empty-icon">▤</span><h3>No saved plans yet</h3><p>Calculate an event, then tap Save to keep a copy on this device.</p><button class="btn btn-primary" data-action="go" data-target="plan">Create your first plan</button></div>`)
      : (documents.length ? `<div class="section-stack">${[...documents].reverse().map(fileCard).join('')}</div>`
      : `<div class="empty-state"><span class="empty-icon">▧</span><h3>Bring your files along</h3><p>Import desktop concert JSON calculations. You can also keep TXT, CSV, PDF, XLSX or DOCX files as references.</p><button class="btn btn-primary" data-action="pick-files">Import a file</button></div>`)}
    <div class="callout"><strong>Keep a backup.</strong><br>Saved plans are stored on this device, not synced to your computer. Export JSON before clearing app data or changing phones. Desktop calculation JSON files can be imported directly.</div>
  </div>`;
}

function render({keepScroll = false} = {}) {
  const top = document.documentElement.scrollTop || document.body.scrollTop;
  const functions = {plan:renderPlan, budget:renderBudget, results:renderResults, research:renderResearch, library:renderLibrary};
  main.innerHTML = functions[currentTab]();
  document.querySelectorAll('.nav-btn').forEach(btn => {
    const active = btn.dataset.tab === currentTab;
    btn.classList.toggle('active',active);
    if (active) btn.setAttribute('aria-current','page'); else btn.removeAttribute('aria-current');
  });
  if (keepScroll) requestAnimationFrame(() => window.scrollTo(0,top));
}
function go(tab) {
  if (!['plan','budget','results','research','library'].includes(tab)) return;
  currentTab = tab;
  render();
  window.scrollTo({top:0,behavior:'instant'});
}
function tryCompute() {
  try {calculation = computeFinance(draft);return true;}
  catch (e) {toast(e.message);return false;}
}
function saveCurrent() {
  try {
    if (!tryCompute()) return;
    const item = {...snapshot(draft),id:uid()};
    history = [...history,item].slice(-100);
    selectedSaved.clear();persist();toast('Calculation saved to your mobile library.');
    if (currentTab==='library')render({keepScroll:true});
  } catch (e) {toast(e.message);}
}
function loadPlan(plan) {
  draft = normalizePlan(plan); calculation=null;persist();go('plan');toast('Plan loaded — ready to edit.');
}
function comparePlans(plans) {
  try {
    const a = summary(plans[0]), b = summary(plans[1]);
    const metrics = [
      ['Artist',a.artist,b.artist], ['City',a.city,b.city],
      ['Total cost',money(a.cost,a.currency),money(b.cost,b.currency)],
      ['Support fees',money(a.support_fees,a.currency),money(b.support_fees,b.currency)],
      ['Base attendance',formatNumber(a.attendance),formatNumber(b.attendance)],
      ['Sponsor income',money(a.sponsor,a.currency),money(b.sponsor,b.currency)],
      ['Bar revenue',money(a.bar,a.currency),money(b.bar,b.currency)],
      ['Ticket target',money(a.ticket,a.currency),money(b.ticket,b.currency)],
      ['Support acts',a.support_names,b.support_names],
    ];
    dialogBody.innerHTML = `<h2 id="dialog-title">Compare concert plans</h2><p>Side-by-side results use the same calculation logic as the original desktop script.</p>
      ${a.currency!==b.currency?`<div class="callout warning">Different currencies: amounts are shown as saved, without conversion.</div>`:''}
      <div class="comparison-table"><div class="compare-head">Metric</div><div class="compare-head">Plan A</div><div class="compare-head">Plan B</div>
      ${metrics.map(m=>`<div class="compare-label">${esc(m[0])}</div><div>${esc(m[1])}</div><div>${esc(m[2])}</div>`).join('')}</div>
      <div class="btn-row"><button class="btn btn-secondary" data-action="close-dialog">Close</button></div>`;
    modal.showModal();
  } catch (e) {toast(`Cannot compare: ${e.message}`);}
}
function openPreview(doc) {
  dialogBody.innerHTML = `<h2 id="dialog-title">${esc(doc.name)}</h2><p>Text preview · first 10,000 characters</p>
    <pre style="white-space:pre-wrap;font-size:12px;line-height:1.6;word-break:break-word;max-height:55vh;overflow:auto">${esc(doc.preview)}</pre><button class="btn btn-secondary btn-full" data-action="close-dialog">Close</button>`;
  modal.showModal();
}
function toFileName(v) {return String(v||'concert').trim().replace(/[^a-z0-9_-]+/gi,'_').slice(0,48)||'concert';}
async function exportData(name, text, type='application/json') {
  const blob = new Blob([text], {type:`${type};charset=utf-8`});
  try {
    const file = new File([blob], name, {type});
    if (navigator.canShare?.({files:[file]}) && navigator.share) {
      await navigator.share({files:[file], title:name});
      return;
    }
  } catch (e) {if (e.name==='AbortError') return;}
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');a.href=url;a.download=name;a.style.display='none';
  document.body.appendChild(a);a.click();a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1200);
  toast('File export started.');
}
async function importFiles(files) {
  if (!files?.length) return;
  let count = 0, jsonFound=0, errors=[];
  for (const f of [...files].slice(0,20)) {
    if (f.size > 8 * 1024 * 1024) {errors.push(`${f.name} is too large (8 MB limit).`);continue;}
    const ext = (f.name.split('.').at(-1)||'').toLowerCase();
    if (!['json','txt','csv','pdf','xlsx','docx'].includes(ext)) {errors.push(`${f.name} is not a supported file type.`);continue;}
    let plans=[], preview='';
    try {
      if (ext==='json') {
        const raw = JSON.parse(await f.text());
        const items = (Array.isArray(raw) ? raw : [raw]).filter(x=>x && typeof x==='object' && x.budget);
        plans = items.slice(-100).map(x=>snapshot(x, x.timestamp || new Date().toISOString()));
        if (!plans.length) throw new Error('No concert calculations in JSON file');
        jsonFound+=plans.length;
      } else if (['txt','csv'].includes(ext)) preview=(await f.text()).slice(0,10000);
      documents.push({id:uid(),name:f.name, extension:ext.toUpperCase(),importedAt:new Date().toISOString(),plans,preview});
      count++;
    } catch(e) {errors.push(`${f.name}: ${e.message}`);}
  }
  documents=documents.slice(-60);persist();filePicker.value='';go('library');currentLibraryTab='files';render();
  toast(`${count} file(s) imported${jsonFound?` · ${jsonFound} plans`:''}${errors.length?` · ${errors.length} failed`:''}.`);
  if (errors.length) console.warn('Import warnings:',errors.join('; '));
}

async function startResearch() {
  if (researchStatus.busy) return;
  if (!draft.artist.trim() || !draft.city.trim() || !(valueOr(draft.capacity)>0)) {
    toast('Set the headline artist, city and capacity in Plan first.');return;
  }
  researchStatus = {busy:true,text:'Connecting to public sources…',current:0,total:10};
  go('research');
  try {
    const result = await researchArtist({artist:draft.artist, city:draft.city,
      capacity:valueOr(draft.capacity),lastfmKey:researchKeys.lastfm.trim(),
      ticketmasterKey:researchKeys.ticketmaster.trim()}, (message, done, total) => {
        researchStatus={busy:true,text:message,current:done,total:Math.max(total,1)};
        const status = $('#research-progress-text'), bar = $('#research-progress-bar');
        if(status) status.textContent=message;
        if(bar) bar.style.width=`${Math.round(done/Math.max(total,1)*100)}%`;
      });
    researchResult=result;
    toast(`Research finished · ${result.sources.length} sources found.`);
  } catch(e) {toast(`Research error: ${e.message}`);}
  finally {researchStatus.busy=false;render({keepScroll:true});}
}

// All buttons use delegated handlers so they survive view redraws.
document.addEventListener('click', async event => {
  const nav = event.target.closest('[data-tab]');
  if (nav) {go(nav.dataset.tab);return;}
  if (event.target.closest('#header-save')) {saveCurrent();return;}
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const {action, id, target, index, scenario:scenarioTarget, kind} = button.dataset;
  switch(action) {
    case 'go':go(target);break;
    case 'calculate':if(tryCompute())go('results');break;
    case 'save':saveCurrent();break;
    case 'add-artist':
      draft.support_artists.push({name:'',fee:'0'});persist();render({keepScroll:true});
      document.querySelectorAll('[data-support-name]')[draft.support_artists.length-1]?.focus();break;
    case 'remove-artist':
      draft.support_artists.splice(Number(index),1);persist();render({keepScroll:true});break;
    case 'scenario':scenario=scenarioTarget;render({keepScroll:true});break;
    case 'library-tab':currentLibraryTab=kind;render({keepScroll:true});break;
    case 'pick-files':filePicker.click();break;
    case 'load-saved':{
      const item=history.find(x=>x.id===id);if(item)loadPlan(item);break;}
    case 'delete-saved':{
      if (!confirm('Delete this saved calculation from this device?')) break;
      history=history.filter(x=>x.id!==id);selectedSaved.delete(id);persist();render({keepScroll:true});toast('Saved calculation deleted.');break;}
    case 'export-saved':{
      const plan=history.find(x=>x.id===id);
      if (plan) {const clean={...plan};delete clean.id;
        await exportData(`${toFileName(plan.artist)}_${toFileName(plan.city)}.json`,JSON.stringify(clean,null,2));}break;}
    case 'compare-library':{
      if(currentLibraryTab==='saved') {
        if(selectedSaved.size!==2){toast('Select exactly 2 saved calculations.');break;}
        comparePlans([...selectedSaved].map(id=>history.find(x=>x.id===id)).filter(Boolean));
      } else {
        if(selectedFiles.size!==2){toast('Select exactly 2 calculation documents.');break;}
        comparePlans([...selectedFiles].map(id=>documents.find(x=>x.id===id)?.plans?.at(-1)).filter(Boolean));
      }break;}
    case 'load-file':{
      const f=documents.find(x=>x.id===id);if(f?.plans?.length)loadPlan(f.plans.at(-1));break;}
    case 'preview-file':{
      const f=documents.find(x=>x.id===id);if(f)openPreview(f);break;}
    case 'delete-file':{
      if (!confirm('Remove this document from the mobile library?')) break;
      documents=documents.filter(x=>x.id!==id);selectedFiles.delete(id);persist();render({keepScroll:true});break;}
    case 'close-dialog':modal.close();break;
    case 'toggle-keys':researchSettingsOpen=!researchSettingsOpen;render({keepScroll:true});break;
    case 'run-research':await startResearch();break;
    case 'apply-forecast':{
      if(!researchResult?.forecast)break;
      const f=researchResult.forecast;
      draft.low_attendance_pct=String(f.low);draft.base_attendance_pct=String(f.base);draft.high_attendance_pct=String(f.high);
      calculation=null;persist();go('plan');toast('Suggested percentages applied. Check the source evidence.');break;}
    case 'export-research':{
      if(researchResult)await exportData(`research_${toFileName(researchResult.artist)}_${toFileName(researchResult.market)}.txt`,researchReportText(researchResult),'text/plain');break;}
  }
});

document.addEventListener('input', e => {
  const el = e.target;
  if (el.dataset.field) {
    draft[el.dataset.field]=el.value;calculation=null;persist();
    if (['capacity','base_attendance_pct'].includes(el.dataset.field)) {
      const label=$('#base-guest-summary');if(label)label.textContent=`${formatNumber(Math.round(valueOr(draft.capacity)*percent(valueOr(draft.base_attendance_pct))/100))} guests`;
    }
  } else if (el.dataset.budget) {
    draft.budget[el.dataset.budget]=el.value;calculation=null;persist();
  } else if (el.dataset.supportName!==undefined) {
    const act=draft.support_artists[Number(el.dataset.supportName)];if(act)act.name=el.value;
    calculation=null;persist();
  } else if (el.dataset.supportFee!==undefined) {
    const act=draft.support_artists[Number(el.dataset.supportFee)];if(act)act.fee=el.value;
    calculation=null;persist();const label=$('#support-total');
    if(label)label.textContent=money(draft.support_artists.reduce((s,a)=>s+Math.max(0,valueOr(a.fee)),0));
  } else if(el.dataset.apiKey) researchKeys[el.dataset.apiKey]=el.value;
});
document.addEventListener('change', e => {
  if(e.target.dataset.selectSaved) {
    const id=e.target.dataset.selectSaved;
    if(e.target.checked)selectedSaved.add(id);else selectedSaved.delete(id);
    render({keepScroll:true});
  } else if(e.target.dataset.selectFile) {
    const id=e.target.dataset.selectFile;
    if(e.target.checked)selectedFiles.add(id);else selectedFiles.delete(id);
    render({keepScroll:true});
  } else if (e.target.matches('select[data-field]')) {
    draft[e.target.dataset.field]=e.target.value;persist();
  }
});
filePicker.addEventListener('change',e=>{importFiles(e.target.files).catch(err=>toast(err.message));});
modal.addEventListener('click',e=>{if(e.target===modal)modal.close();});

// Legacy saved plans lack stable IDs. Adding an ID does not change the
// financial fields; exports remove it for compatibility with the desktop app.
history=history.map(item=>({...item,id:item.id||uid()}));
documents=documents.map(item=>({...item,id:item.id||uid()}));
persist();
render();
