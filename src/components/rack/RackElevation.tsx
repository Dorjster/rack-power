import { useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import type { DeviceInstance, ID, Pdu, Rack } from '../../domain/types';
import type { ScenarioResult } from '../../engine/scenario';
import { FrontPanel, RearPanel } from './Faceplates';
import { checkPlacement, occupiedRanges } from '../../engine/placement';
import { fmtNum } from '../../engine/format';
import { useT } from '../../i18n';

export const FEED_COLOR: Record<string, string> = { A: '#3b82f6', B: '#f97316', C: '#22c55e' };
const DISCONNECTED = '#ef4444';

const U = 20;
const TOP = 26;
const LABEL_W = 30;
const PDU_W = 30;
const RAIL = 12;
const INNER_W = 360;

interface Props {
  rack: Rack;
  devices: DeviceInstance[];
  allDevices: DeviceInstance[];
  pdus: Pdu[];
  allPdus: Pdu[];
  result: ScenarioResult;
  typical: ScenarioResult;
  view: 'front' | 'rear';
  showWiring: boolean;
  selectedId: ID | null;
  onSelect: (id: ID) => void;
  onMove: (id: ID, startU: number) => void;
}

const BAD = new Set(['unpowered', 'partially_unpowered', 'shutdown_risk', 'over_capacity']);
const WARN = new Set(['possible_throttling', 'unknown_behavior', 'degraded', 'not_connected']);

export function RackElevation(props: Props) {
  const { rack, devices, pdus, result, typical, view, showWiring, selectedId, onSelect, onMove } = props;
  const { t } = useT();
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<{ id: ID; grabOffset: number; targetU: number; valid: boolean; moved: boolean; startY: number } | null>(null);
  const [hover, setHover] = useState<{ id: ID; x: number; y: number } | null>(null);

  const zeroU = pdus.filter((p) => p.mounting === 'zero_u');
  const leftPdus = zeroU.filter((p) => p.side === 'left');
  const rightPdus = zeroU.filter((p) => p.side === 'right');
  const leftColW = Math.max(1, leftPdus.length) * PDU_W;
  const rightColW = Math.max(1, rightPdus.length) * PDU_W;
  const rackX = LABEL_W + leftColW + 4;
  const innerX = rackX + RAIL;
  const W = innerX + INNER_W + RAIL + 4 + rightColW + 4;
  const H = TOP + rack.heightU * U + 16;
  const yOfU = (u: number) => TOP + (rack.heightU - u) * U; // top edge of unit u

  const ranges = useMemo(() => occupiedRanges(rack.id, props.allDevices, props.allPdus), [rack.id, props.allDevices, props.allPdus]);

  // Socket positions for 0U PDUs (vertical) and horizontal PDUs
  const socketPos = useMemo(() => {
    const map = new Map<ID, { x: number; y: number; pdu: Pdu }>();
    const place = (list: Pdu[], baseX: number) =>
      list.forEach((p, i) => {
        const outs = p.banks.flatMap((b) => b.outlets);
        const avail = rack.heightU * U - 20;
        const pitch = Math.min(U * 0.95, avail / Math.max(1, outs.length));
        outs.forEach((o, j) => map.set(o.id, { x: baseX + i * PDU_W + PDU_W / 2, y: TOP + 14 + j * pitch + pitch / 2, pdu: p }));
      });
    place(leftPdus, LABEL_W);
    place(rightPdus, innerX + INNER_W + RAIL + 4);
    for (const p of pdus.filter((x) => x.mounting === 'horizontal' && x.startU !== null)) {
      const outs = p.banks.flatMap((b) => b.outlets);
      const pitch = (INNER_W - 40) / Math.max(1, outs.length);
      outs.forEach((o, j) => map.set(o.id, { x: innerX + 30 + j * pitch + pitch / 2, y: yOfU(p.startU! + Math.max(1, p.heightU) - 1) + (Math.max(1, p.heightU) * U) / 2, pdu: p }));
    }
    return map;
  }, [leftPdus, rightPdus, pdus, rack.heightU, innerX]);

  const usedOutlets = useMemo(() => {
    const m = new Map<ID, string>();
    for (const d of props.allDevices) for (const dom of d.domains) for (const p of dom.psus) if (p.connection.outletId) m.set(p.connection.outletId, d.name);
    return m;
  }, [props.allDevices]);

  const svgPoint = (e: { clientX: number; clientY: number }) => {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    return pt.matrixTransform(svg.getScreenCTM()!.inverse());
  };
  const uAtY = (y: number) => rack.heightU - Math.floor((y - TOP) / U);

  const onDown = (e: RPointerEvent, d: DeviceInstance) => {
    if (d.placement.kind !== 'rack' || e.button !== 0) return;
    const p = svgPoint(e);
    const topU = d.placement.startU + d.placement.heightU - 1;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    setDrag({ id: d.id, grabOffset: topU - uAtY(p.y), targetU: d.placement.startU, valid: true, moved: false, startY: p.y });
  };
  const onMoveP = (e: RPointerEvent, d: DeviceInstance) => {
    if (!drag || drag.id !== d.id || d.placement.kind !== 'rack') return;
    const p = svgPoint(e);
    const moved = drag.moved || Math.abs(p.y - drag.startY) > 4;
    const topU = uAtY(p.y) + drag.grabOffset;
    const startU = topU - d.placement.heightU + 1;
    const err = checkPlacement(rack, ranges, startU, d.placement.heightU, d.id);
    setDrag({ ...drag, targetU: startU, valid: !err, moved });
  };
  const onUp = (_e: RPointerEvent, d: DeviceInstance) => {
    if (!drag || drag.id !== d.id) return;
    if (!drag.moved) onSelect(d.id);
    else if (drag.valid && d.placement.kind === 'rack' && drag.targetU !== d.placement.startU) onMove(d.id, drag.targetU);
    setDrag(null);
  };

  const rackDevices = devices.filter((d) => d.placement.kind === 'rack');
  const shelfTowers = devices.filter((d) => d.placement.kind === 'shelf');
  const hoverDev = hover ? devices.find((d) => d.id === hover.id) : undefined;

  const wattLabel = (d: DeviceInstance) => {
    const typ = typical.devices[d.id]?.load.inputW;
    const des = result.devices[d.id]?.load.inputW;
    if (d.power.passiveZero) return '0 W';
    if (d.poweredByPoeSwitchId) return 'PoE';
    return `${typ === null || typ === undefined ? '?' : fmtNum(typ, 0)} / ${des === null || des === undefined ? '?' : fmtNum(des, 0)} W`;
  };

  const renderDevice = (d: DeviceInstance, startU: number, heightU: number, ghost = false) => {
    const y = yOfU(startU + heightU - 1);
    const h = heightU * U;
    const st = result.devices[d.id]?.status ?? 'ok';
    const sel = selectedId === d.id;
    const bad = BAD.has(st);
    const warn = WARN.has(st);
    const nameMax = Math.floor((INNER_W - 140) / 5.6);
    const name = d.name.length > nameMax ? `${d.name.slice(0, nameMax - 1)}…` : d.name;
    const unknown = !d.power.passiveZero && !d.poweredByPoeSwitchId && typical.devices[d.id]?.load.inputW === null;
    return (
      <g transform={`translate(${innerX},${y})`} opacity={ghost ? 0.35 : 1}>
        {view === 'front' ? (
          <FrontPanel w={INNER_W} h={h} category={d.category} passiveKind={d.passiveKind} heightU={heightU} />
        ) : (
          <RearPanel w={INNER_W} h={h} category={d.category} heightU={heightU} />
        )}
        {/* label band */}
        <rect x={INNER_W * 0.5 - 4} y={h / 2 - 7} width={INNER_W * 0.5 - 6} height={14} fill="#020617" opacity={0.78} rx={2} />
        <text x={INNER_W * 0.5} y={h / 2 + 3.5} fontSize={9.5} fill="#f1f5f9" fontWeight={600}>
          {bad ? '✕ ' : warn ? '⚠ ' : ''}
          {name}
        </text>
        <text x={INNER_W - 12} y={h / 2 + 3.5} fontSize={9} textAnchor="end" fill={unknown ? '#fbbf24' : d.power.passiveZero ? '#64748b' : '#67e8f9'} fontFamily="var(--font-mono)">
          {wattLabel(d)}
        </text>
        <rect
          x={0.5}
          y={0.5}
          width={INNER_W - 1}
          height={h - 1}
          fill="none"
          stroke={sel ? '#22d3ee' : bad ? DISCONNECTED : warn ? '#f59e0b' : 'transparent'}
          strokeWidth={sel ? 2.2 : 1.6}
          strokeDasharray={bad ? '5 3' : undefined}
          rx={1}
        />
      </g>
    );
  };

  // PSU rects in rear view
  const psuRects = useMemo(() => {
    const out: { id: ID; x: number; y: number; w: number; h: number; d: DeviceInstance; label: string; outletId: ID | null; state: string }[] = [];
    for (const d of rackDevices) {
      if (d.placement.kind !== 'rack') continue;
      const psus = d.domains.flatMap((x) => x.psus);
      const h = d.placement.heightU * U;
      const y0 = yOfU(d.placement.startU + d.placement.heightU - 1);
      const ph = Math.min(h - 4, 12);
      psus.forEach((p, i) => {
        const left = i % 2 === 0;
        const k = Math.floor(i / 2);
        const x = left ? innerX + 12 + k * 30 : innerX + INNER_W - 12 - 26 - k * 30;
        out.push({ id: p.id, x, y: y0 + (h - ph) / 2, w: 26, h: ph, d, label: p.label, outletId: p.connection.outletId, state: p.state });
      });
    }
    return out;
  }, [rackDevices, innerX]);

  return (
    <div className="relative">
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full select-none" role="img" aria-label={`${rack.name} ${t(view === 'front' ? 'rack.front' : 'rack.rear')}`} style={{ touchAction: drag ? 'none' : 'pan-y' }}>
        <rect x={0} y={0} width={W} height={H} fill="#0b1220" />
        <text x={W / 2} y={15} textAnchor="middle" fontSize={11} fill="#94a3b8" fontWeight={600}>
          {rack.name} · {rack.heightU}U · {t(view === 'front' ? 'rack.front' : 'rack.rear')}
        </text>
        {/* frame */}
        <rect x={rackX} y={TOP - 2} width={INNER_W + RAIL * 2} height={rack.heightU * U + 4} fill="#030712" stroke="#334155" rx={3} />
        <rect x={rackX} y={TOP} width={RAIL} height={rack.heightU * U} fill="#1e293b" />
        <rect x={innerX + INNER_W} y={TOP} width={RAIL} height={rack.heightU * U} fill="#1e293b" />
        {Array.from({ length: rack.heightU }, (_, i) => {
          const u = i + 1;
          const y = yOfU(u);
          return (
            <g key={u}>
              <line x1={innerX} x2={innerX + INNER_W} y1={y + U} y2={y + U} stroke="#111827" strokeWidth={0.6} />
              <text x={LABEL_W - 4} y={y + U / 2 + 3} fontSize={8.5} textAnchor="end" fill="#64748b" fontFamily="var(--font-mono)">
                {u}
              </text>
              <circle cx={rackX + RAIL / 2} cy={y + U / 2} r={1.3} fill="#475569" />
              <circle cx={innerX + INNER_W + RAIL / 2} cy={y + U / 2} r={1.3} fill="#475569" />
            </g>
          );
        })}

        {/* 0U PDUs */}
        {[...leftPdus.map((p, i) => ({ p, x: LABEL_W + i * PDU_W })), ...rightPdus.map((p, i) => ({ p, x: innerX + INNER_W + RAIL + 4 + i * PDU_W }))].map(({ p, x }) => {
          const powered = result.pdus[p.id]?.powered ?? true;
          const color = FEED_COLOR[p.feed] ?? '#94a3b8';
          const outs = p.banks.flatMap((b) => b.outlets);
          return (
            <g key={p.id}>
              <rect x={x + 3} y={TOP} width={PDU_W - 6} height={rack.heightU * U} fill="#0f172a" stroke={powered ? color : '#475569'} strokeWidth={view === 'rear' ? 1.5 : 1} strokeDasharray={powered ? undefined : '4 3'} rx={3} />
              <text x={x + PDU_W / 2} y={TOP + 10} textAnchor="middle" fontSize={9} fontWeight={700} fill={powered ? color : '#64748b'}>
                {p.feed}
              </text>
              {view === 'rear' &&
                outs.map((o) => {
                  const pos = socketPos.get(o.id)!;
                  const used = usedOutlets.has(o.id);
                  const big = o.type === 'C19';
                  return (
                    <g key={o.id}>
                      <rect x={pos.x - (big ? 7 : 6)} y={pos.y - 5} width={big ? 14 : 12} height={10} rx={1.5} fill={used ? color : '#1e293b'} stroke={used ? color : '#475569'} strokeWidth={0.7} opacity={used ? 0.9 : 1}>
                        <title>{`${p.name} #${o.index} ${o.type}${used ? ` → ${usedOutlets.get(o.id)}` : ` (${t('rack.free')})`}`}</title>
                      </rect>
                      <text x={pos.x} y={pos.y + 2.5} textAnchor="middle" fontSize={6} fill={used ? '#020617' : '#94a3b8'} fontFamily="var(--font-mono)">
                        {o.index}
                      </text>
                    </g>
                  );
                })}
              {view === 'front' && (
                <text x={x + PDU_W / 2} y={TOP + rack.heightU * U - 6} textAnchor="middle" fontSize={7} fill="#94a3b8">
                  {outs.filter((o) => usedOutlets.has(o.id)).length}/{outs.length}
                </text>
              )}
            </g>
          );
        })}

        {/* Horizontal PDUs */}
        {pdus
          .filter((p) => p.mounting === 'horizontal' && p.startU !== null)
          .map((p) => {
            const h = Math.max(1, p.heightU) * U;
            const y = yOfU(p.startU! + Math.max(1, p.heightU) - 1);
            const color = FEED_COLOR[p.feed];
            return (
              <g key={p.id}>
                <rect x={innerX} y={y} width={INNER_W} height={h} fill="#111827" stroke={color} rx={1} />
                <text x={innerX + 6} y={y + h / 2 + 3} fontSize={9} fill={color} fontWeight={700}>
                  {p.name}
                </text>
                {p.banks
                  .flatMap((b) => b.outlets)
                  .map((o) => {
                    const pos = socketPos.get(o.id)!;
                    return <rect key={o.id} x={pos.x - 4} y={pos.y - 4} width={8} height={8} fill={usedOutlets.has(o.id) ? color : '#1e293b'} stroke="#475569" strokeWidth={0.5} />;
                  })}
              </g>
            );
          })}

        {/* Devices */}
        {rackDevices.map((d) =>
          d.placement.kind === 'rack' ? (
            <g
              key={d.id}
              className="cursor-grab"
              tabIndex={0}
              role="button"
              aria-label={`${d.name} U${d.placement.startU}`}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelect(d.id);
                }
                if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && d.placement.kind === 'rack') {
                  e.preventDefault();
                  const ns = d.placement.startU + (e.key === 'ArrowUp' ? 1 : -1);
                  if (!checkPlacement(rack, ranges, ns, d.placement.heightU, d.id)) onMove(d.id, ns);
                }
              }}
              onPointerDown={(e) => onDown(e, d)}
              onPointerMove={(e) => onMoveP(e, d)}
              onPointerUp={(e) => onUp(e, d)}
              onPointerCancel={() => setDrag(null)}
              onPointerEnter={(e) => {
                const r = svgRef.current!.getBoundingClientRect();
                setHover({ id: d.id, x: e.clientX - r.left, y: e.clientY - r.top });
              }}
              onPointerLeave={() => setHover(null)}
            >
              {renderDevice(d, d.placement.startU, d.placement.heightU)}
            </g>
          ) : null,
        )}

        {/* Towers on shelves (reserved space above shelf) */}
        {shelfTowers.map((d) => {
          if (d.placement.kind !== 'shelf') return null;
          const shelfId = d.placement.shelfId;
          const shelf = props.allDevices.find((x) => x.id === shelfId);
          if (!shelf || shelf.placement.kind !== 'rack') return null;
          const hU = d.placement.confirmedHeightU ?? 2;
          const start = shelf.placement.startU + shelf.placement.heightU;
          const y = yOfU(Math.min(rack.heightU, start + hU - 1));
          return (
            <g key={d.id} onClick={() => onSelect(d.id)} className="cursor-pointer">
              <rect x={innerX + INNER_W * 0.3} y={y} width={INNER_W * 0.4} height={hU * U - 1} fill="#1f2937" stroke={d.placement.confirmedHeightU === null ? '#f59e0b' : '#64748b'} strokeDasharray={d.placement.confirmedHeightU === null ? '4 2' : undefined} />
              <text x={innerX + INNER_W / 2} y={y + 12} textAnchor="middle" fontSize={9} fill="#e2e8f0">
                {d.name}
              </text>
              <text x={innerX + INNER_W / 2} y={y + 23} textAnchor="middle" fontSize={8} fill="#94a3b8">
                {t('rack.towerOnShelf')}
              </text>
            </g>
          );
        })}

        {/* Drag ghost */}
        {drag &&
          drag.moved &&
          (() => {
            const d = devices.find((x) => x.id === drag.id);
            if (!d || d.placement.kind !== 'rack') return null;
            const h = d.placement.heightU;
            const clamped = Math.max(1, Math.min(rack.heightU - h + 1, drag.targetU));
            const y = yOfU(clamped + h - 1);
            return (
              <g pointerEvents="none">
                <rect x={innerX} y={y} width={INNER_W} height={h * U} fill={drag.valid ? '#22d3ee33' : '#ef444433'} stroke={drag.valid ? '#22d3ee' : '#ef4444'} strokeWidth={2} strokeDasharray="6 3" />
                <text x={innerX + INNER_W / 2} y={y + (h * U) / 2 + 4} textAnchor="middle" fontSize={11} fontWeight={700} fill={drag.valid ? '#67e8f9' : '#fca5a5'}>
                  {drag.valid ? `U${drag.targetU}–U${drag.targetU + h - 1}` : t('rack.invalidDrop')}
                </text>
              </g>
            );
          })()}

        {/* Wiring (rear) */}
        {view === 'rear' &&
          psuRects.map((pr) => {
            const pos = pr.outletId ? socketPos.get(pr.outletId) : undefined;
            const disconnected = !pr.outletId || pr.state === 'removed';
            const color = disconnected ? DISCONNECTED : pos ? FEED_COLOR[pos.pdu.feed] : '#a855f7';
            const powered = pos ? result.pdus[pos.pdu.id]?.powered ?? true : false;
            const failed = pr.state === 'failed' || result.def.failures.psuIds.includes(pr.id);
            const cx = pr.x + pr.w / 2;
            const cy = pr.y + pr.h / 2;
            return (
              <g key={pr.id}>
                {showWiring && pos && !disconnected && (
                  <path
                    d={`M${cx} ${cy} C ${(cx + pos.x) / 2} ${cy}, ${(cx + pos.x) / 2} ${pos.y}, ${pos.x} ${pos.y}`}
                    fill="none"
                    stroke={powered && !failed ? color : '#64748b'}
                    strokeWidth={1.3}
                    strokeDasharray={powered && !failed ? undefined : '4 3'}
                    opacity={0.85}
                    pointerEvents="none"
                  />
                )}
                {showWiring && pr.outletId && !pos && (
                  <text x={cx} y={pr.y - 1} fontSize={6} fill="#a855f7" textAnchor="middle">
                    {t('rack.otherRack')}
                  </text>
                )}
                <rect x={pr.x} y={pr.y} width={pr.w} height={pr.h} rx={1.5} fill="#020617" stroke={failed ? DISCONNECTED : color} strokeWidth={1.4} pointerEvents="none" />
                <text x={cx} y={cy + 2.5} fontSize={6.5} textAnchor="middle" fill={failed || disconnected ? '#fca5a5' : '#e2e8f0'} pointerEvents="none" fontFamily="var(--font-mono)">
                  {failed ? '✕' : disconnected ? '⊘' : ''}
                  {pr.label.replace('PSU', 'P')}
                </text>
              </g>
            );
          })}

        {devices.length === 0 && (
          <text x={innerX + INNER_W / 2} y={TOP + (rack.heightU * U) / 2} textAnchor="middle" fontSize={12} fill="#64748b">
            {t('rack.empty')}
          </text>
        )}
      </svg>
      {hoverDev && !drag && (
        <div className="pointer-events-none absolute z-40 w-64 rounded-md border border-slate-600 bg-slate-900/95 p-2 text-xs shadow-xl" style={{ left: Math.min(hover!.x + 12, 9999), top: hover!.y + 12 }}>
          <DeviceTip d={hoverDev} result={result} typical={typical} />
        </div>
      )}
    </div>
  );
}

function DeviceTip({ d, result, typical }: { d: DeviceInstance; result: ScenarioResult; typical: ScenarioResult }) {
  const { t } = useT();
  const r = result.devices[d.id];
  const ty = typical.devices[d.id];
  const psus = d.domains.flatMap((x) => x.psus);
  return (
    <div className="space-y-0.5">
      <div className="font-semibold text-slate-100">{d.name}</div>
      <div className="text-slate-400">
        {d.vendor} {d.model} · {t(`cat.${d.category}`)}
      </div>
      {d.placement.kind === 'rack' && (
        <div>
          U{d.placement.startU}–U{d.placement.startU + d.placement.heightU - 1} ({d.placement.heightU}U)
        </div>
      )}
      <div>
        {t('power.typical')}: {ty?.load.inputW === null ? t('common.unknown') : `${fmtNum(ty?.load.inputW, 0)} W`} · {t('power.design')}: {r?.load.inputW === null ? t('common.unknown') : `${fmtNum(r?.load.inputW, 0)} W`}
      </div>
      <div className="text-slate-400">
        {t('power.basis')}: {t(`basis.${ty?.load.basis}`)}
      </div>
      {psus.length > 0 && (
        <div>
          PSU: {psus.map((p) => `${p.ratedDcW ?? '?'}W`).join(' + ')} ({t('rack.nameplateNote')})
        </div>
      )}
      <div>
        {t('rack.status')}: {t(`dstatus.${r?.status ?? 'ok'}`)}
      </div>
      <div className="text-[10px] text-cyan-400">{t('rack.clickToEdit')}</div>
    </div>
  );
}
