import type { Finding, Msg } from './types';

/** Prefer the design-level finding when both levels report the same item/scenario. */
export function designOnly(fs: Finding[]): Finding[] {
  const hasDesign = new Set(fs.filter((f) => f.level === 'design').map((f) => `${f.ruleId}|${f.affected.id}|${f.scenarioId}|${f.status}`));
  return fs.filter((f) => f.level !== 'typical' || !hasDesign.has(`${f.ruleId}|${f.affected.id}|${f.scenarioId}|${f.status}`));
}

/** Group identical findings that differ only by (equivalent) scenario, keeping the first as representative. */
export function groupFindings(fs: Finding[]): { f: Finding; scenarios: Msg[] }[] {
  const map = new Map<string, { f: Finding; scenarios: Msg[] }>();
  for (const f of fs) {
    const key = `${f.ruleId}|${f.affected.id}|${f.status}|${f.level ?? ''}|${f.observed ?? ''}`;
    const g = map.get(key);
    if (g) {
      if (f.scenarioLabel) g.scenarios.push(f.scenarioLabel);
    } else map.set(key, { f, scenarios: f.scenarioLabel ? [f.scenarioLabel] : [] });
  }
  return [...map.values()];
}
