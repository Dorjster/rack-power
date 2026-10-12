import type { DeviceInstance, ID, Pdu, Rack } from '../domain/types';

export interface URange {
  id: ID;
  kind: 'device' | 'pdu';
  start: number;
  end: number; // inclusive
}

export function isValidHeight(h: unknown): h is number {
  return typeof h === 'number' && Number.isInteger(h) && h >= 1 && h <= 60;
}

export function isValidRackHeight(h: unknown): h is number {
  return typeof h === 'number' && Number.isInteger(h) && h >= 1 && h <= 60;
}

/** Ranges occupied in rack units. 0U PDUs, outside/shelf towers and unplaced items do not occupy U. */
export function occupiedRanges(rackId: ID, devices: DeviceInstance[], pdus: Pdu[]): URange[] {
  const out: URange[] = [];
  for (const d of devices) {
    if (d.rackId !== rackId || d.placement.kind !== 'rack') continue;
    out.push({ id: d.id, kind: 'device', start: d.placement.startU, end: d.placement.startU + d.placement.heightU - 1 });
  }
  // A tower on a shelf reserves the units directly above the shelf once its height is confirmed.
  // The shelf's own U is counted once (by the shelf), never again for the tower.
  for (const d of devices) {
    if (d.rackId !== rackId || d.placement.kind !== 'shelf' || d.placement.confirmedHeightU === null) continue;
    const shelfId = d.placement.shelfId;
    const shelf = devices.find((x) => x.id === shelfId);
    if (!shelf || shelf.placement.kind !== 'rack') continue;
    const start = shelf.placement.startU + shelf.placement.heightU;
    out.push({ id: d.id, kind: 'device', start, end: start + d.placement.confirmedHeightU - 1 });
  }
  for (const p of pdus) {
    if (p.rackId !== rackId || p.mounting !== 'horizontal' || p.startU === null) continue;
    out.push({ id: p.id, kind: 'pdu', start: p.startU, end: p.startU + Math.max(1, p.heightU) - 1 });
  }
  return out.sort((a, b) => a.start - b.start);
}

export type PlaceError =
  | { code: 'invalid_height' }
  | { code: 'out_of_range'; rackHeight: number }
  | { code: 'overlap'; withIds: ID[] };

export function checkPlacement(
  rack: Rack,
  ranges: URange[],
  startU: number,
  heightU: number,
  ignoreId?: ID,
): PlaceError | null {
  if (!isValidHeight(heightU)) return { code: 'invalid_height' };
  if (!Number.isInteger(startU) || startU < 1 || startU + heightU - 1 > rack.heightU) return { code: 'out_of_range', rackHeight: rack.heightU };
  const end = startU + heightU - 1;
  const hits = ranges.filter((r) => r.id !== ignoreId && r.start <= end && r.end >= startU).map((r) => r.id);
  if (hits.length) return { code: 'overlap', withIds: hits };
  return null;
}

/** Free contiguous blocks, bottom-up. */
export function freeBlocks(rack: Rack, ranges: URange[]): { start: number; size: number }[] {
  const used = new Array<boolean>(rack.heightU + 2).fill(false);
  for (const r of ranges) for (let u = r.start; u <= r.end; u++) if (u >= 1 && u <= rack.heightU) used[u] = true;
  const blocks: { start: number; size: number }[] = [];
  let u = 1;
  while (u <= rack.heightU) {
    if (used[u]) {
      u++;
      continue;
    }
    const start = u;
    while (u <= rack.heightU && !used[u]) u++;
    blocks.push({ start, size: u - start });
  }
  return blocks;
}

export type AutoPlaceResult =
  | { ok: true; startUs: number[] }
  | { ok: false; placed: number; requested: number; heightU: number; largestFree: number; missingSlots: number };

/**
 * Deterministic first-fit, bottom-up. All-or-nothing: validates the whole batch before
 * returning positions. Never moves existing devices.
 */
export function autoPlace(rack: Rack, ranges: URange[], heightU: number, quantity: number): AutoPlaceResult {
  if (!isValidHeight(heightU) || !Number.isInteger(quantity) || quantity < 1) {
    return { ok: false, placed: 0, requested: quantity, heightU, largestFree: 0, missingSlots: quantity };
  }
  const working = [...ranges];
  const starts: number[] = [];
  for (let i = 0; i < quantity; i++) {
    const block = freeBlocks(rack, working).find((b) => b.size >= heightU);
    if (!block) break;
    starts.push(block.start);
    working.push({ id: `__tmp${i}`, kind: 'device', start: block.start, end: block.start + heightU - 1 });
  }
  if (starts.length === quantity) return { ok: true, startUs: starts };
  const largestFree = Math.max(0, ...freeBlocks(rack, ranges).map((b) => b.size));
  return { ok: false, placed: starts.length, requested: quantity, heightU, largestFree, missingSlots: quantity - starts.length };
}

/** Lowest rack height that still contains every occupied unit. */
export function minRackHeight(ranges: URange[]): number {
  return ranges.reduce((m, r) => Math.max(m, r.end), 0);
}

export function checkResize(newHeight: number, ranges: URange[]): { ok: true } | { ok: false; code: 'invalid' } | { ok: false; code: 'would_hide'; minHeight: number; ids: ID[] } {
  if (!isValidRackHeight(newHeight)) return { ok: false, code: 'invalid' };
  const hidden = ranges.filter((r) => r.end > newHeight);
  if (hidden.length) return { ok: false, code: 'would_hide', minHeight: minRackHeight(ranges), ids: hidden.map((r) => r.id) };
  return { ok: true };
}

/** Validate every rack's placements (for imports). Returns problems found. */
export function auditPlacements(racks: Rack[], devices: DeviceInstance[], pdus: Pdu[]): { id: ID; code: 'overlap' | 'out_of_range' | 'invalid_height' | 'unknown_rack' }[] {
  const issues: { id: ID; code: 'overlap' | 'out_of_range' | 'invalid_height' | 'unknown_rack' }[] = [];
  const rackIds = new Set(racks.map((r) => r.id));
  for (const d of devices) if (!rackIds.has(d.rackId)) issues.push({ id: d.id, code: 'unknown_rack' });
  for (const p of pdus) if (!rackIds.has(p.rackId)) issues.push({ id: p.id, code: 'unknown_rack' });
  for (const rack of racks) {
    const ranges = occupiedRanges(rack.id, devices, pdus);
    for (const r of ranges) {
      const h = r.end - r.start + 1;
      if (!isValidHeight(h)) issues.push({ id: r.id, code: 'invalid_height' });
      else if (r.start < 1 || r.end > rack.heightU) issues.push({ id: r.id, code: 'out_of_range' });
    }
    for (let i = 0; i < ranges.length; i++)
      for (let j = i + 1; j < ranges.length; j++)
        if (ranges[i].start <= ranges[j].end && ranges[j].start <= ranges[i].end) issues.push({ id: ranges[j].id, code: 'overlap' });
  }
  return issues;
}
