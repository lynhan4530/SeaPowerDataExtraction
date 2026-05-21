# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> This file is the working reference — it captures everything verified against the real game
> install so you don't need to re-read `PARSER_HANDOFF.md` or re-explore the files. The handoff
> remains the original spec (section numbers like §6 below refer to it) if you need deeper "why".

## What this is

A **standalone, re-runnable extractor**: reads *Sea Power*'s `.ini` data (base game + Steam
Workshop mods) and emits one static `presets.json`. That JSON is consumed by a separate app,
the **Saturation Planner** (`G:\Project\SeaPowerSaturationCalc`), to replace hand-typed
missile stats and a hand-waved defense model with real game numbers.

Two hard rules:
- **Stay decoupled from the app.** The only contract is the JSON schema. Do not import from or
  write into the app repo. (`src/types.ts` there was read once to align field names; that's it.)
- **Never hardcode install paths.** The user adds mods and may move the install between drives.
  Everything is discovered/configured at runtime.

## Commands

```bash
npm install                    # dev deps only: typescript + @types/node
npm test                       # node --test — runs *.test.ts directly (no build step)
npm run typecheck              # tsc --noEmit  (type-check only; never emits JS)
npm run parse                  # node src/cli.ts → presets.json + presets.warnings.log
node --test test/ini.test.ts   # run a single test file
node src/cli.ts --print-config # show resolved paths + mod set, parse nothing
node src/cli.ts --game "<dir>" --mods "<dir>" --out presets.json
```

## Runtime constraints (read before editing TS)

Node runs `.ts` **natively via strip-only type stripping — there is no build step.** `tsc` is
used only for type checking. Consequences:
- Use `.ts` extensions in relative imports (tsconfig: `allowImportingTsExtensions`).
- Strip-only mode CANNOT transform TS-only syntax. **No `enum`, no `namespace`, no constructor
  parameter properties** (`constructor(public readonly x)`) — these throw
  `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` at runtime even though `tsc` accepts them. Use union types
  and plain field assignment.
- `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess` are on. Type a field you may assign
  `undefined` to as `T | undefined`, not `T?`. Array/record indexing yields `T | undefined`.

## Module map (`src/`)

| File | Role |
|---|---|
| `ini.ts` | Tokenizer for the game's INI dialect + lookup helpers. The bedrock. |
| `schema.ts` | `presets.json` output types (the app contract). |
| `steam.ts` | Steam auto-discovery: registry + `libraryfolders.vdf` → game/mods paths. |
| `config.ts` | Path resolution precedence + validation; writes back resolved config. |
| `sources.ts` | Enumerate base/user/mod sources; override resolution + provenance. |
| `units.ts` | Unit conversions (km→nm). |
| `parsers/ammunition.ts` | `Type=Missile` ammo → `MissilePreset`. |
| `parsers/weapons.ts` | `weapons.ini` section → `LauncherPreset`. |
| `parsers/sensors.ts` | `sensors.ini` section → `IlluminatorPreset`. |
| `emit.ts` | Game-version detection + write presets/warnings. |
| `cli.ts` | Arg parsing + pipeline orchestration. |

Pipeline (in `cli.ts`): resolve paths → enumerate sources → parse ammo (per-file) → parse
weapons + sensors (per-section) → [TODO: vessels + cross-link] → emit JSON + warnings.

## Path resolution (`config.ts`, §2.1)

Stop at the first that validates: **CLI `--game`/`--mods`** → **`seapower-parser.config.json`**
(in cwd; resolved paths written back on success) → **env `SEAPOWER_GAME`/`SEAPOWER_MODS`** →
**Steam auto-discovery**. AppID **`1286220`** is the stable anchor. If `--mods` is absent, the
mods dir is derived from the game path (`../../workshop/content/1286220`). On total failure,
throw `PathResolutionError` listing what was checked — never silently emit an empty file.

Validation: game = `Sea Power.exe` + `…/StreamingAssets/original/ammunition` exist; mods = the
`1286220` dir exists.

## Source & override model (`sources.ts`) — important

A "source" is the base game, local user overrides, or a workshop mod — each a directory laid
out like `StreamingAssets` (`ammunition/`, `systems/`, `vessels/`, …). Sources are enumerated
in override **priority order low→high: base → mods (sorted by id) → user**. Deprecated mods
(`_info.ini` has `Name=[DEPRECATED] …`) are skipped entirely. Every emitted entity carries a
`source` field (`base` | `user` | `<modId>`).

Two distinct override strategies, because the files work differently:
- **Per-file** (`indexCategory`) — `ammunition/*.ini` is one entity per file; last-writer-wins
  by **filename**.
- **Per-section** (`mergeSections`) — `systems/weapons.ini` and `systems/sensors.ini` are
  *shared* files that each source ships a (often partial) copy of; the game merges them
  additively, so last-writer-wins by **section id**.

Both report `collisions` (entities defined by more than one source) into `presets.warnings.log`.

## The INI dialect (`ini.ts`) — the quirks that bite

- Comments: `//` (usually inline) and `#` / `############` (whole-line). Inline `//` is stripped
  from values; lines starting with `#` or `//` are dropped.
- **Divider "sections"** like `[---------- Guidance ----------]` or
  `[ =========================================== Test === ]` are visual separators, NOT real
  sections — detected by a run of 2+ of `-=#*~_` and dropped. The real data sits in the plain
  section right after (e.g. `[Guidance]`, `[WarheadData]`). Single dashes are fine: `SPG-62`,
  `RIM-66C` are real ids.
- **Duplicate keys are legal and meaningful** (e.g. `AssociatedMagazine` repeats once per
  weapon system) — every value is collected into an array; nothing is overwritten. A repeated
  section header merges into the existing section.
- Helpers: `getValue/getValues/getNumber/getList` (per-section) and `findValue/findNumber/
  findList` (search the whole document — missile fields are spread across sections).

## Verified input formats (no need to re-open the game files)

**Missiles — `ammunition/*.ini`** (fields spread across `[General]`/`[Guidance]`/`[SensorData]`):
`Type=Missile` (else skip Projectile/Torpedo); `TargetType` → role (AAW/ASuW/ASW);
`GuidanceType` 0-9 (0 None,1 IR,2 SARH,3 ARH,4 ARM,5 Laser,6 TV,7 ActiveSonar,8 PassiveSonar,
9 WakeHoming); `MaxVelocity` knots; `MinLaunchRange`/`MaxLaunchRange` nm; `SeaSkimmingAlt` ft;
`SeekerActiveRange`/`SeekerPassiveRange` nm; `RCS`; `AntiCountermeasuresBonus`/`AntiJammerBonus`
(0..1 ECCM).

**Launchers — `systems/weapons.ini`** (~302 base sections, one per launcher id): `ModuleType`
(SmallLauncher, MediumLauncher, BigLauncher, LargeLauncher, VLS, CIWS, SmallTurret,
MediumTurret, HeavyTurret, OpenMount, Inert); `ReloadTime` s; `FireRate` rpm;
`Horizontal/VerticalDegreesPerSecond`. **CIWS only:** `MissileInterceptChance` /
`AircraftInterceptChance` (literal Pk %).

**Illuminators — `systems/sensors.ini`** (~582 base sections; we keep only the 236 with
`WeaponChannels`): `WeaponChannels` = simultaneous missiles guided = **THE saturation cap**;
`TargetChannels`; `Kind` (Radar/Sonar/…); `Type` (Search/Targeting); `Mode` (Illuminate/
RadioCommand); `MaxRange` **in km** (converted to nm too — sensors use km/m, missiles use nm/kn).

**Vessels — `vessels/*.ini`** (base) and some `ships/*.ini` (user/mods). Detect stat files by
content (`[WeaponSystems]` present), not folder; skip `*_mat.ini`/material/collider files.
Structure: `[WeaponSystems] NumberOfWeaponSystems=N`, then `[WeaponSystemN]` blocks with
`SystemName=` (→ weapons.ini launcher) and ammo binding (see open questions). Sensor link is
**indirect**: `AssociatedSensors=SensorSystem6,SensorSystem5` references local `[SensorSystemN]`
blocks in the same file → each resolves to a sensor type → sensors.ini.

## Output schema (`schema.ts`, §6)

`presets.json` is a **richer superset** of the app's current `src/types.ts`. Keep overlapping
names identical (`id`, `name`, `speedKnots`, `maxRangeNm`, `minRangeNm`); unknown numerics are
`null`, never omitted. Top-level: `generatedAt`, `gameVersion`, `resolvedPaths`, `sources[]`,
`missiles[]`, `launchers[]`, `illuminators[]`, `ships[]`, `stats`. The app's interim model uses
the hand-waved `interceptsPerWindow`; presets instead carry channel/Pk data and the app derives
the rest in a thin adapter — don't downgrade presets to match the interim types.

## Current state

Validated end-to-end against the real install (game **v0.7.10**, 125 mods, 2 deprecated):
**727 missiles, 482 launchers, 829 illuminators**. Tests: `test/ini.test.ts` (tokenizer) +
`test/parsers.test.ts` (parsers), 19 passing.

`ships[]` is still empty. **Next, in order:**
1. **Vessels parser + cross-linking** (the hard part). Graph: vessel `SystemName` → launcher;
   vessel `AssociatedSensors=SensorSystemN` → local block → sensor (count `WeaponChannels` for
   the saturation cap); loadout/magazine → ammo. The **per-loadout ammo fill format is still
   undecoded** (§8.1): `AvailableLoadouts=051,052` → `{ammoId, count}` per cell/magazine. Ammo
   binding is mixed — some weapon systems have a direct `Ammunition=usn_rur-5`, others use
   `AssociatedMagazine=` + loadouts. Inspect more vessel files and `original/templates/`.
2. **Real display names** via `language_*` files (currently a prettified id).

Other open questions (§8): enabled-mods load order (interim: last-writer-wins); whether SAMs
expose a Pk like CIWS do.

## Game data layout (this machine — discovered, not hardcoded)

- Game: `D:\SteamLibrary\steamapps\common\Sea Power`
- Base data: `…\Sea Power_Data\StreamingAssets\original` (ammunition 386, vessels 448,
  systems 5: weapons/sensors/modules/cargo/wip_cargo, templates 2, ships 0)
- User overrides: `…\StreamingAssets\user`
- Workshop mods: `D:\SteamLibrary\steamapps\workshop\content\1286220\<modId>\` (each mirrors the
  StreamingAssets layout)
- `seapower-parser.config.json`, `presets.json`, `presets.warnings.log` are gitignored
  (machine-local / generated).
