/**
 * rippers-calendaria — drives Calendaria's world clock to the EXACT 1892 Almanack on Calendaria.
 *
 * Foundry VTT v13. Integrates against Calendaria release-1.0.17 (the last v13-compatible build;
 * 1.1.0+ are Foundry-v14-only). Austin must install Calendaria 1.0.17 SPECIFICALLY, not latest.
 *
 * MECHANISM (config-driven, no monkey-patching — verified against Calendaria 1.0.17 source):
 *  - On Calendaria's `calendaria.ready` hook we take its live `gregorian` calendar, splice in our
 *    Earth moon (data/moon-1892.json), and register the result as calendar `rippers-1892` via the
 *    public CALENDARIA.api.addCalendar. The moon uses phaseMode:'fixed' + a 49-entry anchorPhases
 *    table (every real 1892 quarter-phase incl. the 12 full moons). Calendaria's getMoonPhase()
 *    resolves each of those dates through #findExactAnchor → the EXACT phase, so the 12 full moons
 *    land on their real dates; resetCycle re-bases the interpolated fill between anchors.
 *  - First run only (GM, flag-guarded): set `rippers-1892` active, set the date to 1 Jan 1892
 *    (a Friday, via the base Gregorian's weekday math), seed all 60 Almanack events as Calendaria
 *    notes (GM-only), and build a GM almanac journal of the daily sunrise/sunset + moon illum
 *    (parked, not fed to the clock — Calendaria's sun is a simple day/night split).
 *
 * We register the calendar in-memory each session AND persist it into Calendaria's own
 * customCalendars setting so its native init reloads it before we run next session.
 */

const MODULE_ID = 'rippers-calendaria';
const CAL_ID = 'rippers-1892';
const MOON_KEY = 'luna000000000000';
const CALENDARIA_ID = 'calendaria';
const CAL_SETTING_CUSTOM = 'customCalendars'; // Calendaria SETTINGS.CUSTOM_CALENDARS
const SETUP_FLAG = 'setupComplete';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const log = (...a) => console.log(`${MODULE_ID} |`, ...a);
const warn = (...a) => console.warn(`${MODULE_ID} |`, ...a);

async function fetchJSON(rel) {
  return foundry.utils.fetchJsonWithTimeout(`modules/${MODULE_ID}/${rel}`);
}

Hooks.once('init', () => {
  game.settings.register(MODULE_ID, SETUP_FLAG, { scope: 'world', config: false, type: Boolean, default: false });
});

Hooks.once('calendaria.ready', async ({ api } = {}) => {
  try {
    if (!api) return warn('calendaria.ready fired without an api; aborting.');
    if (!game.user.isGM) return; // only the GM mutates world state / registers

    // 1) Build the 1892 calendar from Calendaria's live Gregorian, splicing in our anchored moon.
    const gregorian = api.getCalendar('gregorian');
    if (!gregorian) return warn('Calendaria has no `gregorian` calendar to base 1892 on; aborting.');
    const moon = await fetchJSON('data/moon-1892.json');
    const def = gregorian.toObject();
    def.id = CAL_ID;
    def.name = 'Rippers Unmasked — 1892';
    def.moons = { [MOON_KEY]: moon };
    if (def.metadata && typeof def.metadata === 'object') def.metadata = { ...def.metadata, source: MODULE_ID };

    // 2) Register in-memory for THIS session (id-guarded; addCalendar errors on a duplicate).
    if (!api.getCalendar(CAL_ID)) {
      const added = await api.addCalendar(CAL_ID, def);
      if (!added) return warn('addCalendar returned null; aborting.');
      log(`registered calendar ${CAL_ID} (${Object.keys(moon.anchorPhases).length} moon anchors)`);
    }

    // 3) Persist into Calendaria's own customCalendars so its init reloads it next session.
    try {
      const custom = foundry.utils.deepClone(game.settings.get(CALENDARIA_ID, CAL_SETTING_CUSTOM) || {});
      if (JSON.stringify(custom[CAL_ID]) !== JSON.stringify(def)) {
        custom[CAL_ID] = def;
        await game.settings.set(CALENDARIA_ID, CAL_SETTING_CUSTOM, custom);
        log('persisted 1892 calendar into Calendaria customCalendars');
      }
    } catch (e) {
      warn('could not persist into Calendaria customCalendars (calendar still registered in-memory this session):', e);
    }

    // 4) First-run world setup: activate, set date to 1 Jan 1892, seed events + almanac journal.
    if (!game.settings.get(MODULE_ID, SETUP_FLAG)) {
      await api.setActiveCalendar(CAL_ID);
      await api.setDateTime({ year: 1892, month: 1, day: 1, hour: 0, minute: 0 }); // public 1-indexed → 1 Jan 1892 (Friday)
      log('activated rippers-1892 and set world date to 1 Jan 1892');

      await seedEvents(api);
      await buildAlmanacJournal();

      await game.settings.set(MODULE_ID, SETUP_FLAG, true);
      ui.notifications?.info('Rippers 1892 world clock installed: calendar, 12 exact full moons, and 60 events are live.');
    }
  } catch (err) {
    warn('setup failed:', err);
  }
});

/** Seed the 60 Almanack events as GM-only Calendaria notes (idempotent via the setup flag). */
async function seedEvents(api) {
  const events = await fetchJSON('data/events-1892.json');
  let ok = 0;
  for (const ev of events) {
    try {
      await api.createNote({
        name: ev.name,
        content: ev.content,
        startDate: ev.startDate,
        endDate: ev.endDate ?? undefined,
        allDay: ev.allDay ?? true,
        visibility: ev.visibility ?? 'hidden', // NOTE_VISIBILITY.HIDDEN = GM-only
      });
      ok++;
    } catch (e) {
      warn(`failed to seed event "${ev.name}":`, e);
    }
  }
  log(`seeded ${ok}/${events.length} events as GM notes`);
}

/** Park the daily sunrise/sunset + moon illum in a GM-only almanac journal (min bar; not on the clock). */
async function buildAlmanacJournal() {
  try {
    const almanac = await fetchJSON('data/almanac-1892.json');
    const byMonth = Array.from({ length: 12 }, () => []);
    for (const d of almanac.days) byMonth[d.month].push(d);
    const pages = byMonth.map((days, m) => ({
      name: MONTHS[m],
      type: 'text',
      title: { show: true, level: 1 },
      text: {
        format: 1,
        content:
          `<p><em>1892 London — sunrise/sunset (GMT) and moon illumination. Reference only; the Calendaria clock drives day/night and moon phase.</em></p>` +
          `<table><thead><tr><th>Date</th><th>Sunrise</th><th>Sunset</th><th>Moon illum</th></tr></thead><tbody>` +
          days.map((d) => `<tr><td>${d.date}</td><td>${d.sunrise}</td><td>${d.sunset}</td><td>${d.illum_pct}%${d.waxing ? ' ↑' : ' ↓'}</td></tr>`).join('') +
          `</tbody></table>`,
      },
    }));
    await JournalEntry.create({
      name: '1892 Almanack — Watches & Moon (GM)',
      ownership: { default: 0 }, // GM-only
      pages,
      flags: { [MODULE_ID]: { almanac: true } },
    });
    log('built GM almanac journal (12 monthly pages)');
  } catch (e) {
    warn('could not build almanac journal:', e);
  }
}
