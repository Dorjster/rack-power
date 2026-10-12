/**
 * Validated high-level operations. Every placement/connection change is checked before it
 * is committed; on failure nothing is changed and an error key is returned.
 */
import type { DeviceInstance, FeedLetter, ID, Pdu, PduTemplate, Project, Psu, Rack } from '../domain/types';
import { useStore } from './store';
import { autoPlace, checkPlacement, checkResize, occupiedRanges } from '../engine/placement';
import { cloneDevice, newRack, pduFromTemplate, uid } from '../domain/factory';
import { CONNECTOR_MATES } from '../catalog/pdus';

export type ActionResult = { ok: true; ids?: ID[] } | { ok: false; error: string; params?: Record<string, string | number> };

const get = () => useStore.getState();

export function usedOutletIds(p: Project): Set<ID> {
  const s = new Set<ID>();
  for (const d of p.devices) for (const dom of d.domains) for (const ps of dom.psus) if (ps.connection.outletId && ps.state !== 'removed') s.add(ps.connection.outletId);
  for (const b of p.dcBuses) b.rectifierOutletIds.forEach((o) => s.add(o));
  return s;
}

/** Preferred outlet type for a PSU inlet (C14→C13, C20→C19). */
function preferredOutlet(psu: Psu): string | null {
  for (const [sock, inlet] of Object.entries(CONNECTOR_MATES)) if (inlet === psu.inlet) return sock;
  return null;
}

/** Find free outlets on a feed in a rack, preferring compatible types. */
export function freeOutletsOnFeed(p: Project, rackId: ID, feed: FeedLetter, used = usedOutletIds(p)) {
  const out: { pdu: Pdu; outletId: ID; type: string }[] = [];
  for (const pdu of p.pdus.filter((x) => x.rackId === rackId && x.feed === feed))
    for (const b of pdu.banks) for (const o of b.outlets) if (!used.has(o.id)) out.push({ pdu, outletId: o.id, type: o.type });
  return out;
}

/**
 * Proposed PSU→feed mapping: PSU1→A, PSU2→B, alternating. Returns null outlet when no matching
 * free socket exists. The user confirms/edits every mapping.
 */
export function proposeMapping(p: Project, d: DeviceInstance): { psuId: ID; feed: FeedLetter; outletId: ID | null }[] {
  const used = usedOutletIds(p);
  for (const dom of d.domains) for (const ps of dom.psus) if (ps.connection.outletId) used.delete(ps.connection.outletId);
  const rackFeeds = Array.from(new Set(p.pdus.filter((x) => x.rackId === d.rackId).map((x) => x.feed))).sort() as FeedLetter[];
  const res: { psuId: ID; feed: FeedLetter; outletId: ID | null }[] = [];
  let i = 0;
  for (const dom of d.domains)
    for (const ps of dom.psus) {
      if (ps.state === 'removed' || ps.inputType !== 'AC') continue;
      const feed = rackFeeds.length ? rackFeeds[i % rackFeeds.length] : 'A';
      i++;
      const free = freeOutletsOnFeed(p, d.rackId, feed, used);
      const pref = preferredOutlet(ps);
      const pick = free.find((f) => f.type === pref) ?? (ps.inlet === 'unknown' ? free[0] : free.find((f) => f.type === 'C19' && ps.inlet === 'C14')) ?? null;
      if (pick) used.add(pick.outletId);
      res.push({ psuId: ps.id, feed, outletId: pick?.outletId ?? null });
    }
  return res;
}

export function applyMapping(deviceId: ID, mapping: { psuId: ID; outletId: ID | null }[]): ActionResult {
  const p = get().project;
  const d = p.devices.find((x) => x.id === deviceId);
  if (!d) return { ok: false, error: 'err.notFound' };
  const used = usedOutletIds(p);
  for (const dom of d.domains) for (const ps of dom.psus) if (ps.connection.outletId) used.delete(ps.connection.outletId);
  const seen = new Set<ID>();
  for (const m of mapping) {
    if (!m.outletId) continue;
    if (used.has(m.outletId) || seen.has(m.outletId)) return { ok: false, error: 'err.outletUsed' };
    seen.add(m.outletId);
  }
  get().update((draft) => {
    const dd = draft.devices.find((x) => x.id === deviceId)!;
    for (const dom of dd.domains)
      for (const ps of dom.psus) {
        const m = mapping.find((x) => x.psuId === ps.id);
        if (m) ps.connection = { ...ps.connection, outletId: m.outletId };
      }
  });
  return { ok: true };
}

export function connectPsu(psuId: ID, outletId: ID | null): ActionResult {
  const p = get().project;
  if (outletId && usedOutletIds(p).has(outletId)) {
    const owner = p.devices.find((d) => d.domains.some((dom) => dom.psus.some((ps) => ps.id === psuId && ps.connection.outletId === outletId)));
    if (!owner) return { ok: false, error: 'err.outletUsed' };
  }
  get().update((draft) => {
    for (const d of draft.devices) for (const dom of d.domains) for (const ps of dom.psus) if (ps.id === psuId) ps.connection = { ...ps.connection, outletId, dcBusId: outletId ? null : ps.connection.dcBusId };
  });
  return { ok: true };
}

/**
 * Add `quantity` devices built by `make` (each gets a unique ID). Placement is validated for the
 * whole batch before committing; on failure nothing is added.
 */
export function addDevices(
  rackId: ID,
  make: () => DeviceInstance,
  quantity: number,
  placement: { mode: 'auto' } | { mode: 'manual'; startU: number } | { mode: 'zero_u' | 'outside' | 'unplaced' },
  heightU: number,
  autoConnect: boolean,
): ActionResult {
  const p = get().project;
  const rack = p.racks.find((r) => r.id === rackId);
  if (!rack) return { ok: false, error: 'err.notFound' };
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 60) return { ok: false, error: 'err.quantity' };
  const ranges = occupiedRanges(rackId, p.devices, p.pdus);
  let starts: (number | null)[] = Array(quantity).fill(null);
  if (placement.mode === 'auto') {
    const r = autoPlace(rack, ranges, heightU, quantity);
    if (!r.ok) return { ok: false, error: 'err.noSpace', params: { requested: quantity, placed: r.placed, missing: r.missingSlots, h: heightU, largest: r.largestFree } };
    starts = r.startUs;
  } else if (placement.mode === 'manual') {
    const work = [...ranges];
    for (let i = 0; i < quantity; i++) {
      const s = placement.startU + i * heightU;
      const err = checkPlacement(rack, work, s, heightU);
      if (err) return { ok: false, error: `err.place.${err.code}`, params: { u: s, rack: rack.heightU } };
      work.push({ id: `tmp${i}`, kind: 'device', start: s, end: s + heightU - 1 });
      starts[i] = s;
    }
  }
  const devices: DeviceInstance[] = starts.map((s, i) => {
    const d = make();
    d.rackId = rackId;
    if (quantity > 1) d.name = `${d.name} #${i + 1}`;
    if (s !== null) d.placement = { kind: 'rack', startU: s, heightU };
    else if (placement.mode === 'zero_u') d.placement = { kind: 'zero_u', side: 'left' };
    else if (placement.mode === 'outside') d.placement = { kind: 'outside' };
    else d.placement = { kind: 'unplaced' };
    return d;
  });
  get().update((draft) => {
    for (const d of devices) {
      draft.devices.push(d);
      if (autoConnect) {
        const map = proposeMapping(draft, d);
        for (const m of map) {
          const ps = d.domains.flatMap((x) => x.psus).find((x) => x.id === m.psuId);
          if (ps && m.outletId) ps.connection = { outletId: m.outletId };
        }
      }
    }
  });
  return { ok: true, ids: devices.map((d) => d.id) };
}

export function moveDevice(id: ID, startU: number): ActionResult {
  const p = get().project;
  const d = p.devices.find((x) => x.id === id);
  if (!d || d.placement.kind !== 'rack') return { ok: false, error: 'err.notFound' };
  const rack = p.racks.find((r) => r.id === d.rackId)!;
  const err = checkPlacement(rack, occupiedRanges(rack.id, p.devices, p.pdus), startU, d.placement.heightU, id);
  if (err) return { ok: false, error: `err.place.${err.code}`, params: { u: startU, rack: rack.heightU } };
  get().update((draft) => {
    const dd = draft.devices.find((x) => x.id === id)!;
    if (dd.placement.kind === 'rack') dd.placement.startU = startU;
  });
  return { ok: true };
}

export function setPlacement(id: ID, placement: DeviceInstance['placement']): ActionResult {
  const p = get().project;
  const d = p.devices.find((x) => x.id === id);
  if (!d) return { ok: false, error: 'err.notFound' };
  const rack = p.racks.find((r) => r.id === d.rackId)!;
  if (placement.kind === 'rack') {
    const err = checkPlacement(rack, occupiedRanges(rack.id, p.devices, p.pdus), placement.startU, placement.heightU, id);
    if (err) return { ok: false, error: `err.place.${err.code}`, params: { u: placement.startU, rack: rack.heightU } };
  }
  if (placement.kind === 'shelf') {
    const shelf = p.devices.find((x) => x.id === placement.shelfId);
    if (!shelf || shelf.passiveKind !== 'shelf' || shelf.placement.kind !== 'rack') return { ok: false, error: 'err.noShelf' };
    if (placement.confirmedHeightU !== null) {
      const start = shelf.placement.startU + shelf.placement.heightU;
      const err = checkPlacement(rack, occupiedRanges(rack.id, p.devices, p.pdus), start, placement.confirmedHeightU, id);
      if (err) return { ok: false, error: `err.place.${err.code}`, params: { u: start, rack: rack.heightU } };
    }
  }
  get().update((draft) => {
    draft.devices.find((x) => x.id === id)!.placement = placement;
  });
  return { ok: true };
}

/** Move across racks: identity preserved; connections to the old rack's PDUs are cleared and re-proposed. */
export function moveToRack(id: ID, rackId: ID): ActionResult {
  const p = get().project;
  const d = p.devices.find((x) => x.id === id);
  const dest = p.racks.find((r) => r.id === rackId);
  if (!d || !dest) return { ok: false, error: 'err.notFound' };
  if (d.rackId === rackId) return { ok: true };
  let placement = d.placement;
  if (d.placement.kind === 'rack') {
    const r = autoPlace(dest, occupiedRanges(rackId, p.devices, p.pdus), d.placement.heightU, 1);
    if (!r.ok) return { ok: false, error: 'err.noSpace', params: { requested: 1, placed: 0, missing: 1, h: d.placement.heightU, largest: r.largestFree } };
    placement = { kind: 'rack', startU: r.startUs[0], heightU: d.placement.heightU };
  } else if (d.placement.kind === 'shelf') placement = { kind: 'unplaced' };
  get().update((draft) => {
    const dd = draft.devices.find((x) => x.id === id)!;
    dd.rackId = rackId;
    dd.placement = placement;
    const destOutlets = new Set(draft.pdus.filter((x) => x.rackId === rackId).flatMap((x) => x.banks.flatMap((b) => b.outlets.map((o) => o.id))));
    for (const dom of dd.domains) for (const ps of dom.psus) if (ps.connection.outletId && !destOutlets.has(ps.connection.outletId)) ps.connection.outletId = null;
    for (const m of proposeMapping(draft, dd)) {
      const ps = dd.domains.flatMap((x) => x.psus).find((x) => x.id === m.psuId);
      if (ps && !ps.connection.outletId && m.outletId) ps.connection.outletId = m.outletId;
    }
  });
  return { ok: true };
}

export function duplicateDevice(id: ID): ActionResult {
  const p = get().project;
  const d = p.devices.find((x) => x.id === id);
  if (!d) return { ok: false, error: 'err.notFound' };
  const h = d.placement.kind === 'rack' ? d.placement.heightU : 1;
  return addDevices(
    d.rackId,
    () => cloneDevice(d),
    1,
    d.placement.kind === 'rack' ? { mode: 'auto' } : { mode: d.placement.kind === 'outside' ? 'outside' : 'unplaced' },
    h,
    true,
  );
}

export function deleteDevice(id: ID) {
  get().update((draft) => {
    draft.devices = draft.devices.filter((x) => x.id !== id);
    for (const d of draft.devices) {
      if (d.poweredByPoeSwitchId === id) d.poweredByPoeSwitchId = null;
      if (d.placement.kind === 'shelf' && d.placement.shelfId === id) d.placement = { kind: 'unplaced' };
    }
    for (const u of draft.upses) if (u.rackDeviceId === id) u.rackDeviceId = null;
  });
  if (get().selectedDeviceId === id) get().setUi({ selectedDeviceId: null });
}

export function resizeRack(rackId: ID, heightU: number): ActionResult {
  const p = get().project;
  const r = checkResize(heightU, occupiedRanges(rackId, p.devices, p.pdus));
  if (!r.ok) return r.code === 'would_hide' ? { ok: false, error: 'err.resizeHide', params: { min: r.minHeight, n: r.ids.length } } : { ok: false, error: 'err.rackHeight' };
  get().update((draft) => {
    draft.racks.find((x) => x.id === rackId)!.heightU = heightU;
  });
  return { ok: true };
}

export function addRack(partial: Partial<Rack> = {}): ID {
  const rack = newRack({ name: `Rack ${get().project.racks.length + 1}`, ...partial });
  get().update((d) => {
    d.racks.push(rack);
  });
  get().setUi({ selectedRackId: rack.id });
  return rack.id;
}

export function deleteRack(rackId: ID): ActionResult {
  const p = get().project;
  if (p.racks.length <= 1) return { ok: false, error: 'err.lastRack' };
  get().update((d) => {
    const pduIds = new Set(d.pdus.filter((x) => x.rackId === rackId).map((x) => x.id));
    const outletIds = new Set(d.pdus.filter((x) => pduIds.has(x.id)).flatMap((x) => x.banks.flatMap((b) => b.outlets.map((o) => o.id))));
    d.racks = d.racks.filter((r) => r.id !== rackId);
    d.devices = d.devices.filter((x) => x.rackId !== rackId);
    d.pdus = d.pdus.filter((x) => x.rackId !== rackId);
    for (const dev of d.devices) for (const dom of dev.domains) for (const ps of dom.psus) if (ps.connection.outletId && outletIds.has(ps.connection.outletId)) ps.connection.outletId = null;
    d.manualChecks = d.manualChecks.filter((m) => m.rackId !== rackId);
  });
  get().setUi({ selectedRackId: get().project.racks[0].id, selectedDeviceId: null });
  return { ok: true };
}

export function addPduFromTemplate(rackId: ID, t: PduTemplate, feed: FeedLetter, side: 'left' | 'right', startU?: number): ActionResult {
  const p = get().project;
  const pdu = pduFromTemplate(rackId, t, feed, side);
  pdu.name = `PDU-${feed}${p.pdus.filter((x) => x.rackId === rackId && x.feed === feed).length ? p.pdus.filter((x) => x.rackId === rackId && x.feed === feed).length + 1 : ''}`;
  if (pdu.mounting === 'horizontal') {
    const rack = p.racks.find((r) => r.id === rackId)!;
    const h = Math.max(1, pdu.heightU);
    let s = startU ?? null;
    if (s === null) {
      const r = autoPlace(rack, occupiedRanges(rackId, p.devices, p.pdus), h, 1);
      if (!r.ok) return { ok: false, error: 'err.noSpace', params: { requested: 1, placed: 0, missing: 1, h, largest: r.largestFree } };
      s = r.startUs[0];
    } else {
      const err = checkPlacement(rack, occupiedRanges(rackId, p.devices, p.pdus), s, h);
      if (err) return { ok: false, error: `err.place.${err.code}`, params: { u: s, rack: rack.heightU } };
    }
    pdu.startU = s;
  }
  get().update((d) => {
    d.pdus.push(pdu);
  });
  return { ok: true, ids: [pdu.id] };
}

export function deletePdu(pduId: ID) {
  get().update((d) => {
    const pdu = d.pdus.find((x) => x.id === pduId);
    if (!pdu) return;
    const outletIds = new Set(pdu.banks.flatMap((b) => b.outlets.map((o) => o.id)));
    d.pdus = d.pdus.filter((x) => x.id !== pduId);
    for (const dev of d.devices) for (const dom of dev.domains) for (const ps of dom.psus) if (ps.connection.outletId && outletIds.has(ps.connection.outletId)) ps.connection.outletId = null;
    for (const b of d.dcBuses) b.rectifierOutletIds = b.rectifierOutletIds.filter((o) => !outletIds.has(o));
  });
}

/** Ensure a rack has a standard set of upstream records for A/B (user must confirm independence). */
export function ensureUpstream(rackId: ID, independent: boolean | null) {
  get().update((d) => {
    const pdus = d.pdus.filter((x) => x.rackId === rackId);
    const feeds = Array.from(new Set(pdus.map((x) => x.feed)));
    let shared: { srcId: string; brId: string } | null = null;
    for (const feed of feeds) {
      for (const pdu of pdus.filter((x) => x.feed === feed)) {
        if (pdu.upstream) continue;
        if (independent === null) continue;
        if (!independent && shared) {
          pdu.upstream = { kind: 'branch', id: shared.brId };
          continue;
        }
        const src = { id: uid('src'), name: `Source ${feed}`, kind: 'unknown' as const, note: '' };
        const br = { id: uid('br'), name: `Branch ${feed}`, breakerA: pdu.nominalA, breakerIsUsable: false, phases: (pdu.topology === '1ph' ? 1 : 3) as 1 | 3, voltage: pdu.voltage, upsId: null, sourceId: src.id };
        d.sources.push(src);
        d.branches.push(br);
        pdu.upstream = { kind: 'branch', id: br.id };
        if (!independent) shared = { srcId: src.id, brId: br.id };
      }
    }
  });
}
