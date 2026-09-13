const test=require('node:test');
const assert=require('node:assert/strict');
const {presetDates}=require('../public/date-presets');
const {resolveWindow}=require('../src/acquisition');
test('calendar presets use complete UTC days and Monday-start weeks',()=>{
 const now=Date.parse('2026-09-13T19:00:00Z');
 assert.deepEqual(presetDates('this_week',now),{start:'2026-09-07',end:'2026-09-12'});
 assert.deepEqual(presetDates('last_week',now),{start:'2026-08-31',end:'2026-09-06'});
 assert.deepEqual(presetDates('this_month',now),{start:'2026-09-01',end:'2026-09-12'});
 assert.deepEqual(presetDates('last_month',now),{start:'2026-08-01',end:'2026-08-31'});
 assert.deepEqual(presetDates('ytd',now),{start:'2026-01-01',end:'2026-09-12'});
 assert.equal(resolveWindow(presetDates('ytd',now),now).days,255);
});
test('year and leap-month boundaries do not drift or invent days',()=>{
 const jan=Date.parse('2025-01-01T10:00:00Z');
 assert.equal(presetDates('ytd',jan),null);
 assert.equal(presetDates('this_month',jan),null);
 assert.equal(presetDates('this_week',Date.parse('2026-09-14T10:00:00Z')),null);
 assert.deepEqual(presetDates('last_month',jan),{start:'2024-12-01',end:'2024-12-31'});
 assert.equal(resolveWindow(presetDates('last_year',jan),jan).days,366);
 assert.deepEqual(presetDates('last_month',Date.parse('2024-03-04T00:00:00Z')),{start:'2024-02-01',end:'2024-02-29'});
});
