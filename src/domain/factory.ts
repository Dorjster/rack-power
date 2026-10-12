import type {
  Assumptions,
  DeviceCategory,
  DeviceInstance,
  DevicePower,
  DeviceTemplate,
  ID,
  OutletType,
  Pdu,
  PduTemplate,
  Policy,
  PowerDomain,
  Project,
  Psu,
  Rack,
  RedundancyMode,
} from './types';
import { SCHEMA_VERSION } from './types';

let counter = 0;
export function uid(prefix: string): ID {
  const rnd =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  counter = (counter + 1) % 1_000_000;
  return `${prefix}_${rnd}${counter.toString(36)}`;
}

export const nowIso = () => new Date().toISOString();

export function defaultPolicy(): Policy {
  return {
    id: 'policy_site_default',
    name: 'Site planning policy (editable)',
    version: '1.0',
    alertFraction: 0.7,
    applyPlanningDerate: true,
    planningDerateFraction: 0.8,
    staleDays: 90,
    phaseImbalanceDefinition: 'max_dev_from_mean',
    phaseImbalanceFraction: 0.2,
    inletRecommendedMinC: 18,
    inletRecommendedMaxC: 27,
    inletEnvelopeVerified: false,
    inletAllowableMaxC: null,
    inletAllowableMinC: null,
    inletAllowableSource: '',
    growthReserveFraction: 0,
    overrides: {},
  };
}

export function defaultAssumptions(): Assumptions {
  return {
    defaultPf: 0.95,
    pfConfirmed: false,
    defaultEfficiency: 0.9,
    poeEfficiency: 0.9,
    hoursPerDay: 24,
    daysPerMonth: 30,
    tariffPerKwh: null,
    currency: 'MNT',
    pue: null,
    defaultSharing: 'equal',
  };
}

export function newRack(partial: Partial<Rack> = {}): Rack {
  return {
    id: uid('rack'),
    name: 'Rack 1',
    site: '',
    heightU: 42,
    usableDepthMm: null,
    ratedWeightKg: null,
    powerBudgetW: null,
    powerBudgetConfirmed: false,
    coolingCapacityW: null,
    liquidCoolingCapacityW: null,
    feedCount: 2,
    topology: '1ph',
    nominalVoltage: 230,
    frequencyHz: 50,
    inletReadings: [],
    notes: '',
    ...partial,
  };
}

export function emptyPower(passive = false): DevicePower {
  return {
    passiveZero: passive,
    measured: null,
    typicalW: null,
    typicalSource: '',
    designW: null,
    designSource: '',
    manufacturerW: null,
    manufacturerSource: '',
    component: null,
    useComponentEstimate: false,
    proxy: null,
    useProxy: false,
    confidence: 'medium',
    pf: null,
    efficiency: null,
    assumptions: '',
  };
}

export function newPsu(partial: Partial<Psu> = {}): Psu {
  return {
    id: uid('psu'),
    label: 'PSU1',
    ratedDcW: null,
    state: 'ok',
    inputType: 'AC',
    inputVoltageMin: null,
    inputVoltageMax: null,
    efficiency: null,
    inlet: 'unknown',
    connection: { outletId: null },
    compatVerified: false,
    measuredAcW: null,
    ...partial,
  };
}

export function defaultModeFor(count: number): RedundancyMode {
  if (count <= 0) return 'unknown';
  if (count === 1) return 'single';
  return 'unknown';
}

export function newDomain(psuCount: number, ratedDcW: number | null, mode?: RedundancyMode, partial: Partial<PowerDomain> = {}): PowerDomain {
  const psus = Array.from({ length: psuCount }, (_, i) => newPsu({ label: `PSU${i + 1}`, ratedDcW }));
  return {
    id: uid('dom'),
    name: 'Main',
    mode: mode ?? defaultModeFor(psuCount),
    requiredPsus: null,
    loadFraction: 1,
    sharing: 'equal',
    psus,
    ...partial,
  };
}

export const PASSIVE_CATEGORIES: DeviceCategory[] = ['passive'];

export function newDevice(rackId: ID, partial: Partial<DeviceInstance> = {}): DeviceInstance {
  const isPassive = partial.category === 'passive';
  return {
    id: uid('dev'),
    name: 'Device',
    templateId: null,
    category: 'custom',
    vendor: 'Custom',
    model: '',
    rackId,
    placement: { kind: 'unplaced' },
    critical: !isPassive,
    inputType: 'AC',
    depthMm: null,
    weightKg: null,
    airflow: 'unknown',
    power: emptyPower(isPassive),
    domains: isPassive ? [] : [newDomain(1, null)],
    poe: null,
    poweredByPoeSwitchId: null,
    cooling: { liquidCooled: false, liquidFraction: null },
    userOverrides: [],
    notes: '',
    ...partial,
  };
}

/** Create a device instance from a catalog template. Power is NOT populated from the model name. */
export function deviceFromTemplate(rackId: ID, t: DeviceTemplate): DeviceInstance {
  const passive = !!t.isPassive;
  return newDevice(rackId, {
    name: t.model,
    templateId: t.id,
    category: t.category,
    vendor: t.vendor,
    model: t.model,
    passiveKind: t.passiveKind,
    critical: !passive,
    depthMm: t.depthMm.value,
    weightKg: t.weightKg.value,
    airflow: t.airflow.value ?? 'unknown',
    power: {
      ...emptyPower(passive),
      manufacturerW: t.maxAcW.status === 'verified' ? t.maxAcW.value : null,
      manufacturerSource: t.maxAcW.status === 'verified' ? t.maxAcW.source?.title ?? '' : '',
    },
    domains: passive ? [] : [newDomain(1, null)],
  });
}

export function makeOutlets(spec: { type: OutletType; count: number; ratedA?: number | null }[]) {
  let idx = 1;
  return spec.flatMap((s) =>
    Array.from({ length: s.count }, () => ({ id: uid('out'), index: idx++, type: s.type, ratedA: s.ratedA ?? null })),
  );
}

export function pduFromTemplate(rackId: ID, t: PduTemplate, feed: 'A' | 'B' | 'C', side: 'left' | 'right'): Pdu {
  const outletsSpec = t.outlets.value ?? [];
  const banks =
    t.topology === '1ph'
      ? [{ id: uid('bank'), name: 'Bank 1', phase: 'L1' as const, breakerA: null, outlets: makeOutlets(outletsSpec) }]
      : [0, 1, 2].map((i) => ({
          id: uid('bank'),
          name: `Bank ${i + 1}`,
          // Phase mapping must be confirmed by the user — default unknown.
          phase: null,
          breakerA: null,
          outlets: makeOutlets(outletsSpec.map((s) => ({ ...s, count: Math.ceil(s.count / 3) }))),
        }));
  return {
    id: uid('pdu'),
    name: `PDU ${feed}`,
    rackId,
    templateId: t.id,
    vendor: t.vendor,
    model: t.model,
    mounting: t.mounting,
    side,
    startU: null,
    heightU: t.mounting === 'zero_u' ? 0 : t.heightU,
    feed,
    upstream: null,
    topology: t.topology,
    voltage: t.voltage.value,
    nominalA: t.nominalA.value,
    usableA: t.usableA.value,
    usableKw: t.usableKw.value,
    usableKva: t.usableKva.value,
    plug: t.plug.value ?? '',
    capabilities: t.capabilities.value ?? {
      inputMetering: false,
      outletMetering: false,
      remoteMonitoring: false,
      outletSwitching: false,
      envSensors: false,
    },
    banks,
    provenance: t.generic ? 'assumption' : t.nominalA.status,
    sourceNote: t.nominalA.source?.title,
  };
}

export function newProject(partial: Partial<Project> = {}): Project {
  const rack = newRack();
  return {
    schemaVersion: SCHEMA_VERSION,
    id: uid('proj'),
    name: 'New project',
    customer: '',
    site: '',
    mode: 'planning',
    createdAt: nowIso(),
    updatedAt: nowIso(),
    racks: [rack],
    devices: [],
    pdus: [],
    branches: [],
    upses: [],
    sources: [],
    atses: [],
    dcBuses: [],
    catalog: { devices: [], pdus: [] },
    policy: defaultPolicy(),
    assumptions: defaultAssumptions(),
    manualChecks: [],
    evidence: [],
    acks: [],
    snapshots: [],
    audit: { auditor: '', customer: '', date: '', notes: '' },
    isDemo: false,
    ...partial,
  };
}

/** Deep clone a device with new IDs (device, domains, PSUs). Connections are cleared. */
export function cloneDevice(d: DeviceInstance): DeviceInstance {
  const copy: DeviceInstance = structuredClone(d);
  copy.id = uid('dev');
  copy.name = `${d.name} (copy)`;
  copy.placement = { kind: 'unplaced' };
  copy.domains = copy.domains.map((dom) => ({
    ...dom,
    id: uid('dom'),
    shares: undefined,
    psus: dom.psus.map((p) => ({ ...p, id: uid('psu'), connection: { outletId: null, dcBusId: null } })),
  }));
  return copy;
}
