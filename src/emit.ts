/** Output emission: game version detection + writing presets.json / warnings.log. */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PresetsJson } from './schema.ts';

/** Best-effort game version from changelog.txt (first version-looking token). */
export function detectGameVersion(gamePath: string): string | null {
  const path = join(gamePath, 'changelog.txt');
  if (!existsSync(path)) return null;
  try {
    const head = readFileSync(path, 'utf8').slice(0, 2000);
    const m = head.match(/v?\d+\.\d+(?:\.\d+)?[a-z]?/i);
    return m?.[0] ?? null;
  } catch {
    return null;
  }
}

export function writePresets(outPath: string, presets: PresetsJson): void {
  writeFileSync(outPath, JSON.stringify(presets, null, 2) + '\n', 'utf8');
}

export function writeWarnings(outPath: string, warnings: string[]): void {
  writeFileSync(outPath, warnings.join('\n') + (warnings.length ? '\n' : ''), 'utf8');
}
