/**
 * Failure-scenario simulation. Pure functions: Project + scenario -> results.
 *
 * Chain: device PSU -> outlet -> bank/phase -> PDU -> (ATS) -> branch circuit -> UPS -> upstream source.
 * The graph is acyclic by construction (fixed layer order, single upstream field per node;
 * the ATS is the only explicitly modeled multi-source transfer device).
 */
import type {
  BankPhase,
  DeviceInstance,
  FeedLetter,
  ID,
  Outlet,
  OutletBank,
  Pdu,
  PowerDomain,
  Project,
  Psu,
} from '../domain/types';
import { resolveLoad, type LoadLevel, type ResolvedLoad } from './devicePower';
import {
  SQRT3,
  apparentPower,
  isFiniteNonNeg,
  unbalancedLineCurrents,
  type PhaseCurrents,
  type PhaseLoad,
} from './electrical';
import { bankLimits, branchLimits, classify, deriveLimits, pduLimits, type CurrentLimits, type LimitStatus } from './limits';

export interface Failures {
  feeds: FeedLetter[];
  psuIds: ID[];
  upsIds: ID[];
  sourceIds: ID[];
}

export type ScenarioKind = 'normal' | 'loss_feed' | 'loss_psu' | 'loss_ups' | 'loss_source';

export interface ScenarioDef {
  id: string;
  kind: ScenarioKind;
  failures: Failures;
  /** Feed letter / PSU id / UPS id / source id */
  target?: string;
}

export const NO_FAILURES: Failures = { feeds: [], psuIds: [], upsIds: [], sourceIds: [] };

export type DomainStatus = 'ok' | 'degraded' | 'unpowered' | 'shutdown_risk' | 'possible_throttling' | 'unknown_behavior';
export type CapacityStatus = 'ok' | 'exceeded' | 'unknown' | 'na';

export interface DomainResult {
  domainId: ID;
  name: string;
  mode: PowerDomain['mode'];
  status: DomainStatus;
  installedPsuIds: ID[];
  activePsuIds: ID[];
  lostPsuIds: ID[];
  requiredPsus: number | null;
  inputW: number | null;
  dcDemandW: number | null;
  availableDcW: number | null;
  capacity: CapacityStatus;
}

export interface PsuResult {
  psuId: ID;
  deviceId: ID;
  domainId: ID;
  active: boolean;
  /** AC input W drawn through this PSU (DC W for DC-input). null = unknown. */
  inputW: number | null;
  currentA: number | null;
  dcOutW: number | null;
  utilization: number | null;
  outletId: ID | null;
  pduId: ID | null;
  voltage: number | null;
  pf: number;
  phase: BankPhase | null;
  invalidConnection: 'ac_psu_on_dc_bus' | 'dc_psu_on_ac_outlet' | null;
}

export type DeviceStatus =
  | 'ok'
  | 'degraded'
  | 'unpowered'
  | 'partially_unpowered'
  | 'shutdown_risk'
  | 'possible_throttling'
  | 'unknown_behavior'
  | 'over_capacity'
  | 'not_connected';

export interface DeviceResult {
  deviceId: ID;
  rackId: ID;
  load: ResolvedLoad;
  /** Input W actually drawn in this scenario (0 if unpowered, null if unknown). */
  drawnW: number | null;
  status: DeviceStatus;
  domains: DomainResult[];
  outsideRack: boolean;
}

export interface OutletResult {
  outletId: ID;
  pduId: ID;
  bankId: ID;
  w: number;
  currentA: number;
  unknownCount: number;
  psuIds: ID[];
  limitA: number | null;
  status: LimitStatus;
}

export interface BankResult {
  bankId: ID;
  pduId: ID;
  phase: BankPhase | null;
  w: number;
  currentA: number;
  unknownCount: number;
  limits: CurrentLimits;
  status: LimitStatus;
}

export interface PduResult {
  pduId: ID;
  rackId: ID;
  feed: FeedLetter;
  powered: boolean;
  topologyKnown: boolean;
  w: number;
  /** Σ device VA (conservative sizing estimate, not a measured upstream PF). */
  va: number;
  unknownCount: number;
  /** 1ph: total current. 3ph: per-phase currents. */
  totalCurrentA: number | null;
  phaseCurrents: PhaseCurrents | null;
  phaseUnknown: boolean;
  /** Current compared to the limit (1ph total or max phase). null if unknown. */
  governingA: number | null;
  governingPhase: string | null;
  limits: CurrentLimits;
  status: LimitStatus;
  kwStatus: 'within' | 'exceeded' | 'unknown' | 'na';
  kvaStatus: 'within' | 'exceeded' | 'unknown' | 'na';
  outletsTotal: number;
  outletsUsed: number;
  freeByType: Record<string, number>;
  banks: BankResult[];
}

export interface BranchResult {
  branchId: ID;
  powered: boolean;
  w: number;
  va: number;
  currentA: number | null;
  unknownCount: number;
  limits: CurrentLimits;
  status: LimitStatus;
}

export interface UpsResult {
  upsId: ID;
  powered: boolean;
  w: number;
  va: number;
  unknownCount: number;
  totalW: number | null;
  totalVa: number | null;
  kwUtil: number | null;
  kvaUtil: number | null;
  complete: boolean;
  lossW: number | null;
}

export interface DcBusResult {
  busId: ID;
  w: number;
  currentA: number;
  unknownCount: number;
  rectifierAcW: number | null;
  powered: boolean;
}

export interface RackTotals {
  rackId: ID;
  /** Known subtotal of drawn input W of rack-local devices (incl. AC equivalent of DC devices). */
  knownW: number;
  knownVa: number;
  unknownCount: number;
  activeCount: number;
  /** Equipment outside the rack assigned to this rack's circuits. */
  outsideKnownW: number;
  outsideUnknownCount: number;
  /** Heat to room air (W) for rack-local equipment. null if a liquid fraction is unknown. */
  airHeatW: number | null;
  liquidHeatW: number;
  heatUnknownReason: 'liquid_fraction_unknown' | null;
  poeOutsideW: number;
  upsLossW: number;
  unpoweredDeviceIds: ID[];
  riskDeviceIds: ID[];
}

export interface ScenarioResult {
  def: ScenarioDef;
  level: LoadLevel;
  devices: Record<ID, DeviceResult>;
  psus: Record<ID, PsuResult>;
  outlets: Record<ID, OutletResult>;
  pdus: Record<ID, PduResult>;
  branches: Record<ID, BranchResult>;
  upses: Record<ID, UpsResult>;
  dcBuses: Record<ID, DcBusResult>;
  racks: Record<ID, RackTotals>;
  duplicateOutletIds: ID[];
}

// ---------------------------------------------------------------------------

interface OutletRef {
  pdu: Pdu;
  bank: OutletBank;
  outlet: Outlet;
}

export function indexOutlets(project: Project): Map<ID, OutletRef> {
  const map = new Map<ID, OutletRef>();
  for (const pdu of project.pdus) for (const bank of pdu.banks) for (const outlet of bank.outlets) map.set(outlet.id, { pdu, bank, outlet });
  return map;
}

/** Outlet voltage from PDU topology and bank connection. */
export function outletVoltage(pdu: Pdu, bank: OutletBank): number | null {
  if (!isFiniteNonNeg(pdu.voltage) || pdu.voltage === 0) return null;
  if (pdu.topology === '1ph') return pdu.voltage;
  if (bank.phase === null) return null;
  if (bank.phase.includes('-')) return pdu.voltage; // line-to-line
  return pdu.voltage / SQRT3; // line-to-neutral of a wye supply
}

/** Rack-local equipment (unplaced items still belong to the rack plan; only 'outside' is excluded). */
export function isRackLocal(d: DeviceInstance): boolean {
  return d.placement.kind !== 'outside';
}

interface PathState {
  powered: boolean;
  topologyKnown: boolean;
}

export function makePathResolver(project: Project, f: Failures) {
  const upsById = new Map(project.upses.map((u) => [u.id, u]));
  const branchById = new Map(project.branches.map((b) => [b.id, b]));
  const atsById = new Map(project.atses.map((a) => [a.id, a]));

  const sourceUp = (id: ID | null): PathState =>
    id === null ? { powered: true, topologyKnown: false } : { powered: !f.sourceIds.includes(id), topologyKnown: true };

  const upsUp = (id: ID): PathState => {
    const u = upsById.get(id);
    if (!u) return { powered: true, topologyKnown: false };
    if (f.upsIds.includes(id)) return { powered: false, topologyKnown: true };
    // Sustained analysis: a lost source is assumed to outlast UPS runtime.
    return sourceUp(u.sourceId);
  };

  const branchUp = (id: ID | null): PathState => {
    if (id === null) return { powered: true, topologyKnown: false };
    const b = branchById.get(id);
    if (!b) return { powered: true, topologyKnown: false };
    if (b.upsId) return upsUp(b.upsId);
    if (b.sourceId) return sourceUp(b.sourceId);
    return { powered: true, topologyKnown: false };
  };

  /** For an ATS, the input currently selected (primary preferred). */
  const atsActiveBranch = (id: ID): ID | null => {
    const a = atsById.get(id);
    if (!a) return null;
    if (a.primaryBranchId && branchUp(a.primaryBranchId).powered) return a.primaryBranchId;
    if (a.secondaryBranchId && branchUp(a.secondaryBranchId).powered) return a.secondaryBranchId;
    return null;
  };

  const pduUp = (pdu: Pdu): PathState => {
    if (f.feeds.includes(pdu.feed)) return { powered: false, topologyKnown: true };
    if (!pdu.upstream) return { powered: true, topologyKnown: false };
    if (pdu.upstream.kind === 'branch') return branchUp(pdu.upstream.id);
    const a = atsById.get(pdu.upstream.id);
    if (!a) return { powered: true, topologyKnown: false };
    const p = branchUp(a.primaryBranchId);
    const s = branchUp(a.secondaryBranchId);
    return { powered: p.powered || s.powered, topologyKnown: p.topologyKnown && s.topologyKnown };
  };

  return { pduUp, branchUp, upsUp, sourceUp, atsActiveBranch };
}

function requiredFor(dom: PowerDomain, installed: number): number | null {
  switch (dom.mode) {
    case 'single':
    case '1+1':
      return 1;
    case 'N+1':
    case 'N+N':
    case 'vendor_fault_tolerant':
      return dom.requiredPsus;
    case 'load_sharing':
      return installed;
    case 'unknown':
      return null;
  }
}

function psuOutputLimit(p: Psu, voltage: number | null): number | null {
  if (p.ratedDcW === null) return null;
  if (p.derating && p.derating.length > 0 && voltage !== null) {
    const sorted = [...p.derating].sort((a, b) => a.maxInputV - b.maxInputV);
    const rule = sorted.find((r) => voltage <= r.maxInputV);
    if (rule) return Math.min(p.ratedDcW, rule.outputW);
  }
  return p.ratedDcW;
}

export function computeScenario(project: Project, def: ScenarioDef, level: LoadLevel): ScenarioResult {
  const f = def.failures;
  const a = project.assumptions;
  const outletIdx = indexOutlets(project);
  const paths = makePathResolver(project, f);
  const pduPowered = new Map(project.pdus.map((p) => [p.id, paths.pduUp(p)]));
  const busById = new Map(project.dcBuses.map((b) => [b.id, b]));

  // DC buses powered if any rectifier outlet's PDU is powered (or no rectifier modeled -> assumed)
  const busPowered = new Map<ID, boolean>();
  for (const bus of project.dcBuses) {
    if (bus.rectifierOutletIds.length === 0) busPowered.set(bus.id, true);
    else
      busPowered.set(
        bus.id,
        bus.rectifierOutletIds.some((oid) => {
          const ref = outletIdx.get(oid);
          return ref ? pduPowered.get(ref.pdu.id)?.powered ?? false : false;
        }),
      );
  }

  const devices: Record<ID, DeviceResult> = {};
  const psus: Record<ID, PsuResult> = {};
  const outletUse = new Map<ID, ID[]>();

  for (const d of project.devices) {
    const load = resolveLoad(d, a, level);
    const domains: DomainResult[] = [];
    let drawn: number | null = 0;
    const active = !d.power.passiveZero && !d.poweredByPoeSwitchId;
    const anyConnection = d.domains.some((dom) => dom.psus.some((p) => p.connection.outletId || p.connection.dcBusId));

    for (const dom of d.domains) {
      const installed = dom.psus.filter((p) => p.state === 'ok' || p.state === 'standby');
      const psuReach = (p: Psu): { ok: boolean; invalid: PsuResult['invalidConnection'] } => {
        if (p.inputType === 'AC') {
          if (p.connection.dcBusId && !p.connection.outletId) return { ok: false, invalid: 'ac_psu_on_dc_bus' };
          if (!p.connection.outletId) return { ok: false, invalid: null };
          const ref = outletIdx.get(p.connection.outletId);
          if (!ref) return { ok: false, invalid: null };
          return { ok: pduPowered.get(ref.pdu.id)?.powered ?? false, invalid: null };
        }
        if (p.connection.outletId) return { ok: false, invalid: 'dc_psu_on_ac_outlet' };
        if (!p.connection.dcBusId || !busById.has(p.connection.dcBusId)) return { ok: false, invalid: null };
        return { ok: busPowered.get(p.connection.dcBusId) ?? false, invalid: null };
      };

      const reach = new Map(dom.psus.map((p) => [p.id, psuReach(p)]));
      const activePsus = installed.filter((p) => !f.psuIds.includes(p.id) && reach.get(p.id)!.ok);
      const lost = installed.filter((p) => !activePsus.includes(p));
      const required = requiredFor(dom, installed.length);

      const domInputW = load.inputW === null ? null : load.inputW * dom.loadFraction;
      const domDcW = load.dcDemandW === null ? null : load.dcDemandW * dom.loadFraction;

      let status: DomainStatus = 'ok';
      if (!active) status = 'ok';
      else if (activePsus.length === 0) status = 'unpowered';
      else if (lost.length > 0) {
        if (dom.mode === 'unknown') status = 'unknown_behavior';
        else if (required === null) status = dom.mode === 'vendor_fault_tolerant' ? 'possible_throttling' : 'unknown_behavior';
        else if (activePsus.length < required) status = dom.mode === 'vendor_fault_tolerant' ? 'possible_throttling' : 'shutdown_risk';
        else status = 'degraded';
      }

      // Voltage for derating: first active AC psu outlet voltage
      let availableDcW: number | null = 0;
      for (const p of activePsus) {
        const ref = p.connection.outletId ? outletIdx.get(p.connection.outletId) : undefined;
        const v = ref ? outletVoltage(ref.pdu, ref.bank) : null;
        const lim = psuOutputLimit(p, v);
        availableDcW = lim === null || availableDcW === null ? null : availableDcW + lim;
      }
      let capacity: CapacityStatus = 'na';
      if (active && activePsus.length > 0) {
        if (domDcW === null || availableDcW === null) capacity = 'unknown';
        else capacity = domDcW <= availableDcW ? 'ok' : 'exceeded';
      }

      // Distribute input among active PSUs
      const carrying = status === 'unpowered' || !active ? [] : activePsus;
      const shares = new Map<ID, number>();
      if (carrying.length > 0) {
        const hotOk = carrying.filter((p) => p.state === 'ok');
        if (dom.sharing === 'hot_standby' && hotOk.length > 0) {
          hotOk.forEach((p) => shares.set(p.id, 1 / hotOk.length));
        } else if (dom.sharing === 'configured' && dom.shares) {
          const tot = carrying.reduce((s, p) => s + (dom.shares![p.id] ?? 0), 0);
          if (tot > 0) carrying.forEach((p) => shares.set(p.id, (dom.shares![p.id] ?? 0) / tot));
          else carrying.forEach((p) => shares.set(p.id, 1 / carrying.length));
        } else if (
          dom.sharing === 'measured' &&
          lost.length === 0 &&
          carrying.every((p) => isFiniteNonNeg(p.measuredAcW)) &&
          carrying.reduce((s, p) => s + (p.measuredAcW ?? 0), 0) > 0
        ) {
          const tot = carrying.reduce((s, p) => s + (p.measuredAcW ?? 0), 0);
          carrying.forEach((p) => shares.set(p.id, (p.measuredAcW ?? 0) / tot));
        } else {
          carrying.forEach((p) => shares.set(p.id, 1 / carrying.length));
        }
      }

      for (const p of dom.psus) {
        const share = shares.get(p.id) ?? 0;
        const isActive = carrying.includes(p);
        const inputW = !active ? 0 : !isActive ? 0 : domInputW === null ? null : domInputW * share;
        const ref = p.connection.outletId ? outletIdx.get(p.connection.outletId) : undefined;
        const v = ref ? outletVoltage(ref.pdu, ref.bank) : null;
        const bus = p.connection.dcBusId ? busById.get(p.connection.dcBusId) : undefined;
        let currentA: number | null = null;
        if (inputW !== null) {
          if (p.inputType === 'DC' && bus) currentA = inputW / Math.abs(bus.voltage);
          else if (v !== null) currentA = inputW / (v * load.pf);
          else currentA = inputW === 0 ? 0 : null;
        }
        const dcOutW = !active || !isActive ? 0 : domDcW === null ? null : domDcW * share;
        const lim = psuOutputLimit(p, v);
        psus[p.id] = {
          psuId: p.id,
          deviceId: d.id,
          domainId: dom.id,
          active: isActive,
          inputW,
          currentA,
          dcOutW,
          utilization: dcOutW !== null && lim ? dcOutW / lim : null,
          outletId: p.connection.outletId,
          pduId: ref?.pdu.id ?? null,
          voltage: v,
          pf: load.pf,
          phase: ref?.bank.phase ?? null,
          invalidConnection: reach.get(p.id)!.invalid,
        };
        if (p.connection.outletId && p.state !== 'removed') {
          const arr = outletUse.get(p.connection.outletId) ?? [];
          arr.push(p.id);
          outletUse.set(p.connection.outletId, arr);
        }
      }

      const domainDrawn = status === 'unpowered' || !active ? 0 : domInputW;
      drawn = drawn === null || domainDrawn === null ? null : drawn + domainDrawn;
      domains.push({
        domainId: dom.id,
        name: dom.name,
        mode: dom.mode,
        status,
        installedPsuIds: installed.map((p) => p.id),
        activePsuIds: activePsus.map((p) => p.id),
        lostPsuIds: lost.map((p) => p.id),
        requiredPsus: required,
        inputW: domInputW,
        dcDemandW: domDcW,
        availableDcW,
        capacity,
      });
    }

    // Device status precedence
    let status: DeviceStatus = 'ok';
    if (active) {
      if (!anyConnection) status = 'not_connected';
      else if (domains.length === 0 || domains.every((x) => x.status === 'unpowered')) status = 'unpowered';
      else if (domains.some((x) => x.status === 'unpowered')) status = 'partially_unpowered';
      else if (domains.some((x) => x.capacity === 'exceeded')) status = 'over_capacity';
      else if (domains.some((x) => x.status === 'shutdown_risk')) status = 'shutdown_risk';
      else if (domains.some((x) => x.status === 'possible_throttling')) status = 'possible_throttling';
      else if (domains.some((x) => x.status === 'unknown_behavior')) status = 'unknown_behavior';
      else if (domains.some((x) => x.status === 'degraded')) status = 'degraded';
    }
    // Not connected devices still count in device-view totals (planning); unpowered draw nothing.
    let drawnW: number | null;
    if (!active) drawnW = 0;
    else if (status === 'not_connected') drawnW = load.inputW;
    else if (status === 'unpowered') drawnW = 0;
    else drawnW = drawn;

    devices[d.id] = { deviceId: d.id, rackId: d.rackId, load, drawnW, status, domains, outsideRack: d.placement.kind === 'outside' };
  }

  // DC buses
  const dcBuses: Record<ID, DcBusResult> = {};
  const rectifierOutletW = new Map<ID, { w: number | null; pf: number }>();
  for (const bus of project.dcBuses) {
    let w = 0;
    let unknown = 0;
    for (const r of Object.values(psus)) {
      const dev = project.devices.find((x) => x.id === r.deviceId);
      const p = dev?.domains.flatMap((x) => x.psus).find((x) => x.id === r.psuId);
      if (p?.connection.dcBusId !== bus.id || p.inputType !== 'DC') continue;
      if (r.inputW === null) unknown++;
      else w += r.inputW;
    }
    const eta = bus.rectifierEfficiency;
    const acW = eta && eta > 0 && eta <= 1 ? w / eta : null;
    const powered = busPowered.get(bus.id) ?? false;
    const feeding = bus.rectifierOutletIds.filter((oid) => {
      const ref = outletIdx.get(oid);
      return ref && pduPowered.get(ref.pdu.id)?.powered;
    });
    for (const oid of feeding) rectifierOutletW.set(oid, { w: acW === null || unknown > 0 ? null : acW / feeding.length, pf: a.defaultPf });
    dcBuses[bus.id] = { busId: bus.id, w, currentA: w / Math.abs(bus.voltage || 1), unknownCount: unknown, rectifierAcW: acW, powered };
  }

  // Outlets
  const outlets: Record<ID, OutletResult> = {};
  const duplicateOutletIds: ID[] = [];
  const pduLoads = new Map<ID, PhaseLoad[]>();
  for (const pdu of project.pdus) {
    for (const bank of pdu.banks) {
      for (const outlet of bank.outlets) {
        const psuIds = outletUse.get(outlet.id) ?? [];
        if (psuIds.length > 1) duplicateOutletIds.push(outlet.id);
        let w = 0;
        let cur = 0;
        let unknown = 0;
        for (const pid of psuIds) {
          const r = psus[pid];
          if (!r || r.invalidConnection) continue;
          if (r.inputW === null || (r.currentA === null && r.inputW > 0)) unknown++;
          else {
            w += r.inputW;
            cur += r.currentA ?? 0;
            if (bank.phase && r.inputW > 0) {
              const arr = pduLoads.get(pdu.id) ?? [];
              arr.push({ connection: bank.phase, pW: r.inputW, pf: r.pf });
              pduLoads.set(pdu.id, arr);
            }
          }
        }
        const rect = rectifierOutletW.get(outlet.id);
        if (rect) {
          const v = outletVoltage(pdu, bank);
          if (rect.w === null || v === null) unknown++;
          else {
            w += rect.w;
            cur += rect.w / (v * rect.pf);
            if (bank.phase) {
              const arr = pduLoads.get(pdu.id) ?? [];
              arr.push({ connection: bank.phase, pW: rect.w, pf: rect.pf });
              pduLoads.set(pdu.id, arr);
            }
          }
        }
        const lim = deriveLimits(outlet.ratedA, null, project.policy);
        outlets[outlet.id] = {
          outletId: outlet.id,
          pduId: pdu.id,
          bankId: bank.id,
          w,
          currentA: cur,
          unknownCount: unknown,
          psuIds,
          limitA: outlet.ratedA,
          status: psuIds.length === 0 && !rect ? 'within' : outlet.ratedA === null ? 'unknown' : cur > outlet.ratedA ? 'hard_exceeded' : classify(cur, lim),
        };
      }
    }
  }

  // PDUs
  const pdus: Record<ID, PduResult> = {};
  for (const pdu of project.pdus) {
    const ps = pduPowered.get(pdu.id)!;
    const banks: BankResult[] = pdu.banks.map((bank) => {
      let w = 0;
      let cur = 0;
      let unknown = 0;
      for (const o of bank.outlets) {
        const r = outlets[o.id];
        w += r.w;
        cur += r.currentA;
        unknown += r.unknownCount;
      }
      const limits = bankLimits(bank, project.policy);
      let status = classify(cur, limits);
      if (unknown > 0 && (status === 'within' || status === 'alert')) status = 'unknown';
      if (limits.hardA === null && w === 0) status = 'na';
      return { bankId: bank.id, pduId: pdu.id, phase: bank.phase, w, currentA: cur, unknownCount: unknown, limits, status };
    });
    const w = banks.reduce((s, b) => s + b.w, 0);
    const unknownCount = banks.reduce((s, b) => s + b.unknownCount, 0);
    let va = 0;
    for (const bank of pdu.banks)
      for (const o of bank.outlets)
        for (const pid of outlets[o.id].psuIds) {
          const r = psus[pid];
          if (r && r.inputW !== null && !r.invalidConnection) va += apparentPower(r.inputW, r.pf) ?? 0;
        }
    for (const [oid, rect] of rectifierOutletW) if (outlets[oid]?.pduId === pdu.id && rect.w !== null) va += rect.w / rect.pf;

    let totalCurrentA: number | null = null;
    let phaseCurrents: PhaseCurrents | null = null;
    let phaseUnknown = false;
    let governingA: number | null = null;
    let governingPhase: string | null = null;
    if (pdu.topology === '1ph') {
      totalCurrentA = banks.reduce((s, b) => s + b.currentA, 0);
      governingA = totalCurrentA;
    } else {
      const loadedUnmapped = pdu.banks.some((b) => b.phase === null && b.outlets.some((o) => outlets[o.id].psuIds.length > 0 || rectifierOutletW.has(o.id)));
      if (loadedUnmapped || pdu.voltage === null) phaseUnknown = true;
      else {
        phaseCurrents = unbalancedLineCurrents(pduLoads.get(pdu.id) ?? [], pdu.voltage);
        if (!phaseCurrents) phaseUnknown = true;
        else {
          const entries: [string, number][] = [
            ['L1', phaseCurrents.L1],
            ['L2', phaseCurrents.L2],
            ['L3', phaseCurrents.L3],
          ];
          const max = entries.reduce((m, e) => (e[1] > m[1] ? e : m));
          governingA = max[1];
          governingPhase = max[0];
        }
      }
    }
    const limits = pduLimits(pdu, project.policy);
    let status = classify(governingA, limits);
    // Unknown loads: a proven overload stays visible; "within" becomes unknown.
    if (unknownCount > 0 && (status === 'within' || status === 'alert')) status = 'unknown';
    const kwStatus = pdu.usableKw === null ? 'na' : unknownCount > 0 && w <= pdu.usableKw * 1000 ? 'unknown' : w > pdu.usableKw * 1000 ? 'exceeded' : 'within';
    const kvaStatus = pdu.usableKva === null ? 'na' : unknownCount > 0 && va <= pdu.usableKva * 1000 ? 'unknown' : va > pdu.usableKva * 1000 ? 'exceeded' : 'within';
    const allOutlets = pdu.banks.flatMap((b) => b.outlets);
    const used = allOutlets.filter((o) => outlets[o.id].psuIds.length > 0 || rectifierOutletW.has(o.id) || project.dcBuses.some((bus) => bus.rectifierOutletIds.includes(o.id)));
    const freeByType: Record<string, number> = {};
    for (const o of allOutlets) if (!used.includes(o)) freeByType[o.type] = (freeByType[o.type] ?? 0) + 1;
    pdus[pdu.id] = {
      pduId: pdu.id,
      rackId: pdu.rackId,
      feed: pdu.feed,
      powered: ps.powered,
      topologyKnown: ps.topologyKnown,
      w,
      va,
      unknownCount,
      totalCurrentA,
      phaseCurrents,
      phaseUnknown,
      governingA,
      governingPhase,
      limits,
      status,
      kwStatus,
      kvaStatus,
      outletsTotal: allOutlets.length,
      outletsUsed: used.length,
      freeByType,
      banks,
    };
  }

  // Branch circuits (PDUs directly + ATS outputs routed to their active input)
  const branches: Record<ID, BranchResult> = {};
  for (const b of project.branches) {
    const feeding = project.pdus.filter((p) => {
      if (!p.upstream) return false;
      if (p.upstream.kind === 'branch') return p.upstream.id === b.id;
      return paths.atsActiveBranch(p.upstream.id) === b.id;
    });
    let w = 0;
    let va = 0;
    let unknown = 0;
    let cur: number | null = 0;
    for (const p of feeding) {
      const r = pdus[p.id];
      w += r.w;
      va += r.va;
      unknown += r.unknownCount;
      if (b.phases === 1 && p.topology === '1ph') cur = cur === null || r.totalCurrentA === null ? null : cur + r.totalCurrentA;
      else if (b.phases === 3 && p.topology !== '1ph') cur = cur === null || r.governingA === null ? null : cur + r.governingA;
      else cur = null;
    }
    const limits = branchLimits(b, project.policy);
    let status = classify(cur, limits);
    if (unknown > 0 && (status === 'within' || status === 'alert')) status = 'unknown';
    branches[b.id] = { branchId: b.id, powered: paths.branchUp(b.id).powered, w, va, currentA: cur, unknownCount: unknown, limits, status };
  }

  // UPS
  const upses: Record<ID, UpsResult> = {};
  for (const u of project.upses) {
    const brs = project.branches.filter((b) => b.upsId === u.id);
    const w = brs.reduce((s, b) => s + branches[b.id].w, 0);
    const va = brs.reduce((s, b) => s + branches[b.id].va, 0);
    const unknown = brs.reduce((s, b) => s + branches[b.id].unknownCount, 0);
    const complete = u.otherLoadsKnown && unknown === 0;
    const other = u.otherLoadsKnown ? u.otherLoadW ?? 0 : null;
    const totalW = other === null ? null : w + other;
    const totalVa = other === null ? null : va + other / a.defaultPf;
    const lossW = u.efficiency && u.efficiency > 0 && u.efficiency <= 1 ? w * (1 / u.efficiency - 1) : null;
    upses[u.id] = {
      upsId: u.id,
      powered: paths.upsUp(u.id).powered,
      w,
      va,
      unknownCount: unknown,
      totalW,
      totalVa,
      kwUtil: u.ratedKw ? (totalW ?? w) / (u.ratedKw * 1000) : null,
      kvaUtil: u.ratedKva ? (totalVa ?? va) / (u.ratedKva * 1000) : null,
      complete,
      lossW,
    };
  }

  // Rack totals (device view: each device counted once)
  const racks: Record<ID, RackTotals> = {};
  for (const rack of project.racks) {
    const t: RackTotals = {
      rackId: rack.id,
      knownW: 0,
      knownVa: 0,
      unknownCount: 0,
      activeCount: 0,
      outsideKnownW: 0,
      outsideUnknownCount: 0,
      airHeatW: 0,
      liquidHeatW: 0,
      heatUnknownReason: null,
      poeOutsideW: 0,
      upsLossW: 0,
      unpoweredDeviceIds: [],
      riskDeviceIds: [],
    };
    for (const d of project.devices.filter((x) => x.rackId === rack.id)) {
      const r = devices[d.id];
      const active = !d.power.passiveZero && !d.poweredByPoeSwitchId;
      if (!active) continue;
      t.activeCount++;
      if (r.status === 'unpowered' || r.status === 'partially_unpowered') t.unpoweredDeviceIds.push(d.id);
      if (['shutdown_risk', 'possible_throttling', 'unknown_behavior', 'over_capacity'].includes(r.status)) t.riskDeviceIds.push(d.id);
      // AC-equivalent of DC-input devices via rectifier efficiency (counted once, rectifier is not a device)
      let w = r.drawnW;
      if (w !== null && d.inputType === 'DC') {
        const busId = d.domains.flatMap((x) => x.psus).find((p) => p.connection.dcBusId)?.connection.dcBusId;
        const eta = busId ? busById.get(busId)?.rectifierEfficiency : null;
        w = eta && eta > 0 && eta <= 1 ? w / eta : null;
      }
      if (d.placement.kind === 'outside') {
        if (w === null) t.outsideUnknownCount++;
        else t.outsideKnownW += w;
        continue;
      }
      if (w === null) {
        t.unknownCount++;
        continue;
      }
      t.knownW += w;
      t.knownVa += w / r.load.pf;
      // Heat: exclude PoE delivered outside the rack; split liquid-rejected heat.
      let heat = w;
      const poeOut = r.load.poe?.outsideRackW;
      if (poeOut && r.drawnW && r.drawnW > 0) {
        heat -= poeOut;
        t.poeOutsideW += poeOut;
      }
      if (d.cooling.liquidCooled) {
        if (d.cooling.liquidFraction === null) {
          t.heatUnknownReason = 'liquid_fraction_unknown';
        } else {
          t.liquidHeatW += heat * d.cooling.liquidFraction;
          heat *= 1 - d.cooling.liquidFraction;
        }
      }
      if (t.airHeatW !== null) t.airHeatW += heat;
    }
    for (const u of project.upses.filter((x) => x.inRack && x.rackDeviceId)) {
      const dev = project.devices.find((x) => x.id === u.rackDeviceId);
      if (dev?.rackId === rack.id && upses[u.id].lossW !== null) {
        t.upsLossW += upses[u.id].lossW!;
        if (t.airHeatW !== null) t.airHeatW += upses[u.id].lossW!;
      }
    }
    if (t.heatUnknownReason) t.airHeatW = null;
    racks[rack.id] = t;
  }

  return { def, level, devices, psus, outlets, pdus, branches, upses, dcBuses, racks, duplicateOutletIds };
}

// ---------------------------------------------------------------------------

export function standardScenarios(project: Project): ScenarioDef[] {
  const defs: ScenarioDef[] = [{ id: 'normal', kind: 'normal', failures: NO_FAILURES }];
  const feeds = Array.from(new Set(project.pdus.map((p) => p.feed))).sort();
  for (const feed of feeds) defs.push({ id: `loss_feed_${feed}`, kind: 'loss_feed', target: feed, failures: { ...NO_FAILURES, feeds: [feed] } });
  for (const u of project.upses) defs.push({ id: `loss_ups_${u.id}`, kind: 'loss_ups', target: u.id, failures: { ...NO_FAILURES, upsIds: [u.id] } });
  for (const s of project.sources) defs.push({ id: `loss_source_${s.id}`, kind: 'loss_source', target: s.id, failures: { ...NO_FAILURES, sourceIds: [s.id] } });
  return defs;
}

export function psuLossScenario(psuId: ID): ScenarioDef {
  return { id: `loss_psu_${psuId}`, kind: 'loss_psu', target: psuId, failures: { ...NO_FAILURES, psuIds: [psuId] } };
}

export interface ScenarioPair {
  def: ScenarioDef;
  typical: ScenarioResult;
  design: ScenarioResult;
}

export function computeScenarioPair(project: Project, def: ScenarioDef): ScenarioPair {
  return { def, typical: computeScenario(project, def, 'typical'), design: computeScenario(project, def, 'design') };
}

export function computeAllScenarios(project: Project, extra: ScenarioDef[] = []): ScenarioPair[] {
  return [...standardScenarios(project), ...extra].map((d) => computeScenarioPair(project, d));
}
