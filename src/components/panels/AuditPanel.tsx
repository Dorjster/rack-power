import { useEffect, useMemo, useState } from 'react';
import { produce } from 'immer';
import type { CheckStatus, ID, Project } from '../../domain/types';
import type { Finding, RuleType } from '../../audit/types';
import { useStore } from '../../state/store';
import { useAnalysis } from '../../state/useAnalysis';
import { useT } from '../../i18n';
import { ConclusionCards, ConclusionView } from './Conclusion';
import { Field, NumInput, Section, Select, StatusBadge, TextInput } from '../ui/primitives';
import { CHECKLIST_KEYS } from '../../audit/checklist';
import { analyzeProject } from '../../audit/analysis';
import { uid, nowIso } from '../../domain/factory';
import { saveBlob, loadBlob, deleteBlob } from '../../persistence/db';
import { allPduTemplates } from '../../catalog/pdus';
import { autoPlace, occupiedRanges } from '../../engine/placement';

export function AuditPanel() {
  const { t } = useT();
  const rackId = useStore((s) => s.selectedRackId);
  const advanced = useStore((s) => s.advanced);
  return (
    <div>
      <ConclusionView rackId={rackId} />
      <div className="mt-3">
        <ConclusionCards rackId={rackId} />
      </div>
      <div className="mt-3" />
      {advanced && <WhatIf />}
      <FindingsList />
      <Checklist />
      {advanced && <Coverage />}
      <AuditMeta />
      <p className="mt-2 text-[11px] text-slate-500">{t('audit.disclaimer')}</p>
    </div>
  );
}

function FindingsList() {
  const { t, tm } = useT();
  const project = useStore((s) => s.project);
  const rackId = useStore((s) => s.selectedRackId);
  const update = useStore((s) => s.update);
  const a = useAnalysis();
  const all = a.byRack[rackId]?.findings ?? [];
  const [status, setStatus] = useState<CheckStatus | 'issues' | 'all'>('issues');
  const [type, setType] = useState<RuleType | 'all'>('all');
  const [scenario, setScenario] = useState<string>('all');
  const [open, setOpen] = useState<string | null>(null);
  const advanced = useStore((s) => s.advanced);
  const list = all.filter(
    (f) =>
      (status === 'all' || (status === 'issues' ? f.status === 'fail' || f.status === 'warning' || f.status === 'unknown' : f.status === status)) &&
      (type === 'all' || f.ruleType === type) &&
      (scenario === 'all' || (scenario === 'none' ? f.scenarioId === null : f.scenarioId === scenario)),
  );
  const order: Record<CheckStatus, number> = { fail: 0, warning: 1, unknown: 2, pass: 3, na: 4 };
  const sevOrder = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  list.sort((x, y) => order[x.status] - order[y.status] || sevOrder[x.severity] - sevOrder[y.severity]);
  const counts = all.reduce<Record<string, number>>((m, f) => ((m[f.status] = (m[f.status] ?? 0) + 1), m), {});
  const ack = (f: Finding) => project.acks.find((x) => x.findingKey === f.key);
  return (
    <Section
      key={String(advanced)}
      defaultOpen={advanced}
      title={t('audit.findings')}
      badge={
        <span className="flex gap-1">
          {(['fail', 'warning', 'unknown', 'pass'] as const).map((s) => (counts[s] ? <StatusBadge key={s} status={s} small label={String(counts[s])} /> : null))}
        </span>
      }
    >
      <div className="mb-2 flex flex-wrap gap-2 text-xs">
        <Select
          value={status}
          onChange={setStatus}
          ariaLabel={t('csv.status')}
          options={[
            { value: 'issues', label: t('audit.filterIssues') },
            { value: 'all', label: t('audit.filterAll') },
            ...(['fail', 'warning', 'unknown', 'pass', 'na'] as const).map((s) => ({ value: s, label: t(`status.${s}`) })),
          ]}
        />
        <Select value={type} onChange={setType} ariaLabel={t('csv.type')} options={[{ value: 'all', label: t('audit.allTypes') }, ...(['manufacturer', 'guidance', 'site_policy', 'physical', 'data', 'manual'] as const).map((r) => ({ value: r, label: t(`ruletype.${r}`) }))]} />
        <Select
          value={scenario}
          onChange={setScenario}
          ariaLabel={t('common.scenario')}
          options={[{ value: 'all', label: t('audit.allScenarios') }, { value: 'none', label: t('audit.noScenario') }, ...a.scenarios.map((s) => ({ value: s.def.id, label: s.def.id === 'normal' ? t('sc.normal') : s.def.kind === 'loss_feed' ? t('sc.loss_feed', { feed: s.def.target ?? '' }) : s.def.id }))]}
        />
      </div>
      <p className="mb-2 text-[11px] text-slate-400">{t('audit.findingsNote')}</p>
      <ul className="divide-y divide-slate-800 rounded-md border border-slate-800">
        {list.slice(0, 200).map((f) => (
          <li key={f.key} className="p-2">
            <button className="flex w-full items-start gap-2 text-left" onClick={() => setOpen(open === f.key ? null : f.key)} aria-expanded={open === f.key}>
              <StatusBadge status={f.status} small />
              <span className="min-w-0 flex-1 text-xs">
                <span className="font-mono text-[10px] text-slate-500">{f.ruleId}</span> <span className="text-[10px] text-slate-500">{t(`ruletype.${f.ruleType}`)}</span>
                {f.scenarioLabel && <span className="text-[10px] text-cyan-400"> · {tm(f.scenarioLabel)}</span>}
                {f.level && <span className="text-[10px] text-slate-400"> · {t(`level.${f.level}`)}</span>}
                <br />
                <b>{f.affected.label}</b>: {tm(f.msg)}
                {ack(f) && <span className="ml-1 rounded bg-slate-700 px-1 text-[10px]">{t('audit.acked')}</span>}
              </span>
              <span className="shrink-0 text-[10px] text-slate-500">{t(`sev.${f.severity}`)}</span>
            </button>
            {open === f.key && (
              <div className="mt-2 ml-8 space-y-1 rounded bg-slate-900 p-2 text-xs">
                {f.observed && (
                  <div>
                    {t('csv.observed')}: <span className="font-mono">{f.observed}</span>
                  </div>
                )}
                {f.threshold && (
                  <div>
                    {t('csv.threshold')}: <span className="font-mono">{f.threshold}</span>
                  </div>
                )}
                {f.calc && (
                  <div>
                    {t('csv.calc')}: <span className="font-mono text-cyan-200">{f.calc}</span>
                  </div>
                )}
                {f.rec && (
                  <div>
                    {t('csv.action')}: {tm(f.rec)}
                  </div>
                )}
                <div className="text-slate-400">
                  {t('csv.evidence')}: {t(`evidence.${f.evidence}`)}
                  {f.source && ` · ${f.source}`}
                  {f.policyNote && ` · ${t('audit.policy')}: ${f.policyNote}`}
                </div>
                {f.status !== 'pass' && f.status !== 'na' && (
                  <div className="flex items-center gap-2">
                    {ack(f) ? (
                      <>
                        <span className="text-slate-400">
                          {t('audit.ackBy', { by: ack(f)!.by || '—', at: ack(f)!.at.slice(0, 10) })}: {ack(f)!.note}
                        </span>
                        <button className="btn btn-sm" onClick={() => update((p) => (p.acks = p.acks.filter((x) => x.findingKey !== f.key)))}>
                          {t('audit.unack')}
                        </button>
                      </>
                    ) : (
                      <button
                        className="btn btn-sm"
                        onClick={() => {
                          const note = prompt(t('audit.ackPrompt'));
                          if (note !== null) update((p) => p.acks.push({ findingKey: f.key, note, by: p.audit.auditor, at: nowIso() }));
                        }}
                      >
                        {t('audit.ack')}
                      </button>
                    )}
                    <span className="text-[10px] text-slate-500">{t('audit.ackNote')}</span>
                  </div>
                )}
              </div>
            )}
          </li>
        ))}
        {list.length === 0 && <li className="p-3 text-center text-xs text-slate-500">{t('audit.noFindings')}</li>}
      </ul>
    </Section>
  );
}

function Checklist() {
  const { t } = useT();
  const project = useStore((s) => s.project);
  const rackId = useStore((s) => s.selectedRackId);
  const update = useStore((s) => s.update);
  const toast = useStore((s) => s.toast);
  const get = (key: string) => project.manualChecks.find((m) => m.rackId === rackId && m.key === key);
  const patch = (key: string, fn: (m: Project['manualChecks'][number]) => void) =>
    update((p) => {
      let m = p.manualChecks.find((x) => x.rackId === rackId && x.key === key);
      if (!m) {
        m = { id: uid('chk'), rackId, key, status: 'unknown', comment: '', evidenceIds: [], responsible: '', action: '', dueDate: '' };
        p.manualChecks.push(m);
      }
      fn(m);
    });
  const attach = async (key: string, file: File) => {
    if (file.size > 8 * 1024 * 1024) return toast(t('ev.tooBig'), 'error');
    if (!/^image\/(png|jpeg|webp|gif)$|^application\/pdf$/.test(file.type)) return toast(t('ev.badType'), 'error');
    const id = uid('ev');
    const blobKey = uid('blob');
    await saveBlob(blobKey, file);
    update((p) => {
      p.evidence.push({ id, kind: file.type.startsWith('image/') ? 'photo' : 'document', name: file.name, mime: file.type, size: file.size, blobKey, note: '', createdAt: nowIso() });
    });
    patch(key, (m) => m.evidenceIds.push(id));
    toast(t('ev.saved'), 'success');
  };
  return (
    <Section title={t('audit.checklist')} defaultOpen={project.mode === 'audit'}>
      <p className="mb-2 text-[11px] text-slate-400">{t('audit.checklistNote')}</p>
      {CHECKLIST_KEYS.map((key) => {
        const m = get(key);
        return (
          <div key={key} className="mb-2 rounded-md border border-slate-800 p-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="min-w-40 flex-1 text-sm">{t(`chk.${key}`)}</span>
              <div role="radiogroup" aria-label={t(`chk.${key}`)} className="inline-flex overflow-hidden rounded border border-slate-700 text-xs">
                {(['pass', 'fail', 'unknown', 'na'] as const).map((s) => (
                  <button key={s} role="radio" aria-checked={(m?.status ?? 'unknown') === s} className={`px-2 py-0.5 ${(m?.status ?? 'unknown') === s ? 'bg-cyan-800 text-white' : 'bg-slate-900 text-slate-400'}`} onClick={() => patch(key, (x) => (x.status = s))}>
                    {t(`status.${s}`)}
                  </button>
                ))}
              </div>
            </div>
            <details className="mt-1">
              <summary className="cursor-pointer text-[11px] text-cyan-400">
                {t('audit.details')} {m?.evidenceIds.length ? `· 📎 ${m.evidenceIds.length}` : ''}
              </summary>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Field label={t('audit.comment')} className="col-span-2">
                  <TextInput value={m?.comment ?? ''} onChange={(v) => patch(key, (x) => (x.comment = v))} />
                </Field>
                <Field label={t('audit.responsible')}>
                  <TextInput value={m?.responsible ?? ''} onChange={(v) => patch(key, (x) => (x.responsible = v))} />
                </Field>
                <Field label={t('audit.due')}>
                  <input type="date" value={m?.dueDate ?? ''} onChange={(e) => patch(key, (x) => (x.dueDate = e.target.value))} />
                </Field>
                <Field label={t('audit.action')} className="col-span-2">
                  <TextInput value={m?.action ?? ''} onChange={(v) => patch(key, (x) => (x.action = v))} />
                </Field>
                <div className="col-span-2">
                  <label className="btn btn-sm cursor-pointer">
                    📎 {t('ev.attach')}
                    <input type="file" accept="image/png,image/jpeg,image/webp,image/gif,application/pdf" className="hidden" onChange={(e) => e.target.files?.[0] && attach(key, e.target.files[0])} />
                  </label>
                  <EvidenceList ids={m?.evidenceIds ?? []} onRemove={(id) => patch(key, (x) => (x.evidenceIds = x.evidenceIds.filter((y) => y !== id)))} />
                </div>
              </div>
            </details>
          </div>
        );
      })}
    </Section>
  );
}

function EvidenceList({ ids, onRemove }: { ids: ID[]; onRemove: (id: ID) => void }) {
  const project = useStore((s) => s.project);
  const update = useStore((s) => s.update);
  const evs = project.evidence.filter((e) => ids.includes(e.id));
  return (
    <ul className="mt-2 flex flex-wrap gap-2">
      {evs.map((e) => (
        <li key={e.id} className="flex items-center gap-1 rounded border border-slate-700 p-1 text-[10px]">
          <EvidenceThumb blobKey={e.blobKey} mime={e.mime} />
          <span className="max-w-28 truncate">{e.name}</span>
          <button
            className="btn btn-ghost btn-sm"
            aria-label="remove"
            onClick={() => {
              onRemove(e.id);
              update((p) => (p.evidence = p.evidence.filter((x) => x.id !== e.id)));
              if (e.blobKey) deleteBlob(e.blobKey);
            }}
          >
            ✕
          </button>
        </li>
      ))}
    </ul>
  );
}

function EvidenceThumb({ blobKey, mime }: { blobKey: string | null; mime: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let u: string | null = null;
    if (blobKey && mime.startsWith('image/'))
      loadBlob(blobKey).then((b) => {
        if (b) {
          u = URL.createObjectURL(b);
          setUrl(u);
        }
      });
    return () => {
      if (u) URL.revokeObjectURL(u);
    };
  }, [blobKey, mime]);
  if (!url) return <span>📄</span>;
  return <img src={url} alt="" className="h-8 w-8 rounded object-cover" />;
}

function Coverage() {
  const { t } = useT();
  const rackId = useStore((s) => s.selectedRackId);
  const a = useAnalysis();
  const cov = a.byRack[rackId]?.coverage;
  if (!cov) return null;
  const d = cov.devices;
  return (
    <Section title={t('audit.coverage')} defaultOpen={false}>
      <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        {(['measured', 'estimated', 'manufacturer', 'component', 'proxy', 'unknown', 'passive'] as const).map((k) => (
          <div key={k} className="rounded border border-slate-800 p-1.5">
            <div className="text-slate-400">{t(`cov.${k}`)}</div>
            <div className={`font-mono text-base ${k === 'unknown' && d[k] ? 'text-amber-300' : ''}`}>{d[k]}</div>
          </div>
        ))}
        <div className="rounded border border-slate-800 p-1.5">
          <div className="text-slate-400">{t('cov.designKnown')}</div>
          <div className="font-mono text-base">
            {cov.designKnown}/{d.total - d.passive}
          </div>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {(['pass', 'warning', 'fail', 'unknown', 'na'] as const).map((s) => (
          <StatusBadge key={s} status={s} label={`${t(`status.${s}`)}: ${cov.checks[s]}`} />
        ))}
      </div>
      <p className="mt-2 text-[11px] text-slate-400">{t('cov.note')}</p>
    </Section>
  );
}

function AuditMeta() {
  const { t } = useT();
  const project = useStore((s) => s.project);
  const update = useStore((s) => s.update);
  const toast = useStore((s) => s.toast);
  const snap = (kind: 'planned' | 'installed') =>
    update((p) => {
      p.snapshots.push({ id: uid('snap'), kind, label: `${t(`snap.${kind}`)} ${new Date().toLocaleString()}`, createdAt: nowIso(), data: structuredClone({ racks: p.racks, devices: p.devices, pdus: p.pdus }) });
    });
  return (
    <Section title={t('audit.meta')} defaultOpen={project.mode === 'audit'}>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('audit.auditor')}>
          <TextInput value={project.audit.auditor} onChange={(v) => update((p) => (p.audit.auditor = v))} />
        </Field>
        <Field label={t('audit.date')}>
          <input type="date" value={project.audit.date} onChange={(e) => update((p) => (p.audit.date = e.target.value))} />
        </Field>
        <Field label={t('audit.notes')} className="col-span-2">
          <textarea rows={2} value={project.audit.notes} onChange={(e) => update((p) => (p.audit.notes = e.target.value))} />
        </Field>
      </div>
      <div className="mt-3">
        <div className="mb-1 flex flex-wrap items-center gap-2 text-xs font-medium">
          {t('snap.title')}
          <button className="btn btn-sm" onClick={() => snap('planned')}>
            + {t('snap.planned')}
          </button>
          <button className="btn btn-sm" onClick={() => snap('installed')}>
            + {t('snap.installed')}
          </button>
        </div>
        <p className="mb-1 text-[11px] text-slate-400">{t('snap.note')}</p>
        <ul className="space-y-1 text-xs">
          {project.snapshots.map((s) => (
            <li key={s.id} className="flex items-center gap-2">
              <span className="rounded bg-slate-800 px-1">{t(`snap.${s.kind}`)}</span>
              {s.label} · {s.data.devices.length} {t('snap.devices')}
              <button
                className="btn btn-sm ml-auto"
                onClick={() => {
                  if (!confirm(t('snap.restoreConfirm'))) return;
                  const p = produce(project, (d) => {
                    d.racks = structuredClone(s.data.racks);
                    d.devices = structuredClone(s.data.devices);
                    d.pdus = structuredClone(s.data.pdus);
                  });
                  update((d) => {
                    d.racks = p.racks;
                    d.devices = p.devices;
                    d.pdus = p.pdus;
                  });
                  toast(t('snap.restored'), 'success', true);
                }}
              >
                {t('snap.restore')}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => update((d) => (d.snapshots = d.snapshots.filter((x) => x.id !== s.id)))}>
                ✕
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Section>
  );
}

/** "What if?" previews: apply a change to a copy, show which findings change, then optionally apply. */
function WhatIf() {
  const { t, tm } = useT();
  const project = useStore((s) => s.project);
  const rackId = useStore((s) => s.selectedRackId);
  const update = useStore((s) => s.update);
  const toast = useStore((s) => s.toast);
  const a = useAnalysis();
  const [kind, setKind] = useState<'reserve' | 'load' | 'pdu' | 'move'>('load');
  const [reserve, setReserve] = useState<number | null>(project.policy.growthReserveFraction);
  const [devId, setDevId] = useState<string>(project.devices.find((d) => d.rackId === rackId && !d.power.passiveZero)?.id ?? '');
  const [value, setValue] = useState<number | null>(null);
  const [which, setWhich] = useState<'measured' | 'design'>('design');
  const [pduId, setPduId] = useState<string>(project.pdus.find((p) => p.rackId === rackId)?.id ?? '');
  const [tplId, setTplId] = useState<string>('preset-ab-32');
  const [destRack, setDestRack] = useState<string>(project.racks.find((r) => r.id !== rackId)?.id ?? '');
  const activeDevs = project.devices.filter((d) => d.rackId === rackId && !d.power.passiveZero);

  const proposed = useMemo<Project | null>(() => {
    try {
      return produce(project, (p) => {
        if (kind === 'reserve' && reserve !== null) p.policy.growthReserveFraction = reserve;
        if (kind === 'load' && devId && value !== null) {
          const d = p.devices.find((x) => x.id === devId);
          if (!d) return;
          if (which === 'design') d.power.designW = value;
          else d.power.measured = { totalW: value, method: 'whole_device', window: 'what-if', timestamp: nowIso(), source: 'what-if' };
        }
        if (kind === 'pdu' && pduId) {
          const pdu = p.pdus.find((x) => x.id === pduId);
          const tpl = allPduTemplates(p.catalog.pdus).find((x) => x.id === tplId);
          if (!pdu || !tpl) return;
          pdu.nominalA = tpl.nominalA.value;
          pdu.usableA = tpl.usableA.value;
          pdu.voltage = tpl.voltage.value;
          pdu.model = tpl.model;
          pdu.vendor = tpl.vendor;
        }
        if (kind === 'move' && devId && destRack) {
          const d = p.devices.find((x) => x.id === devId);
          const dest = p.racks.find((r) => r.id === destRack);
          if (!d || !dest || d.rackId === destRack) return;
          if (d.placement.kind === 'rack') {
            const r = autoPlace(dest, occupiedRanges(destRack, p.devices, p.pdus), d.placement.heightU, 1);
            if (!r.ok) throw new Error('nospace');
            d.placement = { ...d.placement, startU: r.startUs[0] };
          }
          d.rackId = destRack;
          const destOut = new Set(p.pdus.filter((x) => x.rackId === destRack).flatMap((x) => x.banks.flatMap((b) => b.outlets.map((o) => o.id))));
          const used = new Set(p.devices.flatMap((x) => x.domains.flatMap((dm) => dm.psus.map((ps) => ps.connection.outletId))));
          const feeds = ['A', 'B'];
          d.domains.forEach((dm) =>
            dm.psus.forEach((ps, i) => {
              if (ps.connection.outletId && !destOut.has(ps.connection.outletId)) {
                const free = p.pdus.filter((x) => x.rackId === destRack && x.feed === feeds[i % 2]).flatMap((x) => x.banks.flatMap((b) => b.outlets)).find((o) => !used.has(o.id));
                ps.connection.outletId = free?.id ?? null;
                if (free) used.add(free.id);
              }
            }),
          );
        }
      });
    } catch {
      return null;
    }
  }, [project, kind, reserve, devId, value, which, pduId, tplId, destRack]);

  const diff = useMemo(() => {
    if (!proposed || proposed === project) return null;
    const after = analyzeProject(proposed);
    const before = a;
    const racks = kind === 'move' ? [rackId, destRack] : [rackId];
    const out: { rack: string; verdictBefore: string; verdictAfter: string; resolved: Finding[]; added: Finding[] }[] = [];
    for (const rid of racks) {
      if (!rid || !after.byRack[rid]) continue;
      const b = before.byRack[rid].findings;
      const af = after.byRack[rid].findings;
      const bad = (f: Finding) => f.status === 'fail' || f.status === 'warning' || f.status === 'unknown';
      const bMap = new Map(b.map((f) => [f.key, f]));
      const aMap = new Map(af.map((f) => [f.key, f]));
      out.push({
        rack: project.racks.find((r) => r.id === rid)?.name ?? rid,
        verdictBefore: before.byRack[rid].conclusion.verdict,
        verdictAfter: after.byRack[rid].conclusion.verdict,
        resolved: b.filter((f) => bad(f) && (!aMap.has(f.key) || !bad(aMap.get(f.key)!) || aMap.get(f.key)!.status !== f.status)),
        added: af.filter((f) => bad(f) && (!bMap.has(f.key) || bMap.get(f.key)!.status !== f.status)),
      });
    }
    return out;
  }, [proposed, project, a, rackId, destRack, kind]);

  const apply = () => {
    if (!proposed) return;
    if (project.mode === 'audit' && !project.snapshots.some((s) => s.kind === 'installed')) {
      update((p) => {
        p.snapshots.push({ id: uid('snap'), kind: 'installed', label: `${t('snap.installed')} (auto) ${new Date().toLocaleString()}`, createdAt: nowIso(), data: structuredClone({ racks: p.racks, devices: p.devices, pdus: p.pdus }) });
      });
      toast(t('whatif.installedSaved'), 'info');
    }
    update((p) => {
      p.policy = proposed.policy;
      p.devices = proposed.devices;
      p.pdus = proposed.pdus;
      p.snapshots.push({ id: uid('snap'), kind: 'proposed', label: `${t('snap.proposed')} ${new Date().toLocaleString()}`, createdAt: nowIso(), data: structuredClone({ racks: proposed.racks, devices: proposed.devices, pdus: proposed.pdus }) });
    });
    toast(t('whatif.applied'), 'success', true);
  };

  return (
    <Section title={t('whatif.title')} defaultOpen={false}>
      <div className="mb-2 flex flex-wrap gap-2 text-xs">
        {(['load', 'reserve', 'pdu', 'move'] as const).map((k) => (
          <label key={k} className="inline-flex items-center gap-1">
            <input type="radio" name="whatif" checked={kind === k} onChange={() => setKind(k)} />
            {t(`whatif.${k}`)}
          </label>
        ))}
      </div>
      <div className="mb-2 flex flex-wrap items-end gap-2">
        {kind === 'reserve' && (
          <Field label={t('policy.reserve')}>
            <NumInput value={reserve} min={0} max={2} allowUnknown={false} onChange={setReserve} />
          </Field>
        )}
        {(kind === 'load' || kind === 'move') && (
          <Field label={t('dev.name')}>
            <Select value={devId} onChange={setDevId} options={activeDevs.map((d) => ({ value: d.id, label: d.name }))} />
          </Field>
        )}
        {kind === 'load' && (
          <>
            <Field label={t('whatif.which')}>
              <Select value={which} onChange={setWhich} options={[{ value: 'design', label: t('power.design') }, { value: 'measured', label: t('power.measured') }]} />
            </Field>
            <Field label="W">
              <NumInput value={value} min={0} onChange={setValue} />
            </Field>
          </>
        )}
        {kind === 'pdu' && (
          <>
            <Field label="PDU">
              <Select value={pduId} onChange={setPduId} options={project.pdus.filter((p) => p.rackId === rackId).map((p) => ({ value: p.id, label: p.name }))} />
            </Field>
            <Field label={t('feeds.template')}>
              <Select value={tplId} onChange={setTplId} options={allPduTemplates(project.catalog.pdus).map((x) => ({ value: x.id, label: `${x.vendor === 'Generic preset' ? '' : `${x.vendor} `}${x.model}` }))} />
            </Field>
          </>
        )}
        {kind === 'move' && (
          <Field label={t('whatif.dest')}>
            <Select value={destRack} onChange={setDestRack} options={project.racks.filter((r) => r.id !== rackId).map((r) => ({ value: r.id, label: r.name }))} />
          </Field>
        )}
      </div>
      {kind === 'pdu' && <p className="mb-2 text-[11px] text-amber-300">{t('whatif.pduNote')}</p>}
      {kind === 'move' && project.racks.length < 2 && <p className="mb-2 text-[11px] text-slate-400">{t('whatif.needRack')}</p>}
      {proposed === null && <p className="text-xs text-red-300">{t('err.noSpace', { requested: 1, placed: 0, missing: 1, h: '?', largest: '?' })}</p>}
      {diff && (
        <div className="space-y-2 rounded-md bg-slate-900 p-2 text-xs">
          {diff.map((d) => (
            <div key={d.rack}>
              <div className="font-semibold">
                {d.rack}: {t(`verdict.${d.verdictBefore}`)} → <span className="text-cyan-300">{t(`verdict.${d.verdictAfter}`)}</span>
              </div>
              {d.resolved.length > 0 && (
                <div className="mt-1">
                  <div className="text-emerald-300">{t('whatif.resolved', { n: d.resolved.length })}</div>
                  <ul className="ml-4 list-disc">
                    {d.resolved.slice(0, 5).map((f) => (
                      <li key={f.key}>
                        {f.affected.label}: {tm(f.msg)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {d.added.length > 0 && (
                <div className="mt-1">
                  <div className="text-amber-300">{t('whatif.added', { n: d.added.length })}</div>
                  <ul className="ml-4 list-disc">
                    {d.added.slice(0, 5).map((f) => (
                      <li key={f.key}>
                        <StatusBadge status={f.status} small /> {f.affected.label}: {tm(f.msg)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {d.resolved.length === 0 && d.added.length === 0 && <div className="text-slate-400">{t('whatif.noChange')}</div>}
            </div>
          ))}
          <button className="btn btn-primary btn-sm" onClick={apply}>
            {t('whatif.apply')}
          </button>
          <p className="text-[10px] text-slate-500">{t('whatif.applyNote')}</p>
        </div>
      )}
    </Section>
  );
}
