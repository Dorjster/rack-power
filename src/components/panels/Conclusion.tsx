import type { ReactNode } from 'react';
import type { ID } from '../../domain/types';
import type { Finding } from '../../audit/types';
import { designOnly, groupFindings } from '../../audit/group';
import { useStore } from '../../state/store';
import { useAnalysis } from '../../state/useAnalysis';
import { useT } from '../../i18n';
import { StatusBadge } from '../ui/primitives';
import { fmtA, fmtKw, fmtNum, fmtW } from '../../engine/format';
import { withGrowthReserve } from '../../engine/electrical';
import { limitBadge } from './FeedsPanel';

const VERDICT_STYLE: Record<string, { cls: string; icon: string }> = {
  ok: { cls: 'border-emerald-600 bg-emerald-950/60 text-emerald-100', icon: '✓' },
  normal_ok_failover_exceeds: { cls: 'border-amber-600 bg-amber-950/60 text-amber-100', icon: '!' },
  normal_planning_exceeded: { cls: 'border-orange-600 bg-orange-950/60 text-orange-100', icon: '!' },
  overloaded: { cls: 'border-red-600 bg-red-950/60 text-red-100', icon: '✕' },
  insufficient: { cls: 'border-violet-600 bg-violet-950/60 text-violet-100', icon: '?' },
};

export function FindingLine({ f }: { f: Finding }) {
  const { tm } = useT();
  return (
    <li className="text-xs">
      <StatusBadge status={f.status} small /> <span className="font-mono text-[10px] text-slate-400">{f.ruleId}</span> {f.scenarioLabel && <span className="text-slate-400">[{tm(f.scenarioLabel)}]</span>} <b>{f.affected.label}</b>: {tm(f.msg)}
    </li>
  );
}

export function ConclusionView({ rackId, printable = false }: { rackId: ID; printable?: boolean }) {
  const { t, tm } = useT();
  const a = useAnalysis();
  const ra = a.byRack[rackId];
  if (!ra) return null;
  const c = ra.conclusion;
  const style = VERDICT_STYLE[c.verdict];
  const known = [...c.hardFindings, ...c.planningFindings, ...c.failoverFindings];
  const groups = groupFindings(designOnly(known));
  const advanced = useStore((st) => st.advanced);
  const max = advanced ? 6 : 3;
  return (
    <div className={`rounded-lg border-2 p-3 ${printable ? 'border-black text-black' : style.cls}`}>
      <div className="flex items-start gap-2">
        <span className="text-2xl leading-none font-bold" aria-hidden>
          {style.icon}
        </span>
        <div className="min-w-0">
          <div className="text-base font-bold">{t(`verdict.${c.verdict}`)}</div>
          <div className="text-xs opacity-90">{t(`verdict.${c.verdict}.sub`)}</div>
        </div>
      </div>
      {groups.length > 0 && (
        <ul className="mt-2 space-y-1">
          {groups.slice(0, max).map(({ f, scenarios }) => (
            <li key={f.key} className="text-xs">
              <span aria-hidden>• </span>
              {advanced && scenarios.length > 0 && <b>[{scenarios.map((m) => tm(m)).join('; ')}] </b>}
              <b>{f.affected.label}:</b> {tm(f.msg)}
              {advanced && f.rec && <span className="opacity-80"> → {tm(f.rec)}</span>}
            </li>
          ))}
          {groups.length > max && <li className="text-[11px] opacity-80">+{groups.length - max} …</li>}
        </ul>
      )}
      {c.alsoIncomplete && <div className="mt-2 rounded border border-violet-500/60 bg-violet-950/40 p-2 text-xs text-violet-100">? {t('verdict.alsoIncomplete', { n: c.essentialUnknowns.length })}</div>}
      {c.limitedChecks.length > 0 && c.verdict === 'ok' && <div className="mt-2 text-[11px] opacity-80">{t('verdict.limited', { n: c.limitedChecks.length })}</div>}
    </div>
  );
}

/** The six summary cards of the final screen. */
export function ConclusionCards({ rackId }: { rackId: ID }) {
  const { t, tm } = useT();
  const project = useStore((s) => s.project);
  const advanced = useStore((st) => st.advanced);
  const a = useAnalysis();
  const ra = a.byRack[rackId];
  const normal = a.scenarios[0];
  const rt = normal.typical.racks[rackId];
  const rd = normal.design.racks[rackId];
  const pdus = project.pdus.filter((p) => p.rackId === rackId);
  const losses = a.scenarios.filter((s) => s.def.kind === 'loss_feed');
  const measured = ra.coverage.devices.measured;
  const reserve = project.policy.growthReserveFraction;
  const fixes = [...ra.conclusion.hardFindings, ...ra.conclusion.planningFindings, ...ra.conclusion.failoverFindings, ...ra.findings.filter((f) => f.status === 'warning' && f.severity !== 'low' && f.severity !== 'info')].filter(
    (f, i, arr) => arr.findIndex((g) => g.ruleId === f.ruleId && g.affected.id === f.affected.id) === i,
  );
  // One line per rule/message, listing the affected items.
  const verifyMap = new Map<string, { f: Finding; labels: string[] }>();
  for (const f of ra.findings.filter((x) => x.status === 'unknown')) {
    const k = `${f.ruleId}|${f.msg.key}`;
    const g = verifyMap.get(k);
    if (g) {
      if (!g.labels.includes(f.affected.label)) g.labels.push(f.affected.label);
    } else verifyMap.set(k, { f, labels: [f.affected.label] });
  }
  const verify = [...verifyMap.values()].sort((a, b) => Number(b.f.essential) - Number(a.f.essential));
  const hr = ra.headroom;
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      <Card title={t('cards.current')} n={1}>
        <div className="font-mono text-lg">{fmtKw(rt.knownW)}</div>
        <div className="text-[11px] text-slate-400">
          {t('cards.currentSrc', { measured, total: rt.activeCount })}
          {rt.unknownCount > 0 && <span className="text-amber-300"> · {t('pw.knownSubtotal', { n: rt.unknownCount })}</span>}
        </div>
      </Card>
      <Card title={t('cards.planned')} n={2}>
        <div className="font-mono text-lg">{fmtKw(rd.knownW)}</div>
        <div className="text-[11px] text-slate-400">
          {t('cards.reserve', { pct: fmtNum(reserve * 100, 0), w: fmtKw(withGrowthReserve(rd.knownW, reserve)) })}
          {rd.unknownCount > 0 && <span className="text-amber-300"> · {t('pw.knownSubtotal', { n: rd.unknownCount })}</span>}
        </div>
      </Card>
      <Card title={t('cards.pdu')} n={3}>
        {pdus.length === 0 && <div className="text-xs text-amber-300">{t('feeds.noPdu')}</div>}
        {pdus.map((p) => {
          const r = normal.design.pdus[p.id];
          return (
            <div key={p.id} className="flex flex-wrap items-center gap-1 text-xs">
              <b>{p.name}</b> {fmtA(r.governingA)} / {fmtA(r.limits.planningA)} · {t('cards.outlets', { used: r.outletsUsed, total: r.outletsTotal })} · {t('pw.headroom')} {r.limits.planningA !== null && r.governingA !== null ? fmtA(r.limits.planningA - r.governingA) : '—'}
              <StatusBadge status={limitBadge(r.status)} small />
            </div>
          );
        })}
      </Card>
      <Card title={t('cards.ab')} n={4}>
        {losses.length === 0 && <div className="text-xs text-slate-400">{t('cards.noAb')}</div>}
        {losses.map((s) => {
          const surv = pdus.filter((p) => s.design.pdus[p.id].powered);
          const unp = s.design.racks[rackId].unpoweredDeviceIds.length;
          return (
            <div key={s.def.id} className="mb-1 text-xs">
              <b>{t('sc.loss_feed', { feed: s.def.target ?? '' })}:</b>{' '}
              {surv.map((p) => (
                <span key={p.id} className="mr-1">
                  {p.feed} {fmtA(s.design.pdus[p.id].governingA)} <StatusBadge status={limitBadge(s.design.pdus[p.id].status)} small />
                </span>
              ))}
              {unp > 0 && <span className="text-red-300"> · {t('cards.unpowered', { n: unp })}</span>}
              {s.design.racks[rackId].riskDeviceIds.length > 0 && <span className="text-amber-300"> · {t('cards.risk', { n: s.design.racks[rackId].riskDeviceIds.length })}</span>}
            </div>
          );
        })}
      </Card>
      <Card title={t('cards.fix')} n={5}>
        {fixes.length === 0 ? (
          <div className="text-xs text-emerald-300">{t('cards.noFix')}</div>
        ) : (
          <ol className="list-decimal space-y-1 pl-4 text-xs">
            {fixes.slice(0, advanced ? 6 : 3).map((f) => (
              <li key={f.key}>
                <b>{f.affected.label}</b>: {f.rec ? tm(f.rec) : tm(f.msg)}
              </li>
            ))}
          </ol>
        )}
      </Card>
      <Card title={t('cards.verify')} n={6}>
        {verify.length === 0 ? (
          <div className="text-xs text-emerald-300">{t('cards.noVerify')}</div>
        ) : (
          <ul className="space-y-1 text-xs">
            {verify.slice(0, advanced ? 6 : 3).map(({ f, labels }) => (
              <li key={f.key}>
                {f.essential ? '★ ' : '• '}
                <b>{labels.slice(0, 3).join(', ')}{labels.length > 3 ? ` +${labels.length - 3}` : ''}</b>: {tm(f.msg)}
              </li>
            ))}
            {verify.length > (advanced ? 6 : 3) && <li className="text-slate-400">+{verify.length - (advanced ? 6 : 3)} …</li>}
          </ul>
        )}
      </Card>
      <div className="sm:col-span-2 rounded-md border border-cyan-900 bg-cyan-950/30 p-2 text-xs">
        <b>{t('hr.title')}:</b> {hr.additionalW === null ? t('hr.unknown') : `${fmtW(hr.additionalW)}`} {hr.limitingConstraint && <span>({t('hr.limitedBy')}: {tm({ ...hr.limitingConstraint, params: { ...hr.limitingConstraint.params, scenario: scenarioName(String(hr.limitingConstraint.params.scenario ?? ''), t) } })})</span>}
        {hr.qualified && <span className="text-amber-300"> · {t('hr.qualified')}</span>}
        <div className="text-[11px] text-slate-400">
          {t('hr.sockets')}: {Object.entries(hr.freeSockets).map(([k, v]) => `${v}×${k}`).join(', ') || '0'} · {t('hr.freeU', { n: hr.freeU })} · {t('hr.note')}
        </div>
      </div>
    </div>
  );
}

export function scenarioName(id: string, t: (k: string, p?: Record<string, string | number>) => string) {
  if (id === 'normal') return t('sc.normal');
  const m = id.match(/^loss_feed_(\w)$/);
  if (m) return t('sc.loss_feed', { feed: m[1] });
  if (id.startsWith('loss_ups')) return t('sc.loss_ups', { name: '' });
  if (id.startsWith('loss_source')) return t('sc.loss_source', { name: '' });
  return id;
}

function Card({ title, n, children }: { title: string; n: number; children: ReactNode }) {
  return (
    <div className="rounded-md border border-slate-800 bg-slate-900/60 p-2">
      <div className="mb-1 text-[11px] font-semibold tracking-wide text-slate-400 uppercase">
        {n}. {title}
      </div>
      {children}
    </div>
  );
}
