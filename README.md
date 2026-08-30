# rippers-calendaria

Drives **Calendaria**'s world clock to the **exact 1892 Almanack** in a **Foundry VTT v13** world.
Original Rippers Unmasked campaign content; a personal-table module, **not for redistribution**.

## What it does

On Calendaria's `calendaria.ready` hook (GM only) it:

1. **Registers a `rippers-1892` calendar** — Calendaria's own `gregorian` calendar with an Earth
   moon spliced in. The year starts **Friday 1 January 1892** (leap year, 366 days); weekday math
   comes from the base Gregorian.
2. **Exact moon.** The moon is `phaseMode: 'fixed'` with a **49-entry `anchorPhases` table** — every
   real 1892 quarter-phase, **including all 12 mechanically-live full moons** — so Calendaria's
   `getMoonPhase()` resolves each of those dates through its exact-anchor path and shows the **exact
   phase on the exact date**. `resetCycle` re-bases the interpolated fill between anchors.
3. **Seeds all 60 events** (46 fixed + 14 multi-day windows) as **GM-only** Calendaria notes with
   their `gm_note` bodies, and sets the world date to 1 Jan 1892.
4. **Parks the sun/moon ephemeris** — a GM-only *1892 Almanack — Watches & Moon* journal with the
   daily London sunrise/sunset (GMT) and moon illumination, one page per month.

It also persists the calendar into Calendaria's own `customCalendars` setting so Calendaria reloads
it natively on later sessions. First-run setup is guarded by the world flag
`rippers-calendaria.setupComplete` (clear it to re-run).

## ⚠ Install order & the Calendaria version — READ THIS

This module targets **Foundry VTT v13** and integrates against **Calendaria `release-1.0.17`** —
the **last v13-compatible Calendaria**. Calendaria **1.1.0 → 1.4.0 are Foundry-v14-only** and will
not run in a v13 world. The moon mechanism (`phaseMode:'fixed'` + `anchorPhases`) is present in
1.0.17.

**Install, in order, in your Foundry v13 world:**

1. Install **Calendaria `release-1.0.17` specifically** — not "latest".
   Manifest: `https://github.com/Sayshal/Calendaria/releases/download/release-1.0.17/module.json`
2. Install **rippers-calendaria**.
3. Enable **both** modules (this one declares Calendaria as a required relationship). Launch the
   world **as GM once** — the calendar activates, the date sets to 1 Jan 1892, the 12 full moons and
   60 events go live, and the almanac journal is created.

## Data source & build

The runtime module ships only generated JSON in `data/`; it never parses CSV at runtime.

```
node tools/build-calendaria.mjs   # regenerate data/ from lodge-docs/almanack-1892-data
```

- `data/moon-1892.json` — the anchored Earth moon (49 `anchorPhases`; 12 full-moon anchors).
- `data/events-1892.json` — 60 Calendaria note objects (GM visibility).
- `data/almanac-1892.json` — 366 daily sunrise/sunset + moon illum for the GM journal.

Sources (read at build time, verbatim): `lodge-docs/almanack-1892-data/almanack-1892-moon-phases.csv`,
`almanack-1892-events.csv`, `almanack-1892-ephemeris.json`.

## Fidelity

- **Exact:** all 49 principal phases — incl. **all 12 full moons** — on their real 1892 dates.
  (Verified: the 49 anchors resolve to the correct phase under Calendaria 1.0.17's own algorithm.)
- **Interpolated:** the crescent/gibbous days *between* anchors (the visible full/new/quarter nights
  are exact — the campaign-critical bit).
- **Parked, not on the clock:** exact daily illumination % and real London sunrise/sunset live in the
  GM almanac journal — Calendaria's moon is phase-position based and its sun is a simple day/night
  split, so those are reference data, not clock inputs.

## Boundaries

Standalone companion module. It does **not** modify Calendaria or the Almanack web-app data. No
monkey-patching and no removed-in-v13 hooks — it uses Calendaria's public `CALENDARIA.api`
(`addCalendar` / `setActiveCalendar` / `setDateTime` / `createNote`) and its `calendaria.ready` hook.
