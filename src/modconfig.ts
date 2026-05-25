/**
 * Reader for Sea Power's enabled-mods list + load order (Task 2 / §8).
 *
 * Sea Power (a Unity game by Triassic Games) persists its mod-manager state in
 * its Unity persistent-data dir:
 *
 *   <home>/AppData/LocalLow/Triassic Games/Sea Power/usersettings.ini
 *
 * The relevant section:
 *
 *   [LoadOrder]
 *   Mod1Directory=3380210757,True      // <dir>,<enabledBool>
 *   Mod2Directory=3606134711,True
 *   Mod3Directory=ACConfigs,False
 *   ...
 *   NumberOfModFiles=128
 *
 * where `<dir>` is a workshop folder id (numeric) OR a local mod folder name,
 * the boolean is the per-mod enable flag, and the `Mod<N>` index encodes the
 * player's chosen load order. Later entries (higher N) load last and override
 * earlier ones — last-writer-wins, matching the base→mods→user low→high chain
 * the rest of the pipeline already uses.
 *
 * The persistent-data dir is discovered from the OS home dir (never a hardcoded
 * install path); Company/Product are the game's fixed identifiers, not paths.
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseIni } from './ini.ts';

/** One mod-manager entry, in load order. */
export type ModLoadEntry = {
  /** Workshop folder id (numeric) or local mod folder name. */
  id: string;
  enabled: boolean;
  /** 1-based load-order index (the `Mod<order>Directory` key). */
  order: number;
};

const COMPANY = 'Triassic Games';
const PRODUCT = 'Sea Power';
const USERSETTINGS = 'usersettings.ini';

/** Default Unity persistent-data location for the mod config, from the OS home. */
export function defaultModConfigPath(home: string = homedir()): string {
  return join(home, 'AppData', 'LocalLow', COMPANY, PRODUCT, USERSETTINGS);
}

/**
 * Parse the `[LoadOrder]` section of a usersettings.ini body into load-ordered
 * entries (ascending order = load order = low→high priority). Returns
 * `undefined` when the section is absent or has no `Mod<N>Directory` entries, so
 * the caller falls back to the "all installed, sorted by id" default.
 */
export function parseLoadOrder(text: string): ModLoadEntry[] | undefined {
  const doc = parseIni(text);
  const section = doc.byName.get('LoadOrder');
  if (!section) return undefined;

  const entries: ModLoadEntry[] = [];
  for (const key of section.keys) {
    const m = /^Mod(\d+)Directory$/.exec(key);
    if (!m) continue; // skip NumberOfModFiles and any stray keys
    const order = Number(m[1]);
    const raw = section.values[key]?.[0];
    if (raw === undefined) continue;
    // Value is "<dir>,<enabledBool>". A workshop id / folder name never contains
    // a comma, so split on the LAST comma to isolate the flag defensively.
    const comma = raw.lastIndexOf(',');
    if (comma === -1) continue;
    const id = raw.slice(0, comma).trim();
    const flag = raw.slice(comma + 1).trim().toLowerCase();
    if (id === '') continue;
    entries.push({ id, enabled: flag === 'true', order });
  }
  if (entries.length === 0) return undefined;
  entries.sort((a, b) => a.order - b.order);
  return entries;
}

export type ModConfigResult = {
  /** The file the load order was read from. */
  path: string;
  /** All entries (enabled + disabled), in load order. */
  entries: ModLoadEntry[];
};

/**
 * Locate + parse the mod load order. `explicitPath` (CLI flag) wins; otherwise
 * the default Unity persistent-data location is used. Returns `undefined` when
 * the file is missing or has no usable `[LoadOrder]` section, signalling the
 * caller to fall back to the all-installed default.
 */
export function loadModLoadOrder(
  explicitPath?: string | undefined,
): ModConfigResult | undefined {
  const path = explicitPath ?? defaultModConfigPath();
  if (!existsSync(path)) return undefined;
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
  const entries = parseLoadOrder(text);
  if (!entries) return undefined;
  return { path, entries };
}
