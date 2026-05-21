/**
 * Path resolution with the precedence required by PARSER_HANDOFF.md §2.1:
 *   1. CLI flags  2. config file  3. env vars  4. Steam auto-discovery
 * Stops at the first candidate that *validates*. On a successful resolve the
 * paths are written back to the config file so the next run is zero-config.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { discoverViaSteam, SEA_POWER_APPID } from './steam.ts';

export const CONFIG_FILENAME = 'seapower-parser.config.json';

export type ResolvedPaths = {
  gamePath: string;
  modsPath: string | null;
  /** Which precedence tier won, for `--print-config`. */
  source: 'cli' | 'config' | 'env' | 'steam';
};

export type ResolveOptions = {
  gameFlag?: string | undefined;
  modsFlag?: string | undefined;
  /** Directory holding the config file (defaults to cwd). */
  configDir?: string;
};

/** Game root is valid iff the exe and the original ammunition dir both exist. */
export function validateGame(gamePath: string): boolean {
  return (
    existsSync(join(gamePath, 'Sea Power.exe')) &&
    existsSync(
      join(gamePath, 'Sea Power_Data', 'StreamingAssets', 'original', 'ammunition'),
    )
  );
}

/** Mods root is valid iff the workshop `1286220` directory exists. */
export function validateMods(modsPath: string): boolean {
  return existsSync(modsPath);
}

/** Derive the workshop mods dir from a game path, if it exists on the same drive. */
function deriveModsFromGame(gamePath: string): string | null {
  // <lib>/steamapps/common/Sea Power  ->  <lib>/steamapps/workshop/content/<id>
  const steamapps = resolve(gamePath, '..', '..');
  const mods = join(steamapps, 'workshop', 'content', SEA_POWER_APPID);
  return existsSync(mods) ? mods : null;
}

type ConfigFile = { gamePath?: string; modsPath?: string | null };

function readConfigFile(configDir: string): ConfigFile | undefined {
  const path = join(configDir, CONFIG_FILENAME);
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as ConfigFile;
  } catch {
    return undefined;
  }
}

export function writeConfigFile(configDir: string, paths: ResolvedPaths): void {
  const path = join(configDir, CONFIG_FILENAME);
  const body: ConfigFile = { gamePath: paths.gamePath, modsPath: paths.modsPath };
  writeFileSync(path, JSON.stringify(body, null, 2) + '\n', 'utf8');
}

export class PathResolutionError extends Error {
  // Plain field, not a TS parameter property: Node's strip-only TS runtime
  // can't transform `constructor(public readonly ...)`.
  readonly checked: string[];
  constructor(checked: string[]) {
    super(
      'Could not locate a valid Sea Power install. Checked, in order:\n' +
        checked.map((c) => `  - ${c}`).join('\n'),
    );
    this.name = 'PathResolutionError';
    this.checked = checked;
  }
}

/**
 * Resolve game + mods paths. Throws PathResolutionError (listing what was tried)
 * rather than silently proceeding with nothing — never emit an empty presets.json.
 */
export function resolvePaths(opts: ResolveOptions = {}): ResolvedPaths {
  const configDir = opts.configDir ?? process.cwd();
  const checked: string[] = [];

  const finalize = (
    gamePath: string,
    modsFlagOrCfg: string | null | undefined,
    source: ResolvedPaths['source'],
  ): ResolvedPaths => {
    const game = resolve(gamePath);
    let mods: string | null = null;
    if (modsFlagOrCfg) {
      const m = resolve(modsFlagOrCfg);
      mods = validateMods(m) ? m : null;
    } else {
      mods = deriveModsFromGame(game);
    }
    return { gamePath: game, modsPath: mods, source };
  };

  // 1. CLI flags
  if (opts.gameFlag) {
    checked.push(`CLI --game ${opts.gameFlag}`);
    if (validateGame(opts.gameFlag)) return finalize(opts.gameFlag, opts.modsFlag, 'cli');
  }

  // 2. Config file
  const cfg = readConfigFile(configDir);
  if (cfg?.gamePath) {
    checked.push(`config ${join(configDir, CONFIG_FILENAME)} -> ${cfg.gamePath}`);
    if (validateGame(cfg.gamePath)) return finalize(cfg.gamePath, cfg.modsPath, 'config');
  }

  // 3. Env vars
  const envGame = process.env['SEAPOWER_GAME'];
  if (envGame) {
    checked.push(`env SEAPOWER_GAME=${envGame}`);
    if (validateGame(envGame)) {
      return finalize(envGame, process.env['SEAPOWER_MODS'], 'env');
    }
  }

  // 4. Steam auto-discovery
  checked.push('Steam auto-discovery (registry + libraryfolders.vdf)');
  const steam = discoverViaSteam();
  if (steam && validateGame(steam.gamePath)) {
    return finalize(steam.gamePath, steam.modsPath, 'steam');
  }

  throw new PathResolutionError(checked);
}

export { dirname };
