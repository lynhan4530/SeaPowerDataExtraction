import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAmmunitionNames,
  parseVesselNames,
  parseSystemNames,
} from '../src/names.ts';

// --- parseAmmunitionNames ---------------------------------------------------

test('parseAmmunitionNames: name, nickname, category', () => {
  const m = parseAmmunitionNames(
    '[AmmunitionNames]\nusn_rim-66c=RIM-66C,SM-2MR,SAM/ASuW,The RIM-66C Standard Missile\n',
  );
  const e = m.get('usn_rim-66c');
  assert.ok(e);
  assert.equal(e.name, 'RIM-66C');
  assert.equal(e.nickname, 'SM-2MR');
  assert.equal(e.category, 'SAM/ASuW');
});

test('parseAmmunitionNames: empty nickname → null', () => {
  const m = parseAmmunitionNames('[AmmunitionNames]\nsome_missile=Name,,Cat,desc\n');
  const e = m.get('some_missile');
  assert.ok(e);
  assert.equal(e.nickname, null);
  assert.equal(e.category, 'Cat');
});

test('parseAmmunitionNames: description with commas not split into fields', () => {
  const m = parseAmmunitionNames(
    '[AmmunitionNames]\nsome_missile=Name,Nick,Cat,desc part1,desc part2,desc part3\n',
  );
  const e = m.get('some_missile');
  assert.ok(e);
  assert.equal(e.name, 'Name');
  assert.equal(e.nickname, 'Nick');
  assert.equal(e.category, 'Cat');
});

test('parseAmmunitionNames: missing section → empty map', () => {
  const m = parseAmmunitionNames('[OtherSection]\nkey=val\n');
  assert.equal(m.size, 0);
});

// --- parseVesselNames -------------------------------------------------------

test('parseVesselNames: name and nickname from Default', () => {
  const m = parseVesselNames(
    '[usn_cg_ticonderoga]\nDefault=Ticonderoga-class,Ticonderoga\n',
  );
  const e = m.get('usn_cg_ticonderoga');
  assert.ok(e);
  assert.equal(e.name, 'Ticonderoga-class');
  assert.equal(e.nickname, 'Ticonderoga');
  assert.equal(e.category, null);
});

test('parseVesselNames: section without Default is skipped', () => {
  const m = parseVesselNames('[some_ship]\nType=Destroyer\n');
  assert.equal(m.size, 0);
});

test('parseVesselNames: simple Type → category', () => {
  const m = parseVesselNames('[some_raft]\nDefault=Raft Ship,\nType=Raft\n');
  const e = m.get('some_raft');
  assert.ok(e);
  assert.equal(e.category, 'Raft');
});

test('parseVesselNames: Type=M,Mine → last comma-field as category', () => {
  const m = parseVesselNames('[some_mine]\nDefault=Mine Layer,\nType=M,Mine\n');
  const e = m.get('some_mine');
  assert.ok(e);
  assert.equal(e.category, 'Mine');
});

test('parseVesselNames: empty nickname → null', () => {
  const m = parseVesselNames('[hull]\nDefault=Full Name,\n');
  const e = m.get('hull');
  assert.ok(e);
  assert.equal(e.nickname, null);
});

// --- parseSystemNames -------------------------------------------------------

test('parseSystemNames: plain id=Name', () => {
  const m = parseSystemNames('[LanguageResources]\nMK13=MK 13\n');
  assert.equal(m.get('MK13'), 'MK 13');
});

test('parseSystemNames: id=Name|Description → name only', () => {
  const m = parseSystemNames(
    '[LanguageResources]\nSPG-62=SPG-62|The AN/SPG-62 illuminator\n',
  );
  assert.equal(m.get('SPG-62'), 'SPG-62');
});

test('parseSystemNames: multiple entries', () => {
  const m = parseSystemNames(
    '[LanguageResources]\nMK13=MK 13\nSPY-1A=SPY-1A|Aegis radar\nSPG-62=SPG-62\n',
  );
  assert.equal(m.get('MK13'), 'MK 13');
  assert.equal(m.get('SPY-1A'), 'SPY-1A');
  assert.equal(m.get('SPG-62'), 'SPG-62');
});

test('parseSystemNames: missing section → empty map', () => {
  const m = parseSystemNames('[OtherSection]\nkey=val\n');
  assert.equal(m.size, 0);
});
