/**
 * Vessel parser + cross-linking for `vessels/*.ini` (PARSER_HANDOFF.md §4, §8.1).
 *
 * A vessel file is a stat file iff it has a `[WeaponSystems]` section; material,
 * collider, and `*_variants.ini` (skin/nation) files lack it and are skipped.
 *
 * The hard part is the graph. A hull wires three other entity tables together:
 *
 *  - **Launcher**:  `[WeaponSystemN].SystemName`  → weapons.ini section id.
 *  - **Illuminator** (the SAM director, i.e. THE saturation cap): a missile
 *    mount lists `AssociatedSensors=SensorSystem5,SensorSystem6`; each names a
 *    local `[SensorSystemN]` block whose `SystemName` is a sensors.ini id. Two
 *    physical mounts can share one illuminator type (two SPG-51s), so directors
 *    are counted per physical mount and their `WeaponChannels` SUMMED.
 *  - **Ammo**: either direct (`Ammunition=usn_rgm-84c`) or via a magazine
 *    (`AssociatedMagazine=WeaponMagazineMK13` → a `[WeaponMagazine…]` block of
 *    `AmmunitionN` / `AmmunitionN_Count`).
 *
 * Loadouts (§8.1, now decoded): `AvailableLoadouts=Default,Late` lists named
 * fits. A weapon system's config for loadout L is `[WeaponSystemN<L>]` if that
 * suffixed block exists, else the base `[WeaponSystemN]`. (The first/Default
 * loadout has no suffixed blocks and always uses the base.)
 */
import { getValue, getNumber, getList, type IniDocument } from '../ini.ts';
import type {
  ShipDirector,
  ShipLoadout,
  ShipLoadoutEntry,
  ShipMount,
  ShipPreset,
} from '../schema.ts';

/** Lookups into the already-parsed launcher/illuminator/missile tables. */
export type VesselLinkContext = {
  illuminators: Map<
    string,
    { type: string | null; mode: string | null; weaponChannels: number | null; maxRangeNm: number | null }
  >;
  launcherIds: Set<string>;
  missileIds: Set<string>;
};

/** Turn `usn_ddg_adams_late` into a readable fallback name (real names need l10n later). */
function prettifyId(id: string): string {
  return id.replace(/_/g, ' ').toUpperCase();
}

/** Parse one vessel file, or null if it has no `[WeaponSystems]` (not a stat file). */
export function parseVessel(
  doc: IniDocument,
  id: string,
  source: string,
  ctx: VesselLinkContext,
): ShipPreset | null {
  const ws = doc.byName.get('WeaponSystems');
  if (!ws) return null;

  const general = doc.byName.get('General');
  const ai = doc.byName.get('AI');
  const physics = doc.byName.get('Physics');

  // Map each local [SensorSystemN] → its SystemName (the sensors.ini id).
  const sensorName = new Map<string, string>();
  for (const section of doc.sections) {
    if (/^SensorSystem\d+$/.test(section.name)) {
      sensorName.set(section.name, getValue(section, 'SystemName') ?? '');
    }
  }

  const count = getNumber(ws, 'NumberOfWeaponSystems') ?? 0;
  const loadoutNames = getList(ws, 'AvailableLoadouts');
  const loadouts: string[] = loadoutNames.length > 0 ? loadoutNames : ['Default'];

  // --- Mounts: canonical list from the base [WeaponSystemN] blocks. ----------
  const mounts: ShipMount[] = [];
  for (let n = 1; n <= count; n++) {
    const block = doc.byName.get(`WeaponSystem${n}`);
    if (!block) continue;
    const launcherId = getValue(block, 'SystemName') ?? '';
    mounts.push({
      index: n,
      weaponType: getValue(block, 'Type') ?? '',
      launcherId,
      resolved: ctx.launcherIds.has(launcherId),
    });
  }

  // --- Directors: distinct SAM illuminators across all missile mounts. -------
  // Keyed by the physical [SensorSystemN] ref so two like mounts count twice.
  const directorByRef = new Map<string, ShipDirector>();
  for (const section of doc.sections) {
    if (!/^WeaponSystem\d/.test(section.name)) continue;
    if ((getValue(section, 'Type') ?? '').toLowerCase() !== 'missile') continue;
    for (const ref of getList(section, 'AssociatedSensors')) {
      if (directorByRef.has(ref)) continue;
      const illuminatorId = sensorName.get(ref);
      if (!illuminatorId) continue;
      const illum = ctx.illuminators.get(illuminatorId);
      if (!illum) continue; // not a weapon-guiding sensor (e.g. a gun GFCS)
      directorByRef.set(ref, {
        sensorSystem: ref,
        illuminatorId,
        resolved: true,
        type: illum.type,
        mode: illum.mode,
        weaponChannels: illum.weaponChannels,
        maxRangeNm: illum.maxRangeNm,
      });
    }
  }
  const directors = [...directorByRef.values()].sort((a, b) =>
    a.sensorSystem.localeCompare(b.sensorSystem, undefined, { numeric: true }),
  );
  // Headline cap counts only dedicated terminal illuminators (Type=Targeting);
  // SPY-1-style search radars with channels stay in `directors` for the app.
  const terminal = directors.filter((d) => (d.type ?? '').toLowerCase() === 'targeting');
  const weaponChannels =
    terminal.length > 0 ? terminal.reduce((sum, d) => sum + (d.weaponChannels ?? 0), 0) : null;

  // --- Loadouts: per named fit, ammo aggregated across all mounts. -----------
  const loadoutOut: ShipLoadout[] = loadouts.map((name) => ({
    name,
    ammo: collectLoadoutAmmo(doc, count, name, ctx),
  }));

  return {
    id,
    name: prettifyId(id),
    source,
    unitType: general ? getValue(general, 'UnitType') ?? null : null,
    role: ai ? getValue(ai, 'Role') ?? null : null,
    displacementTons: physics ? getNumber(physics, 'Displacement') ?? null : null,
    maxSpeedKnots: physics ? getNumber(physics, 'MaxForwardVelocity') ?? null : null,
    weaponChannels,
    directors,
    mounts,
    loadouts: loadoutOut,
  };
}

/** Resolve and sum the ammo for one named loadout across every weapon system. */
function collectLoadoutAmmo(
  doc: IniDocument,
  count: number,
  loadout: string,
  ctx: VesselLinkContext,
): ShipLoadoutEntry[] {
  // ammoId -> running count + whether any explicit count was seen.
  const acc = new Map<string, { count: number; known: boolean }>();
  const add = (ammoId: string | undefined, c: number | null): void => {
    if (!ammoId) return;
    const e = acc.get(ammoId) ?? { count: 0, known: false };
    if (c !== null) {
      e.count += c;
      e.known = true;
    }
    acc.set(ammoId, e);
  };

  for (let n = 1; n <= count; n++) {
    const block =
      doc.byName.get(`WeaponSystem${n}${loadout}`) ?? doc.byName.get(`WeaponSystem${n}`);
    if (!block) continue;

    const magName = getValue(block, 'AssociatedMagazine');
    if (magName) {
      const mag = doc.byName.get(magName);
      if (mag) {
        const types = getNumber(mag, 'NumberOfAmmunitionTypes') ?? 0;
        for (let i = 1; i <= types; i++) {
          add(getValue(mag, `Ammunition${i}`), getNumber(mag, `Ammunition${i}_Count`) ?? null);
        }
      }
      continue;
    }

    const direct = getValue(block, 'Ammunition');
    if (direct) {
      const c = getNumber(block, 'Ammunition_Count') ?? getNumber(block, 'NumberOfContainers') ?? null;
      add(direct, c);
    }
  }

  return [...acc.entries()]
    .map(([ammoId, e]) => ({
      ammoId,
      count: e.known ? e.count : null,
      isMissile: ctx.missileIds.has(ammoId),
    }))
    .sort((a, b) => a.ammoId.localeCompare(b.ammoId));
}
