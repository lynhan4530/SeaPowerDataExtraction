# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

Scaffolded TypeScript/Node project. `PARSER_HANDOFF.md` is the authoritative spec — read it
in full before extending anything; it has the file formats, edge cases, and output contract
you'd otherwise re-derive from the game install.

**Done (validated end-to-end against the real install, game v0.7.10, 125 mods):**
- INI tokenizer `src/ini.ts` + tests `test/ini.test.ts` (12 passing).
- Output schema `src/schema.ts` (richer §6 superset; overlapping names match the app).
- Steam discovery `src/steam.ts` + path precedence `src/config.ts`.
- Source enumeration / override resolution `src/sources.ts` (last-writer-wins + collisions,
  `_info.ini` `[DEPRECATED]` skipping, provenance).
- Parsers: ammunition→missiles, weapons→launchers, sensors→illuminators
  (`src/parsers/`), emit `src/emit.ts`, CLI `src/cli.ts`. Parser tests in
  `test/parsers.test.ts`.
- `npm run parse` produces `presets.json`: **727 missiles, 482 launchers, 829 illuminators**
  + `presets.warnings.log`.

Note: `systems/weapons.ini` and `systems/sensors.ini` are shared single files that every
source ships a (often partial) copy of; the game merges them additively, so override
resolution is **per-section** (`mergeSections` in `src/sources.ts`), unlike ammunition which
is per-file (`indexCategory`). Illuminators = only sensors with `WeaponChannels` (the
saturation cap); search-only radars/sonar/ESM are skipped.

**Not yet built (next, in order):**
1. Vessels parser + cross-linking — the hard part. Vessel→sensor link is **indirect**
   (`AssociatedSensors=SensorSystemN` → local `[SensorSystemN]` block → sensors.ini), and ammo
   binding is mixed (direct `Ammunition=` vs `AssociatedMagazine`/loadouts; handoff §8.1 still open).
2. Missile display names need localization (`language_en`); currently a prettified id.

### Runtime constraints (important)
Node runs `.ts` via **strip-only** type stripping, which CANNOT transform TS-only syntax:
**no `enum`, no `namespace`, no constructor parameter properties** (`constructor(public x)`)
— they throw `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` at runtime even though `tsc` accepts them.
Use union types and plain field assignment. `exactOptionalPropertyTypes` is on, so type fields
you assign possibly-`undefined` values to as `T | undefined`, not `T?`.

## Commands

```bash
npm install          # dev deps only: typescript + @types/node
npm test             # node --test — runs *.test.ts directly (Node >=22.6, no build step)
npm run typecheck    # tsc --noEmit
npm run parse        # node src/cli.ts  (cli.ts not implemented yet)
node --test test/ini.test.ts   # run a single test file
```

Node runs `.ts` files natively via type stripping (Node 26 here), so there is **no build
step** — `tsc` is used only for type checking. Use `.ts` extensions in relative imports
(tsconfig has `allowImportingTsExtensions`).

## What this is

A **standalone, re-runnable extractor** that reads the game *Sea Power*'s `.ini` data
(base game + Steam Workshop mods) and emits a single static `presets.json`. That JSON is
consumed by a separate app, the **Saturation Planner** (`G:\Project\SeaPowerSaturationCalc`),
to replace hand-typed missile stats and a hand-waved defense model with real game numbers.

Two hard rules from the handoff:
- **Keep it decoupled from the app.** The only contract with the app is the JSON schema
  (handoff §6). The game is in early access and patches often; mods change constantly. The
  tool must be re-runnable against an updated install to regenerate `presets.json`.
- **Never hardcode paths.** The user will add mods and may move the install to another drive.

## Architecture (planned — handoff §7)

Standalone TS/Node CLI:
`parse-seapower [--game <root>] [--mods <dir>] [--out presets.json] [--print-config]`

Pipeline: (1) index all files across base+mods → (2) resolve override order →
(3) parse ammo → launchers → sensors → vessels → (4) cross-link → (5) emit JSON +
`warnings.log`.

### Path resolution precedence (handoff §2.1 — REQUIRED)
Stop at the first that validates: **CLI flags** → **`seapower-parser.config.json`** (next
to the script; write resolved paths back on success) → **env vars** `SEAPOWER_GAME` /
`SEAPOWER_MODS` → **Steam auto-discovery**. Auto-discovery: find Steam via Windows registry
(`HKCU\Software\Valve\Steam`), parse `libraryfolders.vdf` for all library roots, locate
`steamapps\common\Sea Power` and `steamapps\workshop\content\1286220`. AppID `1286220` is
the stable anchor. Validate a root before trusting it; on failure print the precedence list
and what was checked — never silently emit an empty `presets.json`.

### The four input file types (handoff §3)
- `ammunition/*.ini` — one missile per file (speed in knots, range in nm, RCS).
- `systems/weapons.ini` — one big file, sections = launchers (ReloadTime, FireRate; CIWS
  carry literal `MissileInterceptChance` = Pk).
- `systems/sensors.ini` — illuminators/directors. `WeaponChannels` = simultaneous-guidance
  cap = **the saturation limit** (range here is in km, not nm).
- `vessels/*.ini` **and** some `ships/*.ini` — unit stat files linking the above together.

### The cross-file dependency graph (handoff §4)
Per ship: `[WeaponSystemN].SystemName` → `weapons.ini[launcher]`;
`[WeaponSystemN].ExternalGuidingSystems` → `sensors.ini[radar]`; loadouts + magazines →
ammo ids → `ammunition/<id>.ini`. Output is offensive (missile + max count) and defensive
(ordered SAM/CIWS layers with channels, reload, range, Pk) data.

## Critical gotchas (handoff §5 — these will bite)

1. **Custom INI dialect.** Comments are both `//` (inline) and `#` / `############` (line).
   **Duplicate keys are legal and meaningful** (e.g. `AssociatedMagazine` repeats) — the
   INI reader must collect repeats into arrays, never overwrite. Section headers like
   `[ ---- CIWS ---- ]` are visual dividers, not real sections. Build a small custom
   tokenizer and unit-test it against the §3/§5 samples; don't reach for a generic INI lib.
2. **Mixed units.** Missiles use nm/knots/feet; sensors use km/meters. Normalize on parse.
3. **`ships/` vs `vessels/`.** Both folders are used. Detect stat files by *content*
   (`[General]` + `[WeaponSystems]` present), not folder name; filter out `*_mat.ini` /
   material/collider files.
4. **Year variants are distinct presets, not dupes** (`…_1996`, `_2003`, `_2025`). Key by
   filename; carry display name + year.
5. **Mods & provenance.** Enumerate workshop subfolders at runtime (no hardcoded ids); also
   scan `StreamingAssets\user`. Read each mod's `_info.ini` for name + `[DEPRECATED]` flag.
   Interim override strategy: **last-writer-wins by mod folder** + a `collisions` report.
   Record `source` (`base` | `user` | `<modId>`) on every entity.
6. **Cross-file refs can dangle.** Resolve against the merged base+mods set; emit warnings,
   don't crash.
7. **Idempotent re-runs.** Same inputs → byte-identical output (stable sort keys). Stamp
   output with `generatedAt`, resolved paths, and the exact mod set used.

## Output contract (handoff §6)

`presets.json` shape is fixed by the app. Top-level keys: `generatedAt`, `gameVersion`,
`sources[]`, `missiles[]`, `launchers[]`, `illuminators[]`, `ships[]`. Before finalizing
field names, confirm them against the app's `src/types.ts` (Missile, FriendlyShip,
TargetShip, DefenseLayer) in `G:\Project\SeaPowerSaturationCalc` so the app consumes it
with minimal adapter code.

## Open questions to resolve while building (handoff §8)

1. **Per-loadout ammo fill format** — how `AvailableLoadouts=051,052` maps to actual
   `{ammoId, count}` per cell/magazine. Not fully decoded; inspect more vessel files and
   `original/templates/`.
2. **Enabled-mods list & load order** — where the game stores it (for correct override
   resolution; interim is last-writer-wins).
3. **SAM Pk** — CIWS expose `MissileInterceptChance`; unclear if SAMs do.
4. **Channels per ship** — count illuminators in `ExternalGuidingSystems` to get the real
   simultaneous-guidance cap.
