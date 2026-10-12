import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { DICTS } from '../i18n';
import { CATEGORIES } from '../catalog/devices';
import { CHECKLIST_KEYS } from '../audit/checklist';
import { buildDemoProject } from '../domain/demo';
import { analyzeProject } from '../audit/analysis';
import { baseProject, addDevice } from './helpers';

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : /\.(tsx?|ts)$/.test(f) && !f.endsWith('.test.ts') ? [p] : [];
  });
}

const src = walk(join(__dirname, '..'))
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n');

describe('i18n completeness', () => {
  test('Mongolian and English have the same keys', () => {
    const mn = Object.keys(DICTS.mn).sort();
    const en = Object.keys(DICTS.en).sort();
    expect(mn.filter((k) => !DICTS.en[k])).toEqual([]);
    expect(en.filter((k) => !DICTS.mn[k])).toEqual([]);
  });

  test('every literal key used in source exists', () => {
    const keys = new Set<string>();
    for (const m of src.matchAll(/\bt\('([a-zA-Z0-9_.\-]+)'/g)) keys.add(m[1]);
    for (const m of src.matchAll(/\b(?:error|successKey): '((?:err|dev|map)\.[A-Za-z0-9_.]+)'/g)) keys.add(m[1]);
    for (const m of src.matchAll(/'((?:f|r)\.[A-Z][A-Za-z0-9_.\-]+)'/g)) keys.add(m[1]);
    // A bare prefix (e.g. used to build "f.FEED-002.<reason>") is not itself a key.
    const isPrefix = (k: string) => Object.keys(DICTS.en).some((x) => x.startsWith(`${k}.`));
    const missing = [...keys].filter((k) => (!DICTS.mn[k] || !DICTS.en[k]) && !isPrefix(k));
    expect(missing).toEqual([]);
  });

  test('dynamic enumerations are translated', () => {
    const dyn = [
      ...CATEGORIES.map((c) => `cat.${c}`),
      ...CHECKLIST_KEYS.map((c) => `chk.${c}`),
      ...['overlap', 'out_of_range', 'invalid_height', 'unknown_rack'].map((c) => `f.PHY-001.${c}`),
      ...['overlap', 'out_of_range', 'invalid_height'].map((c) => `err.place.${c}`),
      ...['same_pdu', 'same_branch', 'same_ups', 'same_source', 'via_ats', 'topology_unknown', 'independent'].flatMap((c) => [`f.FEED-002.${c}`, `f.FEED-003.${c}`]),
      ...['unpowered', 'partial', 'shutdown', 'over_capacity', 'throttling', 'unknown'].flatMap((c) => [`f.FAIL.${c}`, `r.FAIL.${c}`]),
      ...['ok', 'normal_ok_failover_exceeds', 'normal_planning_exceeded', 'overloaded', 'insufficient'].flatMap((v) => [`verdict.${v}`, `verdict.${v}.sub`]),
      'f.CONN-DC.dc_psu_on_ac_outlet',
      'f.CONN-DC.ac_psu_on_dc_bus',
    ];
    expect(dyn.filter((k) => !DICTS.mn[k] || !DICTS.en[k])).toEqual([]);
  });

  test('all keys emitted by the rule engine resolve (demo + edge project)', () => {
    const p = baseProject();
    addDevice(p, { typicalW: null, designW: null, mode: 'unknown' });
    const projects = [buildDemoProject(), p];
    for (const proj of projects) {
      const a = analyzeProject(proj);
      const missing = new Set<string>();
      for (const f of a.findings) {
        for (const m of [f.msg, f.rec, f.scenarioLabel]) if (m && m.key !== 'raw' && (!DICTS.mn[m.key] || !DICTS.en[m.key])) missing.add(m.key);
      }
      expect([...missing]).toEqual([]);
    }
  });
});
