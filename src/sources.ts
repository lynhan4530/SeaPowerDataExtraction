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
import { parseIni, getValues, type IniSection } from './ini.ts';
import type { SourceKind, SourceInfo } from './schema.ts';
import type { ModLoadEntry } from './modconfig.ts';

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
 * base game → workshop mods → user overrides win last.
 *
 * The mod chain is built one of two ways:
 *  - **load-order mode** (`loadOrder` given): only the player's *enabled* mods,
 *    in their chosen load order. A mod's `[LoadOrder]` index is preserved on
 *    `order`; ascending index = loaded later = wins conflicts (bottom wins),
 *    matching this low→high chain. Enabled mods whose directory is missing under
 *    `modsPath` are skipped and reported via `missingEnabled`.
 *  - **fallback** (`loadOrder` null/empty): every installed mod, sorted by id —
 *    the original behavior, so runs without a discoverable config don't regress.
 */
export function enumerateSources(
  gamePath: string,
  modsPath: string | null,
  loadOrder?: ModLoadEntry[] | null,
): { sources: Source[]; missingEnabled: ModLoadEntry[] } {
  const sa = streamingAssets(gamePath);
  const sources: Source[] = [
    {
      id: 'base',
      kind: 'base',
      name: 'Base game',
      deprecated: false,
      enabled: true,
      order: null,
      root: join(sa, 'original'),
    },
  ];
  const missingEnabled: ModLoadEntry[] = [];

  if (modsPath && existsSync(modsPath)) {
    const enabledInOrder = loadOrder?.filter((e) => e.enabled) ?? null;
    if (enabledInOrder && enabledInOrder.length > 0) {
      // Load-order mode: enabled mods only, in ascending (low→high) order.
      for (const entry of enabledInOrder) {
        const root = join(modsPath, entry.id);
        if (!existsSync(root)) {
          missingEnabled.push(entry); // enabled but not under the workshop dir
          continue;
        }
        const info = readModInfo(root, entry.id);
        sources.push({
          id: entry.id,
          kind: 'mod',
          name: info.name,
          deprecated: info.deprecated,
          enabled: true,
          order: entry.order,
          root,
        });
      }
    } else {
      // Fallback: every installed mod, sorted by id (the original behavior).
      const modIds = readdirSync(modsPath)
        .filter((d) => statSync(join(modsPath, d)).isDirectory())
        .sort();
      for (const id of modIds) {
        const root = join(modsPath, id);
        const info = readModInfo(root, id);
        sources.push({
          id,
          kind: 'mod',
          name: info.name,
          deprecated: info.deprecated,
          enabled: true,
          order: null,
          root,
        });
      }
    }
  }

  const userRoot = join(sa, 'user');
  if (existsSync(userRoot)) {
    sources.push({
      id: 'user',
      kind: 'user',
      name: 'User overrides',
      deprecated: false,
      enabled: true,
      order: null,
      root: userRoot,
    });
  }
  return { sources, missingEnabled };
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

// --- Shared single-file categories (systems/weapons.ini, sensors.ini) --------
// These aren't one-file-per-entity: every source ships a (often partial) copy
// of the same file, and the game merges their sections additively. So override
// resolution is per-SECTION, not per-file (last-writer-wins by section id).

export type MergedSection = {
  id: string;
  section: IniSection;
  source: string;
  /** Sources that also defined this section id but lost (priority order). */
  overridden: string[];
};

/**
 * Merge a specific relative file (e.g. `systems/weapons.ini`) across all
 * non-deprecated sources, last-writer-wins by section id. `sources` must be in
 * override priority order (low → high). Returns sections sorted by id.
 */
export function mergeSections(
  sources: Source[],
  relPath: string,
): { sections: MergedSection[]; collisions: MergedSection[] } {
  const byId = new Map<string, MergedSection>();
  for (const source of sources) {
    if (source.deprecated) continue;
    const path = join(source.root, relPath);
    if (!existsSync(path)) continue;
    const doc = parseIni(readFileSync(path, 'utf8'));
    for (const section of doc.sections) {
      const prev = byId.get(section.name);
      byId.set(section.name, {
        id: section.name,
        section,
        source: source.id,
        overridden: prev ? [...prev.overridden, prev.source] : [],
      });
    }
  }
  const sections = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
  const collisions = sections.filter((s) => s.overridden.length > 0);
  return { sections, collisions };
}
