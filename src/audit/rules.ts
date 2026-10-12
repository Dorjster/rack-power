/**
 * Configurable audit rule engine.
 *
 * Rule families:
 *  - manufacturer: PSU capacity/compatibility, voltage, published PDU ratings, connectors, depth/weight
 *  - guidance: referenced guidance with explicit source/applicability (e.g. ASHRAE envelope)
 *  - site_policy: editable local thresholds (alert %, planning derating, imbalance) — never universal standards
 *  - physical: rack geometry, hard electrical overloads
 *  - data: missing/stale inputs (never Pass)
 *  - manual: checklist evidence
 */
import type { CheckStatus, DeviceInstance, ID, Pdu, Project } from '../domain/types';
import type { AffectedKind, EvidenceType, Finding, Msg, RuleType, Severity } from './types';
import type { ScenarioDef, ScenarioPair, ScenarioResult } from '../engine/scenario';
import { indexOutlets, isRackLocal, outletVoltage } from '../engine/scenario';
import { auditPlacements, freeBlocks, occupiedRanges } from '../engine/placement';
import { measurementAgeDays, installedPsus } from '../engine/devicePower';
import { phaseImbalance, withGrowthReserve } from '../engine/electrical';
import { fmtA, fmtNum, fmtPct, fmtW } from '../engine/format';
import { CONNECTOR_MATES } from '../catalog/pdus';
import { CHECKLIST_KEYS } from './checklist';
import type { LimitStatus } from '../engine/limits';

export interface RuleContext {
  project: Project;
  scenarios: ScenarioPair[];
  now: Date;
}

const m = (key: string, params: Record<string, string | number> = {}): Msg => ({ key, params });

export function scenarioLabel(def: ScenarioDef, project: Project): Msg {
  switch (def.kind) {
    case 'normal':
      return m('sc.normal');
    case 'loss_feed':
      return m('sc.loss_feed', { feed: def.target ?? '' });
    case 'loss_ups':
      return m('sc.loss_ups', { name: project.upses.find((u) => u.id === def.target)?.name ?? def.target ?? '' });
    case 'loss_source':
      return m('sc.loss_source', { name: project.sources.find((s) => s.id === def.target)?.name ?? def.target ?? '' });
    case 'loss_psu': {
      const d = project.devices.find((x) => installedPsus(x).some((p) => p.id === def.target));
      const p = d ? installedPsus(d).find((x) => x.id === def.target) : undefined;
      return m('sc.loss_psu', { name: `${d?.name ?? ''} ${p?.label ?? ''}`.trim() });
    }
  }
}

class Collector {
  findings: Finding[] = [];
  constructor(private project: Project) {}
  add(f: {
    ruleId: string;
    ruleType: RuleType;
    severity: Severity;
    status: CheckStatus;
    affected: { kind: AffectedKind; id: ID; label: string };
    rackId: ID | null;
    msg: Msg;
    rec?: Msg | null;
    evidence: EvidenceType;
    observed?: string | null;
    threshold?: string | null;
    calc?: string | null;
    scenario?: ScenarioDef | null;
    level?: 'typical' | 'design' | null;
    source?: string | null;
    essential?: boolean;
    hard?: boolean;
    failoverOnly?: boolean;
    excessA?: number;
  }) {
    const override = this.project.policy.overrides[f.ruleId];
    let status = f.status;
    let policyNote: string | null = null;
    if (override?.disabled) {
      policyNote = override.note || 'Disabled by site policy';
      status = 'na';
    } else if (override?.note) policyNote = override.note;
    const key = [f.ruleId, f.affected.id, f.scenario?.id ?? '', f.level ?? ''].join('|');
    this.findings.push({
      key,
      ruleId: f.ruleId,
      ruleType: f.ruleType,
      severity: f.severity,
      status,
      affected: f.affected,
      rackId: f.rackId,
      scenarioId: f.scenario?.id ?? null,
      scenarioLabel: f.scenario ? scenarioLabel(f.scenario, this.project) : null,
      level: f.level ?? null,
      observed: f.observed ?? null,
      threshold: f.threshold ?? null,
      calc: f.calc ?? null,
      msg: f.msg,
      rec: f.rec ?? null,
      evidence: f.evidence,
      source: f.source ?? null,
      essential: !!f.essential && status === 'unknown',
      hard: !!f.hard,
      failoverOnly: !!f.failoverOnly,
      policyNote,
      excessA: f.excessA,
    });
  }
}

const devAff = (d: DeviceInstance) => ({ kind: 'device' as const, id: d.id, label: d.name });
const pduAff = (p: Pdu) => ({ kind: 'pdu' as const, id: p.id, label: `${p.name} (${p.feed})` });

function isActive(d: DeviceInstance) {
  return !d.power.passiveZero && !d.poweredByPoeSwitchId;
}

/** Calculation text for a current derived from per-PSU loads. */
function currentCalc(r: ScenarioResult, pdu: Pdu, project: Project): string {
  const pr = r.pdus[pdu.id];
  const psus = Object.values(r.psus).filter((p) => p.pduId === pdu.id && p.inputW !== null && p.inputW > 0);
  if (pdu.topology === '1ph') {
    const pfs = Array.from(new Set(psus.map((p) => p.pf)));
    if (pfs.length <= 1) {
      const pf = pfs[0] ?? project.assumptions.defaultPf;
      return `I = P / (V × PF) = ${fmtNum(pr.w, 1)} W / (${fmtNum(pdu.voltage, 1)} V × ${pf}) = ${fmtA(pr.governingA)}`;
    }
    return `I = Σ Pᵢ / (V × PFᵢ) = ${fmtA(pr.governingA)} (${psus.length} PSU, V = ${fmtNum(pdu.voltage, 1)} V)`;
  }
  if (pr.phaseCurrents)
    return `Phasor sum per phase (V_LL = ${pdu.voltage} V): L1 ${fmtA(pr.phaseCurrents.L1)}, L2 ${fmtA(pr.phaseCurrents.L2)}, L3 ${fmtA(pr.phaseCurrents.L3)}, N ${fmtA(pr.phaseCurrents.N)}`;
  return 'Phase mapping unknown';
}

export function evaluateRules(ctx: RuleContext): Finding[] {
  const { project, scenarios, now } = ctx;
  const c = new Collector(project);
  const policy = project.policy;
  const normal = scenarios.find((s) => s.def.kind === 'normal')!;
  const outletIdx = indexOutlets(project);
  const pduById = new Map(project.pdus.map((p) => [p.id, p]));
  const branchById = new Map(project.branches.map((b) => [b.id, b]));
  const upsById = new Map(project.upses.map((u) => [u.id, u]));

  // ---------------------------------------------------------------- Physical
  const placementIssues = auditPlacements(project.racks, project.devices, project.pdus);
  for (const iss of placementIssues) {
    const d = project.devices.find((x) => x.id === iss.id);
    const p = project.pdus.find((x) => x.id === iss.id);
    c.add({
      ruleId: 'PHY-001',
      ruleType: 'physical',
      severity: 'high',
      status: 'fail',
      affected: d ? devAff(d) : p ? pduAff(p) : { kind: 'project', id: iss.id, label: iss.id },
      rackId: d?.rackId ?? p?.rackId ?? null,
      msg: m(`f.PHY-001.${iss.code}`),
      rec: m('r.PHY-001'),
      evidence: 'calculated',
    });
  }
  for (const rack of project.racks) {
    const ranges = occupiedRanges(rack.id, project.devices, project.pdus);
    if (!placementIssues.some((i) => ranges.some((r) => r.id === i.id)))
      c.add({
        ruleId: 'PHY-001',
        ruleType: 'physical',
        severity: 'high',
        status: 'pass',
        affected: { kind: 'rack', id: rack.id, label: rack.name },
        rackId: rack.id,
        msg: m('f.PHY-001.ok'),
        evidence: 'calculated',
      });
    for (const d of project.devices.filter((x) => x.rackId === rack.id && x.placement.kind === 'unplaced'))
      c.add({
        ruleId: 'PHY-002',
        ruleType: 'physical',
        severity: 'low',
        status: 'warning',
        affected: devAff(d),
        rackId: rack.id,
        msg: m('f.PHY-002'),
        rec: m('r.PHY-002'),
        evidence: 'calculated',
      });
  }

  // ---------------------------------------------------------------- Data
  for (const d of project.devices) {
    if (!isActive(d)) continue;
    const typ = normal.typical.devices[d.id].load;
    const des = normal.design.devices[d.id].load;
    if (typ.inputW === null)
      c.add({
        ruleId: 'DATA-001',
        ruleType: 'data',
        severity: 'high',
        status: 'unknown',
        affected: devAff(d),
        rackId: d.rackId,
        msg: m('f.DATA-001'),
        rec: m('r.DATA-001'),
        evidence: 'missing',
        essential: true,
      });
    if (des.inputW === null)
      c.add({
        ruleId: 'DATA-002',
        ruleType: 'data',
        severity: 'high',
        status: 'unknown',
        affected: devAff(d),
        rackId: d.rackId,
        msg: m('f.DATA-002', { typ: typ.inputW === null ? '—' : fmtW(typ.inputW), basis: typ.basis }),
        rec: m('r.DATA-002'),
        evidence: 'missing',
        essential: true,
      });
    if (typ.basis === 'psu_proxy' || des.basis === 'psu_proxy')
      c.add({
        ruleId: 'DATA-005',
        ruleType: 'data',
        severity: 'medium',
        status: 'warning',
        affected: devAff(d),
        rackId: d.rackId,
        msg: m('f.DATA-005'),
        rec: m('r.DATA-001'),
        evidence: 'assumption',
      });
    const age = measurementAgeDays(d, now);
    if (age !== null && age > policy.staleDays)
      c.add({
        ruleId: 'DATA-003',
        ruleType: 'site_policy',
        severity: 'medium',
        status: 'warning',
        affected: devAff(d),
        rackId: d.rackId,
        observed: `${fmtNum(age, 0)} d`,
        threshold: `${policy.staleDays} d`,
        msg: m('f.DATA-003', { age: fmtNum(age, 0), limit: policy.staleDays }),
        rec: m('r.DATA-003'),
        evidence: 'measured',
      });
    if (normal.design.devices[d.id].status === 'not_connected' && d.inputType === 'AC')
      c.add({
        ruleId: 'DATA-004',
        ruleType: 'data',
        severity: 'medium',
        status: 'unknown',
        affected: devAff(d),
        rackId: d.rackId,
        msg: m('f.DATA-004'),
        rec: m('r.DATA-004'),
        evidence: 'missing',
        essential: true,
      });
  }

  // ---------------------------------------------------------------- PSU capability
  for (const d of project.devices) {
    if (!isActive(d)) continue;
    const dr = normal.design.devices[d.id];
    for (const dom of d.domains) {
      const domR = dr.domains.find((x) => x.domainId === dom.id)!;
      const installed = dom.psus.filter((p) => p.state === 'ok' || p.state === 'standby');
      const ratings = installed.map((p) => p.ratedDcW);
      const allRated = ratings.every((x) => x !== null);
      const nameplate = allRated ? (ratings as number[]).reduce((s, x) => s + x, 0) : null;
      const dcDemand = domR.dcDemandW;
      const affected = { kind: 'domain' as const, id: dom.id, label: `${d.name} / ${dom.name}` };

      // PSU-001: design DC demand vs installed PSU capability
      if (installed.length === 0) continue;
      if (dcDemand === null || nameplate === null) {
        c.add({
          ruleId: 'PSU-001',
          ruleType: 'manufacturer',
          severity: 'high',
          status: 'unknown',
          affected,
          rackId: d.rackId,
          msg: m(dcDemand === null ? 'f.PSU-001.demand_unknown' : 'f.PSU-001.rating_unknown'),
          rec: m('r.PSU-001.unknown'),
          evidence: 'missing',
          level: 'design',
        });
      } else {
        const ok = dcDemand <= nameplate;
        c.add({
          ruleId: 'PSU-001',
          ruleType: 'manufacturer',
          severity: ok ? 'info' : 'critical',
          status: ok ? 'pass' : 'fail',
          affected,
          rackId: d.rackId,
          observed: fmtW(dcDemand, 1) + ' DC',
          threshold: fmtW(nameplate) + ' DC',
          calc: `P_DC = P_AC × η = ${fmtW(domR.inputW, 1)} × ${fmtNum(dr.load.eta, 3)} = ${fmtW(dcDemand, 1)}; Σ PSU = ${fmtW(nameplate)}`,
          msg: m(ok ? 'f.PSU-001.ok' : 'f.PSU-001.fail', { demand: fmtW(dcDemand, 1), cap: fmtW(nameplate) }),
          rec: ok ? null : m('r.PSU-001.fail'),
          evidence: dr.load.basis === 'measured' ? 'measured' : 'estimated',
          level: 'design',
          hard: !ok,
        });
      }

      // PSU-002: remaining capacity after each single PSU failure / redundancy
      if (dom.mode === 'unknown') {
        c.add({
          ruleId: 'PSU-002',
          ruleType: 'manufacturer',
          severity: 'medium',
          status: 'unknown',
          affected,
          rackId: d.rackId,
          msg: m('f.PSU-002.mode_unknown', { count: installed.length }),
          rec: m('r.PSU-002.mode_unknown'),
          evidence: 'missing',
          essential: installed.length > 1,
        });
      } else if (dom.mode === 'single' || dom.mode === 'load_sharing') {
        c.add({
          ruleId: 'PSU-002',
          ruleType: 'manufacturer',
          severity: d.critical ? 'medium' : 'low',
          status: d.critical ? 'warning' : 'na',
          affected,
          rackId: d.rackId,
          msg: m('f.PSU-002.nonredundant', { mode: dom.mode }),
          rec: d.critical ? m('r.PSU-002.nonredundant') : null,
          evidence: 'manufacturer',
        });
      } else {
        const required = dom.mode === '1+1' ? 1 : dom.requiredPsus;
        let worstRemaining: number | null = Infinity;
        let worstLabel = '';
        for (const lost of installed) {
          const remaining = installed.filter((p) => p !== lost);
          if (remaining.some((p) => p.ratedDcW === null)) {
            worstRemaining = null;
            break;
          }
          const cap = remaining.reduce((s, p) => s + (p.ratedDcW ?? 0), 0);
          if (cap < (worstRemaining as number)) {
            worstRemaining = cap;
            worstLabel = lost.label;
          }
        }
        if (installed.length < 2) worstRemaining = 0;
        if (required === null) {
          c.add({
            ruleId: 'PSU-002',
            ruleType: 'manufacturer',
            severity: 'medium',
            status: 'unknown',
            affected,
            rackId: d.rackId,
            msg: m('f.PSU-002.n_unknown', { mode: dom.mode }),
            rec: m('r.PSU-002.mode_unknown'),
            evidence: 'missing',
            essential: true,
          });
        } else if (installed.length - 1 < required) {
          c.add({
            ruleId: 'PSU-002',
            ruleType: 'manufacturer',
            severity: 'high',
            status: 'fail',
            affected,
            rackId: d.rackId,
            observed: `${installed.length} PSU`,
            threshold: `N=${required} +1`,
            msg: m('f.PSU-002.count', { installed: installed.length, required }),
            rec: m('r.PSU-002.count'),
            evidence: 'manufacturer',
            failoverOnly: true,
          });
        } else if (worstRemaining === null || dcDemand === null) {
          c.add({
            ruleId: 'PSU-002',
            ruleType: 'manufacturer',
            severity: 'medium',
            status: 'unknown',
            affected,
            rackId: d.rackId,
            msg: m('f.PSU-002.unknown'),
            rec: m('r.PSU-001.unknown'),
            evidence: 'missing',
            level: 'design',
            essential: true,
          });
        } else {
          const ok = dcDemand <= worstRemaining;
          c.add({
            ruleId: 'PSU-002',
            ruleType: 'manufacturer',
            severity: ok ? 'info' : 'high',
            status: ok ? 'pass' : 'fail',
            affected,
            rackId: d.rackId,
            observed: fmtW(dcDemand, 1) + ' DC',
            threshold: fmtW(worstRemaining as number) + ' DC',
            calc: `${d.name}: P_DC design = ${fmtW(domR.inputW, 1)} × η ${fmtNum(dr.load.eta, 3)} = ${fmtW(dcDemand, 1)} ≤ ${fmtW(worstRemaining as number)} (lose ${worstLabel})`,
            msg: m(ok ? 'f.PSU-002.ok' : 'f.PSU-002.fail', { demand: fmtW(dcDemand, 1), cap: fmtW(worstRemaining as number), psu: worstLabel }),
            rec: ok ? null : m('r.PSU-002.fail'),
            evidence: 'estimated',
            level: 'design',
            failoverOnly: !ok,
          });
        }
      }

      // PSU-003: mixed ratings / unverified compatibility
      const distinct = new Set(installed.map((p) => p.ratedDcW));
      if (distinct.size > 1)
        c.add({
          ruleId: 'PSU-003',
          ruleType: 'manufacturer',
          severity: 'high',
          status: 'warning',
          affected,
          rackId: d.rackId,
          observed: Array.from(distinct)
            .map((x) => (x === null ? '?' : `${x} W`))
            .join(' / '),
          msg: m('f.PSU-003.mixed'),
          rec: m('r.PSU-003.mixed'),
          evidence: 'manufacturer',
        });
      const unverified = installed.filter((p) => !p.compatVerified);
      c.add({
        ruleId: 'PSU-004',
        ruleType: 'manufacturer',
        severity: 'low',
        status: unverified.length ? 'unknown' : 'pass',
        affected,
        rackId: d.rackId,
        msg: m(unverified.length ? 'f.PSU-004.unverified' : 'f.PSU-004.ok', { count: unverified.length }),
        rec: unverified.length ? m('r.PSU-004') : null,
        evidence: unverified.length ? 'missing' : 'manufacturer',
      });

      // PSU-005: input voltage range vs outlet voltage
      for (const p of installed) {
        if (p.inputType !== 'AC' || !p.connection.outletId) continue;
        const ref = outletIdx.get(p.connection.outletId);
        if (!ref) continue;
        const v = outletVoltage(ref.pdu, ref.bank);
        if (v === null || p.inputVoltageMin === null || p.inputVoltageMax === null) {
          c.add({
            ruleId: 'PSU-005',
            ruleType: 'manufacturer',
            severity: 'low',
            status: 'unknown',
            affected: { kind: 'psu', id: p.id, label: `${d.name} ${p.label}` },
            rackId: d.rackId,
            msg: m('f.PSU-005.unknown'),
            rec: m('r.PSU-005.unknown'),
            evidence: 'missing',
          });
        } else {
          const ok = v >= p.inputVoltageMin && v <= p.inputVoltageMax;
          c.add({
            ruleId: 'PSU-005',
            ruleType: 'manufacturer',
            severity: ok ? 'info' : 'critical',
            status: ok ? 'pass' : 'fail',
            affected: { kind: 'psu', id: p.id, label: `${d.name} ${p.label}` },
            rackId: d.rackId,
            observed: `${fmtNum(v, 1)} V`,
            threshold: `${p.inputVoltageMin}–${p.inputVoltageMax} V`,
            msg: m(ok ? 'f.PSU-005.ok' : 'f.PSU-005.fail', { v: fmtNum(v, 1), min: p.inputVoltageMin, max: p.inputVoltageMax }),
            rec: ok ? null : m('r.PSU-005.fail'),
            evidence: 'manufacturer',
            hard: !ok,
          });
        }
      }
    }
  }

  // Transients / vendor full-redundancy behavior: always requires manufacturer guidance.
  for (const rack of project.racks) {
    const redundant = project.devices.filter((d) => d.rackId === rack.id && isActive(d) && d.domains.some((x) => installedPsus(d).length > 1 && x.mode !== 'single'));
    if (redundant.length)
      c.add({
        ruleId: 'PSU-006',
        ruleType: 'manufacturer',
        severity: 'low',
        status: 'unknown',
        affected: { kind: 'rack', id: rack.id, label: rack.name },
        rackId: rack.id,
        msg: m('f.PSU-006', { count: redundant.length }),
        rec: m('r.PSU-006'),
        evidence: 'missing',
      });
  }

  // ---------------------------------------------------------------- Feed independence
  const pathOf = (pdu: Pdu) => {
    if (!pdu.upstream) return { branch: null, ups: null, source: null, ats: null, known: false };
    if (pdu.upstream.kind === 'ats') return { branch: null, ups: null, source: null, ats: pdu.upstream.id, known: true };
    const br = branchById.get(pdu.upstream.id);
    const ups = br?.upsId ? upsById.get(br.upsId) : undefined;
    const source = ups ? ups.sourceId : br?.sourceId ?? null;
    return { branch: br?.id ?? null, ups: ups?.id ?? null, source, ats: null, known: !!br && source !== null };
  };
  const compareIndependence = (a: Pdu, b: Pdu): { status: CheckStatus; reason: string } => {
    if (a.id === b.id) return { status: 'fail', reason: 'same_pdu' };
    const pa = pathOf(a);
    const pb = pathOf(b);
    if (pa.branch && pa.branch === pb.branch) return { status: 'fail', reason: 'same_branch' };
    if (pa.ups && pa.ups === pb.ups) return { status: 'fail', reason: 'same_ups' };
    if (pa.source && pa.source === pb.source) return { status: 'fail', reason: 'same_source' };
    if (pa.ats || pb.ats) return { status: 'unknown', reason: 'via_ats' };
    if (!pa.known || !pb.known) return { status: 'unknown', reason: 'topology_unknown' };
    return { status: 'pass', reason: 'independent' };
  };

  for (const rack of project.racks) {
    const rackPdus = project.pdus.filter((p) => p.rackId === rack.id);
    const feedsA = rackPdus.filter((p) => p.feed === 'A');
    const feedsB = rackPdus.filter((p) => p.feed === 'B');
    if (rack.feedCount === 2) {
      if (!feedsA.length || !feedsB.length) {
        c.add({
          ruleId: 'FEED-003',
          ruleType: 'physical',
          severity: 'high',
          status: 'fail',
          affected: { kind: 'rack', id: rack.id, label: rack.name },
          rackId: rack.id,
          msg: m('f.FEED-003.missing'),
          rec: m('r.FEED-003.missing'),
          evidence: 'topology',
        });
      } else {
        for (const a of feedsA)
          for (const b of feedsB) {
            const r = compareIndependence(a, b);
            c.add({
              ruleId: 'FEED-003',
              ruleType: 'physical',
              severity: r.status === 'fail' ? 'high' : r.status === 'unknown' ? 'medium' : 'info',
              status: r.status,
              affected: { kind: 'pdu', id: `${a.id}+${b.id}`, label: `${a.name} / ${b.name}` },
              rackId: rack.id,
              msg: m(`f.FEED-003.${r.reason}`),
              rec: r.status === 'pass' ? null : m('r.FEED-003'),
              evidence: 'topology',
              essential: r.status === 'unknown',
            });
          }
      }
    }
  }

  for (const d of project.devices) {
    if (!isActive(d) || d.inputType !== 'AC') continue;
    for (const dom of d.domains) {
      const installed = dom.psus.filter((p) => p.state === 'ok' || p.state === 'standby');
      const connected = installed.filter((p) => p.connection.outletId && outletIdx.has(p.connection.outletId));
      const affected = { kind: 'domain' as const, id: dom.id, label: `${d.name} / ${dom.name}` };
      if (installed.length >= 2 && dom.mode !== 'load_sharing' && dom.mode !== 'single') {
        // FEED-001/002: all PSUs on the same PDU / branch / UPS / source
        if (connected.length < installed.length) {
          c.add({
            ruleId: 'FEED-001',
            ruleType: 'physical',
            severity: 'medium',
            status: 'unknown',
            affected,
            rackId: d.rackId,
            msg: m('f.FEED-001.disconnected', { connected: connected.length, installed: installed.length }),
            rec: m('r.DATA-004'),
            evidence: 'topology',
          });
          continue;
        }
        const pdus = connected.map((p) => outletIdx.get(p.connection.outletId!)!.pdu);
        const distinctPdus = Array.from(new Set(pdus.map((p) => p.id))).map((id) => pduById.get(id)!);
        if (distinctPdus.length === 1) {
          c.add({
            ruleId: 'FEED-001',
            ruleType: 'physical',
            severity: 'high',
            status: 'fail',
            affected,
            rackId: d.rackId,
            observed: distinctPdus[0].name,
            msg: m('f.FEED-001.same_pdu', { pdu: distinctPdus[0].name }),
            rec: m('r.FEED-001'),
            evidence: 'topology',
            failoverOnly: true,
          });
        } else {
          // worst pairwise comparison
          let worst: { status: CheckStatus; reason: string } = { status: 'pass', reason: 'independent' };
          const rank: Record<string, number> = { pass: 0, unknown: 1, fail: 2 };
          for (let i = 0; i < distinctPdus.length; i++)
            for (let j = i + 1; j < distinctPdus.length; j++) {
              const r = compareIndependence(distinctPdus[i], distinctPdus[j]);
              if (rank[r.status] > rank[worst.status]) worst = r;
            }
          c.add({
            ruleId: 'FEED-002',
            ruleType: 'physical',
            severity: worst.status === 'fail' ? 'high' : worst.status === 'unknown' ? 'medium' : 'info',
            status: worst.status,
            affected,
            rackId: d.rackId,
            msg: m(`f.FEED-002.${worst.reason}`),
            rec: worst.status === 'pass' ? null : m('r.FEED-003'),
            evidence: 'topology',
            failoverOnly: worst.status === 'fail',
          });
        }
      }
    }
    // FEED-004: single-cord critical device
    const allPsus = installedPsus(d).filter((p) => p.state === 'ok' || p.state === 'standby');
    const isSingleCord = allPsus.length === 1 || d.domains.every((dom) => dom.mode === 'single');
    if (d.critical && isSingleCord && allPsus.length > 0) {
      const ref = allPsus[0].connection.outletId ? outletIdx.get(allPsus[0].connection.outletId) : undefined;
      const ats = ref?.pdu.upstream?.kind === 'ats' ? project.atses.find((a) => a.id === ref.pdu.upstream!.id) : undefined;
      const status: CheckStatus = ats ? (ats.validated ? 'pass' : 'warning') : 'warning';
      c.add({
        ruleId: 'FEED-004',
        ruleType: 'physical',
        severity: status === 'pass' ? 'info' : 'high',
        status,
        affected: devAff(d),
        rackId: d.rackId,
        msg: m(ats ? (ats.validated ? 'f.FEED-004.ats_ok' : 'f.FEED-004.ats_unvalidated') : 'f.FEED-004.no_ats'),
        rec: status === 'pass' ? null : m('r.FEED-004'),
        evidence: 'topology',
        failoverOnly: status !== 'pass',
      });
    }
  }

  // ---------------------------------------------------------------- Capacity per scenario
  const limitStatusToCheck = (s: LimitStatus): CheckStatus =>
    s === 'hard_exceeded' || s === 'planning_exceeded' ? 'fail' : s === 'alert' ? 'warning' : s === 'unknown' ? 'unknown' : s === 'na' ? 'na' : 'pass';

  for (const sp of scenarios) {
    const isNormal = sp.def.kind === 'normal';
    for (const level of ['typical', 'design'] as const) {
      const r = level === 'typical' ? sp.typical : sp.design;
      for (const pdu of project.pdus) {
        const pr = r.pdus[pdu.id];
        if (!pr.powered) continue;
        const L = pr.limits;
        const calc = currentCalc(r, pdu, project);
        const aff = pduAff(pdu);
        // Hard / manufacturer usable limit
        if (L.hardA === null) {
          if (isNormal)
            c.add({
              ruleId: 'CAP-PDU-HARD',
              ruleType: 'manufacturer',
              severity: 'high',
              status: 'unknown',
              affected: aff,
              rackId: pdu.rackId,
              scenario: sp.def,
              level,
              observed: fmtA(pr.governingA),
              msg: m('f.CAP-PDU.rating_unknown'),
              rec: m('r.CAP-PDU.rating_unknown'),
              evidence: 'missing',
              essential: true,
            });
          continue;
        }
        const phaseTxt = pr.governingPhase ? ` (${pr.governingPhase})` : '';
        if (pr.phaseUnknown) {
          c.add({
            ruleId: 'CAP-PHASE',
            ruleType: 'physical',
            severity: 'high',
            status: 'unknown',
            affected: aff,
            rackId: pdu.rackId,
            scenario: sp.def,
            level,
            msg: m('f.CAP-PHASE.unknown'),
            rec: m('r.CAP-PHASE.unknown'),
            evidence: 'missing',
            essential: true,
          });
          continue;
        }
        const hardExceeded = pr.governingA !== null && pr.governingA > L.hardA;
        const hardStatus: CheckStatus = hardExceeded ? 'fail' : pr.unknownCount > 0 ? 'unknown' : pr.governingA === null ? 'unknown' : 'pass';
        c.add({
          ruleId: 'CAP-PDU-HARD',
          ruleType: L.hardBasis === 'usable_published' ? 'manufacturer' : 'physical',
          severity: hardExceeded ? 'critical' : 'info',
          status: hardStatus,
          affected: aff,
          rackId: pdu.rackId,
          scenario: sp.def,
          level,
          observed: fmtA(pr.governingA) + phaseTxt,
          threshold: `${fmtA(L.hardA)} (${L.hardBasis === 'usable_published' ? 'usable' : 'nominal'})`,
          calc,
          msg: m(hardExceeded ? 'f.CAP-PDU-HARD.fail' : hardStatus === 'unknown' ? 'f.CAP-PDU.partial' : 'f.CAP-PDU-HARD.ok', {
            pdu: pdu.name,
            a: fmtA(pr.governingA),
            limit: fmtA(L.hardA),
            over: fmtA(pr.governingA !== null ? pr.governingA - L.hardA : null),
            head: fmtA(pr.governingA !== null ? L.hardA - pr.governingA : null),
            unknown: pr.unknownCount,
          }),
          rec: hardExceeded ? m('r.CAP-PDU.reduce') : hardStatus === 'unknown' ? m('r.DATA-001') : null,
          evidence: 'calculated',
          essential: hardStatus === 'unknown',
          hard: hardExceeded,
          failoverOnly: hardExceeded && !isNormal,
          excessA: hardExceeded ? pr.governingA! - L.hardA : undefined,
        });
        // Planning / alert (site policy)
        if (L.planningA !== null) {
          const planEx = pr.governingA !== null && pr.governingA > L.planningA;
          const alert = !planEx && L.alertA !== null && pr.governingA !== null && pr.governingA >= L.alertA;
          let status: CheckStatus = planEx ? 'fail' : alert ? 'warning' : 'pass';
          if (!planEx && (pr.unknownCount > 0 || pr.governingA === null)) status = 'unknown';
          const planBasis = L.planningBasis === 'derated_nominal' ? `${fmtPct(policy.planningDerateFraction)} × ${fmtA(L.nominalA)}` : L.planningBasis === 'usable_published_no_further_derate' ? 'usable, not derated again' : 'nominal';
          c.add({
            ruleId: 'CAP-PDU-PLAN',
            ruleType: 'site_policy',
            severity: planEx ? 'high' : alert ? 'low' : 'info',
            status,
            affected: aff,
            rackId: pdu.rackId,
            scenario: sp.def,
            level,
            observed: fmtA(pr.governingA) + phaseTxt,
            threshold: `${fmtA(L.planningA)} (${planBasis}); alert ≥ ${fmtA(L.alertA)}`,
            calc,
            msg: m(
              planEx ? (hardExceeded ? 'f.CAP-PDU-PLAN.fail_hard' : sp.def.kind === 'loss_feed' ? 'f.CAP-PDU-PLAN.fail_loss' : 'f.CAP-PDU-PLAN.fail') : alert ? 'f.CAP-PDU-PLAN.alert' : status === 'unknown' ? 'f.CAP-PDU.partial' : 'f.CAP-PDU-PLAN.ok',
              {
                pdu: pdu.name,
                feed: pdu.feed,
                a: fmtA(pr.governingA),
                limit: fmtA(L.planningA),
                hard: fmtA(L.hardA),
                over: fmtA(pr.governingA !== null ? pr.governingA - L.planningA : null),
                head: fmtA(pr.governingA !== null ? L.planningA - pr.governingA : null),
                alert: fmtA(L.alertA),
                unknown: pr.unknownCount,
                lost: sp.def.target ?? '',
              },
            ),
            rec: planEx ? m('r.CAP-PDU.plan') : alert ? m('r.CAP-PDU.alert') : null,
            evidence: 'calculated',
            essential: status === 'unknown',
            failoverOnly: planEx && !isNormal,
            excessA: planEx ? pr.governingA! - L.planningA : undefined,
          });
        }
        // Published usable kW / kVA
        if (pr.kwStatus !== 'na' || pr.kvaStatus !== 'na') {
          const ex = pr.kwStatus === 'exceeded' || pr.kvaStatus === 'exceeded';
          const unk = pr.kwStatus === 'unknown' || pr.kvaStatus === 'unknown';
          c.add({
            ruleId: 'CAP-PDU-KW',
            ruleType: 'manufacturer',
            severity: ex ? 'critical' : 'info',
            status: ex ? 'fail' : unk ? 'unknown' : 'pass',
            affected: aff,
            rackId: pdu.rackId,
            scenario: sp.def,
            level,
            observed: `${fmtW(pr.w)} / ${fmtNum(pr.va, 0)} VA`,
            threshold: [pdu.usableKw !== null ? `${pdu.usableKw} kW` : null, pdu.usableKva !== null ? `${pdu.usableKva} kVA` : null].filter(Boolean).join(' / '),
            msg: m(ex ? 'f.CAP-PDU-KW.fail' : 'f.CAP-PDU-KW.ok'),
            rec: ex ? m('r.CAP-PDU.reduce') : null,
            evidence: pdu.provenance === 'verified' ? 'manufacturer' : 'assumption',
            hard: ex,
            failoverOnly: ex && !isNormal,
          });
        }
        // Phase imbalance (site policy, normal only)
        if (pr.phaseCurrents && isNormal) {
          const imb = phaseImbalance([pr.phaseCurrents.L1, pr.phaseCurrents.L2, pr.phaseCurrents.L3], policy.phaseImbalanceDefinition);
          if (imb !== null) {
            const bad = imb > policy.phaseImbalanceFraction;
            c.add({
              ruleId: 'CAP-IMB',
              ruleType: 'site_policy',
              severity: bad ? 'medium' : 'info',
              status: bad ? 'warning' : 'pass',
              affected: aff,
              rackId: pdu.rackId,
              scenario: sp.def,
              level,
              observed: fmtPct(imb, 1),
              threshold: `${fmtPct(policy.phaseImbalanceFraction)} (${policy.phaseImbalanceDefinition})`,
              calc: policy.phaseImbalanceDefinition === 'max_dev_from_mean' ? 'max|Iₚ − Ī| / Ī' : '(Imax − Imin) / Imax',
              msg: m(bad ? 'f.CAP-IMB.warn' : 'f.CAP-IMB.ok'),
              rec: bad ? m('r.CAP-IMB') : null,
              evidence: 'calculated',
            });
          }
        }
        // Banks (breaker limits)
        for (const br of pr.banks) {
          if (br.limits.hardA === null || br.w === 0) continue;
          const st = limitStatusToCheck(br.status);
          if (st === 'pass' && !isNormal) continue;
          c.add({
            ruleId: 'CAP-BANK',
            ruleType: 'manufacturer',
            severity: br.status === 'hard_exceeded' ? 'critical' : st === 'fail' ? 'high' : 'info',
            status: st,
            affected: { kind: 'bank', id: br.bankId, label: `${pdu.name} / ${pdu.banks.find((b) => b.id === br.bankId)?.name}` },
            rackId: pdu.rackId,
            scenario: sp.def,
            level,
            observed: fmtA(br.currentA),
            threshold: `${fmtA(br.limits.planningA)} / ${fmtA(br.limits.hardA)}`,
            msg: m(st === 'fail' ? 'f.CAP-BANK.fail' : 'f.CAP-BANK.ok'),
            rec: st === 'fail' ? m('r.CAP-BANK') : null,
            evidence: 'calculated',
            hard: br.status === 'hard_exceeded',
            failoverOnly: st === 'fail' && !isNormal,
          });
        }
        // Outlets
        for (const bank of pdu.banks)
          for (const o of bank.outlets) {
            const orr = r.outlets[o.id];
            if (orr.psuIds.length === 0) continue;
            if (o.ratedA === null) {
              if (isNormal && level === 'design')
                c.add({
                  ruleId: 'CAP-OUTLET',
                  ruleType: 'manufacturer',
                  severity: 'low',
                  status: 'unknown',
                  affected: { kind: 'outlet', id: o.id, label: `${pdu.name} #${o.index} (${o.type})` },
                  rackId: pdu.rackId,
                  scenario: sp.def,
                  level,
                  observed: fmtA(orr.currentA),
                  msg: m('f.CAP-OUTLET.unknown'),
                  rec: m('r.CAP-OUTLET.unknown'),
                  evidence: 'missing',
                });
              continue;
            }
            if (orr.currentA > o.ratedA)
              c.add({
                ruleId: 'CAP-OUTLET',
                ruleType: 'manufacturer',
                severity: 'critical',
                status: 'fail',
                affected: { kind: 'outlet', id: o.id, label: `${pdu.name} #${o.index} (${o.type})` },
                rackId: pdu.rackId,
                scenario: sp.def,
                level,
                observed: fmtA(orr.currentA),
                threshold: fmtA(o.ratedA),
                msg: m('f.CAP-OUTLET.fail'),
                rec: m('r.CAP-OUTLET.fail'),
                evidence: 'calculated',
                hard: true,
                failoverOnly: !isNormal,
              });
          }
      }

      // Branch circuits
      for (const b of project.branches) {
        const br = r.branches[b.id];
        if (!br.powered || br.w === 0) continue;
        const st = br.limits.hardA === null ? 'unknown' : limitStatusToCheck(br.status);
        if (st === 'pass' && !isNormal) continue;
        c.add({
          ruleId: 'CAP-BRANCH',
          ruleType: br.limits.hardBasis === 'usable_published' ? 'manufacturer' : 'physical',
          severity: br.status === 'hard_exceeded' ? 'critical' : st === 'fail' ? 'high' : st === 'unknown' ? 'medium' : 'info',
          status: st,
          affected: { kind: 'branch', id: b.id, label: b.name },
          rackId: null,
          scenario: sp.def,
          level,
          observed: fmtA(br.currentA),
          threshold: br.limits.hardA === null ? null : `${fmtA(br.limits.planningA)} / ${fmtA(br.limits.hardA)}`,
          msg: m(st === 'fail' ? (br.status === 'hard_exceeded' ? 'f.CAP-BRANCH.hard' : 'f.CAP-BRANCH.plan') : st === 'unknown' ? 'f.CAP-BRANCH.unknown' : st === 'warning' ? 'f.CAP-BRANCH.alert' : 'f.CAP-BRANCH.ok'),
          rec: st === 'fail' ? m('r.CAP-BRANCH') : st === 'unknown' ? m('r.CAP-BRANCH.unknown') : null,
          evidence: 'calculated',
          hard: br.status === 'hard_exceeded',
          failoverOnly: st === 'fail' && !isNormal,
          excessA: br.status === 'hard_exceeded' || br.status === 'planning_exceeded' ? (br.currentA ?? 0) - (br.status === 'hard_exceeded' ? br.limits.hardA! : br.limits.planningA!) : undefined,
        });
      }

      // UPS kW and kVA independently
      for (const u of project.upses) {
        const ur = r.upses[u.id];
        if (!ur.powered || ur.w === 0) continue;
        const checks: { id: 'UPS-KW' | 'UPS-KVA'; util: number | null; rated: number | null; val: number }[] = [
          { id: 'UPS-KW', util: ur.kwUtil, rated: u.ratedKw, val: ur.totalW ?? ur.w },
          { id: 'UPS-KVA', util: ur.kvaUtil, rated: u.ratedKva, val: ur.totalVa ?? ur.va },
        ];
        for (const ch of checks) {
          if (ch.rated === null) {
            if (isNormal && level === 'design')
              c.add({
                ruleId: ch.id,
                ruleType: 'manufacturer',
                severity: 'medium',
                status: 'unknown',
                affected: { kind: 'ups', id: u.id, label: u.name },
                rackId: null,
                scenario: sp.def,
                level,
                msg: m('f.UPS.rating_unknown'),
                rec: m('r.UPS.rating_unknown'),
                evidence: 'missing',
                essential: true,
              });
            continue;
          }
          const ex = (ch.util ?? 0) > 1;
          const st: CheckStatus = ex ? 'fail' : !ur.complete ? 'unknown' : (ch.util ?? 0) >= policy.alertFraction ? 'warning' : 'pass';
          // Failure scenarios only report UPS problems; incompleteness is reported once (normal).
          if (!isNormal && st !== 'fail' && st !== 'warning') continue;
          c.add({
            ruleId: ch.id,
            ruleType: 'manufacturer',
            severity: ex ? 'critical' : st === 'unknown' ? 'medium' : st === 'warning' ? 'low' : 'info',
            status: st,
            affected: { kind: 'ups', id: u.id, label: u.name },
            rackId: null,
            scenario: sp.def,
            level,
            observed: `${fmtNum(ch.val / 1000, 2)} ${ch.id === 'UPS-KW' ? 'kW' : 'kVA'} (${fmtPct(ch.util)})`,
            threshold: `${ch.rated} ${ch.id === 'UPS-KW' ? 'kW' : 'kVA'}`,
            calc: ch.id === 'UPS-KVA' ? 'Σ device VA = Σ P/PF (conservative sizing estimate)' : 'Σ P (downstream)',
            msg: m(ex ? 'f.UPS.fail' : st === 'unknown' ? 'f.UPS.contribution_only' : st === 'warning' ? 'f.UPS.alert' : 'f.UPS.ok', { kind: ch.id === 'UPS-KW' ? 'kW' : 'kVA' }),
            rec: ex ? m('r.UPS.fail') : st === 'unknown' ? m('r.UPS.incomplete') : null,
            evidence: 'calculated',
            essential: st === 'unknown' && level === 'design',
            hard: ex,
            failoverOnly: ex && !isNormal,
          });
        }
      }

      // Device outcomes in failure scenarios
      if (!isNormal && level === 'design') {
        for (const d of project.devices) {
          if (!isActive(d)) continue;
          const dr = r.devices[d.id];
          const map: Partial<Record<typeof dr.status, { status: CheckStatus; sev: Severity; key: string }>> = {
            unpowered: { status: d.critical ? 'fail' : 'warning', sev: d.critical ? 'high' : 'medium', key: 'f.FAIL.unpowered' },
            partially_unpowered: { status: 'fail', sev: 'high', key: 'f.FAIL.partial' },
            shutdown_risk: { status: 'fail', sev: 'high', key: 'f.FAIL.shutdown' },
            over_capacity: { status: 'fail', sev: 'high', key: 'f.FAIL.over_capacity' },
            possible_throttling: { status: 'warning', sev: 'medium', key: 'f.FAIL.throttling' },
            unknown_behavior: { status: 'unknown', sev: 'medium', key: 'f.FAIL.unknown' },
          };
          const hit = map[dr.status];
          if (!hit) continue;
          const dom = dr.domains.find((x) => x.capacity === 'exceeded');
          c.add({
            ruleId: 'FAIL-DEV',
            ruleType: 'manufacturer',
            severity: hit.sev,
            status: hit.status,
            affected: devAff(d),
            rackId: d.rackId,
            scenario: sp.def,
            level,
            observed: dom ? `${fmtW(dom.dcDemandW, 1)} DC` : null,
            threshold: dom ? `${fmtW(dom.availableDcW)} DC` : null,
            msg: m(hit.key),
            rec: m(`r.${hit.key.slice(2)}`),
            evidence: 'calculated',
            failoverOnly: hit.status === 'fail',
            essential: hit.status === 'unknown',
          });
        }
      }
    }
  }

  // ---------------------------------------------------------------- Connectors / outlets
  for (const rackPdu of project.pdus) {
    const nr = normal.design.pdus[rackPdu.id];
    c.add({
      ruleId: 'CONN-SOCKETS',
      ruleType: 'physical',
      severity: nr.outletsUsed > nr.outletsTotal ? 'high' : 'info',
      status: nr.outletsUsed > nr.outletsTotal ? 'fail' : 'pass',
      affected: pduAff(rackPdu),
      rackId: rackPdu.rackId,
      observed: `${nr.outletsUsed}/${nr.outletsTotal}`,
      msg: m('f.CONN-SOCKETS', { used: nr.outletsUsed, total: nr.outletsTotal }),
      evidence: 'calculated',
    });
  }
  for (const oid of normal.design.duplicateOutletIds) {
    const ref = outletIdx.get(oid)!;
    c.add({
      ruleId: 'CONN-DUP',
      ruleType: 'physical',
      severity: 'high',
      status: 'fail',
      affected: { kind: 'outlet', id: oid, label: `${ref.pdu.name} #${ref.outlet.index}` },
      rackId: ref.pdu.rackId,
      msg: m('f.CONN-DUP', { count: normal.design.outlets[oid].psuIds.length }),
      rec: m('r.CONN-DUP'),
      evidence: 'topology',
    });
  }
  for (const d of project.devices) {
    for (const p of installedPsus(d)) {
      const pr = normal.design.psus[p.id];
      if (pr?.invalidConnection) {
        c.add({
          ruleId: 'CONN-DC',
          ruleType: 'physical',
          severity: 'critical',
          status: 'fail',
          affected: { kind: 'psu', id: p.id, label: `${d.name} ${p.label}` },
          rackId: d.rackId,
          msg: m(`f.CONN-DC.${pr.invalidConnection}`),
          rec: m('r.CONN-DC'),
          evidence: 'topology',
          hard: true,
        });
        continue;
      }
      if (!p.connection.outletId || p.inputType !== 'AC') continue;
      const ref = outletIdx.get(p.connection.outletId);
      if (!ref) continue;
      const mate = CONNECTOR_MATES[ref.outlet.type];
      let status: CheckStatus;
      let key: string;
      if (p.inlet === 'unknown' || !mate) {
        status = 'unknown';
        key = 'f.CONN-TYPE.unknown';
      } else if (mate === p.inlet) {
        status = 'pass';
        key = 'f.CONN-TYPE.ok';
      } else {
        status = 'warning';
        key = 'f.CONN-TYPE.mismatch';
      }
      c.add({
        ruleId: 'CONN-TYPE',
        ruleType: 'manufacturer',
        severity: status === 'warning' ? 'medium' : 'info',
        status,
        affected: { kind: 'psu', id: p.id, label: `${d.name} ${p.label}` },
        rackId: d.rackId,
        observed: `${ref.outlet.type} → ${p.inlet}`,
        threshold: mate ? `${ref.outlet.type} → ${mate}` : null,
        msg: m(key, { outlet: ref.outlet.type, inlet: p.inlet, mate: mate ?? '?' }),
        rec: status === 'pass' ? null : m('r.CONN-TYPE'),
        evidence: p.inlet === 'unknown' ? 'missing' : 'manual',
      });
    }
  }

  // ---------------------------------------------------------------- UPS completeness and runtime
  for (const u of project.upses) {
    if (!u.otherLoadsKnown)
      c.add({
        ruleId: 'UPS-SHARED',
        ruleType: 'data',
        severity: 'medium',
        status: 'unknown',
        affected: { kind: 'ups', id: u.id, label: u.name },
        rackId: null,
        msg: m('f.UPS-SHARED'),
        rec: m('r.UPS.incomplete'),
        evidence: 'missing',
      });
    c.add({
      ruleId: 'UPS-RUNTIME',
      ruleType: 'manufacturer',
      severity: 'low',
      status: u.runtime ? 'pass' : 'unknown',
      affected: { kind: 'ups', id: u.id, label: u.name },
      rackId: null,
      observed: u.runtime ? `${u.runtime.minutes} min @ ${fmtW(u.runtime.atLoadW)}` : null,
      msg: m(u.runtime ? 'f.UPS-RUNTIME.ok' : 'f.UPS-RUNTIME.unknown', { evidence: u.runtime?.evidence ?? '' }),
      rec: u.runtime ? null : m('r.UPS-RUNTIME'),
      evidence: u.runtime ? 'manufacturer' : 'missing',
      source: u.runtime?.evidence ?? null,
    });
    if (u.redundancy === 'unknown')
      c.add({
        ruleId: 'UPS-REDUNDANCY',
        ruleType: 'data',
        severity: 'low',
        status: 'unknown',
        affected: { kind: 'ups', id: u.id, label: u.name },
        rackId: null,
        msg: m('f.UPS-REDUNDANCY'),
        evidence: 'missing',
      });
  }
  for (const b of project.branches)
    if (!b.upsId && !b.sourceId)
      c.add({
        ruleId: 'TOPO-001',
        ruleType: 'data',
        severity: 'medium',
        status: 'unknown',
        affected: { kind: 'branch', id: b.id, label: b.name },
        rackId: null,
        msg: m('f.TOPO-001.branch'),
        rec: m('r.FEED-003'),
        evidence: 'missing',
      });
  for (const p of project.pdus)
    if (!p.upstream)
      c.add({
        ruleId: 'TOPO-001',
        ruleType: 'data',
        severity: 'medium',
        status: 'unknown',
        affected: pduAff(p),
        rackId: p.rackId,
        msg: m('f.TOPO-001.pdu'),
        rec: m('r.FEED-003'),
        evidence: 'missing',
        essential: true,
      });
  for (const a of project.atses)
    c.add({
      ruleId: 'ATS-001',
      ruleType: 'physical',
      severity: a.validated ? 'info' : 'medium',
      status: a.validated && a.primaryBranchId && a.secondaryBranchId ? 'pass' : a.primaryBranchId && a.secondaryBranchId ? 'warning' : 'unknown',
      affected: { kind: 'ats', id: a.id, label: a.name },
      rackId: null,
      msg: m(a.primaryBranchId && a.secondaryBranchId ? (a.validated ? 'f.ATS-001.ok' : 'f.ATS-001.unvalidated') : 'f.ATS-001.inputs'),
      rec: a.validated ? null : m('r.ATS-001'),
      evidence: a.validated ? 'manual' : 'missing',
    });

  // ---------------------------------------------------------------- Rack budget / weight / depth / cooling
  for (const rack of project.racks) {
    const rt = normal.design.racks[rack.id];
    const rackAff = { kind: 'rack' as const, id: rack.id, label: rack.name };
    const designWithReserve = withGrowthReserve(rt.knownW, policy.growthReserveFraction) ?? rt.knownW;
    if (rack.powerBudgetW === null) {
      c.add({
        ruleId: 'RACK-BUDGET',
        ruleType: 'site_policy',
        severity: 'low',
        status: 'unknown',
        affected: rackAff,
        rackId: rack.id,
        msg: m('f.RACK-BUDGET.unknown'),
        rec: m('r.RACK-BUDGET.unknown'),
        evidence: 'missing',
      });
    } else {
      const ex = designWithReserve > rack.powerBudgetW;
      const st: CheckStatus = ex ? 'fail' : rt.unknownCount > 0 ? 'unknown' : !rack.powerBudgetConfirmed ? 'warning' : 'pass';
      c.add({
        ruleId: 'RACK-BUDGET',
        ruleType: 'site_policy',
        severity: ex ? 'high' : st === 'warning' ? 'low' : 'info',
        status: st,
        affected: rackAff,
        rackId: rack.id,
        level: 'design',
        observed: fmtW(designWithReserve),
        threshold: fmtW(rack.powerBudgetW),
        calc: policy.growthReserveFraction > 0 ? `${fmtW(rt.knownW)} × (1 + ${policy.growthReserveFraction}) = ${fmtW(designWithReserve)}` : null,
        msg: m(ex ? 'f.RACK-BUDGET.fail' : st === 'warning' ? 'f.RACK-BUDGET.unconfirmed' : st === 'unknown' ? 'f.RACK-BUDGET.partial' : 'f.RACK-BUDGET.ok', { unknown: rt.unknownCount }),
        rec: ex ? m('r.RACK-BUDGET.fail') : st === 'warning' ? m('r.RACK-BUDGET.confirm') : null,
        evidence: 'calculated',
      });
    }

    // Weight
    const rackDevs = project.devices.filter((d) => d.rackId === rack.id && isRackLocal(d));
    const weightOf = (d: DeviceInstance) => (d.placement.kind === 'shelf' ? d.placement.confirmedWeightKg : d.weightKg);
    const unknownWeight = rackDevs.filter((d) => d.category !== 'passive' && weightOf(d) === null);
    const knownWeight = rackDevs.reduce((s, d) => s + (weightOf(d) ?? 0), 0);
    if (rack.ratedWeightKg === null || unknownWeight.length) {
      const ex = rack.ratedWeightKg !== null && knownWeight > rack.ratedWeightKg;
      c.add({
        ruleId: 'RACK-WEIGHT',
        ruleType: 'manufacturer',
        severity: ex ? 'high' : 'low',
        status: ex ? 'fail' : 'unknown',
        affected: rackAff,
        rackId: rack.id,
        observed: `${fmtNum(knownWeight, 1)} kg (+${unknownWeight.length} unknown)`,
        threshold: rack.ratedWeightKg === null ? null : `${rack.ratedWeightKg} kg`,
        msg: m(ex ? 'f.RACK-WEIGHT.fail' : 'f.RACK-WEIGHT.unknown', { count: unknownWeight.length }),
        rec: m('r.RACK-WEIGHT.unknown'),
        evidence: 'missing',
      });
    } else {
      const ex = knownWeight > rack.ratedWeightKg;
      c.add({
        ruleId: 'RACK-WEIGHT',
        ruleType: 'manufacturer',
        severity: ex ? 'high' : 'info',
        status: ex ? 'fail' : 'pass',
        affected: rackAff,
        rackId: rack.id,
        observed: `${fmtNum(knownWeight, 1)} kg`,
        threshold: `${rack.ratedWeightKg} kg`,
        msg: m(ex ? 'f.RACK-WEIGHT.fail' : 'f.RACK-WEIGHT.ok'),
        rec: ex ? m('r.RACK-WEIGHT.fail') : null,
        evidence: 'manufacturer',
      });
    }
    // Depth
    for (const d of rackDevs.filter((x) => x.category !== 'passive')) {
      const depth = d.placement.kind === 'shelf' ? d.placement.confirmedDepthMm : d.depthMm;
      if (depth === null || rack.usableDepthMm === null) continue;
      if (depth > rack.usableDepthMm)
        c.add({
          ruleId: 'RACK-DEPTH',
          ruleType: 'manufacturer',
          severity: 'high',
          status: 'fail',
          affected: devAff(d),
          rackId: rack.id,
          observed: `${depth} mm`,
          threshold: `${rack.usableDepthMm} mm`,
          msg: m('f.RACK-DEPTH.fail'),
          rec: m('r.RACK-DEPTH'),
          evidence: 'manufacturer',
        });
    }
    const depthUnknown = rackDevs.filter((x) => x.category !== 'passive' && (x.placement.kind === 'shelf' ? x.placement.confirmedDepthMm : x.depthMm) === null);
    if (rack.usableDepthMm === null || depthUnknown.length)
      c.add({
        ruleId: 'RACK-DEPTH',
        ruleType: 'manufacturer',
        severity: 'low',
        status: 'unknown',
        affected: rackAff,
        rackId: rack.id,
        msg: m('f.RACK-DEPTH.unknown', { count: depthUnknown.length }),
        rec: m('r.RACK-WEIGHT.unknown'),
        evidence: 'missing',
      });
    // Towers on shelves
    for (const d of project.devices.filter((x) => x.rackId === rack.id && x.placement.kind === 'shelf')) {
      const pl = d.placement as Extract<DeviceInstance['placement'], { kind: 'shelf' }>;
      const shelf = project.devices.find((x) => x.id === pl.shelfId);
      const confirmed = pl.confirmedHeightU !== null && pl.confirmedDepthMm !== null && pl.confirmedWeightKg !== null;
      const shelfCap = shelf?.shelfCapacityKg ?? null;
      const over = confirmed && shelfCap !== null && pl.confirmedWeightKg! > shelfCap;
      const shelfFree = shelf && shelf.placement.kind === 'rack' ? shelf.placement.startU + shelf.placement.heightU : null;
      const fitsAbove =
        confirmed && shelfFree !== null
          ? occupiedRanges(rack.id, project.devices, project.pdus).every((r) => r.id === shelf!.id || r.id === d.id || r.end < shelfFree || r.start > shelfFree + pl.confirmedHeightU! - 1) && shelfFree + pl.confirmedHeightU! - 1 <= rack.heightU
          : null;
      const status: CheckStatus = !shelf ? 'fail' : !confirmed || shelfCap === null ? 'unknown' : over || fitsAbove === false ? 'fail' : 'pass';
      c.add({
        ruleId: 'RACK-SHELF',
        ruleType: 'physical',
        severity: status === 'fail' ? 'high' : status === 'unknown' ? 'medium' : 'info',
        status,
        affected: devAff(d),
        rackId: rack.id,
        observed: confirmed ? `${pl.confirmedHeightU}U / ${pl.confirmedDepthMm} mm / ${pl.confirmedWeightKg} kg` : null,
        threshold: shelfCap !== null ? `${shelfCap} kg` : null,
        msg: m(!shelf ? 'f.RACK-SHELF.missing' : !confirmed ? 'f.RACK-SHELF.unconfirmed' : over ? 'f.RACK-SHELF.over' : fitsAbove === false ? 'f.RACK-SHELF.space' : shelfCap === null ? 'f.RACK-SHELF.cap_unknown' : 'f.RACK-SHELF.ok'),
        rec: status === 'pass' ? null : m('r.RACK-SHELF'),
        evidence: confirmed ? 'manual' : 'missing',
      });
    }

    // Cooling
    if (rack.coolingCapacityW === null) {
      c.add({
        ruleId: 'COOL-001',
        ruleType: 'site_policy',
        severity: 'low',
        status: 'unknown',
        affected: rackAff,
        rackId: rack.id,
        msg: m('f.COOL-001.unknown'),
        rec: m('r.COOL-001.unknown'),
        evidence: 'missing',
      });
    } else if (rt.airHeatW === null) {
      c.add({
        ruleId: 'COOL-001',
        ruleType: 'site_policy',
        severity: 'medium',
        status: 'unknown',
        affected: rackAff,
        rackId: rack.id,
        msg: m('f.COOL-001.liquid_unknown'),
        rec: m('r.COOL-001.liquid'),
        evidence: 'missing',
      });
    } else {
      const heat = rt.airHeatW;
      const ex = heat > rack.coolingCapacityW;
      const st: CheckStatus = ex ? 'fail' : rt.unknownCount > 0 ? 'unknown' : heat >= policy.alertFraction * rack.coolingCapacityW ? 'warning' : 'pass';
      c.add({
        ruleId: 'COOL-001',
        ruleType: 'site_policy',
        severity: ex ? 'high' : st === 'warning' ? 'low' : 'info',
        status: st,
        affected: rackAff,
        rackId: rack.id,
        level: 'design',
        observed: `${fmtW(heat)} (${fmtNum(heat * 3.412142, 0)} BTU/h)`,
        threshold: fmtW(rack.coolingCapacityW),
        calc: `Q = ${fmtW(heat)} × 3.412142 = ${fmtNum(heat * 3.412142, 0)} BTU/h` + (rt.poeOutsideW ? `; excl. PoE to outside endpoints ${fmtW(rt.poeOutsideW)}` : ''),
        msg: m(ex ? 'f.COOL-001.fail' : st === 'unknown' ? 'f.COOL-001.partial' : st === 'warning' ? 'f.COOL-001.alert' : 'f.COOL-001.ok', { unknown: rt.unknownCount }),
        rec: ex ? m('r.COOL-001.fail') : null,
        evidence: 'calculated',
      });
    }
    if (rt.liquidHeatW > 0 && rack.liquidCoolingCapacityW !== null) {
      const ex = rt.liquidHeatW > rack.liquidCoolingCapacityW;
      c.add({
        ruleId: 'COOL-002',
        ruleType: 'site_policy',
        severity: ex ? 'high' : 'info',
        status: ex ? 'fail' : 'pass',
        affected: rackAff,
        rackId: rack.id,
        observed: fmtW(rt.liquidHeatW),
        threshold: fmtW(rack.liquidCoolingCapacityW),
        msg: m(ex ? 'f.COOL-002.fail' : 'f.COOL-002.ok'),
        evidence: 'calculated',
      });
    }

    // Airflow mismatch
    const flows = new Set(rackDevs.filter((d) => d.category !== 'passive' && d.airflow !== 'unknown').map((d) => d.airflow));
    const unknownFlow = rackDevs.filter((d) => d.category !== 'passive' && d.airflow === 'unknown').length;
    c.add({
      ruleId: 'AIR-001',
      ruleType: 'physical',
      severity: flows.size > 1 ? 'medium' : 'info',
      status: flows.size > 1 ? 'warning' : unknownFlow ? 'unknown' : 'pass',
      affected: rackAff,
      rackId: rack.id,
      observed: Array.from(flows).join(', ') || null,
      msg: m(flows.size > 1 ? 'f.AIR-001.mismatch' : unknownFlow ? 'f.AIR-001.unknown' : 'f.AIR-001.ok', { count: unknownFlow }),
      rec: flows.size > 1 ? m('r.AIR-001') : null,
      evidence: unknownFlow ? 'missing' : 'manual',
    });
    // Blanking gaps
    const gaps = freeBlocks(rack, occupiedRanges(rack.id, project.devices, project.pdus));
    const freeU = gaps.reduce((s, g) => s + g.size, 0);
    c.add({
      ruleId: 'AIR-002',
      ruleType: 'physical',
      severity: freeU > 0 ? 'low' : 'info',
      status: freeU > 0 ? 'warning' : 'pass',
      affected: rackAff,
      rackId: rack.id,
      observed: `${freeU} U`,
      msg: m(freeU > 0 ? 'f.AIR-002.gaps' : 'f.AIR-002.ok', { free: freeU, blocks: gaps.length }),
      rec: freeU > 0 ? m('r.AIR-002') : null,
      evidence: 'calculated',
    });

    // Environment: inlet temperatures (guidance)
    if (rack.inletReadings.length === 0) {
      c.add({
        ruleId: 'ENV-INLET',
        ruleType: 'guidance',
        severity: 'low',
        status: 'unknown',
        affected: rackAff,
        rackId: rack.id,
        msg: m('f.ENV-INLET.missing'),
        rec: m('r.ENV-INLET.missing'),
        evidence: 'missing',
        source: 'ASHRAE TC 9.9 (recommended envelope, class-dependent)',
      });
    } else {
      for (const rd of rack.inletReadings) {
        const outRec = rd.tempC < policy.inletRecommendedMinC || rd.tempC > policy.inletRecommendedMaxC;
        const overHard =
          (policy.inletAllowableMaxC !== null && rd.tempC > policy.inletAllowableMaxC) ||
          (policy.inletAllowableMinC !== null && rd.tempC < policy.inletAllowableMinC);
        const status: CheckStatus = overHard ? 'fail' : outRec ? 'warning' : policy.inletEnvelopeVerified ? 'pass' : 'unknown';
        c.add({
          ruleId: 'ENV-INLET',
          ruleType: 'guidance',
          severity: overHard ? 'high' : outRec ? 'medium' : 'info',
          status,
          affected: { kind: 'rack', id: `${rack.id}:${rd.id}`, label: `${rack.name} (${rd.position})` },
          rackId: rack.id,
          observed: `${rd.tempC} °C @ ${rd.timestamp.replace('T', ' ').slice(0, 16)}`,
          threshold: `${policy.inletRecommendedMinC}–${policy.inletRecommendedMaxC} °C` + (policy.inletAllowableMaxC !== null ? `; allowable ≤ ${policy.inletAllowableMaxC} °C` : ''),
          msg: m(overHard ? 'f.ENV-INLET.fail' : outRec ? 'f.ENV-INLET.warn' : policy.inletEnvelopeVerified ? 'f.ENV-INLET.ok' : 'f.ENV-INLET.unverified'),
          rec: outRec || overHard ? m('r.ENV-INLET.out') : policy.inletEnvelopeVerified ? null : m('r.ENV-INLET.verify'),
          evidence: 'measured',
          source: overHard ? policy.inletAllowableSource || null : 'ASHRAE TC 9.9 recommended envelope (applicability must be verified)',
        });
      }
    }

    // Manual checklist
    for (const key of CHECKLIST_KEYS) {
      const mc = project.manualChecks.find((x) => x.rackId === rack.id && x.key === key);
      const status = mc?.status ?? 'unknown';
      c.add({
        ruleId: `MAN-${key}`,
        ruleType: 'manual',
        severity: status === 'fail' ? 'medium' : 'low',
        status,
        affected: rackAff,
        rackId: rack.id,
        msg: m(`chk.${key}`),
        rec: mc?.action ? m('raw', { text: mc.action }) : status === 'unknown' ? m('r.MAN') : null,
        evidence: mc?.evidenceIds.length ? 'manual' : 'missing',
        observed: mc?.comment || null,
      });
    }
  }

  // ---------------------------------------------------------------- PoE and DC
  for (const d of project.devices) {
    if (d.category !== 'poe_switch' || !d.poe) continue;
    const del = d.poe.deliveredDesignW;
    const st: CheckStatus = d.poe.budgetW === null || del === null ? 'unknown' : del > d.poe.budgetW ? 'fail' : 'pass';
    c.add({
      ruleId: 'POE-001',
      ruleType: 'manufacturer',
      severity: st === 'fail' ? 'high' : 'low',
      status: st,
      affected: devAff(d),
      rackId: d.rackId,
      observed: fmtW(del),
      threshold: fmtW(d.poe.budgetW),
      msg: m(st === 'fail' ? 'f.POE-001.fail' : st === 'unknown' ? 'f.POE-001.unknown' : 'f.POE-001.ok'),
      evidence: st === 'unknown' ? 'missing' : 'estimated',
    });
    if (d.poe.efficiency === null)
      c.add({
        ruleId: 'POE-002',
        ruleType: 'data',
        severity: 'low',
        status: 'warning',
        affected: devAff(d),
        rackId: d.rackId,
        msg: m('f.POE-002', { eta: fmtPct(project.assumptions.poeEfficiency) }),
        evidence: 'assumption',
      });
  }
  for (const bus of project.dcBuses) {
    const br = normal.design.dcBuses[bus.id];
    const st: CheckStatus = bus.capacityA === null ? 'unknown' : br.currentA > bus.capacityA ? 'fail' : br.unknownCount ? 'unknown' : 'pass';
    c.add({
      ruleId: 'DC-001',
      ruleType: 'manufacturer',
      severity: st === 'fail' ? 'critical' : 'low',
      status: st,
      affected: { kind: 'dcbus', id: bus.id, label: bus.name },
      rackId: null,
      observed: fmtA(br.currentA),
      threshold: fmtA(bus.capacityA),
      calc: `I = P / |V| = ${fmtW(br.w)} / ${Math.abs(bus.voltage)} V = ${fmtA(br.currentA)}`,
      msg: m(st === 'fail' ? 'f.DC-001.fail' : st === 'unknown' ? 'f.DC-001.unknown' : 'f.DC-001.ok'),
      evidence: 'calculated',
      hard: st === 'fail',
    });
  }

  return c.findings;
}
