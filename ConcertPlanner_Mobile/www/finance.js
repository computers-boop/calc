/** Financial calculations ported from ConcertPlanner_Stage_Icon_Edition.py.
 *  All amounts use the currency selected by the user (no conversion).
 *  The original model treats the headliner deposit as an additional cost.
 */
export const BUDGET_FIELDS = [
  'artist_fee', 'music_rights_pct', 'artist_deposit_pct', 'sponsor_money',
  'bar_budget', 'venue', 'production', 'marketing', 'staffing', 'security',
  'insurance', 'travel', 'hospitality', 'other', 'contingency_pct',
  'ticket_fee_pct', 'tax_pct',
];
export const TICKET_PRICES = [20, 25, 30, 35, 40, 45, 50, 60, 75, 100];

export function defaultDraft() {
  return {
    artist: '', city: '', capacity: '1000', currency: 'EUR',
    low_attendance_pct: '50', base_attendance_pct: '70', high_attendance_pct: '90',
    target_profit: '0', bar_revenue_per_attendee: '0',
    budget: Object.fromEntries(BUDGET_FIELDS.map(key => [key, '0'])),
    support_artists: [],
  };
}

const numeric = (value, label) => {
  const v = value === null || value === undefined || value === '' ? 0 : Number(value);
  if (!Number.isFinite(v)) throw new Error(`${label} must be a valid number.`);
  return v;
};

export function normalizePlan(input = {}) {
  const defaults = defaultDraft();
  const budget = Object.fromEntries(BUDGET_FIELDS.map(k => [
    k, String(input?.budget?.[k] ?? defaults.budget[k]),
  ]));
  return {
    artist: String(input.artist ?? defaults.artist),
    city: String(input.city ?? defaults.city),
    capacity: String(input.capacity ?? defaults.capacity),
    currency: ['EUR', 'USD', 'BGN', 'GBP'].includes(input.currency) ? input.currency : 'EUR',
    low_attendance_pct: String(input.low_attendance_pct ?? defaults.low_attendance_pct),
    base_attendance_pct: String(input.base_attendance_pct ?? defaults.base_attendance_pct),
    high_attendance_pct: String(input.high_attendance_pct ?? defaults.high_attendance_pct),
    target_profit: String(input.target_profit ?? defaults.target_profit),
    bar_revenue_per_attendee: String(input.bar_revenue_per_attendee ?? defaults.bar_revenue_per_attendee),
    budget,
    support_artists: Array.isArray(input.support_artists)
      ? input.support_artists.filter(v => v && typeof v === 'object').slice(0, 100).map(v => ({
          name: String(v.name ?? ''), fee: String(v.fee ?? '0'),
        })) : [],
  };
}

export function validatePlan(input) {
  const plan = normalizePlan(input);
  const capacity = numeric(plan.capacity, 'Venue capacity');
  if (!(capacity > 0) || !Number.isInteger(capacity)) {
    throw new Error('Venue capacity must be a positive whole number.');
  }
  const percentages = ['low_attendance_pct', 'base_attendance_pct', 'high_attendance_pct'];
  const [lowPct, basePct, highPct] = percentages.map(k => numeric(plan[k], k.replaceAll('_', ' ')));
  for (const pct of [lowPct, basePct, highPct]) {
    if (pct < 0 || pct > 100) throw new Error('Attendance percentages must be between 0 and 100.');
  }
  if (!(lowPct <= basePct && basePct <= highPct)) {
    throw new Error('Attendance must follow Low ≤ Base ≤ High.');
  }
  const budget = {};
  for (const key of BUDGET_FIELDS) {
    budget[key] = numeric(plan.budget[key], key.replaceAll('_', ' '));
    if (budget[key] < 0) throw new Error(`${key.replaceAll('_', ' ')} cannot be negative.`);
  }
  if (budget.ticket_fee_pct + budget.tax_pct >= 100) {
    throw new Error('Ticket fees plus taxes must be less than 100%.');
  }
  const supportArtists = [];
  for (const [index, item] of plan.support_artists.entries()) {
    const name = item.name.trim();
    const fee = numeric(item.fee, `Support artist #${index + 1} fee`);
    if (!name && fee === 0) continue;
    if (!name) throw new Error(`Enter a name for support artist #${index + 1}, or remove the row.`);
    if (fee < 0) throw new Error(`Support fee for ${name} cannot be negative.`);
    supportArtists.push({name, fee});
  }
  const targetProfit = numeric(plan.target_profit, 'Desired profit');
  const barPer = numeric(plan.bar_revenue_per_attendee, 'Bar revenue per attendee');
  if (barPer < 0) throw new Error('Bar revenue per attendee cannot be negative.');
  return {
    artist: plan.artist.trim(), city: plan.city.trim(), capacity, currency: plan.currency,
    low_attendance_pct: lowPct, base_attendance_pct: basePct, high_attendance_pct: highPct,
    target_profit: targetProfit, bar_revenue_per_attendee: barPer,
    support_artists: supportArtists, budget,
  };
}

export function computeFinance(input) {
  const plan = validatePlan(input);
  const b = plan.budget;
  const supportFees = plan.support_artists.reduce((sum, a) => sum + a.fee, 0);
  const musicRights = b.artist_fee * b.music_rights_pct / 100;
  const artistDeposit = b.artist_fee * b.artist_deposit_pct / 100;
  const fixed = b.artist_fee + musicRights + artistDeposit + supportFees
    + b.bar_budget + b.venue + b.production + b.marketing + b.staffing
    + b.security + b.insurance + b.travel + b.hospitality + b.other;
  const contingency = fixed * b.contingency_pct / 100;
  const totalCost = fixed + contingency;
  const retained = 1 - (b.ticket_fee_pct + b.tax_pct) / 100;
  const attendance = {
    low: Math.max(0, Math.round(plan.capacity * plan.low_attendance_pct / 100)),
    base: Math.max(0, Math.round(plan.capacity * plan.base_attendance_pct / 100)),
    high: Math.max(0, Math.round(plan.capacity * plan.high_attendance_pct / 100)),
  };
  const ticketNeeded = att => att <= 0 ? 0 : Math.max(0,
    (totalCost + plan.target_profit - b.sponsor_money - att * plan.bar_revenue_per_attendee)
      / (att * retained));
  const profit = (att, price) => att * price * retained + b.sponsor_money
    + att * plan.bar_revenue_per_attendee - totalCost;
  return {
    plan,
    supportFees, musicRights, artistDeposit, fixed, contingency, totalCost,
    retained, attendance,
    barRevenue: Object.fromEntries(Object.entries(attendance)
      .map(([key, att]) => [key, att * plan.bar_revenue_per_attendee])),
    ticketNeeded: Object.fromEntries(Object.entries(attendance)
      .map(([key, att]) => [key, ticketNeeded(att)])),
    scenarios: TICKET_PRICES.map(price => ({
      price, low: profit(attendance.low, price),
      base: profit(attendance.base, price), high: profit(attendance.high, price),
    })),
  };
}

export function snapshot(input, timestamp = new Date().toISOString()) {
  const clean = validatePlan(input);
  // Keep the exact desktop JSON field names for file interchange.
  return {timestamp, ...clean};
}

export function summary(input) {
  const calc = computeFinance(input);
  return {
    artist: calc.plan.artist, city: calc.plan.city,
    cost: calc.totalCost, attendance: calc.attendance.base,
    bar: calc.barRevenue.base, sponsor: calc.plan.budget.sponsor_money,
    ticket: calc.ticketNeeded.base, support_fees: calc.supportFees,
    support_names: calc.plan.support_artists.map(a => a.name).join(', ') || 'None',
    currency: calc.plan.currency,
  };
}

export function formatMoney(value, currency = 'EUR') {
  return new Intl.NumberFormat('en-US', {style: 'currency', currency, maximumFractionDigits: 2})
    .format(value);
}
export const formatNumber = (n) => new Intl.NumberFormat('en-US', {maximumFractionDigits: 0}).format(n);
