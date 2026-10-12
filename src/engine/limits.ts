import type { BranchCircuit, OutletBank, Pdu, Policy } from '../domain/types';
import { isFinitePositive } from './electrical';

export type HardBasis = 'usable_published' | 'nominal' | 'unknown';
export type PlanningBasis = 'usable_published_no_further_derate' | 'derated_nominal' | 'nominal_no_policy' | 'unknown';

export interface CurrentLimits {
  /** Exceeding this is a physical/manufacturer overload (always Fail). */
  hardA: number | null;
  hardBasis: HardBasis;
  /** Site planning limit. */
  planningA: number | null;
  planningBasis: PlanningBasis;
  /** Alert threshold (fraction of nominal). */
  alertA: number | null;
  nominalA: number | null;
}

/**
 * Derive current limits from ratings and policy.
 *
 *  - A published usable/continuous rating is already derated by the manufacturer:
 *    it is used as-is for planning and as the hard usable limit, never derated again.
 *  - An un-derated nominal rating is the hard limit; the optional planning derating
 *    (e.g. 80%) applies only when the policy selects it.
 *  - Alert = policy.alertFraction × nominal (or × usable if nominal unknown).
 */
export function deriveLimits(nominalA: number | null, usableA: number | null, policy: Policy): CurrentLimits {
  const nominal = isFinitePositive(nominalA) ? nominalA : null;
  const usable = isFinitePositive(usableA) ? usableA : null;
  if (usable !== null) {
    return {
      hardA: usable,
      hardBasis: 'usable_published',
      planningA: usable,
      planningBasis: 'usable_published_no_further_derate',
      alertA: policy.alertFraction * (nominal ?? usable),
      nominalA: nominal,
    };
  }
  if (nominal !== null) {
    return {
      hardA: nominal,
      hardBasis: 'nominal',
      planningA: policy.applyPlanningDerate ? nominal * policy.planningDerateFraction : nominal,
      planningBasis: policy.applyPlanningDerate ? 'derated_nominal' : 'nominal_no_policy',
      alertA: policy.alertFraction * nominal,
      nominalA: nominal,
    };
  }
  return { hardA: null, hardBasis: 'unknown', planningA: null, planningBasis: 'unknown', alertA: null, nominalA: null };
}

export function pduLimits(pdu: Pdu, policy: Policy): CurrentLimits {
  return deriveLimits(pdu.nominalA, pdu.usableA, policy);
}

export function bankLimits(bank: OutletBank, policy: Policy): CurrentLimits {
  return deriveLimits(bank.breakerA, null, policy);
}

export function branchLimits(b: BranchCircuit, policy: Policy): CurrentLimits {
  return b.breakerIsUsable ? deriveLimits(null, b.breakerA, policy) : deriveLimits(b.breakerA, null, policy);
}

export type LimitStatus = 'within' | 'alert' | 'planning_exceeded' | 'hard_exceeded' | 'unknown' | 'na';

/**
 * Boundary semantics: a value equal to an allowable limit is within it (zero headroom).
 * Alert triggers at >= alert threshold.
 */
export function classify(valueA: number | null, l: CurrentLimits): LimitStatus {
  if (valueA === null || !Number.isFinite(valueA)) return 'unknown';
  if (l.hardA === null) return 'unknown';
  if (valueA > l.hardA) return 'hard_exceeded';
  if (l.planningA !== null && valueA > l.planningA) return 'planning_exceeded';
  if (l.alertA !== null && valueA >= l.alertA) return 'alert';
  return 'within';
}

export function headroom(valueA: number | null, limitA: number | null): number | null {
  if (valueA === null || limitA === null) return null;
  return limitA - valueA;
}
