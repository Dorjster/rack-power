/**
 * Simplified schematic front/rear panels per category (CSS/SVG). These are schematic
 * illustrations, not exact manufacturer drawings.
 */
import type { ReactElement } from 'react';
import type { DeviceCategory, PassiveKind } from '../../domain/types';

interface FP {
  w: number;
  h: number;
  category: DeviceCategory;
  passiveKind?: PassiveKind;
  heightU: number;
}

const C = {
  body: '#1f2937',
  body2: '#273244',
  edge: '#4b5563',
  port: '#0b1220',
  led: '#22c55e',
  ledA: '#38bdf8',
  bay: '#334155',
  vent: '#111827',
  accent: '#94a3b8',
};

function Ears({ w, h }: { w: number; h: number }) {
  return (
    <>
      <rect x={0} y={0} width={8} height={h} fill={C.body2} />
      <rect x={w - 8} y={0} width={8} height={h} fill={C.body2} />
      <circle cx={4} cy={h / 2} r={1.6} fill={C.edge} />
      <circle cx={w - 4} cy={h / 2} r={1.6} fill={C.edge} />
    </>
  );
}

function Ports({ x, y, cols, rows, pw = 6, ph = 5, gap = 2 }: { x: number; y: number; cols: number; rows: number; pw?: number; ph?: number; gap?: number }) {
  const out = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out.push(<rect key={`${r}-${c}`} x={x + c * (pw + gap)} y={y + r * (ph + gap)} width={pw} height={ph} fill={C.port} stroke={C.edge} strokeWidth={0.4} />);
  return <>{out}</>;
}

function Bays({ x, y, w, h, n, rows = 1 }: { x: number; y: number; w: number; h: number; n: number; rows?: number }) {
  const out = [];
  const perRow = Math.ceil(n / rows);
  const bw = w / perRow;
  const bh = h / rows;
  for (let r = 0; r < rows; r++)
    for (let i = 0; i < perRow; i++)
      out.push(
        <g key={`${r}-${i}`}>
          <rect x={x + i * bw + 0.6} y={y + r * bh + 0.6} width={bw - 1.2} height={bh - 1.2} fill={C.bay} stroke={C.edge} strokeWidth={0.4} rx={0.8} />
          <circle cx={x + i * bw + bw - 3} cy={y + r * bh + bh / 2} r={0.9} fill={C.led} />
        </g>,
      );
  return <>{out}</>;
}

function Vents({ x, y, w, h, n = 14 }: { x: number; y: number; w: number; h: number; n?: number }) {
  const out = [];
  const step = w / n;
  for (let i = 0; i < n; i++) out.push(<rect key={i} x={x + i * step + step * 0.25} y={y} width={step * 0.5} height={h} fill={C.vent} rx={0.6} />);
  return <>{out}</>;
}

function Leds({ x, y, n = 3 }: { x: number; y: number; n?: number }) {
  return (
    <>
      {Array.from({ length: n }, (_, i) => (
        <circle key={i} cx={x + i * 5} cy={y} r={1.4} fill={i === 0 ? C.led : C.ledA} />
      ))}
    </>
  );
}

export function FrontPanel({ w, h, category, passiveKind, heightU }: FP) {
  const inner = { x: 10, w: w - 20 };
  const mid = h / 2;
  let body: ReactElement;
  switch (category) {
    case 'rack_server':
    case 'mgmt_appliance':
    case 'backup_appliance':
      body = (
        <>
          <Bays x={inner.x + 4} y={3} w={inner.w * 0.68} h={h - 6} n={heightU >= 2 ? 12 : 8} rows={heightU >= 2 ? 2 : 1} />
          <Vents x={inner.x + inner.w * 0.72} y={4} w={inner.w * 0.16} h={h - 8} n={5} />
          <Leds x={inner.x + inner.w * 0.92} y={mid} n={2} />
        </>
      );
      break;
    case 'gpu_server':
      body = (
        <>
          <Vents x={inner.x + 4} y={3} w={inner.w * 0.62} h={h - 6} n={22} />
          <Bays x={inner.x + inner.w * 0.66} y={3} w={inner.w * 0.26} h={h - 6} n={4} rows={2} />
          <text x={inner.x + 8} y={h - 4} fontSize={6} fill="#a78bfa" fontWeight={700}>
            GPU
          </text>
        </>
      );
      break;
    case 'tower_server':
      body = (
        <>
          <rect x={inner.x + inner.w * 0.35} y={2} width={inner.w * 0.3} height={h - 4} fill={C.body2} stroke={C.edge} rx={2} />
          <Bays x={inner.x + inner.w * 0.37} y={4} w={inner.w * 0.26} h={Math.min(h * 0.4, h - 8)} n={2} rows={2} />
          <Vents x={inner.x + inner.w * 0.37} y={h * 0.55} w={inner.w * 0.26} h={h * 0.35} n={8} />
        </>
      );
      break;
    case 'switch':
    case 'poe_switch':
    case 'san_switch': {
      const rows = 2;
      const ph = Math.max(2.5, (h - 8) / 2 - 1);
      body = (
        <>
          <Leds x={inner.x + 4} y={mid} n={2} />
          <Ports x={inner.x + 16} y={(h - (rows * ph + 1)) / 2} cols={24} rows={rows} pw={7} ph={ph} gap={1.3} />
          <Ports x={inner.x + inner.w - 46} y={(h - (rows * ph + 1)) / 2} cols={4} rows={rows} pw={8} ph={ph} gap={2} />
          {category === 'poe_switch' && (
            <text x={inner.x + inner.w - 70} y={h - 2} fontSize={5} fill="#facc15" fontWeight={700}>
              PoE
            </text>
          )}
          {category === 'san_switch' && (
            <text x={inner.x + inner.w - 70} y={h - 2} fontSize={5} fill="#5eead4" fontWeight={700}>
              FC
            </text>
          )}
        </>
      );
      break;
    }
    case 'router':
      body = (
        <>
          <Leds x={inner.x + 4} y={mid} n={3} />
          <rect x={inner.x + 24} y={3} width={inner.w * 0.3} height={h - 6} fill={C.body2} stroke={C.edge} rx={1} />
          <Ports x={inner.x + inner.w * 0.45} y={mid - 3} cols={8} rows={1} pw={8} ph={6} gap={2} />
          <Ports x={inner.x + inner.w * 0.78} y={mid - 3} cols={2} rows={1} pw={10} ph={6} gap={3} />
        </>
      );
      break;
    case 'firewall':
      body = (
        <>
          <rect x={inner.x + 4} y={3} width={18} height={h - 6} fill="#7f1d1d" rx={1} />
          <path d={`M${inner.x + 9} ${mid + 3} l4 -7 l4 7 z`} fill="#fca5a5" />
          <Ports x={inner.x + 30} y={mid - 3} cols={16} rows={1} pw={7} ph={6} gap={1.6} />
          <Ports x={inner.x + inner.w * 0.75} y={mid - 3} cols={4} rows={1} pw={8} ph={6} gap={2} />
        </>
      );
      break;
    case 'storage_array':
    case 'disk_enclosure':
      body = <Bays x={inner.x + 2} y={2} w={inner.w - 4} h={h - 4} n={heightU >= 4 ? 48 : heightU >= 2 ? 24 : 12} rows={heightU >= 4 ? 4 : heightU >= 2 ? 2 : 1} />;
      break;
    case 'tape_library':
      body = (
        <>
          <rect x={inner.x + 4} y={3} width={inner.w * 0.55} height={h - 6} fill="#0f172a" stroke={C.edge} />
          <rect x={inner.x + inner.w * 0.62} y={4} width={inner.w * 0.18} height={Math.min(10, h - 8)} fill="#14532d" />
          <Bays x={inner.x + inner.w * 0.82} y={3} w={inner.w * 0.16} h={h - 6} n={2} />
        </>
      );
      break;
    case 'ups':
      body = (
        <>
          <rect x={inner.x + inner.w * 0.4} y={4} width={inner.w * 0.2} height={h - 8} fill="#0f172a" stroke={C.edge} rx={1} />
          <rect x={inner.x + inner.w * 0.42} y={6} width={inner.w * 0.16} height={Math.min(8, h - 12)} fill="#0e7490" />
          <Vents x={inner.x + 4} y={4} w={inner.w * 0.34} h={h - 8} n={10} />
          <Vents x={inner.x + inner.w * 0.64} y={4} w={inner.w * 0.34} h={h - 8} n={10} />
        </>
      );
      break;
    case 'pdu':
      body = <Ports x={inner.x + 6} y={mid - 3} cols={16} rows={1} pw={9} ph={6} gap={4} />;
      break;
    case 'passive': {
      if (passiveKind === 'patch_panel')
        body = <Ports x={inner.x + 6} y={mid - 3} cols={24} rows={1} pw={8} ph={6} gap={4.2} />;
      else if (passiveKind === 'cable_manager')
        body = (
          <>
            {Array.from({ length: 10 }, (_, i) => (
              <rect key={i} x={inner.x + 6 + i * (inner.w / 10)} y={2} width={6} height={h - 4} fill={C.body2} rx={2} />
            ))}
          </>
        );
      else if (passiveKind === 'shelf') body = <rect x={inner.x} y={h - 4} width={inner.w} height={3} fill={C.accent} />;
      else body = <rect x={inner.x} y={2} width={inner.w} height={h - 4} fill="#151c2a" />;
      break;
    }
    default:
      body = (
        <>
          <rect x={inner.x + 4} y={3} width={inner.w - 8} height={h - 6} fill="none" stroke={C.edge} strokeDasharray="3 2" />
          <Leds x={inner.x + 10} y={mid} n={2} />
        </>
      );
  }
  return (
    <g>
      <rect x={0} y={0} width={w} height={h} fill={category === 'passive' ? '#111827' : C.body} stroke={C.edge} strokeWidth={0.6} rx={1} />
      {category !== 'passive' || passiveKind !== 'blanking' ? <Ears w={w} h={h} /> : null}
      {body}
    </g>
  );
}

export function RearPanel({ w, h, category }: Omit<FP, 'passiveKind'>) {
  if (category === 'passive') return <rect x={0} y={0} width={w} height={h} fill="#111827" stroke={C.edge} strokeWidth={0.6} />;
  return (
    <g>
      <rect x={0} y={0} width={w} height={h} fill={C.body} stroke={C.edge} strokeWidth={0.6} rx={1} />
      <Vents x={w * 0.25} y={3} w={w * 0.5} h={h - 6} n={18} />
      <Ports x={w * 0.3} y={h / 2 - 2} cols={4} rows={1} pw={6} ph={4} gap={2} />
    </g>
  );
}
