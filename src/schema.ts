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
};

export type MissilePreset = {
  id: string;
  name: string;
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

/** Placeholder — ship cross-linking is built in a later pass (handoff §4, §8). */
export type ShipPreset = {
  id: string;
  name: string;
  source: string;
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
