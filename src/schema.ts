/**
 * Output contract: the shape of `presets.json` (PARSER_HANDOFF.md §6).
 *
 * This is intentionally a RICHER superset of the consuming app's current
 * `src/types.ts`. Overlapping field names are kept identical (`id`, `name`,
 * `speedKnots`, `maxRangeNm`, `minRangeNm`) so the app needs only a thin
 * adapter. Missing/unknown numeric fields are `null`, never omitted, so the
 * shape is stable across game patches.
 */

/** Provenance of an entity: base game, local user override, or a workshop mod. */
export type SourceKind = 'base' | 'user' | 'mod';

/** Missile role, from a missile's `[General].TargetType`. */
export type MissileRole = 'AAW' | 'ASuW' | 'ASW' | 'Other';

/** Guidance family, decoded from `[Guidance].GuidanceType` (0..9). */
export type GuidanceType =
  | 'None'
  | 'IR'
  | 'SARH'
  | 'ARH'
  | 'ARM'
  | 'Laser'
  | 'TV'
  | 'ActiveSonar'
  | 'PassiveSonar'
  | 'WakeHoming'
  | 'Unknown';

export type SourceInfo = {
  /** 'base', 'user', or the workshop mod id. */
  id: string;
  kind: SourceKind;
  /** Display name from `_info.ini` (mods), or a friendly label for base/user. */
  name: string;
  deprecated: boolean;
  /** Whether this source was applied (base/user always true; mods per load order). */
  enabled: boolean;
  /**
   * Mod load-order index from the game's `[LoadOrder]` (higher = loaded later =
   * wins conflicts). `null` for base/user and when load order isn't applied.
   */
  order: number | null;
};

export type MissilePreset = {
  id: string;
  /** Localized display name (language_en); falls back to a prettified id. */
  name: string;
  /** Popular/nickname from the name file, e.g. "SM-2MR", or null. */
  nickname: string | null;
  /** Name-file category, e.g. "SAM/ASuW", "IR AAM", or null. */
  category: string | null;
  role: MissileRole;
  speedKnots: number | null;
  maxRangeNm: number | null;
  minRangeNm: number | null;
  guidance: GuidanceType;
  seaSkimming: boolean;
  seaSkimmingAltFt: number | null;
  rcs: number | null;
  seekerActiveRangeNm: number | null;
  seekerPassiveRangeNm: number | null;
  /** ECCM: subtracted from spoof/jam probability (0..1). */
  antiCountermeasuresBonus: number | null;
  antiJammerBonus: number | null;
  source: string;
};

export type LauncherPreset = {
  id: string;
  /** Localized display name (systemgroups.ini); falls back to a prettified id. */
  name: string;
  /** `ModuleType` verbatim (SmallLauncher, VLS, CIWS, MediumTurret, …). */
  kind: string;
  reloadTimeS: number | null;
  fireRatePerMin: number | null;
  horizontalDegPerSec: number | null;
  verticalDegPerSec: number | null;
  /** CIWS only: literal Pk vs missiles / aircraft (percent), else null. */
  missileInterceptChance: number | null;
  aircraftInterceptChance: number | null;
  source: string;
};

export type IlluminatorPreset = {
  id: string;
  /** Localized display name (systemgroups.ini); falls back to a prettified id. */
  name: string;
  /** `Kind` (Radar, Sonar, …) and `Type` (Search, Targeting). */
  kind: string | null;
  type: string | null;
  /** `Mode`: Illuminate, RadioCommand, … */
  mode: string | null;
  /** Simultaneous missiles guided — THE saturation cap. */
  weaponChannels: number | null;
  /** Simultaneous targets tracked. */
  targetChannels: number | null;
  maxRangeKm: number | null;
  maxRangeNm: number | null;
  source: string;
};

/**
 * A guidance director on a hull: one physical `[SensorSystemN]` mount that a
 * SAM weapon system points at via `AssociatedSensors`. Resolved through its
 * `SystemName` to a sensors.ini illuminator. Multiple physical mounts can share
 * the same `illuminatorId` (e.g. two SPG-51s) — each is counted separately, so
 * the ship's saturation cap is the SUM of their `weaponChannels`.
 */
export type ShipDirector = {
  /** Local hull reference, e.g. `SensorSystem5`. */
  sensorSystem: string;
  /** Resolved illuminators[].id (sensors.ini section), or raw SystemName if unresolved. */
  illuminatorId: string;
  /** Whether `illuminatorId` matched a known illuminator. */
  resolved: boolean;
  /**
   * `Type`: `Targeting` = dedicated terminal illuminator (the classic SARH
   * saturation channel); `Search`/`DirectedSearch` = a search radar that also
   * carries guidance channels (e.g. Aegis SPY-1 command guidance). Only
   * `Targeting` directors feed the ship's headline `weaponChannels`.
   */
  type: string | null;
  /** `Mode`: Illuminate, RadioCommand, … */
  mode: string | null;
  weaponChannels: number | null;
  maxRangeNm: number | null;
};

/** A weapon mount on a hull: `[WeaponSystemN]` → a weapons.ini launcher. */
export type ShipMount = {
  /** Hull-local index from `[WeaponSystemN]`. */
  index: number;
  /** `Type`: Missile, Gun, CIWS, Torpedo, Chaff, Noisemaker, … */
  weaponType: string;
  /** `SystemName` → launchers[].id (weapons.ini). */
  launcherId: string;
  /** Whether `launcherId` matched a known launcher. */
  resolved: boolean;
};

/** One ammo line in a loadout: `ammoId` → missiles[].id when it's a missile. */
export type ShipLoadoutEntry = {
  ammoId: string;
  count: number | null;
  /** Whether `ammoId` matched a known missile preset. */
  isMissile: boolean;
};

/** A named fit (`AvailableLoadouts`), with ammo aggregated across all mounts. */
export type ShipLoadout = {
  name: string;
  ammo: ShipLoadoutEntry[];
};

export type ShipPreset = {
  id: string;
  /** Localized display name (vessel_names.ini); falls back to a prettified id. */
  name: string;
  /** Short/class name, e.g. "Ticonderoga", or null. */
  nickname: string | null;
  /** Name-file `Type`, e.g. "Raft", or null. */
  category: string | null;
  source: string;
  /** `[General].UnitType`: Vessel or Submarine. */
  unitType: string | null;
  /** `[AI].Role`, e.g. "AAW,ASW,ASuW". */
  role: string | null;
  displacementTons: number | null;
  maxSpeedKnots: number | null;
  /**
   * Headline saturation cap: sum of WeaponChannels over distinct *terminal*
   * illuminators (`Type=Targeting`) referenced by missile mounts. Search radars
   * with guidance channels (SPY-1) are excluded here but kept in `directors` so
   * the app can model Aegis-style command guidance itself. `null` if the ship
   * has no terminal illuminators (e.g. all-VLS fire-and-forget, gun boats).
   */
  weaponChannels: number | null;
  directors: ShipDirector[];
  mounts: ShipMount[];
  loadouts: ShipLoadout[];
};

export type PresetsJson = {
  generatedAt: string;
  gameVersion: string | null;
  resolvedPaths: {
    gamePath: string;
    modsPath: string | null;
  };
  sources: SourceInfo[];
  missiles: MissilePreset[];
  launchers: LauncherPreset[];
  illuminators: IlluminatorPreset[];
  ships: ShipPreset[];
  stats: Record<string, number>;
};
