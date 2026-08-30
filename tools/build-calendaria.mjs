// build-calendaria.mjs — generate the bundled runtime data for rippers-calendaria from the
// canonical 1892 Almanack sources in lodge-docs/almanack-1892-data/. FORMATTING ONLY — no
// rules/data invention; every value comes verbatim from the source files.
//
// SOURCES (read at build time, never re-derived):
//   lodge-docs/almanack-1892-data/almanack-1892-moon-phases.csv  (49 quarter-phases; 12 fulls)
//   lodge-docs/almanack-1892-data/almanack-1892-events.csv       (60 events: 46 fixed + 14 windows)
//   lodge-docs/almanack-1892-data/almanack-1892-ephemeris.json   (366 daily sunrise/sunset/illum)
//
// EMITS (bundled in the module, committed):
//   data/moon-1892.json     — the anchored Earth moon object (phaseMode 'fixed' + 49 anchorPhases).
//                             Spliced onto Calendaria's live `gregorian` calendar at runtime.
//   data/events-1892.json   — 60 Calendaria note objects (createNote args), GM-visibility.
//   data/almanac-1892.json  — per-day sunrise/sunset/illum, grouped by month, for the GM journal.
//
// The runtime module (scripts/rippers-calendaria.mjs) never parses CSV — it fetches these JSONs.
//
// MECHANISM (verified against Calendaria release-1.0.17 source):
//   A moon with phaseMode:'fixed' resolves each date through #findExactAnchor(date): if the date
//   matches an anchorPhases entry {year,month,dayOfMonth,phaseIndex}, that EXACT phase is used
//   (overriding the parametric cycle); resetCycle:true also re-bases the between-anchor fill off
//   the nearest anchor. Feeding all 49 real quarter-phases as anchors lands every principal phase
//   — incl. the 12 mechanically-live full moons — on its exact 1892 date.
//   Phase index (Calendaria 8-phase default): new=0, waxing crescent=1, first quarter=2,
//   waxing gibbous=3, FULL=4, waning gibbous=5, last quarter=6, waning crescent=7.
//   Calendar month/dayOfMonth are 0-indexed; anchor.year is the DISPLAY year (1892).
//
// Run:  node tools/build-calendaria.mjs   (from the module dir)
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MODULE = dirname(HERE);
const DATA = join(MODULE, '..', '..', 'lodge-docs', 'almanack-1892-data');
const OUT = join(MODULE, 'data');

// --- tiny CSV parser (RFC-4180-ish: quoted fields, embedded commas, doubled quotes) ----------
function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c === '\r') { /* skip */ }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift();
  return rows.filter((r) => r.length > 1 || (r.length === 1 && r[0] !== '')).map((r) => {
    const o = {}; header.forEach((h, i) => (o[h.trim()] = (r[i] ?? '').trim())); return o;
  });
}

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// "1892-01-14" -> {year, monthIdx(0-based), dayIdx(0-based), day(1-based), month(1-based)}
function parseDate(iso) {
  const [y, m, d] = iso.split('-').map((n) => parseInt(n, 10));
  return { year: y, month: m, day: d, monthIdx: m - 1, dayIdx: d - 1 };
}

// --- MOON: 49 anchors from the quarter-phase CSV -------------------------------------------
const PHASE_INDEX = { new: 0, fq: 2, full: 4, lq: 6 }; // Calendaria 8-phase default indices
// Standard 8-phase table — names + icon paths resolve against the installed Calendaria at runtime
// (its DEFAULT_MOON_PHASES / gregorian `luna`). Order fixes the phaseIndex→phase mapping.
const A = 'modules/calendaria/assets/moon-phases';
const STANDARD_PHASES = {
  newmoon000000000: { name: 'CALENDARIA.MoonPhase.NewMoon', icon: `${A}/01_newmoon.svg`, start: 0, end: 0.125 },
  waxingcrescent00: { name: 'CALENDARIA.MoonPhase.WaxingCrescent', icon: `${A}/02_waxingcrescent.svg`, start: 0.125, end: 0.25 },
  firstquarter0000: { name: 'CALENDARIA.MoonPhase.FirstQuarter', icon: `${A}/03_firstquarter.svg`, start: 0.25, end: 0.375 },
  waxinggibbous000: { name: 'CALENDARIA.MoonPhase.WaxingGibbous', icon: `${A}/04_waxinggibbous.svg`, start: 0.375, end: 0.5 },
  fullmoon00000000: { name: 'CALENDARIA.MoonPhase.FullMoon', icon: `${A}/05_fullmoon.svg`, start: 0.5, end: 0.625 },
  waninggibbous000: { name: 'CALENDARIA.MoonPhase.WaningGibbous', icon: `${A}/06_waninggibbous.svg`, start: 0.625, end: 0.75 },
  lastquarter00000: { name: 'CALENDARIA.MoonPhase.LastQuarter', icon: `${A}/07_lastquarter.svg`, start: 0.75, end: 0.875 },
  waningcrescent00: { name: 'CALENDARIA.MoonPhase.WaningCrescent', icon: `${A}/08_waningcrescent.svg`, start: 0.875, end: 1 },
};
function buildMoon() {
  const phases = STANDARD_PHASES;
  const rows = parseCSV(readFileSync(join(DATA, 'almanack-1892-moon-phases.csv'), 'utf8'));
  const anchorPhases = {};
  let fulls = 0;
  let refDate = null;
  for (const r of rows) {
    const key = r.phase_key;
    if (!(key in PHASE_INDEX)) throw new Error(`unknown phase_key "${key}" (${r.date})`);
    const d = parseDate(r.date);
    if (d.year !== 1892) throw new Error(`non-1892 phase date ${r.date}`);
    const anchorId = `a${String(d.month).padStart(2, '0')}${String(d.day).padStart(2, '0')}`; // e.g. a0114
    anchorPhases[anchorId] = { year: 1892, month: d.monthIdx, dayOfMonth: d.dayIdx, phaseIndex: PHASE_INDEX[key], resetCycle: true };
    if (key === 'full') fulls++;
    if (key === 'new' && !refDate) refDate = { year: 1892, month: d.monthIdx, dayOfMonth: d.dayIdx }; // first new moon = reference
  }
  const anchorCount = Object.keys(anchorPhases).length;
  const moon = {
    name: 'Luna',
    cycleLength: 29.53059,
    color: '#C0C0C0',
    phaseMode: 'fixed',
    referencePhase: 0, // reference date is a New Moon (index 0)
    referenceDate: refDate, // first new moon of 1892 (29 Jan), display-year space
    anchorPhases,
    phases,
    eclipseMode: 'never',
  };
  return { moon, anchorCount, fulls };
}

// --- EVENTS: 60 Calendaria notes (createNote args) -----------------------------------------
function buildEvents() {
  const rows = parseCSV(readFileSync(join(DATA, 'almanack-1892-events.csv'), 'utf8'));
  const notes = [];
  let fixed = 0, windows = 0;
  for (const r of rows) {
    const s = parseDate(r.start_date);
    const isWindow = r.kind === 'window' && r.end_date;
    const e = isWindow ? parseDate(r.end_date) : null;
    if (isWindow) windows++; else fixed++;
    notes.push({
      name: r.label,
      // gm_note body as a simple paragraph; label repeated as heading-free lead (verbatim text).
      content: `<p>${esc(r.gm_note)}</p>`,
      startDate: { year: s.year, month: s.month, day: s.day }, // public 1-indexed for createNote
      endDate: e ? { year: e.year, month: e.month, day: e.day } : null,
      allDay: true,
      visibility: 'hidden', // GM-only (Calendaria NOTE_VISIBILITY.HIDDEN = the default for GM notes)
      kind: r.kind,
    });
  }
  return { notes, fixed, windows };
}

// --- ALMANAC: per-day sun/moon parked for the GM journal (min-bar; not fed to the clock) ----
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DIM = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]; // 1892 leap
const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
function buildAlmanac() {
  const eph = JSON.parse(readFileSync(join(DATA, 'almanack-1892-ephemeris.json'), 'utf8'));
  const { sunrise_min, sunset_min, moon_illum: illum, moon_waxing: waxing, count } = eph;
  const days = [];
  let idx = 0;
  for (let m = 0; m < 12; m++) {
    for (let d = 1; d <= DIM[m]; d++) {
      days.push({
        date: `1892-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
        month: m, day: d,
        sunrise: hhmm(sunrise_min[idx]), sunset: hhmm(sunset_min[idx]),
        illum_pct: Math.round((illum[idx] ?? 0) * 100),
        waxing: !!waxing[idx],
      });
      idx++;
    }
  }
  if (idx !== count) throw new Error(`ephemeris day count ${count} != generated ${idx}`);
  return { days, count: idx };
}

// --- run -----------------------------------------------------------------------------------
const { moon, anchorCount, fulls } = buildMoon();
const { notes, fixed, windows } = buildEvents();
const { days, count } = buildAlmanac();

writeFileSync(join(OUT, 'moon-1892.json'), JSON.stringify(moon, null, '\t'));
writeFileSync(join(OUT, 'events-1892.json'), JSON.stringify(notes, null, '\t'));
writeFileSync(join(OUT, 'almanac-1892.json'), JSON.stringify({ note: '1892 London daily sunrise/sunset (GMT) + moon illum. Parked for the GM almanac journal; NOT fed to the Calendaria clock.', months: MONTHS, days }, null, '\t'));

console.log('=== rippers-calendaria data build ===');
console.log(`moon-1892.json    : ${anchorCount} anchors (expect 49), ${fulls} full-moon anchors (expect 12)`);
console.log(`events-1892.json  : ${notes.length} notes (${fixed} fixed + ${windows} windows; expect 60 = 46 + 14)`);
console.log(`almanac-1892.json : ${count} daily entries (expect 366)`);
if (anchorCount !== 49) console.log(`⚠ expected 49 anchors, got ${anchorCount}`);
if (fulls !== 12) console.log(`⚠ expected 12 fulls, got ${fulls}`);
if (notes.length !== 60) console.log(`⚠ expected 60 events, got ${notes.length}`);
if (count !== 366) console.log(`⚠ expected 366 days, got ${count}`);
