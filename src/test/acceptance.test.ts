import { describe, expect, test } from 'vitest';
import { buildDemoProject } from '../domain/demo';
import { analyzeProject } from '../audit/analysis';
import { computeScenario, computeScenarioPair, NO_FAILURES, standardScenarios } from '../engine/scenario';
import { resolveLoad, installedNameplateW } from '../engine/devicePower';
import { dcToAc, singlePhaseCurrent, threePhaseBalancedCurrent, unbalancedLineCurrents, apparentPower } from '../engine/electrical';
import { deriveLimits, classify } from '../engine/limits';
import { autoPlace, checkPlacement, checkResize, occupiedRanges, auditPlacements } from '../engine/placement';
import { defaultPolicy, emptyPower, newDevice, newPsu, uid } from '../domain/factory';
import { addDevice, baseProject } from './helpers';

const normalDef = { id: 'normal', kind: 'normal' as const, failures: NO_FAILURES };
const lossFeed = (feed: 'A' | 'B') => ({ id: `loss_feed_${feed}`, kind: 'loss_feed' as const, target: feed, failures: { ...NO_FAILURES, feeds: [feed] } });

describe('1. PSU nameplate is not consumption', () => {
  test('2 × 800 W with 500 W measured whole-device input = 500 W consumption, 1600 W nameplate', () => {
    const p = baseProject();
    const d = addDevice(p, { psus: 2, ratedDcW: 800 });
    d.power.measured = { totalW: 500, method: 'whole_device', window: 'instant', timestamp: new Date().toISOString(), source: 'iDRAC' };
    const load = resolveLoad(d, p.assumptions, 'typical');
    expect(load.inputW).toBe(500);
    expect(load.basis).toBe('measured');
    expect(installedNameplateW(d)).toBe(1600);
    const r = computeScenario(p, normalDef, 'typical');
    expect(r.devices[d.id].drawnW).toBe(500);
    // Whole-device reading is not multiplied by PSU count: each PSU carries a share.
    const psuSum = d.domains[0].psus.reduce((s, ps) => s + (r.psus[ps.id].inputW ?? 0), 0);
    expect(psuSum).toBeCloseTo(500, 9);
  });

  test('per-PSU readings are summed once', () => {
    const p = baseProject();
    const d = addDevice(p, { psus: 2 });
    d.domains[0].psus[0].measuredAcW = 240;
    d.domains[0].psus[1].measuredAcW = 260;
    expect(resolveLoad(d, p.assumptions, 'typical').inputW).toBe(500);
  });
});

describe('2. DC/AC conversion', () => {
  test('1000 W DC / 0.90 = 1111.11 W AC; measured AC stays', () => {
    expect(dcToAc(1000, 0.9)).toBeCloseTo(1111.111, 3);
    const p = baseProject();
    const d = addDevice(p, {});
    d.power.measured = { totalW: 1000, method: 'whole_device', window: '24h avg', timestamp: new Date().toISOString(), source: 'iLO' };
    expect(resolveLoad(d, p.assumptions, 'typical').inputW).toBe(1000);
    // Component estimate is converted once
    const c = addDevice(p, {});
    c.power.useComponentEstimate = true;
    c.power.component = { cpuCount: 2, cpuTdpW: 250, gpuCount: 0, gpuTdpW: 0, memoryW: 200, disksW: 200, fansW: 50, boardW: 50, otherW: 0 };
    const l = resolveLoad(c, p.assumptions, 'design');
    expect(l.dcDemandW).toBe(1000);
    expect(l.inputW).toBeCloseTo(1111.111, 3);
    expect(l.basis).toBe('component');
  });

  test('manufacturer whole-system estimate overrides component totals', () => {
    const p = baseProject();
    const c = addDevice(p, {});
    c.power.useComponentEstimate = true;
    c.power.component = { cpuCount: 2, cpuTdpW: 350, gpuCount: 8, gpuTdpW: 700, memoryW: 0, disksW: 0, fansW: 0, boardW: 0, otherW: 0 };
    c.power.manufacturerW = 5000;
    const l = resolveLoad(c, p.assumptions, 'design');
    expect(l.inputW).toBe(5000);
    expect(l.assumptions).toContain('manufacturer_overrides_component');
  });

  test('invalid PF/efficiency rejected', () => {
    expect(dcToAc(100, 0)).toBeNull();
    expect(dcToAc(100, 1.2)).toBeNull();
    expect(singlePhaseCurrent(100, 230, 0)).toBeNull();
    expect(singlePhaseCurrent(NaN, 230, 0.95)).toBeNull();
    expect(apparentPower(Infinity, 0.9)).toBeNull();
  });
});

describe('3. Single-phase current', () => {
  test('2200 W at 230 V PF 0.95 ≈ 10.07 A', () => {
    expect(singlePhaseCurrent(2200, 230, 0.95)).toBeCloseTo(10.07, 2);
  });
});

describe('4. Three-phase', () => {
  test('balanced 12 kW at 400 V PF 0.95 ≈ 18.23 A per phase', () => {
    expect(threePhaseBalancedCurrent(12000, 400, 0.95)).toBeCloseTo(18.232, 3);
    // Phasor engine agrees when loads are balanced across L-N
    const r = unbalancedLineCurrents(
      [
        { connection: 'L1', pW: 4000, pf: 0.95 },
        { connection: 'L2', pW: 4000, pf: 0.95 },
        { connection: 'L3', pW: 4000, pf: 0.95 },
      ],
      400,
    )!;
    expect(r.L1).toBeCloseTo(18.232, 3);
    expect(r.L2).toBeCloseTo(18.232, 3);
    expect(r.N).toBeCloseTo(0, 6);
  });

  test('unbalanced case reports the overloaded individual phase', () => {
    // 12 kW total: balanced would be 18.23 A (< 32 A) but all on L1 = 54.7 A
    const r = unbalancedLineCurrents([{ connection: 'L1', pW: 12000, pf: 0.95 }], 400)!;
    expect(r.L1).toBeCloseTo(12000 / ((400 / Math.sqrt(3)) * 0.95), 3);
    expect(r.L1).toBeGreaterThan(32);
    expect(r.L2).toBe(0);

    const p = baseProject({ feeds: [] });
    const rack = p.racks[0];
    p.pdus.push({
      id: uid('pdu'),
      name: '3PH',
      rackId: rack.id,
      templateId: null,
      vendor: '',
      model: '',
      mounting: 'zero_u',
      side: 'left',
      startU: null,
      heightU: 0,
      feed: 'A',
      upstream: null,
      topology: '3ph_wye',
      voltage: 400,
      nominalA: 32,
      usableA: null,
      usableKw: null,
      usableKva: null,
      plug: '',
      capabilities: { inputMetering: false, outletMetering: false, remoteMonitoring: false, outletSwitching: false, envSensors: false },
      banks: (['L1', 'L2', 'L3'] as const).map((ph) => ({
        id: uid('bank'),
        name: ph,
        phase: ph,
        breakerA: null,
        outlets: Array.from({ length: 4 }, (_, i) => ({ id: uid('out'), index: i + 1, type: 'C19' as const, ratedA: null })),
      })),
      provenance: 'user_supplied',
    });
    const l1 = p.pdus[0].banks[0].outlets;
    for (let i = 0; i < 4; i++) {
      const d = newDevice(rack.id, {
        power: { ...emptyPower(false), typicalW: 3000, designW: 3000 },
        domains: [{ id: uid('dom'), name: 'Main', mode: 'single', requiredPsus: 1, loadFraction: 1, sharing: 'equal', psus: [newPsu({ connection: { outletId: l1[i].id } })] }],
      });
      p.devices.push(d);
    }
    const res = computeScenario(p, normalDef, 'design');
    const pr = res.pdus[p.pdus[0].id];
    expect(pr.governingPhase).toBe('L1');
    expect(pr.governingA!).toBeGreaterThan(32);
    expect(pr.status).toBe('hard_exceeded');
    // Total power would look fine under the balanced formula
    expect(threePhaseBalancedCurrent(12000, 400, 0.95)!).toBeLessThan(32);
  });

  test('unknown phase mapping makes phase assessment unknown', () => {
    const p = baseProject({ feeds: ['A'] });
    const pdu = p.pdus[0];
    pdu.topology = '3ph_wye';
    pdu.voltage = 400;
    pdu.banks[0].phase = null;
    addDevice(p, { psus: 1, typicalW: 500, designW: 500, feeds: ['A'] });
    const r = computeScenario(p, normalDef, 'design');
    expect(r.pdus[pdu.id].phaseUnknown).toBe(true);
    expect(r.pdus[pdu.id].status).toBe('unknown');
  });
});

describe('5. Unknown active device power', () => {
  test('makes totals incomplete; no default-zero Pass', () => {
    const p = baseProject();
    addDevice(p, { typicalW: 500, designW: 700 });
    const u = addDevice(p, { typicalW: null, designW: null });
    const r = computeScenario(p, normalDef, 'typical');
    const t = r.racks[p.racks[0].id];
    expect(t.knownW).toBe(500);
    expect(t.unknownCount).toBe(1);
    expect(r.devices[u.id].drawnW).toBeNull();
    const pduA = r.pdus[p.pdus[0].id];
    expect(pduA.unknownCount).toBe(1);
    expect(pduA.status).toBe('unknown');
    const a = analyzeProject(p);
    const f = a.findings.filter((x) => x.ruleId === 'DATA-001');
    expect(f).toHaveLength(1);
    expect(f[0].status).toBe('unknown');
    expect(a.findings.some((x) => x.ruleId === 'CAP-PDU-PLAN' && x.scenarioId === 'normal' && x.status === 'pass')).toBe(false);
    expect(a.byRack[p.racks[0].id].conclusion.verdict).not.toBe('ok');
  });

  test('passive 0 W is distinct from unknown', () => {
    const p = baseProject();
    p.devices.push(newDevice(p.racks[0].id, { category: 'passive', power: emptyPower(true), domains: [] }));
    const r = computeScenario(p, normalDef, 'typical');
    expect(r.racks[p.racks[0].id].unknownCount).toBe(0);
  });
});

describe('6. Single-cord device on lost feed', () => {
  test('becomes unpowered without ATS', () => {
    const p = baseProject();
    const d = addDevice(p, { psus: 1, typicalW: 200, designW: 300, feeds: ['A'] });
    const r = computeScenario(p, lossFeed('A'), 'design');
    expect(r.devices[d.id].status).toBe('unpowered');
    expect(r.devices[d.id].drawnW).toBe(0);
    expect(r.pdus[p.pdus[1].id].w).toBe(0); // not magically transferred to B
    const a = analyzeProject(p);
    expect(a.findings.some((f) => f.ruleId === 'FAIL-DEV' && f.affected.id === d.id && f.status === 'fail')).toBe(true);
    expect(a.findings.some((f) => f.ruleId === 'FEED-004' && f.affected.id === d.id && f.status === 'warning')).toBe(true);
  });

  test('stays powered through a modeled ATS', () => {
    const p = baseProject({ feeds: ['A'] });
    const srcA = { id: uid('src'), name: 'S-A', kind: 'utility' as const, note: '' };
    const srcB = { id: uid('src'), name: 'S-B', kind: 'utility' as const, note: '' };
    const brA = { id: uid('br'), name: 'BA', breakerA: 16, breakerIsUsable: false, phases: 1 as const, voltage: 230, upsId: null, sourceId: srcA.id };
    const brB = { ...brA, id: uid('br'), name: 'BB', sourceId: srcB.id };
    const ats = { id: uid('ats'), name: 'ATS', primaryBranchId: brA.id, secondaryBranchId: brB.id, ratedA: 16, transfer: 'open_transition' as const, validated: true };
    p.sources.push(srcA, srcB);
    p.branches.push(brA, brB);
    p.atses.push(ats);
    p.pdus[0].upstream = { kind: 'ats', id: ats.id };
    const d = addDevice(p, { psus: 1, typicalW: 200, designW: 300, feeds: ['A'] });
    const def = { id: 'ls', kind: 'loss_source' as const, failures: { ...NO_FAILURES, sourceIds: [srcA.id] } };
    const r = computeScenario(p, def, 'design');
    expect(r.devices[d.id].status).toBe('ok');
    expect(r.branches[brB.id].w).toBe(300);
    expect(r.branches[brA.id].w).toBe(0);
  });
});

describe('7. Same-source A/B fails independence', () => {
  test('two PDUs from the same source', () => {
    const p = baseProject();
    const src = { id: uid('src'), name: 'Only source', kind: 'utility' as const, note: '' };
    const brA = { id: uid('br'), name: 'BA', breakerA: 16, breakerIsUsable: false, phases: 1 as const, voltage: 230, upsId: null, sourceId: src.id };
    const brB = { ...brA, id: uid('br'), name: 'BB' };
    p.sources.push(src);
    p.branches.push(brA, brB);
    p.pdus[0].upstream = { kind: 'branch', id: brA.id };
    p.pdus[1].upstream = { kind: 'branch', id: brB.id };
    addDevice(p, { typicalW: 100, designW: 100 });
    const a = analyzeProject(p);
    const rackF = a.findings.find((f) => f.ruleId === 'FEED-003')!;
    expect(rackF.status).toBe('fail');
    expect(rackF.msg.key).toBe('f.FEED-003.same_source');
    expect(a.findings.find((f) => f.ruleId === 'FEED-002')!.status).toBe('fail');
  });

  test('unknown topology is Unknown, not Pass', () => {
    const p = baseProject();
    addDevice(p, { typicalW: 100, designW: 100 });
    const a = analyzeProject(p);
    expect(a.findings.find((f) => f.ruleId === 'FEED-003')!.status).toBe('unknown');
  });

  test('both PSUs on the same PDU fail', () => {
    const p = baseProject();
    addDevice(p, { typicalW: 100, designW: 100, feeds: ['A', 'A'] });
    const a = analyzeProject(p);
    expect(a.findings.find((f) => f.ruleId === 'FEED-001')!.status).toBe('fail');
  });
});

describe('8. Placement never overlaps or goes out of range', () => {
  test('manual placement rejects overlap / range / invalid height', () => {
    const p = baseProject();
    const rack = p.racks[0];
    addDevice(p, { startU: 1, heightU: 2 });
    const ranges = occupiedRanges(rack.id, p.devices, p.pdus);
    expect(checkPlacement(rack, ranges, 2, 1)?.code).toBe('overlap');
    expect(checkPlacement(rack, ranges, 42, 2)?.code).toBe('out_of_range');
    expect(checkPlacement(rack, ranges, 0, 1)?.code).toBe('out_of_range');
    expect(checkPlacement(rack, ranges, 5, 0)?.code).toBe('invalid_height');
    expect(checkPlacement(rack, ranges, 5, 1.5)?.code).toBe('invalid_height');
    expect(checkPlacement(rack, ranges, 3, 2)).toBeNull();
  });

  test('auto placement is deterministic first-fit and all-or-nothing', () => {
    const p = baseProject();
    const rack = { ...p.racks[0], heightU: 12 };
    addDevice(p, { startU: 3, heightU: 2 });
    const ranges = occupiedRanges(rack.id, p.devices, p.pdus);
    const ok = autoPlace(rack, ranges, 2, 3);
    expect(ok).toEqual({ ok: true, startUs: [1, 5, 7] });
    const fail = autoPlace(rack, ranges, 2, 7);
    expect(fail.ok).toBe(false);
    if (!fail.ok) {
      expect(fail.placed).toBe(5);
      expect(fail.missingSlots).toBe(2);
    }
  });

  test('resize cannot hide devices', () => {
    const p = baseProject();
    addDevice(p, { startU: 40, heightU: 2 });
    const ranges = occupiedRanges(p.racks[0].id, p.devices, p.pdus);
    const r = checkResize(24, ranges);
    expect(r.ok).toBe(false);
    if (!r.ok && r.code === 'would_hide') expect(r.minHeight).toBe(41);
    expect(checkResize(41, ranges).ok).toBe(true);
    expect(checkResize(0, ranges).ok).toBe(false);
  });

  test('imports with overlaps are detected', () => {
    const p = baseProject();
    addDevice(p, { startU: 1, heightU: 2 });
    addDevice(p, { startU: 2, heightU: 1 });
    addDevice(p, { startU: 42, heightU: 2 });
    const issues = auditPlacements(p.racks, p.devices, p.pdus);
    expect(issues.map((i) => i.code).sort()).toEqual(['out_of_range', 'overlap']);
  });
});

describe('9. Mixed PSUs do not validate compatibility/redundancy', () => {
  test('800 + 1100 W', () => {
    const p = baseProject();
    const d = addDevice(p, { typicalW: 500, designW: 700 });
    d.domains[0].psus[1].ratedDcW = 1100;
    const a = analyzeProject(p);
    const mix = a.findings.find((f) => f.ruleId === 'PSU-003' && f.affected.id === d.domains[0].id)!;
    expect(mix.status).toBe('warning');
    const compat = a.findings.find((f) => f.ruleId === 'PSU-004' && f.affected.id === d.domains[0].id)!;
    expect(compat.status).toBe('unknown');
  });

  test('PSU count alone never proves redundancy (unknown mode)', () => {
    const p = baseProject();
    const d = addDevice(p, { typicalW: 500, designW: 700, mode: 'unknown' });
    const a = analyzeProject(p);
    expect(a.findings.find((f) => f.ruleId === 'PSU-002' && f.affected.id === d.domains[0].id)!.status).toBe('unknown');
    const r = computeScenario(p, lossFeed('A'), 'design');
    expect(r.devices[d.id].status).toBe('unknown_behavior');
  });
});

describe('10. Published usable rating is not derated again', () => {
  test('usable 12.8 A stays 12.8 A', () => {
    const policy = defaultPolicy();
    const l = deriveLimits(16, 12.8, policy);
    expect(l.planningA).toBe(12.8);
    expect(l.hardA).toBe(12.8);
    expect(l.planningBasis).toBe('usable_published_no_further_derate');
    const n = deriveLimits(16, null, policy);
    expect(n.planningA).toBeCloseTo(12.8, 9);
    expect(n.hardA).toBe(16);
    // Boundary: equal to the limit is within (zero headroom)
    expect(classify(12.8, l)).not.toBe('planning_exceeded');
    expect(classify(12.8000001, l)).toBe('hard_exceeded');
    // Policy without derating
    expect(deriveLimits(16, null, { ...policy, applyPlanningDerate: false }).planningA).toBe(16);
  });
});

describe('11. Unknown design load does not produce a verified design/failover Pass', () => {
  test('typical known, design unknown', () => {
    const p = baseProject();
    const d = addDevice(p, { typicalW: 500, designW: null });
    d.power.measured = { totalW: 480, method: 'whole_device', window: '7d avg', timestamp: new Date().toISOString(), source: 'iDRAC' };
    const r = computeScenario(p, lossFeed('A'), 'design');
    expect(r.racks[p.racks[0].id].unknownCount).toBe(1);
    expect(r.pdus[p.pdus[1].id].status).toBe('unknown');
    const a = analyzeProject(p);
    expect(a.findings.find((f) => f.ruleId === 'DATA-002')!.status).toBe('unknown');
    const fail = a.findings.filter((f) => f.ruleId === 'CAP-PDU-PLAN' && f.level === 'design' && f.status === 'pass');
    expect(fail).toHaveLength(0);
    expect(a.byRack[p.racks[0].id].conclusion.verdict).toBe('insufficient');
  });
});

describe('12. Shared UPS with unknown other loads', () => {
  test('cannot receive a complete Pass', () => {
    const p = baseProject();
    const src = { id: uid('src'), name: 'S', kind: 'utility' as const, note: '' };
    const ups = { id: uid('ups'), name: 'UPS', ratedKw: 20, ratedKva: 20, redundancy: 'single' as const, sourceId: src.id, otherLoadsKnown: false, otherLoadW: null, efficiency: null, inRack: false, rackDeviceId: null, runtime: null };
    const br = { id: uid('br'), name: 'B', breakerA: 32, breakerIsUsable: false, phases: 1 as const, voltage: 230, upsId: ups.id, sourceId: null };
    p.sources.push(src);
    p.upses.push(ups);
    p.branches.push(br);
    p.pdus.forEach((x) => (x.upstream = { kind: 'branch', id: br.id }));
    addDevice(p, { typicalW: 500, designW: 700 });
    const a = analyzeProject(p);
    const upsF = a.findings.filter((f) => f.affected.id === ups.id && (f.ruleId === 'UPS-KW' || f.ruleId === 'UPS-KVA'));
    expect(upsF.length).toBeGreaterThan(0);
    expect(upsF.every((f) => f.status !== 'pass')).toBe(true);
    expect(upsF[0].msg.key).toBe('f.UPS.contribution_only');
    // Once other loads are known, it can pass
    ups.otherLoadsKnown = true;
    ups.otherLoadW = 2000;
    const b = analyzeProject(p);
    expect(b.findings.find((f) => f.affected.id === ups.id && f.ruleId === 'UPS-KW' && f.scenarioId === 'normal')!.status).toBe('pass');
  });

  test('runtime is never fabricated', () => {
    const p = buildDemoProject();
    const a = analyzeProject(p);
    expect(a.findings.filter((f) => f.ruleId === 'UPS-RUNTIME').every((f) => f.status === 'unknown')).toBe(true);
  });
});

describe('13. PoE endpoint load and UPS downstream load counted once', () => {
  test('PoE endpoint powered by switch adds nothing at the PDU', () => {
    const p = baseProject();
    const sw = addDevice(p, { psus: 2 });
    sw.category = 'poe_switch';
    sw.poe = { baseTypicalW: 100, baseDesignW: 150, deliveredTypicalW: 180, deliveredDesignW: 360, efficiency: 0.9, budgetW: 740, inRackFraction: 0 };
    const cam = newDevice(p.racks[0].id, { name: 'AP', poweredByPoeSwitchId: sw.id, power: { ...emptyPower(false), typicalW: 20, designW: 25 }, domains: [] });
    p.devices.push(cam);
    const r = computeScenario(p, normalDef, 'typical');
    // Switch AC = 100 + 180/0.9 = 300 W; endpoint not added again
    expect(r.devices[sw.id].drawnW).toBeCloseTo(300, 9);
    expect(r.devices[cam.id].drawnW).toBe(0);
    expect(r.racks[p.racks[0].id].knownW).toBeCloseTo(300, 9);
    const pduTotal = Object.values(r.pdus).reduce((s, x) => s + x.w, 0);
    expect(pduTotal).toBeCloseTo(300, 9);
    // Rack-local heat excludes power delivered to endpoints outside the rack (180 W)
    expect(r.racks[p.racks[0].id].airHeatW).toBeCloseTo(120, 9);
  });

  test('in-rack UPS counts only its losses, not its nameplate', () => {
    const p = baseProject();
    const upsDev = newDevice(p.racks[0].id, { name: 'Rack UPS', category: 'ups', placement: { kind: 'rack', startU: 1, heightU: 2 }, power: emptyPower(true), domains: [] });
    p.devices.push(upsDev);
    const src = { id: uid('src'), name: 'S', kind: 'utility' as const, note: '' };
    const ups = { id: uid('ups'), name: 'In-rack UPS', ratedKw: 3, ratedKva: 3, redundancy: 'single' as const, sourceId: src.id, otherLoadsKnown: true, otherLoadW: 0, efficiency: 0.95, inRack: true, rackDeviceId: upsDev.id, runtime: null };
    const br = { id: uid('br'), name: 'UPS out', breakerA: 16, breakerIsUsable: false, phases: 1 as const, voltage: 230, upsId: ups.id, sourceId: null };
    p.sources.push(src);
    p.upses.push(ups);
    p.branches.push(br);
    p.pdus.forEach((x) => (x.upstream = { kind: 'branch', id: br.id }));
    addDevice(p, { typicalW: 950, designW: 950 });
    const r = computeScenario(p, normalDef, 'design');
    const t = r.racks[p.racks[0].id];
    expect(t.knownW).toBe(950); // IT load once; UPS device itself is not an IT load
    expect(r.upses[ups.id].w).toBe(950);
    expect(r.upses[ups.id].lossW).toBeCloseTo(50, 6);
    expect(t.airHeatW).toBeCloseTo(1000, 6); // losses counted once in heat
  });

  test('DC device on -48 V bus: DC current and rectifier AC counted once', () => {
    const p = baseProject({ feeds: ['A'] });
    const rectOutlet = p.pdus[0].banks[0].outlets[0].id;
    p.dcBuses.push({ id: 'bus1', name: '-48V', voltage: -48, capacityA: 100, rectifierEfficiency: 0.96, rectifierOutletIds: [rectOutlet] });
    const d = newDevice(p.racks[0].id, {
      inputType: 'DC',
      power: { ...emptyPower(false), typicalW: 960, designW: 960 },
      domains: [{ id: uid('dom'), name: 'Main', mode: 'single', requiredPsus: 1, loadFraction: 1, sharing: 'equal', psus: [newPsu({ inputType: 'DC', connection: { outletId: null, dcBusId: 'bus1' } })] }],
    });
    p.devices.push(d);
    const r = computeScenario(p, normalDef, 'design');
    expect(r.dcBuses.bus1.currentA).toBeCloseTo(20, 9);
    expect(r.pdus[p.pdus[0].id].w).toBeCloseTo(1000, 9);
    expect(r.racks[p.racks[0].id].knownW).toBeCloseTo(1000, 9);
  });

  test('-48 V PSU on an AC outlet is rejected', () => {
    const p = baseProject({ feeds: ['A'] });
    const d = newDevice(p.racks[0].id, {
      inputType: 'DC',
      power: { ...emptyPower(false), typicalW: 100, designW: 100 },
      domains: [{ id: uid('dom'), name: 'Main', mode: 'single', requiredPsus: 1, loadFraction: 1, sharing: 'equal', psus: [newPsu({ inputType: 'DC', connection: { outletId: p.pdus[0].banks[0].outlets[0].id } })] }],
    });
    p.devices.push(d);
    const a = analyzeProject(p);
    expect(a.findings.find((f) => f.ruleId === 'CONN-DC')!.status).toBe('fail');
    expect(computeScenario(p, normalDef, 'design').pdus[p.pdus[0].id].w).toBe(0);
  });
});

describe('Demo project acceptance', () => {
  const p = buildDemoProject();
  const rackId = p.racks[0].id;
  const defs = standardScenarios(p);
  const normal = computeScenarioPair(p, defs[0]);
  const lossA = computeScenarioPair(p, defs.find((d) => d.id === 'loss_feed_A')!);
  const pduA = p.pdus.find((x) => x.feed === 'A')!;
  const pduB = p.pdus.find((x) => x.feed === 'B')!;

  test('totals', () => {
    expect(normal.typical.racks[rackId].knownW).toBe(2200);
    expect(normal.design.racks[rackId].knownW).toBe(3150);
  });
  test('each feed typical 1100 W ≈ 5.03 A', () => {
    expect(normal.typical.pdus[pduA.id].w).toBeCloseTo(1100, 9);
    expect(normal.typical.pdus[pduA.id].governingA!).toBeCloseTo(5.034, 3);
  });
  test('loss of A: surviving typical 2200 W ≈ 10.07 A within 12.8 A', () => {
    expect(lossA.typical.pdus[pduB.id].w).toBeCloseTo(2200, 9);
    expect(lossA.typical.pdus[pduB.id].governingA!).toBeCloseTo(10.07, 2);
    expect(lossA.typical.pdus[pduB.id].limits.planningA).toBeCloseTo(12.8, 9);
    expect(lossA.typical.pdus[pduB.id].status).toBe('within');
  });
  test('loss of A: design 3150 W ≈ 14.42 A planning fail, hard within', () => {
    const r = lossA.design.pdus[pduB.id];
    expect(r.governingA!).toBeCloseTo(14.416, 3);
    expect(r.status).toBe('planning_exceeded');
    expect(r.governingA!).toBeLessThan(r.limits.hardA!);
    const a = analyzeProject(p);
    const plan = a.findings.find((f) => f.ruleId === 'CAP-PDU-PLAN' && f.affected.id === pduB.id && f.scenarioId === 'loss_feed_A' && f.level === 'design')!;
    const hard = a.findings.find((f) => f.ruleId === 'CAP-PDU-HARD' && f.affected.id === pduB.id && f.scenarioId === 'loss_feed_A' && f.level === 'design')!;
    expect(plan.status).toBe('fail');
    expect(hard.status).toBe('pass');
    expect(a.byRack[rackId].conclusion.verdict).toBe('normal_ok_failover_exceeds');
  });
  test('server design DC 630 W < one 800 W PSU', () => {
    const srv = p.devices.find((d) => d.name.startsWith('Demo Server 1'))!;
    const dom = normal.design.devices[srv.id].domains[0];
    expect(dom.dcDemandW).toBeCloseTo(630, 9);
    const a = analyzeProject(p);
    const f = a.findings.find((x) => x.ruleId === 'PSU-002' && x.affected.id === srv.domains[0].id)!;
    expect(f.status).toBe('pass');
    // transients/vendor behaviour remain unverified
    expect(a.findings.find((x) => x.ruleId === 'PSU-006')!.status).toBe('unknown');
  });
});
