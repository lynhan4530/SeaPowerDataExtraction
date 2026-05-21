# NEXT STEPS — Localized display names (in progress)

> Resume point for the "real display names" task. The schema is expanded and all
> parsers compile with **prettified-id fallback names**; what's left is reading the
> `language_en` files and overwriting those fallbacks. Decisions already made:
> **(1) carry name + nickname + category (NOT the long descriptions); (2) base-game
> names only for now (no mod-override merge yet).**

## Done in this commit
- `schema.ts`: added `nickname`/`category` to `MissilePreset` & `ShipPreset`; added
  `name` to `LauncherPreset` & `IlluminatorPreset`.
- Parsers populate the new fields: missiles/vessels set `nickname:null, category:null`;
  launchers/sensors set `name = prettifyId(id)` (space-separated fallback).
- Typecheck clean, 23 tests pass. Output still uses fallback names (no localization yet).

## What's left (do these, in order)

### 1. `src/names.ts` — pure parsers + loader + enricher
Read from the **base game** language dir only:
`<gamePath>/Sea Power_Data/StreamingAssets/original/language_en/`
(parseIni from `ini.ts` handles the UTF-8 BOM on the first line via `trim()`).

Three source formats (all verified against the real install):

- **`ammunition_names.ini`** — single `[AmmunitionNames]` section; each line is
  `id=name,nickname,category,description`. Split the value on commas; take
  `parts[0]`=name, `parts[1]`=nickname (empty → null), `parts[2]`=category. The
  description (everything after the 3rd comma) is dropped. Example:
  `usn_rim-66c=RIM-66C,SM-2MR,SAM/ASuW,The RIM-66C Standard Missile 2 MR ...`

- **`vessel_names.ini`** — one section **per ship id**, e.g. `[usn_cg_ticonderoga]`
  with `Default=Ticonderoga-class,Ticonderoga` (→ name="Ticonderoga-class",
  nickname/short="Ticonderoga") and optional `Type=Raft` (→ category; note some are
  `Type=M,Mine` so take the *last* comma field or just first — pick and document).
  Iterate `doc.sections`; skip sections without a `Default` key.

- **`systemgroups.ini`** — single `[LanguageResources]` section; lines are
  `id=Name` OR `id=Name|Description` (pipe-delimited — split on `|`, take `[0]`).
  Covers **both launchers and illuminators** keyed by their weapons.ini/sensors.ini
  section id. Examples: `MK13=MK 13`, `SPG-62=SPG-62|The AN/SPG-62 ...`,
  `SPY-1A=SPY-1A|...`. (Also contains `SG_*` system-group keys — harmless, just
  won't match any launcher/illuminator id.)

Suggested shape:
```ts
export type NameEntry = { name: string; nickname: string | null; category: string | null };
export type NameTables = {
  missiles: Map<string, NameEntry>;
  ships: Map<string, NameEntry>;
  systems: Map<string, string>;   // id -> name (launchers + illuminators)
};
export function parseAmmunitionNames(text: string): Map<string, NameEntry>;
export function parseVesselNames(text: string): Map<string, NameEntry>;
export function parseSystemNames(text: string): Map<string, string>;
export function loadNames(gamePath: string, lang = 'en'): NameTables;  // fs reads; missing files → empty maps
export function applyNames(presets: PresetsJson, names: NameTables): void;  // mutate arrays in place
```
`applyNames`: for each missile `m`, `const e = names.missiles.get(m.id); if (e) { m.name = e.name || m.name; m.nickname = e.nickname; m.category = e.category; }` — same pattern for ships; for launchers/illuminators `const n = names.systems.get(x.id); if (n) x.name = n;`.

### 2. Wire into `cli.ts`
After `presets` is built and before `writePresets`, add:
```ts
applyNames(presets, loadNames(paths.gamePath));
```
(Keep parsers FS-free — localization stays centralized in names.ts.)

### 3. `test/names.test.ts`
Unit-test the three pure parsers with inline fixtures:
- ammunition: empty nickname (`id=Name,,Cat,desc`) → null; description with commas not split into fields.
- vessel: `Default=Name,Short` → name+nickname; section without `Default` skipped.
- systemgroups: `id=Name|Desc` → name only; plain `id=Name` works.

### 4. Validate against the real install
```
node src/cli.ts --game "D:\SteamLibrary\steamapps\common\Sea Power" --mods "D:\SteamLibrary\steamapps\workshop\content\1286220"
```
Spot-check: `usn_cg_ticonderoga` → name "Ticonderoga-class", nickname "Ticonderoga";
`usn_rim-66c` → name "RIM-66C", nickname "SM-2MR", category "SAM/ASuW";
launcher `MK13` → "MK 13"; illuminator `SPG-62` → "SPG-62". Report coverage
(how many of 727/546/482/829 got a localized name vs fallback).

### 5. Update `CLAUDE.md`
Move display names out of "Next" into "Current state"; note base-only coverage and
that mod-name merge is still deferred. Bump the test count.

## Other deferred items (from CLAUDE.md §8)
- Mod-override merge for names (we chose base-only for now).
- Residual ~2.3% unresolved ship mounts (mod naming drift) — needs an alias step, risky.
- enabled-mods load order; whether SAMs expose a Pk like CIWS.
