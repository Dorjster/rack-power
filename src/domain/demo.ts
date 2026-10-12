/**
 * Ready-to-use demo project. ALL values are synthetic demonstration data — they are not
 * verified specifications of any named vendor model.
 */
import type { DeviceInstance, Pdu, Project, PowerDomain, Psu } from './types';
import { BUILTIN_PDU_TEMPLATES } from '../catalog/pdus';
import { emptyPower, makeOutlets, newDevice, newProject, newPsu, newRack, nowIso, pduFromTemplate, uid } from './factory';

function dualPsuDomain(ratedDcW: number): PowerDomain {
  const mk = (label: string): Psu =>
    newPsu({ label, ratedDcW, efficiency: 0.9, inlet: 'C14', inputVoltageMin: 200, inputVoltageMax: 240 });
  return {
    id: uid('dom'),
    name: 'Main',
    mode: '1+1',
    requiredPsus: 1,
    loadFraction: 1,
    sharing: 'equal',
    psus: [mk('PSU1'), mk('PSU2')],
  };
}

function demoDevice(
  rackId: string,
  name: string,
  category: DeviceInstance['category'],
  startU: number,
  heightU: number,
  typicalW: number,
  designW: number,
  ratedDcW: number,
): DeviceInstance {
  return newDevice(rackId, {
    name,
    category,
    vendor: 'Generic (demo)',
    model: 'Illustrative',
    placement: { kind: 'rack', startU, heightU },
    critical: true,
    airflow: 'front_to_back',
    power: {
      ...emptyPower(false),
      typicalW,
      typicalSource: 'Synthetic demo value',
      designW,
      designSource: 'Synthetic demo value',
      efficiency: 0.9,
      confidence: 'low',
      assumptions: 'Demo: 90% PSU efficiency assumption; PF from project default 0.95.',
    },
    domains: [dualPsuDomain(ratedDcW)],
  });
}

function passiveItem(rackId: string, name: string, kind: DeviceInstance['passiveKind'], startU: number, heightU: number): DeviceInstance {
  return newDevice(rackId, {
    name,
    category: 'passive',
    passiveKind: kind,
    vendor: 'Generic',
    model: name,
    placement: { kind: 'rack', startU, heightU },
    critical: false,
    power: emptyPower(true),
    domains: [],
  });
}

export function buildDemoProject(): Project {
  const rack = newRack({
    name: 'DEMO-A01',
    site: 'Demo site',
    heightU: 42,
    usableDepthMm: 1000,
    ratedWeightKg: 1000,
    powerBudgetW: 10000,
    powerBudgetConfirmed: false,
    coolingCapacityW: 10000,
    feedCount: 2,
    topology: '1ph',
    nominalVoltage: 230,
    frequencyHz: 50,
  });

  const preset = BUILTIN_PDU_TEMPLATES.find((t) => t.id === 'preset-ab-16')!;
  const mkPdu = (feed: 'A' | 'B', side: 'left' | 'right'): Pdu => {
    const p = pduFromTemplate(rack.id, preset, feed, side);
    p.name = `PDU-${feed}`;
    // Demo outlet ratings (region-specific; demo assumption).
    p.banks[0].outlets = makeOutlets([
      { type: 'C13', count: 20, ratedA: 10 },
      { type: 'C19', count: 4, ratedA: 16 },
    ]);
    return p;
  };
  const pduA = mkPdu('A', 'left');
  const pduB = mkPdu('B', 'right');

  const srcA = { id: uid('src'), name: 'Utility source A (demo)', kind: 'utility' as const, note: 'Demo topology' };
  const srcB = { id: uid('src'), name: 'Utility source B (demo)', kind: 'utility' as const, note: 'Demo topology' };
  const upsA = {
    id: uid('ups'),
    name: 'UPS-A (demo)',
    ratedKw: 10,
    ratedKva: 10,
    redundancy: 'single' as const,
    sourceId: srcA.id,
    otherLoadsKnown: false,
    otherLoadW: null,
    efficiency: null,
    inRack: false,
    rackDeviceId: null,
    runtime: null,
  };
  const upsB = { ...upsA, id: uid('ups'), name: 'UPS-B (demo)', sourceId: srcB.id };
  const brA = { id: uid('br'), name: 'Branch A (16 A)', breakerA: 16, breakerIsUsable: false, phases: 1 as const, voltage: 230, upsId: upsA.id, sourceId: null };
  const brB = { ...brA, id: uid('br'), name: 'Branch B (16 A)', upsId: upsB.id };
  pduA.upstream = { kind: 'branch', id: brA.id };
  pduB.upstream = { kind: 'branch', id: brB.id };

  const devices: DeviceInstance[] = [
    demoDevice(rack.id, 'Demo Storage (2U)', 'storage_array', 1, 2, 600, 900, 1100),
    demoDevice(rack.id, 'Demo Server 1 (2U)', 'rack_server', 3, 2, 500, 700, 800),
    demoDevice(rack.id, 'Demo Server 2 (2U)', 'rack_server', 5, 2, 500, 700, 800),
    demoDevice(rack.id, 'Demo Server 3 (2U)', 'rack_server', 7, 2, 500, 700, 800),
    demoDevice(rack.id, 'Demo Switch (1U)', 'switch', 42, 1, 100, 150, 250),
    passiveItem(rack.id, 'Patch panel 1U', 'patch_panel', 41, 1),
    passiveItem(rack.id, 'Cable manager 1U', 'cable_manager', 40, 1),
    passiveItem(rack.id, 'Blanking 2U', 'blanking', 9, 2),
  ];

  // Connect PSU1 -> A, PSU2 -> B on successive outlets.
  const freeA = pduA.banks[0].outlets.filter((o) => o.type === 'C13');
  const freeB = pduB.banks[0].outlets.filter((o) => o.type === 'C13');
  let i = 0;
  for (const d of devices) {
    for (const dom of d.domains) {
      if (dom.psus[0]) dom.psus[0].connection = { outletId: freeA[i].id };
      if (dom.psus[1]) dom.psus[1].connection = { outletId: freeB[i].id };
      if (dom.psus.length) i++;
    }
  }

  const project = newProject({
    name: 'Demo project (synthetic data)',
    customer: 'Demo customer',
    site: 'Demo site',
    racks: [rack],
    devices,
    pdus: [pduA, pduB],
    branches: [brA, brB],
    upses: [upsA, upsB],
    sources: [srcA, srcB],
    isDemo: true,
    audit: { auditor: '', customer: 'Demo customer', date: nowIso().slice(0, 10), notes: '' },
  });
  project.assumptions.pfConfirmed = true;
  return project;
}
