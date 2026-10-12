import 'fake-indexeddb/auto';
import { describe, expect, test } from 'vitest';
import { buildDemoProject } from '../domain/demo';
import { exportJson, toCsv } from '../persistence/io';
import { parseImport, validateProject } from '../persistence/validate';
import { analyzeProject } from '../audit/analysis';
import { loadLastProject, saveProject } from '../persistence/db';

describe('14. Persistence and JSON round-trip', () => {
  test('refresh restores the project from IndexedDB', async () => {
    const p = buildDemoProject();
    p.policy.alertFraction = 0.65;
    p.policy.overrides['AIR-002'] = { disabled: true, note: 'site decision' };
    await saveProject(p);
    const restored = await loadLastProject();
    expect(restored).not.toBeNull();
    expect(restored!.id).toBe(p.id);
    expect(restored!.devices.map((d) => d.id)).toEqual(p.devices.map((d) => d.id));
    expect(restored!.policy.alertFraction).toBe(0.65);
  });

  test('JSON round-trip retains IDs, rules and configurations', () => {
    const p = buildDemoProject();
    p.policy.overrides['AIR-002'] = { disabled: true, note: 'site decision' };
    p.devices[1].domains[0].psus[0].state = 'failed';
    const res = parseImport(exportJson(p));
    expect(res.ok).toBe(true);
    const q = res.project!;
    expect(q).toEqual(JSON.parse(JSON.stringify(p)));
    const fa = analyzeProject(p).findings.map((f) => [f.key, f.status]);
    const fb = analyzeProject(q).findings.map((f) => [f.key, f.status]);
    expect(fb).toEqual(fa);
  });

  test('corrupted / malicious imports are rejected gracefully', () => {
    expect(parseImport('not json').ok).toBe(false);
    expect(parseImport(JSON.stringify({ format: 'other' })).ok).toBe(false);
    const p = buildDemoProject();
    const txt = exportJson(p).replace('"typicalW": 500', '"typicalW": 1e999');
    const r = parseImport(txt);
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toMatch(/non-finite/);
    const bad = JSON.parse(JSON.stringify(p));
    bad.devices[0].power.pf = 1.5;
    expect(validateProject(bad).ok).toBe(false);
    const dup = JSON.parse(JSON.stringify(p));
    dup.devices[1].id = dup.devices[0].id;
    expect(validateProject(dup).errors.join()).toMatch(/duplicated id/);
    const newer = JSON.parse(JSON.stringify(p));
    newer.schemaVersion = 999;
    expect(validateProject(newer).ok).toBe(false);
  });

  test('CSV is UTF-8 with BOM, quoted, and neutralises formulas', () => {
    const csv = toCsv([['Нэр', 'a,b', '=SUM(A1)', 'x"y']]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('Нэр');
    expect(csv).toContain('"a,b"');
    expect(csv).toContain("'=SUM(A1)");
    expect(csv).toContain('"x""y"');
  });
});
