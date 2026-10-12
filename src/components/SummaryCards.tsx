import { useStore } from '../state/store';
import { useAnalysis } from '../state/useAnalysis';
import { useT } from '../i18n';
import { fmtA, fmtKw, fmtPct, fmtW } from '../engine/format';
import { freeBlocks, occupiedRanges } from '../engine/placement';
import { Help } from './ui/primitives';

export function SummaryCards() {
  const { t } = useT();
  const project = useStore((s) => s.project);
  const rackId = useStore((s) => s.selectedRackId);
  const setUi = useStore((s) => s.setUi);
  const advanced = useStore((s) => s.advanced);
  const a = useAnalysis();
  const rack = project.racks.find((r) => r.id === rackId);
  const ra = a.byRack[rackId];
  if (!rack || !ra) return null;
  const normal = a.scenarios[0];
  const rt = normal.typical.racks[rackId];
  const rd = normal.design.racks[rackId];
  const pdus = project.pdus.filter((p) => p.rackId === rackId);
  let worst: { util: number; label: string } | null = null;
  let worstUnknown = false;
  for (const s of a.scenarios.filter((x) => x.def.kind !== 'normal'))
    for (const p of pdus) {
      const r = s.design.pdus[p.id];
      if (!r.powered) continue;
      if (r.governingA === null || r.limits.planningA === null) {
        worstUnknown = true;
        continue;
      }
      if (r.unknownCount) worstUnknown = true;
      const util = r.governingA / r.limits.planningA;
      if (!worst || util > worst.util) worst = { util, label: `${p.feed} (${s.def.kind === 'loss_feed' ? t('sc.loss_feed', { feed: s.def.target ?? '' }) : s.def.id})` };
    }
  const ranges = occupiedRanges(rackId, project.devices, project.pdus);
  const freeU = freeBlocks(rack, ranges).reduce((s, b) => s + b.size, 0);
  const counts = ra.findings.reduce<Record<string, number>>((m, f) => ((m[f.status] = (m[f.status] ?? 0) + 1), m), {});
  const allCards: { label: string; value: string; sub?: string; tone?: 'warn' | 'bad' | 'ok'; help?: string; onClick?: () => void; basic?: boolean }[] = [
    { basic: true, label: t('sum.normal'), value: fmtKw(rt.knownW), sub: rt.unknownCount ? t('pw.knownSubtotal', { n: rt.unknownCount }) : t('sum.typical'), tone: rt.unknownCount ? 'warn' : undefined, help: t('help.kwKva') },
    { label: t('sum.design'), value: fmtKw(rd.knownW), sub: rd.unknownCount ? t('pw.knownSubtotal', { n: rd.unknownCount }) : t('sum.peak'), tone: rd.unknownCount ? 'warn' : undefined },
    {
      basic: true,
      label: t('sum.abCurrent'),
      value: pdus.length ? pdus.map((p) => `${p.feed} ${fmtA(normal.typical.pdus[p.id].governingA, 1)}`).join(' · ') : '—',
      sub: t('sum.normalTypical'),
    },
    {
      basic: true,
      label: t('sum.worstFailover'),
      value: worst ? fmtPct(worst.util) : '—',
      sub: worst ? `${worst.label}${worstUnknown ? ' · +?' : ''}` : t('sum.noFailover'),
      tone: worst ? (worst.util > 1 ? 'bad' : worst.util >= project.policy.alertFraction / project.policy.planningDerateFraction ? 'warn' : 'ok') : undefined,
      help: t('help.worst'),
    },
    { label: t('sum.remaining'), value: ra.headroom.additionalW === null ? '—' : fmtW(ra.headroom.additionalW), sub: ra.headroom.qualified ? t('hr.qualifiedShort') : t('sum.policyBased'), tone: ra.headroom.qualified ? 'warn' : undefined },
    { label: t('sum.u'), value: `${rack.heightU - freeU}/${rack.heightU} U`, sub: t('sum.freeU', { n: freeU }) },
    {
      basic: true,
      label: t('sum.findings'),
      value: `✕${counts.fail ?? 0} !${counts.warning ?? 0} ?${counts.unknown ?? 0}`,
      sub: t('sum.findingsSub'),
      tone: counts.fail ? 'bad' : counts.warning ? 'warn' : 'ok',
      onClick: () => setUi({ rightTab: 'audit', mobileTab: 'settings' }),
    },
  ];
  const cards = allCards.filter((c) => advanced || c.basic);
  const toneCls = { warn: 'text-amber-300', bad: 'text-red-300', ok: 'text-emerald-300' };
  return (
    <div className="scroll-thin grid grid-flow-col auto-cols-[minmax(9.5rem,1fr)] gap-2 overflow-x-auto pb-1">
      {cards.map((c) => (
        <div key={c.label} className={`card px-2.5 py-1.5 ${c.onClick ? 'cursor-pointer hover:border-cyan-700' : ''}`} onClick={c.onClick} role={c.onClick ? 'button' : undefined}>
          <div className="flex items-center gap-1 text-[10px] font-medium tracking-wide text-slate-400 uppercase">
            {c.label}
            {c.help && <Help text={c.help} />}
          </div>
          <div className={`font-mono text-sm font-semibold whitespace-nowrap ${c.tone ? toneCls[c.tone] : 'text-slate-100'}`}>{c.value}</div>
          {c.sub && <div className="truncate text-[10px] text-slate-500">{c.sub}</div>}
        </div>
      ))}
    </div>
  );
}
