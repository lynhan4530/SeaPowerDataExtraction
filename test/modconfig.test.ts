import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLoadOrder, defaultModConfigPath } from '../src/modconfig.ts';

// --- parseLoadOrder ---------------------------------------------------------

test('parseLoadOrder: enabled subset with non-contiguous order, ascending', () => {
  const text = [
    '[LoadOrder]',
    'Mod1Directory=3380210757,True',
    'Mod3Directory=3606134711,True',
    'Mod5Directory=DisabledMod,False',
    'Mod12Directory=3491248180,True',
    'NumberOfModFiles=12',
  ].join('\n');

  const entries = parseLoadOrder(text);
  assert.ok(entries);
  // All four mod entries are parsed (enable filtering happens in enumerateSources).
  assert.equal(entries.length, 4);
  // Sorted by numeric order, not file order.
  assert.deepEqual(
    entries.map((e) => e.order),
    [1, 3, 5, 12],
  );
  assert.deepEqual(
    entries.map((e) => e.id),
    ['3380210757', '3606134711', 'DisabledMod', '3491248180'],
  );
  // Enable flags decoded from the trailing field.
  assert.deepEqual(
    entries.map((e) => e.enabled),
    [true, true, false, true],
  );
});

test('parseLoadOrder: local mod folder names (non-numeric) are kept', () => {
  const text = '[LoadOrder]\nMod1Directory=AI Doctrine Overhaul,False\nNumberOfModFiles=1\n';
  const entries = parseLoadOrder(text);
  assert.ok(entries);
  assert.equal(entries[0]?.id, 'AI Doctrine Overhaul');
  assert.equal(entries[0]?.enabled, false);
});

test('parseLoadOrder: NumberOfModFiles and stray keys ignored', () => {
  const text = '[LoadOrder]\nNumberOfModFiles=5\nSomethingElse=99\nMod2Directory=abc,True\n';
  const entries = parseLoadOrder(text);
  assert.ok(entries);
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.id, 'abc');
  assert.equal(entries[0]?.order, 2);
});

test('parseLoadOrder: case-insensitive enable flag', () => {
  const text = '[LoadOrder]\nMod1Directory=a,TRUE\nMod2Directory=b,false\nMod3Directory=c,True\n';
  const entries = parseLoadOrder(text);
  assert.ok(entries);
  assert.deepEqual(
    entries.map((e) => e.enabled),
    [true, false, true],
  );
});

test('parseLoadOrder: missing [LoadOrder] section → undefined', () => {
  assert.equal(parseLoadOrder('[VideoSettings]\nScreenWidth=1920\n'), undefined);
});

test('parseLoadOrder: section present but no Mod<N>Directory entries → undefined', () => {
  assert.equal(parseLoadOrder('[LoadOrder]\nNumberOfModFiles=0\n'), undefined);
});

test('parseLoadOrder: empty / malformed body → undefined', () => {
  assert.equal(parseLoadOrder(''), undefined);
  assert.equal(parseLoadOrder('not an ini at all'), undefined);
});

// --- defaultModConfigPath ---------------------------------------------------

test('defaultModConfigPath: builds the Unity persistent-data path from home', () => {
  const p = defaultModConfigPath('C:\\Users\\someone');
  // Use forward-slash-insensitive checks (path.join is platform-specific).
  assert.match(p, /Triassic Games/);
  assert.match(p, /Sea Power/);
  assert.match(p, /usersettings\.ini$/);
  assert.match(p, /LocalLow/);
});
