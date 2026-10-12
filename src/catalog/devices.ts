/**
 * Built-in device catalog.
 *
 * PROVENANCE POLICY
 * Manufacturer documentation could not be accessed from the build environment
 * (network policy blocked vendor sites on 2026-10-12). Therefore every model below is an
 * UNVERIFIED TEMPLATE: the model name is retained so the user can pick it, but power,
 * PSU options, dimensions, weight and airflow are null and must be supplied by the user
 * from the actual datasheet / nameplate / BMC reading. Rack height is a commonly published
 * form-factor value given as an unverified hint that the user must confirm.
 *
 * Consumption is NEVER populated from a brand or model name.
 */
import type { DeviceCategory, DeviceTemplate, PassiveKind, Sourced } from '../domain/types';

export const CATALOG_VERSION = '2026-10-12';
export const CATALOG_ACCESS_NOTE =
  'Manufacturer sites not reachable from build environment on 2026-10-12; all model records are unverified templates.';

const nil = <T,>(): Sourced<T> => ({ value: null, status: 'unverified' });
const hint = <T,>(value: T, note = 'Form-factor hint, confirm against datasheet'): Sourced<T> => ({
  value,
  status: 'unverified',
  source: { title: note },
});

function tpl(
  id: string,
  category: DeviceCategory,
  vendor: string,
  model: string,
  heightU: number | null,
  family?: string,
): DeviceTemplate {
  return {
    id,
    category,
    vendor,
    model,
    family,
    heightU: heightU === null ? nil() : hint(heightU),
    depthMm: nil(),
    weightKg: nil(),
    airflow: nil(),
    psuOptions: [],
    supportedPsuCounts: nil(),
    supportedModes: nil(),
    typicalAcW: nil(),
    maxAcW: nil(),
  };
}

function passive(id: string, model: string, kind: PassiveKind, heightU: number): DeviceTemplate {
  return {
    ...tpl(id, 'passive', 'Generic', model, null),
    heightU: { value: heightU, status: 'user_supplied', source: { title: 'Generic passive accessory' } },
    typicalAcW: { value: 0, status: 'assumption' },
    maxAcW: { value: 0, status: 'assumption' },
    isPassive: true,
    passiveKind: kind,
  };
}

export const VENDORS = ['Dell', 'HPE', 'Aruba', 'Cisco', 'Fortinet', 'Huawei', 'Generic'] as const;
/** Catalog architecture accepts any vendor string; these are planned additions. */
export const FUTURE_VENDORS = ['Arista', 'Lenovo', 'Supermicro', 'APC/Schneider', 'Eaton'] as const;

export const BUILTIN_DEVICE_TEMPLATES: DeviceTemplate[] = [
  // Dell
  tpl('dell-r760', 'rack_server', 'Dell', 'PowerEdge R760', 2, 'PowerEdge'),
  tpl('dell-r760xs', 'rack_server', 'Dell', 'PowerEdge R760xs', 2, 'PowerEdge'),
  tpl('dell-r770', 'rack_server', 'Dell', 'PowerEdge R770', 2, 'PowerEdge'),
  tpl('dell-t560', 'tower_server', 'Dell', 'PowerEdge T560 (tower)', null, 'PowerEdge'),
  tpl('dell-t360', 'tower_server', 'Dell', 'PowerEdge T360 (tower)', null, 'PowerEdge'),
  tpl('dell-powerstore', 'storage_array', 'Dell', 'PowerStore (model TBD)', null, 'PowerStore'),
  tpl('dell-me5024', 'storage_array', 'Dell', 'PowerVault ME5024', 2, 'PowerVault'),
  tpl('dell-me5084', 'disk_enclosure', 'Dell', 'PowerVault ME5084', 5, 'PowerVault'),
  // HPE
  tpl('hpe-dl380-g11', 'rack_server', 'HPE', 'ProLiant DL380 Gen11', 2, 'ProLiant'),
  tpl('hpe-dl380a-g11', 'gpu_server', 'HPE', 'ProLiant DL380a Gen11 (GPU)', 2, 'ProLiant'),
  tpl('hpe-alletra-mp', 'storage_array', 'HPE', 'Alletra Storage MP (config TBD)', null, 'Alletra'),
  // Aruba
  tpl('aruba-cx8325', 'switch', 'Aruba', 'CX 8325', 1, 'CX'),
  tpl('aruba-cx10000', 'switch', 'Aruba', 'CX 10000', 1, 'CX'),
  // Cisco
  tpl('cisco-n93180yc', 'switch', 'Cisco', 'Nexus 93180YC (variant TBD)', 1, 'Nexus'),
  tpl('cisco-c9300', 'switch', 'Cisco', 'Catalyst 9300 (SKU TBD)', 1, 'Catalyst'),
  tpl('cisco-c9300-poe', 'poe_switch', 'Cisco', 'Catalyst 9300 PoE (SKU TBD)', 1, 'Catalyst'),
  tpl('cisco-c8300', 'router', 'Cisco', 'Catalyst 8300 Edge (SKU TBD)', null, 'Catalyst'),
  tpl('cisco-mds', 'san_switch', 'Cisco', 'MDS SAN switch (SKU TBD)', null, 'MDS'),
  // Fortinet
  tpl('ftnt-fg200f', 'firewall', 'Fortinet', 'FortiGate 200F', 1, 'FortiGate'),
  tpl('ftnt-fg600f', 'firewall', 'Fortinet', 'FortiGate 600F', 1, 'FortiGate'),
  tpl('ftnt-fsw448e-poe', 'poe_switch', 'Fortinet', 'FortiSwitch 448E-FPOE', 1, 'FortiSwitch'),
  // Huawei
  tpl('hw-ce6881', 'switch', 'Huawei', 'CloudEngine 6881 (SKU TBD)', 1, 'CloudEngine'),
  tpl('hw-2288h-v6', 'rack_server', 'Huawei', 'FusionServer 2288H V6', 2, 'FusionServer'),
  // Generic categories (templates for custom entry)
  tpl('gen-tape', 'tape_library', 'Generic', 'Tape library', null),
  tpl('gen-backup', 'backup_appliance', 'Generic', 'Backup appliance', null),
  tpl('gen-mgmt', 'mgmt_appliance', 'Generic', 'Management appliance', 1),
  tpl('gen-ups', 'ups', 'Generic', 'Rack UPS', 2),
  // Passive (0 W by default — distinct from unknown)
  passive('pas-blank-1u', 'Blanking panel 1U', 'blanking', 1),
  passive('pas-blank-2u', 'Blanking panel 2U', 'blanking', 2),
  passive('pas-patch-1u', 'Patch panel 1U', 'patch_panel', 1),
  passive('pas-patch-2u', 'Patch panel 2U', 'patch_panel', 2),
  passive('pas-cable-1u', 'Cable manager 1U', 'cable_manager', 1),
  passive('pas-cable-2u', 'Cable manager 2U', 'cable_manager', 2),
  passive('pas-shelf-1u', 'Shelf 1U', 'shelf', 1),
  passive('pas-shelf-2u', 'Shelf 2U', 'shelf', 2),
];

export const CATEGORIES: DeviceCategory[] = [
  'rack_server',
  'gpu_server',
  'tower_server',
  'switch',
  'poe_switch',
  'router',
  'firewall',
  'storage_array',
  'disk_enclosure',
  'san_switch',
  'tape_library',
  'backup_appliance',
  'mgmt_appliance',
  'ups',
  'pdu',
  'passive',
  'custom',
];

/** Example custom PSU wattages. NOT an assertion that any model supports them. */
export const EXAMPLE_PSU_WATTS = [350, 500, 750, 800, 1100, 1600, 2000, 2400, 3000];

export function allDeviceTemplates(user: DeviceTemplate[]): DeviceTemplate[] {
  const overridden = new Set(user.map((t) => t.id));
  return [...BUILTIN_DEVICE_TEMPLATES.filter((t) => !overridden.has(t.id)), ...user];
}
