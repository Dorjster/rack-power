import type { CheckStatus, ID } from '../domain/types';

export type RuleType = 'manufacturer' | 'guidance' | 'site_policy' | 'physical' | 'data' | 'manual';
export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type EvidenceType = 'measured' | 'estimated' | 'manufacturer' | 'manual' | 'assumption' | 'missing' | 'topology' | 'calculated';
export type AffectedKind =
  | 'project'
  | 'rack'
  | 'device'
  | 'domain'
  | 'psu'
  | 'pdu'
  | 'bank'
  | 'outlet'
  | 'branch'
  | 'ups'
  | 'source'
  | 'ats'
  | 'dcbus';

export interface Msg {
  key: string;
  params: Record<string, string | number>;
}

export interface Finding {
  /** Stable key: ruleId|affectedId|scenario|level */
  key: string;
  ruleId: string;
  ruleType: RuleType;
  severity: Severity;
  status: CheckStatus;
  affected: { kind: AffectedKind; id: ID; label: string };
  rackId: ID | null;
  scenarioId: string | null;
  scenarioLabel: Msg | null;
  level: 'typical' | 'design' | null;
  observed: string | null;
  threshold: string | null;
  /** Calculation shown behind the finding. */
  calc: string | null;
  msg: Msg;
  rec: Msg | null;
  evidence: EvidenceType;
  source: string | null;
  /** Unknown that prevents a final conclusion. */
  essential: boolean;
  /** Hard/physical overload (vs. planning policy). */
  hard: boolean;
  /** Failure-scenario only finding (normal passes). */
  failoverOnly: boolean;
  policyNote: string | null;
  /** Amount over limit (A) for ranking. */
  excessA?: number;
}

export interface Coverage {
  devices: { measured: number; estimated: number; manufacturer: number; component: number; proxy: number; unknown: number; passive: number; total: number };
  designKnown: number;
  checks: Record<CheckStatus, number>;
}

export type Verdict = 'ok' | 'normal_ok_failover_exceeds' | 'normal_planning_exceeded' | 'overloaded' | 'insufficient';

export interface Conclusion {
  verdict: Verdict;
  /** Data is also incomplete (shown alongside a known failure verdict). */
  alsoIncomplete: boolean;
  hardFindings: Finding[];
  failoverFindings: Finding[];
  planningFindings: Finding[];
  essentialUnknowns: Finding[];
  limitedChecks: Finding[];
}

export interface Headroom {
  /** Additional dual-corded load (W, AC) acceptable under the selected policy. */
  additionalW: number | null;
  limitingConstraint: Msg | null;
  qualified: boolean;
  constraints: { label: Msg; headroomW: number | null }[];
  freeSockets: Record<string, number>;
  freeU: number;
}
