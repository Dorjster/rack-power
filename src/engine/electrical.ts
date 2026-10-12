/**
 * Pure electrical formulas. No UI, no rounding. All functions validate inputs and
 * return `null` when a required input is unknown or invalid, never a fictitious 0.
 */

export const BTU_PER_W = 3.412142;
export const SQRT3 = Math.sqrt(3);

export function isFinitePositive(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x) && x > 0;
}

export function isFiniteNonNeg(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x) && x >= 0;
}

/** PF and efficiency must be in (0, 1]. */
export function isUnitFraction(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x) && x > 0 && x <= 1;
}

/** Apparent power S = P / PF (VA). */
export function apparentPower(pW: number | null, pf: number | null): number | null {
  if (!isFiniteNonNeg(pW) || !isUnitFraction(pf)) return null;
  return pW / pf;
}

/** Single phase current I = P / (V × PF). */
export function singlePhaseCurrent(pW: number | null, v: number | null, pf: number | null): number | null {
  if (!isFiniteNonNeg(pW) || !isFinitePositive(v) || !isUnitFraction(pf)) return null;
  return pW / (v * pf);
}

/** Balanced three-phase line current I = P / (√3 × V_LL × PF). */
export function threePhaseBalancedCurrent(pW: number | null, vLL: number | null, pf: number | null): number | null {
  if (!isFiniteNonNeg(pW) || !isFinitePositive(vLL) || !isUnitFraction(pf)) return null;
  return pW / (SQRT3 * vLL * pf);
}

/** AC input from DC output with constant efficiency: P_AC = P_DC / η. */
export function dcToAc(pDc: number | null, eta: number | null): number | null {
  if (!isFiniteNonNeg(pDc) || !isUnitFraction(eta)) return null;
  return pDc / eta;
}

/** DC output from AC input: P_DC = P_AC × η. */
export function acToDc(pAc: number | null, eta: number | null): number | null {
  if (!isFiniteNonNeg(pAc) || !isUnitFraction(eta)) return null;
  return pAc * eta;
}

/** Energy in kWh = average kW × hours. */
export function energyKwh(avgW: number | null, hours: number): number | null {
  if (!isFiniteNonNeg(avgW) || !isFiniteNonNeg(hours)) return null;
  return (avgW / 1000) * hours;
}

export function costFromKwh(kwh: number | null, tariff: number | null): number | null {
  if (!isFiniteNonNeg(kwh) || !isFiniteNonNeg(tariff)) return null;
  return kwh * tariff;
}

export function wattsToBtuh(w: number | null): number | null {
  if (!isFiniteNonNeg(w)) return null;
  return w * BTU_PER_W;
}

/** Nominal apparent capacity of a supply (VA). */
export function nominalCapacityVa(topology: '1ph' | '3ph_wye' | '3ph_delta', v: number | null, a: number | null): number | null {
  if (!isFinitePositive(v) || !isFinitePositive(a)) return null;
  return topology === '1ph' ? v * a : SQRT3 * v * a;
}

/** Growth reserve: applied once to the design load. */
export function withGrowthReserve(designW: number | null, reserve: number): number | null {
  if (!isFiniteNonNeg(designW) || !isFiniteNonNeg(reserve)) return null;
  return designW * (1 + reserve);
}

// ---------------------------------------------------------------------------
// Phasor math for unbalanced three-phase line currents
// ---------------------------------------------------------------------------

export interface Complex {
  re: number;
  im: number;
}

const c = (re: number, im: number): Complex => ({ re, im });
const add = (a: Complex, b: Complex): Complex => c(a.re + b.re, a.im + b.im);
const sub = (a: Complex, b: Complex): Complex => c(a.re - b.re, a.im - b.im);
const mag = (a: Complex): number => Math.hypot(a.re, a.im);
const polar = (r: number, thetaRad: number): Complex => c(r * Math.cos(thetaRad), r * Math.sin(thetaRad));
const deg = (d: number) => (d * Math.PI) / 180;

/** Voltage angles (degrees) for positive sequence L1, L2, L3. */
const LN_ANGLE: Record<'L1' | 'L2' | 'L3', number> = { L1: 0, L2: -120, L3: 120 };
/** Line-to-line voltage angle leads L-N of the first line by 30°. */
const LL_ANGLE: Record<'L1-L2' | 'L2-L3' | 'L3-L1', number> = { 'L1-L2': 30, 'L2-L3': -90, 'L3-L1': 150 };

export interface PhaseLoad {
  /** Phase (line-to-neutral) or line pair (line-to-line). */
  connection: 'L1' | 'L2' | 'L3' | 'L1-L2' | 'L2-L3' | 'L3-L1';
  /** Real power W */
  pW: number;
  pf: number;
}

export interface PhaseCurrents {
  L1: number;
  L2: number;
  L3: number;
  N: number;
}

/**
 * Line currents of a three-phase supply from per-connection loads.
 * Line-to-neutral loads use V_LN = V_LL/√3, line-to-line loads use V_LL.
 * Load angle is assumed lagging by acos(PF).
 */
export function unbalancedLineCurrents(loads: PhaseLoad[], vLL: number): PhaseCurrents | null {
  if (!isFinitePositive(vLL)) return null;
  const vLN = vLL / SQRT3;
  let i1 = c(0, 0);
  let i2 = c(0, 0);
  let i3 = c(0, 0);
  for (const l of loads) {
    if (!isFiniteNonNeg(l.pW) || !isUnitFraction(l.pf)) return null;
    const phi = Math.acos(l.pf);
    if (l.connection === 'L1' || l.connection === 'L2' || l.connection === 'L3') {
      const mI = l.pW / (vLN * l.pf);
      const ph = polar(mI, deg(LN_ANGLE[l.connection]) - phi);
      if (l.connection === 'L1') i1 = add(i1, ph);
      if (l.connection === 'L2') i2 = add(i2, ph);
      if (l.connection === 'L3') i3 = add(i3, ph);
    } else {
      const mI = l.pW / (vLL * l.pf);
      const ph = polar(mI, deg(LL_ANGLE[l.connection]) - phi);
      // current flows out of first line, returns via second line
      if (l.connection === 'L1-L2') {
        i1 = add(i1, ph);
        i2 = sub(i2, ph);
      } else if (l.connection === 'L2-L3') {
        i2 = add(i2, ph);
        i3 = sub(i3, ph);
      } else {
        i3 = add(i3, ph);
        i1 = sub(i1, ph);
      }
    }
  }
  const n = add(add(i1, i2), i3);
  return { L1: mag(i1), L2: mag(i2), L3: mag(i3), N: mag(n) };
}

/** Phase imbalance by an explicit definition (site policy). */
export function phaseImbalance(
  currents: [number, number, number],
  definition: 'max_dev_from_mean' | 'max_minus_min_over_max',
): number | null {
  const [a, b, cc] = currents;
  if (![a, b, cc].every(isFiniteNonNeg)) return null;
  const max = Math.max(a, b, cc);
  const min = Math.min(a, b, cc);
  if (max === 0) return 0;
  if (definition === 'max_minus_min_over_max') return (max - min) / max;
  const mean = (a + b + cc) / 3;
  return Math.max(Math.abs(a - mean), Math.abs(b - mean), Math.abs(cc - mean)) / mean;
}
