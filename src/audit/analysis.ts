import type { CheckStatus, ID, Project } from '../domain/types';
import type { Conclusion, Coverage, Finding, Headroom, Msg } from './types';
import { evaluateRules } from './rules';
import { computeAllScenarios, type ScenarioDef, type ScenarioPair } from '../engine/scenario';
import { freeBlocks, occupiedRanges } from '../engine/placement';
import { withGrowthReserve } from '../engine/electrical';

export interface Analysis {
  scenarios: ScenarioPair[];
  findings: Finding[];
  byRack: Record<ID, RackAnalysis>;
}

export interface RackAnalysis {
  findings: Finding[];
  conclusion: Conclusion;
  coverage: Coverage;
  headroom: Headroom;
}

/** Findings relevant to a rack: rack-scoped + upstream elements feeding its PDUs. */
export function findingsForRack(findings: Finding[], project: Project, rackId: ID): Finding[] {
  const pdus = project.pdus.filter((p) => p.rackId === rackId);
  const branchIds = new Set<ID>();
  for (const p of pdus) {
    if (p.upstream?.kind === 'branch') branchIds.add(p.upstream.id);
    if (p.upstream?.kind === 'ats') {
      const a = project.atses.find((x) => x.id === p.upstream!.id);
      if (a?.primaryBranchId) branchIds.add(a.primaryBranchId);
      if (a?.secondaryBranchId) branchIds.add(a.secondaryBranchId);
    }
  }
  const upsIds = new Set(project.branches.filter((b) => branchIds.has(b.id) && b.upsId).map((b) => b.upsId!));
  const atsIds = new Set(pdus.filter((p) => p.upstream?.kind === 'ats').map((p) => p.upstream!.id));
  return findings.filter((f) => {
    if (f.rackId === rackId) return true;
    if (f.rackId !== null) return false;
    if (f.affected.kind === 'branch') return branchIds.has(f.affected.id);
    if (f.affected.kind === 'ups') return upsIds.has(f.affected.id);
    if (f.affected.kind === 'ats') return atsIds.has(f.affected.id);
    return f.affected.kind === 'dcbus' || f.affected.kind === 'project';
  });
}

export function computeConclusion(findings: Finding[]): Conclusion {
  const fails = findings.filter((f) => f.status === 'fail');
  const hardNormal = fails.filter((f) => f.hard && !f.failoverOnly);
  const failover = fails.filter((f) => f.failoverOnly);
  const normalIssues = fails.filter((f) => !f.failoverOnly && !f.hard);
  const essentialUnknowns = findings.filter((f) => f.status === 'unknown' && f.essential);
  const limitedChecks = findings.filter((f) => f.status === 'unknown' && !f.essential);
  const rank = (a: Finding, b: Finding) => (b.excessA ?? 0) - (a.excessA ?? 0);
  let verdict: Conclusion['verdict'];
  if (hardNormal.length) verdict = 'overloaded';
  else if (normalIssues.length) verdict = 'normal_planning_exceeded';
  else if (failover.length) verdict = 'normal_ok_failover_exceeds';
  else if (essentialUnknowns.length) verdict = 'insufficient';
  else verdict = 'ok';
  return {
    verdict,
    alsoIncomplete: verdict !== 'insufficient' && verdict !== 'ok' && essentialUnknowns.length > 0,
    hardFindings: hardNormal.sort(rank),
    failoverFindings: failover.sort(rank),
    planningFindings: normalIssues.sort(rank),
    essentialUnknowns,
    limitedChecks,
  };
}

export function computeCoverage(project: Project, normal: ScenarioPair, findings: Finding[], rackId: ID): Coverage {
  const cov: Coverage = {
    devices: { measured: 0, estimated: 0, manufacturer: 0, component: 0, proxy: 0, unknown: 0, passive: 0, total: 0 },
    designKnown: 0,
    checks: { pass: 0, warning: 0, fail: 0, unknown: 0, na: 0 },
  };
  for (const d of project.devices.filter((x) => x.rackId === rackId)) {
    cov.devices.total++;
    const l = normal.typical.devices[d.id].load;
    switch (l.basis) {
      case 'passive':
      case 'poe_endpoint':
        cov.devices.passive++;
        break;
      case 'measured':
        cov.devices.measured++;
        break;
      case 'estimated':
        cov.devices.estimated++;
        break;
      case 'manufacturer':
        cov.devices.manufacturer++;
        break;
      case 'component':
        cov.devices.component++;
        break;
      case 'psu_proxy':
        cov.devices.proxy++;
        break;
      default:
        cov.devices.unknown++;
    }
    if (normal.design.devices[d.id].load.inputW !== null) cov.designKnown++;
  }
  for (const f of findings) cov.checks[f.status as CheckStatus]++;
  return cov;
}

/**
 * Additional dual-corded AC load acceptable under the selected policy: minimum headroom across
 * normal and failure path constraints (PDU per feed, branch, UPS), rack budget and cooling.
 */
export function computeHeadroom(project: Project, scenarios: ScenarioPair[], rackId: ID): Headroom {
  const rack = project.racks.find((r) => r.id === rackId)!;
  const pf = project.assumptions.defaultPf;
  const rackPdus = project.pdus.filter((p) => p.rackId === rackId);
  const constraints: Headroom['constraints'] = [];
  let qualified = false;
  const feeds = Array.from(new Set(rackPdus.map((p) => p.feed)));

  for (const sp of scenarios) {
    if (sp.def.kind === 'loss_psu') continue;
    const r = sp.design;
    const poweredFeeds = feeds.filter((f) => rackPdus.some((p) => p.feed === f && r.pdus[p.id].powered));
    if (poweredFeeds.length === 0) continue;
    const share = 1 / poweredFeeds.length;
    for (const feed of poweredFeeds) {
      // Best PDU on this feed (user can choose where to connect)
      let best: number | null = null;
      let anyKnown = false;
      for (const p of rackPdus.filter((x) => x.feed === feed && r.pdus[x.id].powered)) {
        const pr = r.pdus[p.id];
        // Single-phase device on this PDU: 1ph supply voltage, or V_LN of a wye supply.
        const v = p.topology === '1ph' ? p.voltage : p.voltage ? p.voltage / Math.sqrt(3) : null;
        if (pr.limits.planningA === null || pr.governingA === null || v === null) {
          qualified = true;
          continue;
        }
        if (pr.unknownCount > 0) qualified = true;
        anyKnown = true;
        const w = ((pr.limits.planningA - pr.governingA) * v * pf) / share;
        best = best === null ? w : Math.max(best, w);
      }
      if (anyKnown) constraints.push({ label: { key: 'hr.pdu', params: { feed, scenario: sp.def.id } }, headroomW: best });
    }
    // Branches and UPS feeding this rack
    for (const b of project.branches) {
      const br = r.branches[b.id];
      if (!rackPdus.some((p) => p.upstream?.kind === 'branch' && p.upstream.id === b.id) || !br.powered) continue;
      if (br.limits.planningA === null || br.currentA === null || b.voltage === null) {
        qualified = true;
        continue;
      }
      const feedOfBranch = rackPdus.find((p) => p.upstream?.kind === 'branch' && p.upstream.id === b.id)!.feed;
      if (!poweredFeeds.includes(feedOfBranch)) continue;
      constraints.push({ label: { key: 'hr.branch', params: { name: b.name, scenario: sp.def.id } }, headroomW: ((br.limits.planningA - br.currentA) * b.voltage * pf) / share });
    }
    for (const u of project.upses) {
      const ur = r.upses[u.id];
      if (!ur.powered || ur.w === 0 || u.ratedKw === null) continue;
      if (!ur.complete) qualified = true;
      constraints.push({ label: { key: 'hr.ups', params: { name: u.name, scenario: sp.def.id } }, headroomW: (u.ratedKw * 1000 - (ur.totalW ?? ur.w)) / share });
    }
  }
  const normal = scenarios.find((s) => s.def.kind === 'normal')!;
  const rt = normal.design.racks[rackId];
  if (rt.unknownCount > 0) qualified = true;
  if (rack.powerBudgetW !== null) {
    const used = withGrowthReserve(rt.knownW, project.policy.growthReserveFraction) ?? rt.knownW;
    constraints.push({ label: { key: 'hr.budget', params: {} }, headroomW: (rack.powerBudgetW - used) / (1 + project.policy.growthReserveFraction) });
    if (!rack.powerBudgetConfirmed) qualified = true;
  } else qualified = true;
  if (rack.coolingCapacityW !== null && rt.airHeatW !== null) constraints.push({ label: { key: 'hr.cooling', params: {} }, headroomW: rack.coolingCapacityW - rt.airHeatW });

  const known = constraints.filter((c) => c.headroomW !== null) as { label: Msg; headroomW: number }[];
  const min = known.reduce<{ label: Msg; headroomW: number } | null>((m, c) => (m === null || c.headroomW < m.headroomW ? c : m), null);
  const freeSockets: Record<string, number> = {};
  for (const p of rackPdus) for (const [t, n] of Object.entries(normal.design.pdus[p.id].freeByType)) freeSockets[t] = (freeSockets[t] ?? 0) + n;
  const freeU = freeBlocks(rack, occupiedRanges(rackId, project.devices, project.pdus)).reduce((s, b) => s + b.size, 0);
  return {
    additionalW: min ? Math.max(0, min.headroomW) : null,
    limitingConstraint: min?.label ?? null,
    qualified,
    constraints,
    freeSockets,
    freeU,
  };
}

export function analyzeProject(project: Project, extra: ScenarioDef[] = [], now = new Date()): Analysis {
  const scenarios = computeAllScenarios(project, extra);
  const findings = evaluateRules({ project, scenarios, now });
  const normal = scenarios[0];
  const byRack: Record<ID, RackAnalysis> = {};
  for (const rack of project.racks) {
    const rf = findingsForRack(findings, project, rack.id);
    byRack[rack.id] = {
      findings: rf,
      conclusion: computeConclusion(rf),
      coverage: computeCoverage(project, normal, rf, rack.id),
      headroom: computeHeadroom(project, scenarios, rack.id),
    };
  }
  return { scenarios, findings, byRack };
}
