import type { DeviceInstance, Pdu, Project } from '../domain/types';
import { emptyPower, makeOutlets, newDevice, newProject, newPsu, newRack, uid } from '../domain/factory';

/** Minimal project with one rack and optional A/B single-phase PDUs (230 V, 16 A nominal). */
export function baseProject(opts: { feeds?: ('A' | 'B')[]; nominalA?: number; usableA?: number | null } = {}): Project {
  const rack = newRack({ name: 'T1' });
  const p = newProject({ racks: [rack] });
  for (const feed of opts.feeds ?? ['A', 'B']) p.pdus.push(mkPdu(rack.id, feed, opts.nominalA ?? 16, opts.usableA ?? null));
  return p;
}

export function mkPdu(rackId: string, feed: 'A' | 'B', nominalA: number, usableA: number | null = null): Pdu {
  return {
    id: uid('pdu'),
    name: `PDU-${feed}`,
    rackId,
    templateId: null,
    vendor: 'Test',
    model: 'Test',
    mounting: 'zero_u',
    side: feed === 'A' ? 'left' : 'right',
    startU: null,
    heightU: 0,
    feed,
    upstream: null,
    topology: '1ph',
    voltage: 230,
    nominalA,
    usableA,
    usableKw: null,
    usableKva: null,
    plug: '',
    capabilities: { inputMetering: false, outletMetering: false, remoteMonitoring: false, outletSwitching: false, envSensors: false },
    banks: [{ id: uid('bank'), name: 'Bank 1', phase: 'L1', breakerA: null, outlets: makeOutlets([{ type: 'C13', count: 12, ratedA: 10 }]) }],
    provenance: 'user_supplied',
  };
}

export function freeOutlet(p: Project, feed: 'A' | 'B'): string {
  const pdu = p.pdus.find((x) => x.feed === feed)!;
  const used = new Set(p.devices.flatMap((d) => d.domains.flatMap((dom) => dom.psus.map((ps) => ps.connection.outletId))));
  return pdu.banks[0].outlets.find((o) => !used.has(o.id))!.id;
}

/** Add an active device with N PSUs; PSUs alternately connected to A/B. */
export function addDevice(
  p: Project,
  o: { name?: string; typicalW?: number | null; designW?: number | null; psus?: number; ratedDcW?: number | null; mode?: DeviceInstance['domains'][0]['mode']; feeds?: ('A' | 'B' | null)[]; eta?: number | null; startU?: number; heightU?: number },
): DeviceInstance {
  const rackId = p.racks[0].id;
  const n = o.psus ?? 2;
  const feeds = o.feeds ?? Array.from({ length: n }, (_, i) => (i % 2 === 0 ? 'A' : 'B'));
  const d = newDevice(rackId, {
    name: o.name ?? `Dev${p.devices.length + 1}`,
    placement: o.startU ? { kind: 'rack', startU: o.startU, heightU: o.heightU ?? 1 } : { kind: 'unplaced' },
    power: { ...emptyPower(false), typicalW: o.typicalW ?? null, designW: o.designW ?? null, efficiency: o.eta === undefined ? 0.9 : o.eta },
    domains: [
      {
        id: uid('dom'),
        name: 'Main',
        mode: o.mode ?? (n === 1 ? 'single' : '1+1'),
        requiredPsus: o.mode === 'N+1' ? n - 1 : 1,
        loadFraction: 1,
        sharing: 'equal',
        psus: [],
      },
    ],
  });
  p.devices.push(d);
  for (let i = 0; i < n; i++) {
    const feed = feeds[i];
    d.domains[0].psus.push(
      newPsu({ label: `PSU${i + 1}`, ratedDcW: o.ratedDcW === undefined ? 800 : o.ratedDcW, connection: { outletId: feed ? freeOutlet(p, feed) : null } }),
    );
  }
  return d;
}
