import { useMemo } from 'react';
import { useStore } from './store';
import { analyzeProject } from '../audit/analysis';
import { psuLossScenario } from '../engine/scenario';

/** Shared, memoized analysis of the current project (single engine for every view). */
export function useAnalysis() {
  const project = useStore((s) => s.project);
  const psuLossId = useStore((s) => s.psuLossId);
  return useMemo(() => {
    const valid = psuLossId && project.devices.some((d) => d.domains.some((dom) => dom.psus.some((p) => p.id === psuLossId)));
    return analyzeProject(project, valid ? [psuLossScenario(psuLossId)] : []);
  }, [project, psuLossId]);
}
