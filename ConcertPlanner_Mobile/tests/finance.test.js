import test from 'node:test';
import assert from 'node:assert/strict';
import {BUDGET_FIELDS, defaultDraft, computeFinance, snapshot, normalizePlan, summary} from '../www/finance.js';

function sample() {
  const d=defaultDraft();
  d.artist='Headliner';d.city='Sofia';d.capacity='1000';
  d.budget.artist_fee='10000';d.budget.music_rights_pct='5';d.budget.artist_deposit_pct='20';
  d.budget.venue='3000';d.budget.production='2000';d.budget.marketing='1000';
  d.budget.sponsor_money='1500';d.budget.bar_budget='500';d.budget.contingency_pct='10';
  d.budget.ticket_fee_pct='8';d.budget.tax_pct='2';
  d.target_profit='2000';d.bar_revenue_per_attendee='5';
  d.support_artists=[{name:'Support one',fee:'1000'},{name:'Support two',fee:'500'}];
  return d;
}

test('all original 17 budget input fields preserved',()=>{
  assert.equal(BUDGET_FIELDS.length,17);
  for(const key of ['artist_fee','artist_deposit_pct','ticket_fee_pct','sponsor_money','bar_budget']) assert.ok(BUDGET_FIELDS.includes(key));
});
test('support fees are included in fixed costs, contingency, and ticket target',()=>{
  const c=computeFinance(sample());
  // 10000 + 500 rights + 2000 deposit + 1500 support + 3000 venue +
  // 2000 production + 1000 marketing + 500 bar = 20500.
  assert.equal(c.fixed, 20500);
  assert.equal(c.contingency,2050);
  assert.equal(c.totalCost,22550);
  assert.equal(c.attendance.low,500);
  assert.equal(c.attendance.base,700);
  assert.equal(c.attendance.high,900);
  const expected=Math.max(0,(22550+2000-1500-700*5)/(700*.90));
  assert.ok(Math.abs(c.ticketNeeded.base-expected)<1e-9);
  assert.equal(c.scenarios.length,10);
  const at20=c.scenarios.find(v=>v.price===20);
  assert.equal(at20.base,700*20*.9+1500+700*5-22550);
});
test('snapshot JSON is compatible with desktop support-artist structure',()=>{
  const saved=snapshot(sample(),'2026-11-26T00:00:00');
  assert.equal(saved.support_artists.length,2);
  assert.equal(saved.support_artists[0].name,'Support one');
  assert.equal(saved.budget.artist_fee,10000);
  assert.equal(saved.base_attendance_pct,70);
  assert.equal(saved.timestamp,'2026-11-26T00:00:00');
  assert.equal(summary(saved).support_fees,1500);
});
test('legacy desktop plan without support artists loads with zero acts',()=>{
  const legacy=sample();delete legacy.support_artists;
  const clean=normalizePlan(legacy);
  assert.deepEqual(clean.support_artists,[]);
  assert.equal(computeFinance(clean).supportFees,0);
});
test('prevents invalid attendance, negative support fees and excessive deductions',()=>{
  const bad=sample();bad.low_attendance_pct='101';
  assert.throws(()=>computeFinance(bad),/percentages/i);
  bad.low_attendance_pct='50';bad.support_artists[0].fee='-100';
  assert.throws(()=>computeFinance(bad),/cannot be negative/i);
  bad.support_artists[0].fee='100';bad.budget.tax_pct='97';
  assert.throws(()=>computeFinance(bad),/less than 100/i);
});
test('zero attendance scenarios never divide by zero',()=>{
  const d=sample();d.low_attendance_pct='0';
  const c=computeFinance(d);
  assert.equal(c.ticketNeeded.low,0);
  assert.ok(Number.isFinite(c.ticketNeeded.base));
});
