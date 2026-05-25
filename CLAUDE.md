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
| `parsers/vessels.ts` | `vessels/*.ini` (+ mod `ships/*.ini`) → `ShipPreset`; cross-links launchers/illuminators/missiles. |
| `names.ts` | Language-file parsers (`parseAmmunitionNames`, `parseVesselNames`, `parseSystemNames`), FS loader (`loadNames`), in-place enricher (`applyNames`). |
| `emit.ts` | Game-version detection + write presets/warnings. |
| `cli.ts` | Arg parsing + pipeline orchestration. |

Pipeline (in `cli.ts`): resolve paths → enumerate sources → parse ammo (per-file) → parse
weapons + sensors (per-section) → build link context (illuminator/launcher/missile id maps) →
parse vessels (per-file, cross-linked) → apply localized names → emit JSON + warnings.

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
content (`[WeaponSystems]` present), not folder — material/collider/`*_variants.ini` (skin/
nation) files lack it and self-exclude. `[General].UnitType` is `Vessel` or `Submarine` (both
kept). `[AI].Role` = "AAW,ASW,ASuW"; `[Physics]` has `Displacement`, `MaxForwardVelocity`.
Structure: `[WeaponSystems] NumberOfWeaponSystems=N` + `AvailableLoadouts=Default,Late`, then
`[WeaponSystemN]` blocks:
- `Type` (Missile/Gun/CIWS/Torpedo/Chaff/Noisemaker), `SystemName` (→ weapons.ini launcher).
- **Sensor link is indirect**: `AssociatedSensors=SensorSystem6,SensorSystem5` → local
  `[SensorSystemN]` blocks → each block's `SystemName` is a sensors.ini id (a direct match).
- **Ammo binding (two ways)**: direct `Ammunition=usn_mk46_ship`, or `AssociatedMagazine=
  WeaponMagazineMK13` → a `[WeaponMagazine…]` block of `AmmunitionN` / `AmmunitionN_Count`.

**Loadout format (§8.1, DECODED — loadouts are NAMED, not numbered):** `AvailableLoadouts=
Default,Late` (also Early/AntiShip/LandAttack/…). A weapon system's config for loadout `L` is
`[WeaponSystemN<L>]` (e.g. `[WeaponSystem1Late]`) if that suffixed block exists, else the base
`[WeaponSystemN]`. The first/Default loadout has no suffixed blocks and always uses the base.
Magazines vary per loadout too (`WeaponMagazineMK13` vs `WeaponMagazineMK13Late`).

**Saturation cap (the headline `ShipPreset.weaponChannels`):** sum of `WeaponChannels` over the
distinct *terminal* illuminators (`Type=Targeting`) referenced by missile mounts — counted per
**physical** `[SensorSystemN]` mount (two SPG-51s = 2, not 1). Search radars that also carry
guidance channels (`Type=DirectedSearch`, e.g. Aegis SPY-1A with 24) are kept in `directors[]`
but **excluded** from the headline, so the app can model Aegis command guidance itself. Verified:
Ticonderoga cap=4 (4× SPG-62), Spruance cap=2 (MK-95).

## Output schema (`schema.ts`, §6)

`presets.json` is a **richer superset** of the app's current `src/types.ts`. Keep overlapping
names identical (`id`, `name`, `speedKnots`, `maxRangeNm`, `minRangeNm`); unknown numerics are
`null`, never omitted. Top-level: `generatedAt`, `gameVersion`, `resolvedPaths`, `sources[]`,
`missiles[]`, `launchers[]`, `illuminators[]`, `ships[]`, `stats`. The app's interim model uses
the hand-waved `interceptsPerWindow`; presets instead carry channel/Pk data and the app derives
the rest in a thin adapter — don't downgrade presets to match the interim types.

## Current state

Validated end-to-end against the real install (game **v0.7.10**, 125 mods, 2 deprecated):
**727 missiles, 482 launchers, 829 illuminators, 546 ships**. Tests: `test/ini.test.ts`
(tokenizer) + `test/parsers.test.ts` (parsers incl. vessels) + `test/names.test.ts`
(name parsers), **36 passing**.

Vessel cross-linking is live: each ship carries `directors[]` (resolved illuminators + channels),
`mounts[]` (resolved launchers), `loadouts[]` (per-named-fit `{ammoId, count, isMissile}`), and
the headline `weaponChannels` cap. Link health: **mounts 97.7% resolved** (152/6694 unresolved,
almost all mod naming drift — `NSM_quad_launcher` vs `eu_NSM_quad_launcher`, `SeacatQuad` vs
`RN_SeacatQuad`, `3S90` vs `3S90M` — reported via each mount's `resolved:false`, no fuzzy
matching); **directors 100% resolved**. Mod-overridden sensors flow through: e.g. Adams SPG-51
shows 2 channels (base is 1) because an active mod bumped it.

**Localized display names** are live (base-game only): `names.ts` reads
`language_en/ammunition_names.ini`, `vessel_names.ini`, and `systemgroups.ini` and enriches all
four preset arrays before emit. Mod-name override merge is deferred (base names are authoritative
for the app's needs).

**Coverage — verified against the real install 2026-05-25** (tables loaded: 334 missile, 235
ship, 100 systemgroup entries):

| Preset | Localized | % | Notes |
|---|---|---|---|
| Missiles | **145 / 727** | 19.9% | All 145 are base; the 582 fallbacks are all mod/user (mods ship no language files). 145 got a category, 129 a nickname. |
| Ships | **179 / 546** | 32.8% | All base; every one of the 179 got both nickname and category. |
| Launchers | **0 / 482** | 0.0% | **Broken — see below.** Names stay raw-id fallbacks (`MK13`, not "MK 13"). |
| Illuminators | **0 / 829** | 0.0% | **Broken — see below.** (`SPG-62` stays "SPG-62" — fallback that happens to equal the real name.) |

Spot-checks confirm missiles/ships work: `usn_rim-66c` → name `RIM-66C`, nickname `SM-2MR`,
category `SAM/ASuW`; `usn_cg_ticonderoga` → `Ticonderoga-class` / `Ticonderoga`.

**Launcher/illuminator localization is wired but matches nothing — wrong key namespace.**
`systemgroups.ini`'s `[LanguageResources]` holds generic *system-group* labels (`SG_CIC`,
`SG_Air_Radar`, `SG_FCRadarSAM`, `Unknown`, …), **not** weapon/sensor ids like `100mm_AK-100` or
`AN/APG-53`. Zero of its 100 keys match any launcher or illuminator id, so `applyNames` is a
no-op for both arrays. The real names live in a different file (not yet located). Note: the
`/_/`-uppercase fallback heuristic gives a false 0/0/0/0 — `prettifyId` already replaces
underscores with spaces, so the underscore test never matches; coverage must be measured by
table membership, not name shape.

**Next:**
1. **Find the real launcher/illuminator name source** so the 0% arrays get localized (the
   `systemgroups.ini` keys are group labels, not ids — wrong file). Until then both stay
   raw-id fallbacks.
2. (Optional) Resolve the residual ~2.3% unresolved ship mounts — would require a
   normalization/alias step, risky; defer unless asked.

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
