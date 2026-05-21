import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIni } from '../src/ini.ts';
import { parseMissile } from '../src/parsers/ammunition.ts';
import { parseLauncher } from '../src/parsers/weapons.ts';
import { parseIlluminator } from '../src/parsers/sensors.ts';
import { parseVessel, type VesselLinkContext } from '../src/parsers/vessels.ts';

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

// --- Vessels + cross-linking -------------------------------------------------

const SHIP_INI = `[General]
UnitType=Vessel
[AI]
Role=AAW,ASW
[Physics]
Displacement=4500
MaxForwardVelocity=33
[SensorSystems]
NumberOfSensorSystems=4
[SensorSystem2]
Type=Radar
SystemName=SPY-1A
[SensorSystem5]
Type=Radar
SystemName=SPG-51
[SensorSystem6]
Type=Radar
SystemName=SPG-51
[SensorSystem7]
Type=Radar
SystemName=MK68_GFCS
[WeaponSystems]
NumberOfWeaponSystems=3
AvailableLoadouts=Default,Late
[WeaponSystem1]
Type=Missile
SystemName=MK13
AssociatedSensors=SensorSystem5,SensorSystem6,SensorSystem2
AssociatedMagazine=MagDefault
[WeaponSystem1Late]
Type=Missile
SystemName=MK13
AssociatedSensors=SensorSystem5,SensorSystem6,SensorSystem2
AssociatedMagazine=MagLate
[WeaponSystem2]
Type=Gun
SystemName=MK42
AssociatedSensors=SensorSystem7
[WeaponSystem3]
Type=Missile
SystemName=ASROC
Ammunition=usn_rur-5
NumberOfContainers=8
[MagDefault]
NumberOfAmmunitionTypes=2
Ammunition1=usn_rim-66b
Ammunition1_Count=34
Ammunition2=usn_rgm-84a
Ammunition2_Count=6
[MagLate]
NumberOfAmmunitionTypes=1
Ammunition1=usn_rim-66e
Ammunition1_Count=40
`;

function shipCtx(): VesselLinkContext {
  return {
    illuminators: new Map([
      ['SPG-51', { type: 'Targeting', mode: 'Illuminate', weaponChannels: 1, maxRangeNm: 90 }],
      // A search radar with guidance channels (Aegis-style): must NOT feed the cap.
      ['SPY-1A', { type: 'DirectedSearch', mode: 'Illuminate', weaponChannels: 24, maxRangeNm: 240 }],
    ]),
    launcherIds: new Set(['MK13', 'MK42', 'ASROC']),
    missileIds: new Set(['usn_rim-66b', 'usn_rim-66e', 'usn_rgm-84a', 'usn_rur-5']),
  };
}

test('parseVessel reads identity, mounts, and cross-links launchers', () => {
  const ship = parseVessel(parseIni(SHIP_INI), 'usn_ddg_test', 'base', shipCtx());
  assert.ok(ship);
  assert.equal(ship.unitType, 'Vessel');
  assert.equal(ship.role, 'AAW,ASW');
  assert.equal(ship.displacementTons, 4500);
  assert.equal(ship.maxSpeedKnots, 33);
  assert.equal(ship.mounts.length, 3);
  assert.deepEqual(
    ship.mounts.map((m) => [m.launcherId, m.resolved]),
    [['MK13', true], ['MK42', true], ['ASROC', true]],
  );
});

test('parseVessel cap counts only Type=Targeting illuminators', () => {
  const ship = parseVessel(parseIni(SHIP_INI), 'usn_ddg_test', 'base', shipCtx())!;
  // SPY-1A (DirectedSearch) is listed but excluded; MK68 gun GFCS isn't an
  // illuminator at all. Cap = the two SPG-51 terminal illuminators × 1 channel.
  assert.deepEqual(ship.directors.map((d) => d.sensorSystem), [
    'SensorSystem2',
    'SensorSystem5',
    'SensorSystem6',
  ]);
  assert.ok(ship.directors.some((d) => d.illuminatorId === 'SPY-1A'));
  assert.equal(ship.weaponChannels, 2);
});

test('parseVessel resolves per-loadout ammo from magazines and direct binds', () => {
  const ship = parseVessel(parseIni(SHIP_INI), 'usn_ddg_test', 'base', shipCtx())!;
  const byName = new Map(ship.loadouts.map((l) => [l.name, l]));
  const dflt = byName.get('Default')!;
  assert.deepEqual(
    dflt.ammo.map((a) => [a.ammoId, a.count]),
    [['usn_rgm-84a', 6], ['usn_rim-66b', 34], ['usn_rur-5', 8]],
  );
  assert.ok(dflt.ammo.every((a) => a.isMissile));
  const late = byName.get('Late')!;
  assert.deepEqual(
    late.ammo.map((a) => [a.ammoId, a.count]),
    [['usn_rim-66e', 40], ['usn_rur-5', 8]],
  );
});

test('parseVessel returns null when there is no [WeaponSystems]', () => {
  const doc = parseIni('[General]\nUnitType=Vessel\n[Physics]\nDisplacement=900\n');
  assert.equal(parseVessel(doc, 'civ_tugboat', 'base', shipCtx()), null);
});
