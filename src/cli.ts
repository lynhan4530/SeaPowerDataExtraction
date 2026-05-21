#!/usr/bin/env node
/**
 * parse-seapower — extract Sea Power .ini data into presets.json.
 *
 * Usage:
 *   parse-seapower [--game <dir>] [--mods <dir>] [--out presets.json]
 *   parse-seapower --print-config      # show resolved paths + mod set, parse nothing
 *
 * Paths resolve via CLI flags -> config file -> env vars -> Steam discovery (§2.1).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseIni } from './ini.ts';
import {
  resolvePaths,
  writeConfigFile,
  PathResolutionError,
  CONFIG_FILENAME,
} from './config.ts';
import { enumerateSources, indexCategory, mergeSections } from './sources.ts';
import { parseMissile } from './parsers/ammunition.ts';
import { parseLauncher } from './parsers/weapons.ts';
import { parseIlluminator } from './parsers/sensors.ts';
import { detectGameVersion, writePresets, writeWarnings } from './emit.ts';
import type {
  IlluminatorPreset,
  LauncherPreset,
  MissilePreset,
  PresetsJson,
  SourceInfo,
} from './schema.ts';

type Args = {
  game: string | undefined;
  mods: string | undefined;
  out: string;
  printConfig: boolean;
};

function parseArgs(argv: string[]): Args {
  const args: Args = { game: undefined, mods: undefined, out: 'presets.json', printConfig: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--game':
        args.game = argv[++i];
        break;
      case '--mods':
        args.mods = argv[++i];
        break;
      case '--out':
        args.out = argv[++i] ?? args.out;
        break;
      case '--print-config':
        args.printConfig = true;
        break;
      case '-h':
      case '--help':
        printHelp();
        process.exit(0);
      // falls through to default otherwise
      default:
        if (a?.startsWith('--')) {
          console.error(`Unknown flag: ${a}`);
          process.exit(2);
        }
    }
  }
  return args;
}

function printHelp(): void {
  console.log(
    [
      'parse-seapower — Sea Power .ini -> presets.json',
      '',
      '  --game <dir>     game root (…/steamapps/common/Sea Power)',
      '  --mods <dir>     workshop dir (…/workshop/content/1286220)',
      '  --out <file>     output path (default: presets.json)',
      '  --print-config   show resolved paths + mod set, then exit',
      '  -h, --help       this help',
    ].join('\n'),
  );
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  let paths;
  try {
    paths = resolvePaths({ gameFlag: args.game, modsFlag: args.mods });
  } catch (err) {
    if (err instanceof PathResolutionError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }

  const sources = enumerateSources(paths.gamePath, paths.modsPath);
  const active = sources.filter((s) => !s.deprecated);
  const deprecated = sources.filter((s) => s.deprecated);

  if (args.printConfig) {
    console.log(`Resolved via : ${paths.source}`);
    console.log(`Game path    : ${paths.gamePath}`);
    console.log(`Mods path    : ${paths.modsPath ?? '(none)'}`);
    console.log(`Game version : ${detectGameVersion(paths.gamePath) ?? '(unknown)'}`);
    console.log(`Sources      : ${active.length} active, ${deprecated.length} deprecated`);
    const { files, collisions } = indexCategory(active, 'ammunition');
    console.log(`Ammunition   : ${files.length} files (${collisions.length} overridden)`);
    return;
  }

  const warnings: string[] = [];
  for (const d of deprecated) warnings.push(`skipped deprecated mod ${d.id} (${d.name})`);

  // --- Missiles -------------------------------------------------------------
  const { files: ammoFiles, collisions } = indexCategory(active, 'ammunition');
  for (const c of collisions) {
    warnings.push(`collision: ammunition/${c.id} from ${c.source} overrides [${c.overridden.join(', ')}]`);
  }
  const missiles: MissilePreset[] = [];
  for (const file of ammoFiles) {
    try {
      const doc = parseIni(readFileSync(file.path, 'utf8'));
      const missile = parseMissile(doc, file.id, file.source);
      if (missile) missiles.push(missile);
    } catch (err) {
      warnings.push(`failed to parse ammunition/${file.id}: ${(err as Error).message}`);
    }
  }
  missiles.sort((a, b) => a.id.localeCompare(b.id));

  // --- Launchers (systems/weapons.ini, merged per-section) -------------------
  const weapons = mergeSections(active, 'systems/weapons.ini');
  for (const c of weapons.collisions) {
    warnings.push(`collision: weapons[${c.id}] from ${c.source} overrides [${c.overridden.join(', ')}]`);
  }
  const launchers: LauncherPreset[] = [];
  for (const s of weapons.sections) {
    const launcher = parseLauncher(s.section, s.source);
    if (launcher) launchers.push(launcher);
  }

  // --- Illuminators (systems/sensors.ini, merged per-section) ----------------
  const sensors = mergeSections(active, 'systems/sensors.ini');
  for (const c of sensors.collisions) {
    warnings.push(`collision: sensors[${c.id}] from ${c.source} overrides [${c.overridden.join(', ')}]`);
  }
  const illuminators: IlluminatorPreset[] = [];
  for (const s of sensors.sections) {
    const illum = parseIlluminator(s.section, s.source);
    if (illum) illuminators.push(illum);
  }

  const sourceInfos: SourceInfo[] = sources.map((s) => ({
    id: s.id,
    kind: s.kind,
    name: s.name,
    deprecated: s.deprecated,
  }));

  const presets: PresetsJson = {
    generatedAt: new Date().toISOString(),
    gameVersion: detectGameVersion(paths.gamePath),
    resolvedPaths: { gamePath: paths.gamePath, modsPath: paths.modsPath },
    sources: sourceInfos,
    missiles,
    launchers,
    illuminators,
    ships: [],
    stats: {
      sourcesActive: active.length,
      sourcesDeprecated: deprecated.length,
      ammunitionFiles: ammoFiles.length,
      missiles: missiles.length,
      launchers: launchers.length,
      illuminators: illuminators.length,
      collisions: collisions.length + weapons.collisions.length + sensors.collisions.length,
      warnings: warnings.length,
    },
  };

  const outPath = resolve(args.out);
  writePresets(outPath, presets);
  writeWarnings(outPath.replace(/\.json$/i, '') + '.warnings.log', warnings);
  writeConfigFile(process.cwd(), paths);

  console.log(`Wrote ${outPath}`);
  console.log(`  ${missiles.length} missiles from ${ammoFiles.length} ammunition files`);
  console.log(`  ${launchers.length} launchers, ${illuminators.length} illuminators`);
  console.log(`  ${active.length} sources (${deprecated.length} deprecated skipped)`);
  console.log(`  ${warnings.length} warnings -> ${CONFIG_FILENAME} updated`);
}

main();
