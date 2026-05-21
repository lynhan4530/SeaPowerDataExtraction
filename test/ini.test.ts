import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseIni,
  getValue,
  getValues,
  getNumber,
  getList,
} from '../src/ini.ts';

test('basic section + key/value', () => {
  const doc = parseIni('[General]\nType=Missile\nTargetType=ASuW\n');
  const general = doc.byName.get('General');
  assert.ok(general);
  assert.equal(getValue(general, 'Type'), 'Missile');
  assert.equal(getValue(general, 'TargetType'), 'ASuW');
});

test('strips // inline comments and trims', () => {
  const doc = parseIni(
    '[Guidance]\nMaxVelocity=620          // knots\nMaxLaunchRange=22.6      // nm\n',
  );
  const g = doc.byName.get('Guidance');
  assert.ok(g);
  assert.equal(getValue(g, 'MaxVelocity'), '620');
  assert.equal(getNumber(g, 'MaxVelocity'), 620);
  assert.equal(getNumber(g, 'MaxLaunchRange'), 22.6);
});

test('ignores # and ##### line comments', () => {
  const doc = parseIni(
    '############ header ############\n# a note\n[General]\n# inner note\nType=Missile\n',
  );
  assert.equal(doc.sections.length, 1);
  assert.equal(getValue(doc.byName.get('General')!, 'Type'), 'Missile');
});

test('lines opening with // are comments, not values', () => {
  const doc = parseIni('[General]\n// disabled=Type=Foo\nType=Missile\n');
  const g = doc.byName.get('General')!;
  assert.equal(getValue(g, 'Type'), 'Missile');
  assert.equal(g.keys.length, 1);
});

test('divider sections are dropped, real dashed ids kept', () => {
  const doc = parseIni(
    '[ ---- CIWS ---- ]\n[AK630]\nMissileInterceptChance=45\n[SPG-62]\nWeaponChannels=1\n',
  );
  // The `----` divider must not become a section...
  assert.equal(doc.byName.has('---- CIWS ----'), false);
  // ...but single-dash real ids must survive.
  assert.ok(doc.byName.get('AK630'));
  assert.ok(doc.byName.get('SPG-62'));
  assert.equal(getNumber(doc.byName.get('AK630')!, 'MissileInterceptChance'), 45);
  assert.equal(getNumber(doc.byName.get('SPG-62')!, 'WeaponChannels'), 1);
});

test('=== / ### / *** dividers are dropped too', () => {
  const doc = parseIni('[==========]\n[####]\n[~~~~]\n[Real]\nx=1\n');
  assert.deepEqual(
    doc.sections.map((s) => s.name),
    ['Real'],
  );
});

test('duplicate keys collect into arrays in document order', () => {
  const doc = parseIni(
    '[General]\nAssociatedMagazine=MagA\nAssociatedMagazine=MagB\nAssociatedMagazine=MagC\n',
  );
  const g = doc.byName.get('General')!;
  assert.deepEqual(getValues(g, 'AssociatedMagazine'), ['MagA', 'MagB', 'MagC']);
  // getValue returns the first; keys list is deduplicated.
  assert.equal(getValue(g, 'AssociatedMagazine'), 'MagA');
  assert.deepEqual(g.keys, ['AssociatedMagazine']);
});

test('repeated section header merges, preserving duplicate keys', () => {
  const doc = parseIni('[General]\nx=1\n[Other]\ny=2\n[General]\nx=9\nz=3\n');
  assert.equal(doc.sections.length, 2); // General appears once
  const g = doc.byName.get('General')!;
  assert.deepEqual(getValues(g, 'x'), ['1', '9']);
  assert.equal(getValue(g, 'z'), '3');
});

test('comma list parsing (AvailableLoadouts)', () => {
  const doc = parseIni('[WeaponSystems]\nAvailableLoadouts=051, 051BF ,052,\n');
  assert.deepEqual(getList(doc.byName.get('WeaponSystems')!, 'AvailableLoadouts'), [
    '051',
    '051BF',
    '052',
  ]);
});

test('preamble captures keys before the first section', () => {
  const doc = parseIni('Name=[DEPRECATED] Old Mod\n[General]\nType=Missile\n');
  assert.equal(getValue(doc.preamble, 'Name'), '[DEPRECATED] Old Mod');
});

test('CRLF line endings handled', () => {
  const doc = parseIni('[General]\r\nType=Missile\r\n');
  assert.equal(getValue(doc.byName.get('General')!, 'Type'), 'Missile');
});

test('numbers that are not finite return undefined', () => {
  const doc = parseIni('[X]\na=\nb=notanumber\nc=12\n');
  const x = doc.byName.get('X')!;
  assert.equal(getNumber(x, 'a'), undefined);
  assert.equal(getNumber(x, 'b'), undefined);
  assert.equal(getNumber(x, 'c'), 12);
  assert.equal(getNumber(x, 'missing'), undefined);
});
