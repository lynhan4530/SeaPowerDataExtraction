/**
 * Localized display-name loader for Sea Power language_* files.
 *
 * Three source files (all in <gamePath>/Sea Power_Data/StreamingAssets/original/language_en/):
 *   ammunition_names.ini  – missiles
 *   vessel_names.ini      – ships
 *   systemgroups.ini      – launchers + illuminators
 *
 * Parsers are FS-free; loadNames does the file I/O.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseIni } from './ini.ts';
import type { PresetsJson } from './schema.ts';

export type NameEntry = { name: string; nickname: string | null; category: string | null };
export type NameTables = {
  missiles: Map<string, NameEntry>;
  ships: Map<string, NameEntry>;
  /** id → name for both launchers and illuminators. */
  systems: Map<string, string>;
};

/**
 * Parse `ammunition_names.ini`.
 * Format: single `[AmmunitionNames]` section; each line is
 *   id=name,nickname,category,description
 * (description may contain commas — we take only the first three fields).
 * Empty nickname/category → null.
 */
export function parseAmmunitionNames(text: string): Map<string, NameEntry> {
  const doc = parseIni(text);
  const section = doc.byName.get('AmmunitionNames');
  if (!section) return new Map();

  const result = new Map<string, NameEntry>();
  for (const key of section.keys) {
    const raw = section.values[key]?.[0];
    if (raw === undefined) continue;
    const parts = raw.split(',');
    const name = parts[0]?.trim() ?? '';
    const nickname = parts[1]?.trim() || null;
    const category = parts[2]?.trim() || null;
    if (name) result.set(key, { name, nickname, category });
  }
  return result;
}

/**
 * Parse `vessel_names.ini`.
 * Format: one section per ship id; within each:
 *   Default=ClassName,Nickname  (nickname may be absent or empty → null)
 *   Type=Category               (optional; `Type=M,Mine` → last comma-field = "Mine")
 * Sections without a `Default` key are skipped.
 */
export function parseVesselNames(text: string): Map<string, NameEntry> {
  const doc = parseIni(text);
  const result = new Map<string, NameEntry>();

  for (const section of doc.sections) {
    const defaultVal = section.values['Default']?.[0];
    if (!defaultVal) continue;

    const parts = defaultVal.split(',');
    const name = parts[0]?.trim() ?? '';
    const nickname = parts[1]?.trim() || null;

    const typeVal = section.values['Type']?.[0];
    let category: string | null = null;
    if (typeVal) {
      const typeParts = typeVal.split(',');
      // `Type=M,Mine` — take the last field as the human-readable category name
      category = typeParts[typeParts.length - 1]?.trim() || null;
    }

    if (name) result.set(section.name, { name, nickname, category });
  }
  return result;
}

/**
 * Parse `systemgroups.ini`.
 * Format: single `[LanguageResources]` section; lines are either
 *   id=Name
 *   id=Name|Description   (pipe-delimited; description is dropped)
 * Covers both weapons.ini and sensors.ini ids, plus SG_* group keys (harmless).
 */
export function parseSystemNames(text: string): Map<string, string> {
  const doc = parseIni(text);
  const section = doc.byName.get('LanguageResources');
  if (!section) return new Map();

  const result = new Map<string, string>();
  for (const key of section.keys) {
    const raw = section.values[key]?.[0];
    if (!raw) continue;
    const name = raw.split('|')[0]?.trim();
    if (name) result.set(key, name);
  }
  return result;
}

/**
 * Read the three language files from disk and return combined name tables.
 * Missing files produce empty maps (not an error — mods omit them).
 */
export function loadNames(gamePath: string, lang = 'en'): NameTables {
  const langDir = join(
    gamePath,
    'Sea Power_Data',
    'StreamingAssets',
    'original',
    `language_${lang}`,
  );

  const tryRead = (filename: string): string | null => {
    try {
      return readFileSync(join(langDir, filename), 'utf8');
    } catch {
      return null;
    }
  };

  const ammoText = tryRead('ammunition_names.ini');
  const vesselText = tryRead('vessel_names.ini');
  const systemsText = tryRead('systemgroups.ini');

  return {
    missiles: ammoText !== null ? parseAmmunitionNames(ammoText) : new Map(),
    ships: vesselText !== null ? parseVesselNames(vesselText) : new Map(),
    systems: systemsText !== null ? parseSystemNames(systemsText) : new Map(),
  };
}

/**
 * Overwrite fallback names on all presets in-place using the loaded name tables.
 * Fields not present in the tables are left unchanged.
 */
export function applyNames(presets: PresetsJson, names: NameTables): void {
  for (const m of presets.missiles) {
    const e = names.missiles.get(m.id);
    if (e) {
      m.name = e.name || m.name;
      m.nickname = e.nickname;
      m.category = e.category;
    }
  }
  for (const s of presets.ships) {
    const e = names.ships.get(s.id);
    if (e) {
      s.name = e.name || s.name;
      s.nickname = e.nickname;
      s.category = e.category;
    }
  }
  for (const l of presets.launchers) {
    const n = names.systems.get(l.id);
    if (n) l.name = n;
  }
  for (const i of presets.illuminators) {
    const n = names.systems.get(i.id);
    if (n) i.name = n;
  }
}
