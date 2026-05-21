/**
 * Launcher parser for `systems/weapons.ini` (PARSER_HANDOFF.md §3b).
 *
 * One section per launcher id (e.g. [MK13], [AK630]). CIWS sections carry a
 * literal Pk (`MissileInterceptChance`) — the kill chance we want directly.
 * Divider sections (`[ ---- Aircraft Guns ---- ]`) are already dropped by the
 * tokenizer, but we still skip sections with no launcher-ish fields.
 */
import { getValue, getNumber, type IniSection } from '../ini.ts';
import type { LauncherPreset } from '../schema.ts';

/** Readable fallback name; replaced by the localized name later if available. */
function prettifyId(id: string): string {
  return id.replace(/_/g, ' ');
}

/** Parse one weapons.ini section, or null if it isn't a real launcher/mount. */
export function parseLauncher(
  section: IniSection,
  source: string,
): LauncherPreset | null {
  const kind = getValue(section, 'ModuleType');
  // A real entry has a ModuleType; without it, it's not a launcher/mount.
  if (kind === undefined) return null;

  return {
    id: section.name,
    name: prettifyId(section.name),
    kind,
    reloadTimeS: getNumber(section, 'ReloadTime') ?? null,
    fireRatePerMin: getNumber(section, 'FireRate') ?? null,
    horizontalDegPerSec: getNumber(section, 'HorizontalDegreesPerSecond') ?? null,
    verticalDegPerSec: getNumber(section, 'VerticalDegreesPerSecond') ?? null,
    missileInterceptChance: getNumber(section, 'MissileInterceptChance') ?? null,
    aircraftInterceptChance: getNumber(section, 'AircraftInterceptChance') ?? null,
    source,
  };
}
