/**
 * Source enumeration + file indexing with provenance (PARSER_HANDOFF.md §2.2).
 *
 * A "source" is the base game, the local user overrides, or a workshop mod —
 * each a directory laid out like StreamingAssets (ammunition/, systems/, …).
 * Files are indexed last-writer-wins by filename, with a collisions report so
 * the user can audit which mod overrode what.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { parseIni, getValues } from './ini.ts';
import type { SourceKind, SourceInfo } from './schema.ts';

export type Source = SourceInfo & {
  kind: SourceKind;
  /** Directory containing the category folders (ammunition/, systems/, …). */
  root: string;
};

/** A resolved file: which path won, plus the full override chain (low→high). */
export type IndexedFile = {
  id: string;
  path: string;
  source: string;
  /** Sources that also defined this id but lost (in priority order). */
  overridden: string[];
};

function streamingAssets(gamePath: string): string {
  return join(gamePath, 'Sea Power_Data', 'StreamingAssets');
}

/** Read a mod's `_info.ini` → display name + [DEPRECATED] flag. */
function readModInfo(root: string, id: string): { name: string; deprecated: boolean } {
  const infoPath = join(root, '_info.ini');
  if (!existsSync(infoPath)) return { name: id, deprecated: false };
  try {
    const doc = parseIni(readFileSync(infoPath, 'utf8'));
    const names = doc.sections.flatMap((s) => getValues(s, 'Name'));
    const name = names[0] ?? id;
    const deprecated = names.some((n) => /\[DEPRECATED\]/i.test(n));
    return { name, deprecated };
  } catch {
    return { name: id, deprecated: false };
  }
}

/**
 * Enumerate sources in override priority order (low → high):
 * base game → workshop mods (by id) → user overrides win last.
 */
export function enumerateSources(gamePath: string, modsPath: string | null): Source[] {
  const sa = streamingAssets(gamePath);
  const sources: Source[] = [
    { id: 'base', kind: 'base', name: 'Base game', deprecated: false, root: join(sa, 'original') },
  ];

  if (modsPath && existsSync(modsPath)) {
    const modIds = readdirSync(modsPath)
      .filter((d) => statSync(join(modsPath, d)).isDirectory())
      .sort();
    for (const id of modIds) {
      const root = join(modsPath, id);
      const info = readModInfo(root, id);
      sources.push({ id, kind: 'mod', name: info.name, deprecated: info.deprecated, root });
    }
  }

  const userRoot = join(sa, 'user');
  if (existsSync(userRoot)) {
    sources.push({ id: 'user', kind: 'user', name: 'User overrides', deprecated: false, root: userRoot });
  }
  return sources;
}

/** List `*.ini` files (shallow) in `<source.root>/<category>`. */
function listCategoryFiles(source: Source, category: string): string[] {
  const dir = join(source.root, category);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.ini'))
    .map((f) => join(dir, f));
}

/**
 * Index one category across all (non-deprecated) sources, last-writer-wins by
 * filename. `sources` must already be in override priority order (low → high).
 */
export function indexCategory(
  sources: Source[],
  category: string,
): { files: IndexedFile[]; collisions: IndexedFile[] } {
  const byId = new Map<string, IndexedFile>();
  for (const source of sources) {
    if (source.deprecated) continue; // skip deprecated mods entirely
    for (const path of listCategoryFiles(source, category)) {
      const id = basename(path).replace(/\.ini$/i, '');
      const prev = byId.get(id);
      byId.set(id, {
        id,
        path,
        source: source.id,
        overridden: prev ? [...prev.overridden, prev.source] : [],
      });
    }
  }
  const files = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
  const collisions = files.filter((f) => f.overridden.length > 0);
  return { files, collisions };
}
