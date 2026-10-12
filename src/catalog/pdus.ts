/**
 * PDU catalog: generic planning presets (editable templates, not a standard or purchase
 * recommendation) and two named model records.
 *
 * The named models carry headline values as described in the project brief referencing the
 * manufacturer listing. The manufacturer sites were NOT reachable from the build environment
 * (2026-10-12), so the values are marked `unverified` and must be re-checked. Internal bank,
 * breaker, phase and per-outlet limits are not published in that headline data and are left null.
 */
import type { PduCapabilities, PduTemplate, Sourced } from '../domain/types';

export const PDU_VENDORS = ['APC/Schneider', 'Eaton', 'Vertiv', 'Raritan', 'Huawei', 'Custom'] as const;

const noCaps: PduCapabilities = {
  inputMetering: false,
  outletMetering: false,
  remoteMonitoring: false,
  outletSwitching: false,
  envSensors: false,
};

const asm = <T,>(value: T | null, note?: string): Sourced<T> => ({
  value,
  status: 'assumption',
  source: note ? { title: note } : undefined,
});
const nil = <T,>(): Sourced<T> => ({ value: null, status: 'unverified' });

function generic(id: string, model: string, topology: '1ph' | '3ph_wye', voltage: number, amps: number, description: string): PduTemplate {
  return {
    id,
    vendor: 'Generic preset',
    model,
    mounting: 'zero_u',
    heightU: 0,
    topology,
    voltage: asm(voltage, 'Planning preset — confirm site supply'),
    nominalA: asm(amps, 'Un-derated nominal rating (preset)'),
    usableA: nil(),
    usableKw: nil(),
    usableKva: nil(),
    plug: asm<string>(null),
    // User confirms counts/types; a starting layout is provided as an editable placeholder.
    outlets: asm(
      topology === '1ph'
        ? [
            { type: 'C13', count: 20 },
            { type: 'C19', count: 4 },
          ]
        : [
            { type: 'C13', count: 24 },
            { type: 'C19', count: 6 },
          ],
      'Placeholder outlet layout — confirm counts/types',
    ),
    capabilities: asm(noCaps),
    generic: true,
    description,
  };
}

const unv = <T,>(value: T, url: string): Sourced<T> => ({
  value,
  status: 'unverified',
  source: {
    title: 'Manufacturer listing (headline, per project brief; not re-verified — site unreachable 2026-10-12)',
    url,
  },
});

const EATON_URL = 'https://www.eaton.com/us/en-us/skuPage.PDUMV16HV.html';
const APC_URL = 'https://www.se.com/hk/en/product/AP8853/';

export const BUILTIN_PDU_TEMPLATES: PduTemplate[] = [
  generic('preset-1ph-16', 'Small rack single feed 230 V 16 A 1-ph', '1ph', 230, 16, '3.68 kVA nominal'),
  generic('preset-ab-16', 'A/B rack starter 230 V 16 A 1-ph (per feed)', '1ph', 230, 16, '3.68 kVA nominal per feed'),
  generic('preset-ab-32', 'Higher capacity A/B 230 V 32 A 1-ph (per feed)', '1ph', 230, 32, '7.36 kVA nominal per feed'),
  generic('preset-3ph-16', 'Three-phase 400 V 16 A/phase', '3ph_wye', 400, 16, '≈11.09 kVA balanced; phase/bank mapping required'),
  generic('preset-3ph-32', 'Higher capacity three-phase 400 V 32 A/phase', '3ph_wye', 400, 32, '≈22.17 kVA balanced; phase/bank mapping required'),
  {
    id: 'eaton-pdumv16hv',
    vendor: 'Eaton',
    model: 'Tripp Lite PDUMV16HV',
    mounting: 'zero_u',
    heightU: 0,
    topology: '1ph',
    voltage: unv(230, EATON_URL),
    nominalA: unv(16, EATON_URL),
    usableA: nil(),
    usableKw: unv(3.7, EATON_URL),
    usableKva: nil(),
    plug: unv('IEC 60309', EATON_URL),
    outlets: unv(
      [
        { type: 'C13', count: 32 },
        { type: 'C19', count: 6 },
      ],
      EATON_URL,
    ),
    capabilities: nil(),
    description: '0U, 1-phase, 16 A, 208/230 V, 32×C13 + 6×C19 (headline, unverified)',
  },
  {
    id: 'apc-ap8853',
    vendor: 'APC/Schneider',
    model: 'AP8853',
    mounting: 'zero_u',
    heightU: 0,
    topology: '1ph',
    voltage: unv(230, APC_URL),
    nominalA: unv(32, APC_URL),
    usableA: nil(),
    usableKw: unv(7.4, APC_URL),
    usableKva: nil(),
    plug: unv('IEC 309 2P+E', APC_URL),
    outlets: unv(
      [
        { type: 'C13', count: 36 },
        { type: 'C19', count: 6 },
      ],
      APC_URL,
    ),
    capabilities: nil(),
    description: '0U, 1-phase, 230 V/32 A, 36×C13 + 6×C19 (headline, unverified)',
  },
];

export function allPduTemplates(user: PduTemplate[]): PduTemplate[] {
  const overridden = new Set(user.map((t) => t.id));
  return [...BUILTIN_PDU_TEMPLATES.filter((t) => !overridden.has(t.id)), ...user];
}

/** Connector pairing: socket -> mating equipment inlet. */
export const CONNECTOR_MATES: Record<string, string> = {
  C13: 'C14',
  C19: 'C20',
  C15: 'C16',
  C5: 'C6',
  C7: 'C8',
};
