/**
 * Import validation and schema migration. Imported content is parsed as data only
 * (JSON.parse) — nothing is executed. Every structural reference is checked.
 */
import type { Project } from '../domain/types';
import { SCHEMA_VERSION } from '../domain/types';
import { defaultAssumptions, defaultPolicy } from '../domain/factory';
import { auditPlacements } from '../engine/placement';

export const EXPORT_FORMAT = 'rack-power-planner';

export interface ImportResult {
  ok: boolean;
  project?: Project;
  errors: string[];
  warnings: string[];
  blobs?: Record<string, { mime: string; data: string }>;
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/** Reject non-finite numbers anywhere (e.g. "1e999" parses to Infinity). */
function findNonFinite(x: unknown, path: string, out: string[]) {
  if (out.length > 20) return;
  if (typeof x === 'number' && !Number.isFinite(x)) out.push(path);
  else if (Array.isArray(x)) x.forEach((v, i) => findNonFinite(v, `${path}[${i}]`, out));
  else if (isObj(x)) for (const [k, v] of Object.entries(x)) findNonFinite(v, `${path}.${k}`, out);
}

const posOrNull = (x: unknown) => x === null || (typeof x === 'number' && x > 0);
const fracOrNull = (x: unknown) => x === null || (typeof x === 'number' && x > 0 && x <= 1);

export function migrate(raw: Record<string, unknown>, warnings: string[]): Record<string, unknown> {
  const v = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 0;
  const p = { ...raw };
  if (v < SCHEMA_VERSION) {
    warnings.push(`migrated schema ${v} → ${SCHEMA_VERSION}`);
    p.policy = { ...defaultPolicy(), ...(isObj(p.policy) ? p.policy : {}) };
    p.assumptions = { ...defaultAssumptions(), ...(isObj(p.assumptions) ? p.assumptions : {}) };
    for (const k of ['racks', 'devices', 'pdus', 'branches', 'upses', 'sources', 'atses', 'dcBuses', 'manualChecks', 'evidence', 'acks', 'snapshots']) {
      if (!Array.isArray(p[k])) p[k] = [];
    }
    if (!isObj(p.catalog)) p.catalog = { devices: [], pdus: [] };
    if (!isObj(p.audit)) p.audit = { auditor: '', customer: '', date: '', notes: '' };
    p.schemaVersion = SCHEMA_VERSION;
  }
  return p;
}

export function validateProject(raw: unknown): ImportResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!isObj(raw)) return { ok: false, errors: ['not an object'], warnings };
  if (typeof raw.schemaVersion === 'number' && raw.schemaVersion > SCHEMA_VERSION)
    return { ok: false, errors: [`schema version ${raw.schemaVersion} is newer than supported ${SCHEMA_VERSION}`], warnings };

  const nonFinite: string[] = [];
  findNonFinite(raw, 'project', nonFinite);
  if (nonFinite.length) return { ok: false, errors: nonFinite.map((p) => `non-finite number at ${p}`), warnings };

  const p = migrate(raw, warnings);
  const reqStr = ['id', 'name'];
  for (const k of reqStr) if (typeof p[k] !== 'string') errors.push(`project.${k} missing`);
  const arrays = ['racks', 'devices', 'pdus', 'branches', 'upses', 'sources', 'atses', 'dcBuses'] as const;
  for (const k of arrays) if (!Array.isArray(p[k])) errors.push(`project.${k} must be an array`);
  if (errors.length) return { ok: false, errors, warnings };

  const proj = p as unknown as Project;
  const ids = new Set<string>();
  const dup = (id: unknown, where: string) => {
    if (typeof id !== 'string' || !id) errors.push(`${where}: missing id`);
    else if (ids.has(id)) errors.push(`${where}: duplicated id ${id}`);
    else ids.add(id);
  };

  if (proj.racks.length === 0) errors.push('project has no racks');
  for (const r of proj.racks) {
    dup(r.id, 'rack');
    if (!Number.isInteger(r.heightU) || r.heightU < 1 || r.heightU > 60) errors.push(`rack ${r.name}: invalid height`);
    if (!posOrNull(r.nominalVoltage)) errors.push(`rack ${r.name}: invalid voltage`);
    if (!Array.isArray(r.inletReadings)) r.inletReadings = [];
  }
  const outletIds = new Set<string>();
  for (const pdu of proj.pdus) {
    dup(pdu.id, 'pdu');
    if (!['1ph', '3ph_wye', '3ph_delta'].includes(pdu.topology)) errors.push(`pdu ${pdu.name}: invalid topology`);
    if (!posOrNull(pdu.voltage)) errors.push(`pdu ${pdu.name}: invalid voltage`);
    if (!posOrNull(pdu.nominalA) || !posOrNull(pdu.usableA)) errors.push(`pdu ${pdu.name}: invalid current rating`);
    if (!Array.isArray(pdu.banks)) errors.push(`pdu ${pdu.name}: banks missing`);
    else
      for (const b of pdu.banks) {
        dup(b.id, 'bank');
        if (!Array.isArray(b.outlets)) errors.push(`bank ${b.name}: outlets missing`);
        else
          for (const o of b.outlets) {
            dup(o.id, 'outlet');
            outletIds.add(o.id);
            if (!posOrNull(o.ratedA)) errors.push(`outlet ${o.id}: invalid rating`);
          }
      }
  }
  const psuOutlets = new Map<string, number>();
  const dcBusIds = new Set(proj.dcBuses.map((b) => b.id));
  for (const d of proj.devices) {
    dup(d.id, 'device');
    if (!isObj(d.power)) {
      errors.push(`device ${d.name}: power missing`);
      continue;
    }
    if (!isObj(d.placement)) errors.push(`device ${d.name}: placement missing`);
    if (!fracOrNull(d.power.pf)) errors.push(`device ${d.name}: PF must be in (0,1]`);
    if (!fracOrNull(d.power.efficiency)) errors.push(`device ${d.name}: efficiency must be in (0,1]`);
    for (const k of ['typicalW', 'designW', 'manufacturerW'] as const) {
      const v = d.power[k];
      if (v !== null && (typeof v !== 'number' || v < 0)) errors.push(`device ${d.name}: ${k} must be ≥ 0 or unknown`);
    }
    if (!Array.isArray(d.domains)) {
      errors.push(`device ${d.name}: domains missing`);
      continue;
    }
    for (const dom of d.domains) {
      dup(dom.id, 'domain');
      for (const ps of dom.psus ?? []) {
        dup(ps.id, 'psu');
        if (!posOrNull(ps.ratedDcW)) errors.push(`psu ${ps.label}: rated W must be > 0 or unknown`);
        if (!fracOrNull(ps.efficiency)) errors.push(`psu ${ps.label}: efficiency must be in (0,1]`);
        const oid = ps.connection?.outletId;
        if (oid) {
          if (!outletIds.has(oid)) {
            warnings.push(`psu ${ps.label} of ${d.name}: unknown outlet — disconnected`);
            ps.connection.outletId = null;
          } else psuOutlets.set(oid, (psuOutlets.get(oid) ?? 0) + 1);
        }
        if (ps.connection?.dcBusId && !dcBusIds.has(ps.connection.dcBusId)) {
          warnings.push(`psu ${ps.label} of ${d.name}: unknown DC bus — disconnected`);
          ps.connection.dcBusId = null;
        }
      }
    }
  }
  for (const [oid, n] of psuOutlets) if (n > 1) warnings.push(`outlet ${oid}: ${n} PSUs assigned (duplicate)`);
  for (const b of proj.branches) dup(b.id, 'branch');
  for (const u of proj.upses) dup(u.id, 'ups');
  for (const s of proj.sources) dup(s.id, 'source');
  for (const a of proj.atses) dup(a.id, 'ats');

  // Placement integrity: never import overlaps or out-of-range devices.
  const issues = auditPlacements(proj.racks, proj.devices, proj.pdus);
  for (const iss of issues) errors.push(`placement ${iss.code}: ${iss.id}`);

  if (errors.length) return { ok: false, errors, warnings };
  return { ok: true, project: proj, errors, warnings };
}

export function parseImport(text: string): ImportResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, errors: ['invalid JSON'], warnings: [] };
  }
  if (!isObj(data)) return { ok: false, errors: ['invalid file'], warnings: [] };
  if (data.format !== EXPORT_FORMAT) return { ok: false, errors: ['not a Rack Power Planner export'], warnings: [] };
  const res = validateProject(data.project);
  if (res.ok && isObj(data.blobs)) {
    const blobs: Record<string, { mime: string; data: string }> = {};
    for (const [k, v] of Object.entries(data.blobs))
      if (isObj(v) && typeof v.mime === 'string' && typeof v.data === 'string' && /^image\/(png|jpeg|webp|gif)$|^application\/pdf$/.test(v.mime)) blobs[k] = { mime: v.mime, data: v.data };
    res.blobs = blobs;
  }
  return res;
}
