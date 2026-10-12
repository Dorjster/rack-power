import type { Assumptions, DeviceInstance, PowerBasis, Confidence, Psu } from '../domain/types';
import { dcToAc, acToDc, isFiniteNonNeg, isUnitFraction } from './electrical';

export type LoadLevel = 'typical' | 'design';

export type AssumptionKey =
  | 'pf_default'
  | 'eta_default'
  | 'poe_eta_default'
  | 'component_estimate'
  | 'psu_proxy_low_confidence'
  | 'manufacturer_overrides_component'
  | 'poe_powered_endpoint'
  | 'passive_zero';

export interface ResolvedLoad {
  /** Whole-device input W at this level. AC for AC devices, DC for DC-input devices. null = unknown. */
  inputW: number | null;
  /** DC output demand on PSUs (W). null = unknown. */
  dcDemandW: number | null;
  basis: PowerBasis | 'passive' | 'poe_endpoint';
  confidence: Confidence;
  pf: number;
  pfAssumed: boolean;
  eta: number;
  etaAssumed: boolean;
  assumptions: AssumptionKey[];
  /** Human-oriented source label (as entered). */
  sourceLabel: string;
  /** For PoE switches: breakdown. */
  poe?: { baseW: number | null; deliveredW: number | null; conversionLossW: number | null; outsideRackW: number | null };
}

export function isActiveDevice(d: DeviceInstance): boolean {
  return !d.power.passiveZero;
}

export function installedPsus(d: DeviceInstance): Psu[] {
  return d.domains.flatMap((dom) => dom.psus);
}

/** Installed PSU nameplate capacity (DC). Inventory value — NOT consumption. */
export function installedNameplateW(d: DeviceInstance): number | null {
  const psus = installedPsus(d).filter((p) => p.state !== 'removed');
  if (psus.length === 0) return 0;
  if (psus.some((p) => p.ratedDcW === null)) return null;
  return psus.reduce((s, p) => s + (p.ratedDcW ?? 0), 0);
}

export function deviceEfficiency(d: DeviceInstance, a: Assumptions): { eta: number; assumed: boolean } {
  if (isUnitFraction(d.power.efficiency)) return { eta: d.power.efficiency, assumed: false };
  const etas = installedPsus(d)
    .map((p) => p.efficiency)
    .filter((e): e is number => isUnitFraction(e));
  if (etas.length > 0) return { eta: etas.reduce((s, e) => s + e, 0) / etas.length, assumed: false };
  return { eta: a.defaultEfficiency, assumed: true };
}

export function devicePf(d: DeviceInstance, a: Assumptions): { pf: number; assumed: boolean } {
  if (isUnitFraction(d.power.pf)) return { pf: d.power.pf, assumed: false };
  return { pf: a.defaultPf, assumed: true };
}

export function componentDcW(d: DeviceInstance): number | null {
  const c = d.power.component;
  if (!c) return null;
  const parts = [c.cpuCount * c.cpuTdpW, c.gpuCount * c.gpuTdpW, c.memoryW, c.disksW, c.fansW, c.boardW, c.otherW];
  if (!parts.every(isFiniteNonNeg)) return null;
  return parts.reduce((s, x) => s + x, 0);
}

/**
 * Sum of per-PSU measured AC readings (summed once). Returns null unless every
 * active PSU has a reading.
 */
export function perPsuMeasuredSum(d: DeviceInstance): number | null {
  const psus = installedPsus(d).filter((p) => p.state === 'ok' || p.state === 'standby');
  if (psus.length === 0) return null;
  if (!psus.every((p) => isFiniteNonNeg(p.measuredAcW))) return null;
  return psus.reduce((s, p) => s + (p.measuredAcW ?? 0), 0);
}

/**
 * Resolve the device's input power at a level, preserving unknowns.
 *
 * Typical level: measured whole-device > per-PSU measured sum > typical estimate >
 *   (component mode: manufacturer whole-system > component DC/η) > PSU proxy > unknown.
 * Design level: design estimate > (component mode: manufacturer > component) > PSU proxy > unknown.
 *   A measured value is NEVER promoted to design/peak.
 */
export function resolveLoad(d: DeviceInstance, a: Assumptions, level: LoadLevel): ResolvedLoad {
  const { pf, assumed: pfAssumed } = devicePf(d, a);
  const { eta, assumed: etaAssumed } = deviceEfficiency(d, a);
  const base = { pf, pfAssumed, eta, etaAssumed };
  const assumptions: AssumptionKey[] = [];

  if (d.power.passiveZero) {
    return { ...base, inputW: 0, dcDemandW: 0, basis: 'passive', confidence: 'high', assumptions: ['passive_zero'], sourceLabel: '' };
  }
  if (d.poweredByPoeSwitchId) {
    return { ...base, inputW: 0, dcDemandW: 0, basis: 'poe_endpoint', confidence: 'medium', assumptions: ['poe_powered_endpoint'], sourceLabel: '' };
  }

  const p = d.power;
  let inputW: number | null = null;
  let dcDemandW: number | null = null;
  let basis: ResolvedLoad['basis'] = 'unknown';
  let confidence: Confidence = p.confidence;
  let sourceLabel = '';
  let poe: ResolvedLoad['poe'];

  const fromAc = (w: number) => {
    inputW = w;
    dcDemandW = d.inputType === 'DC' ? w : acToDc(w, eta);
  };

  // PoE switch: base AC + delivered/η_poe. Measured whole-device value (typical) wins.
  const poeCfg = d.category === 'poe_switch' ? d.poe : null;

  if (level === 'typical' && p.measured && isFiniteNonNeg(p.measured.totalW)) {
    fromAc(p.measured.totalW);
    basis = 'measured';
    confidence = 'high';
    sourceLabel = p.measured.source;
  } else if (level === 'typical' && perPsuMeasuredSum(d) !== null) {
    fromAc(perPsuMeasuredSum(d)!);
    basis = 'measured';
    confidence = 'high';
    sourceLabel = 'Σ PSU';
  } else if (poeCfg) {
    const baseW = level === 'typical' ? poeCfg.baseTypicalW : poeCfg.baseDesignW;
    const delivered = level === 'typical' ? poeCfg.deliveredTypicalW : poeCfg.deliveredDesignW;
    let poeEta = poeCfg.efficiency;
    if (!isUnitFraction(poeEta)) {
      poeEta = a.poeEfficiency;
      assumptions.push('poe_eta_default');
    }
    const poeAc = dcToAc(delivered, poeEta);
    if (isFiniteNonNeg(baseW) && poeAc !== null && delivered !== null) {
      fromAc(baseW + poeAc);
      basis = 'estimated';
      sourceLabel = 'PoE';
      poe = {
        baseW,
        deliveredW: delivered,
        conversionLossW: poeAc - delivered,
        outsideRackW: delivered * (1 - poeCfg.inRackFraction),
      };
    } else {
      poe = { baseW: baseW ?? null, deliveredW: delivered ?? null, conversionLossW: null, outsideRackW: null };
    }
  } else {
    const explicit = level === 'typical' ? p.typicalW : p.designW;
    if (isFiniteNonNeg(explicit)) {
      fromAc(explicit);
      basis = 'estimated';
      sourceLabel = level === 'typical' ? p.typicalSource : p.designSource;
    } else if (p.useComponentEstimate) {
      if (isFiniteNonNeg(p.manufacturerW)) {
        fromAc(p.manufacturerW);
        basis = 'manufacturer';
        sourceLabel = p.manufacturerSource;
        if (p.component) assumptions.push('manufacturer_overrides_component');
      } else {
        const dc = componentDcW(d);
        if (dc !== null) {
          inputW = d.inputType === 'DC' ? dc : dcToAc(dc, eta);
          dcDemandW = dc;
          basis = 'component';
          confidence = 'low';
          assumptions.push('component_estimate');
        }
      }
    } else if (p.useProxy && p.proxy && isFiniteNonNeg(p.proxy.assumedDcW)) {
      inputW = d.inputType === 'DC' ? p.proxy.assumedDcW : dcToAc(p.proxy.assumedDcW, eta);
      dcDemandW = p.proxy.assumedDcW;
      basis = 'psu_proxy';
      confidence = 'low';
      assumptions.push('psu_proxy_low_confidence');
    }
  }

  if (inputW !== null && d.inputType === 'AC') {
    if (pfAssumed) assumptions.push('pf_default');
    if (etaAssumed && basis !== 'measured') assumptions.push('eta_default');
  }
  if (dcDemandW !== null && etaAssumed && d.inputType === 'AC' && !assumptions.includes('eta_default')) {
    assumptions.push('eta_default');
  }

  return { ...base, inputW, dcDemandW, basis, confidence, assumptions, sourceLabel, poe };
}

export function measurementAgeDays(d: DeviceInstance, now: Date): number | null {
  const m = d.power.measured;
  if (!m) return null;
  const t = Date.parse(m.timestamp);
  if (!Number.isFinite(t)) return null;
  return (now.getTime() - t) / 86_400_000;
}
