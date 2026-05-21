import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIni } from '../src/ini.ts';
import { parseMissile } from '../src/parsers/ammunition.ts';
import { parseLauncher } from '../src/parsers/weapons.ts';
import { parseIlluminator } from '../src/parsers/sensors.ts';

test('parseMissile decodes guidance, role, sea-skimming, ECCM', () => {
  const doc = parseIni(`[General]
Type=Missile
TargetType=ASuW
[Guidance]
GuidanceType=3
MaxVelocity=620
MinLaunchRange=6
MaxLaunchRange=35
SeaSkimmingAlt=33
SeekerActiveRange=20
AntiCountermeasuresBonus=0.2
AntiJammerBonus=0.05
[SensorData]
RCS=0.25
`);
  const m = parseMissile(doc, 'fr_am-39', 'base');
  assert.ok(m);
  assert.equal(m.role, 'ASuW');
  assert.equal(m.guidance, 'ARH');
  assert.equal(m.speedKnots, 620);
  assert.equal(m.maxRangeNm, 35);
  assert.equal(m.minRangeNm, 6);
  assert.equal(m.seaSkimming, true);
  assert.equal(m.seaSkimmingAltFt, 33);
  assert.equal(m.rcs, 0.25);
  assert.equal(m.antiJammerBonus, 0.05);
});

test('parseMissile returns null for non-missile ammo', () => {
  const doc = parseIni('[General]\nType=Projectile\n');
  assert.equal(parseMissile(doc, 'gun_round', 'base'), null);
});

test('parseMissile maps unknown guidance code to Unknown', () => {
  const doc = parseIni('[General]\nType=Missile\n[Guidance]\nGuidanceType=42\n');
  assert.equal(parseMissile(doc, 'x', 'base')!.guidance, 'Unknown');
});

test('parseLauncher reads CIWS Pk and rate fields', () => {
  const doc = parseIni(`[AK630]
MissileInterceptChance=45
AircraftInterceptChance=70
FireRate=4000
ReloadTime=1800
HorizontalDegreesPerSecond=70
ModuleType=CIWS
`);
  const l = parseLauncher(doc.byName.get('AK630')!, 'base');
  assert.ok(l);
  assert.equal(l.kind, 'CIWS');
  assert.equal(l.missileInterceptChance, 45);
  assert.equal(l.fireRatePerMin, 4000);
  assert.equal(l.reloadTimeS, 1800);
});

test('parseLauncher returns null without ModuleType', () => {
  const doc = parseIni('[NotALauncher]\nFoo=1\n');
  assert.equal(parseLauncher(doc.byName.get('NotALauncher')!, 'base'), null);
});

test('parseIlluminator requires WeaponChannels and converts km->nm', () => {
  const doc = parseIni(`[SPG-62]
Kind=Radar
Type=Targeting
Mode=Illuminate
WeaponChannels=1
TargetChannels=1
MaxRange=185.2
`);
  const i = parseIlluminator(doc.byName.get('SPG-62')!, 'base');
  assert.ok(i);
  assert.equal(i.weaponChannels, 1);
  assert.equal(i.maxRangeKm, 185.2);
  assert.equal(i.maxRangeNm, 100); // 185.2 / 1.852
});

test('parseIlluminator skips sensors without WeaponChannels', () => {
  const doc = parseIni('[SearchOnly]\nKind=Radar\nType=Search\nTargetChannels=20\n');
  assert.equal(parseIlluminator(doc.byName.get('SearchOnly')!, 'base'), null);
});
