/**
 * Steam auto-discovery (PARSER_HANDOFF.md §2.1, step 4) — the zero-config happy
 * path. AppID 1286220 is the stable anchor for both the game and workshop dirs.
 *
 * Windows-only: reads the registry via `reg query` and parses libraryfolders.vdf.
 * Best-effort — callers fall back to explicit paths when this returns nothing.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const SEA_POWER_APPID = '1286220';

/** Read Steam's install dir from the Windows registry, or undefined. */
export function findSteamPath(): string | undefined {
  const queries: Array<[string, string]> = [
    ['HKCU\\Software\\Valve\\Steam', 'SteamPath'],
    ['HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath'],
  ];
  for (const [key, value] of queries) {
    try {
      const out = execFileSync('reg', ['query', key, '/v', value], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      // Line looks like:  SteamPath    REG_SZ    g:/program files (x86)/steam
      const m = out.match(new RegExp(`${value}\\s+REG_SZ\\s+(.+)`, 'i'));
      const path = m?.[1]?.trim();
      if (path && existsSync(path)) return path;
    } catch {
      // key/value absent — try the next candidate
    }
  }
  return undefined;
}

/** All Steam library roots, parsed from libraryfolders.vdf. */
export function listLibraryRoots(steamPath: string): string[] {
  const vdf = join(steamPath, 'steamapps', 'libraryfolders.vdf');
  if (!existsSync(vdf)) return [steamPath];
  const text = readFileSync(vdf, 'utf8');
  const roots: string[] = [];
  for (const m of text.matchAll(/"path"\s*"([^"]+)"/g)) {
    // VDF escapes backslashes; normalise to real paths.
    roots.push(m[1]!.replace(/\\\\/g, '\\'));
  }
  return roots.length > 0 ? roots : [steamPath];
}

export type SteamDiscovery = {
  gamePath: string;
  modsPath: string | null;
};

/**
 * Locate the game (and workshop mods) across all Steam libraries. The library
 * whose `appmanifest_1286220.acf` exists is authoritative for the game folder.
 */
export function discoverViaSteam(): SteamDiscovery | undefined {
  const steam = findSteamPath();
  if (!steam) return undefined;

  for (const root of listLibraryRoots(steam)) {
    const apps = join(root, 'steamapps');
    const game = join(apps, 'common', 'Sea Power');
    const acf = join(apps, `appmanifest_${SEA_POWER_APPID}.acf`);
    if (existsSync(acf) && existsSync(game)) {
      const mods = join(apps, 'workshop', 'content', SEA_POWER_APPID);
      return { gamePath: game, modsPath: existsSync(mods) ? mods : null };
    }
  }
  return undefined;
}
