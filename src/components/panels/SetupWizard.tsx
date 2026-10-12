import { useState } from 'react';
import type { ID } from '../../domain/types';
import { useStore } from '../../state/store';
import { useAnalysis } from '../../state/useAnalysis';
import { useT } from '../../i18n';
import { Field, NumInput, StatusBadge, TextInput } from '../ui/primitives';
import { AddPdu } from './FeedsPanel';
import { LibraryPanel } from './LibraryPanel';
import { ConclusionCards, ConclusionView } from './Conclusion';
import { applyMapping, ensureUpstream, proposeMapping, resizeRack, freeOutletsOnFeed, usedOutletIds } from '../../state/actions';
import { useNotify } from '../useNotify';
import { fmtW } from '../../engine/format';

const SIZES = [12, 18, 24, 42, 45, 48];

export function SetupWizard() {
  const { t } = useT();
  const step = useStore((s) => s.wizardStep);
  const setUi = useStore((s) => s.setUi);
  const project = useStore((s) => s.project);
  const rackId = useStore((s) => s.selectedRackId);
  const rack = project.racks.find((r) => r.id === rackId)!;
  const pdus = project.pdus.filter((p) => p.rackId === rackId);
  const active = project.devices.filter((d) => d.rackId === rackId && !d.power.passiveZero && !d.poweredByPoeSwitchId);
  const a = useAnalysis();
  const normal = a.scenarios[0];
  const psus = active.flatMap((d) => d.domains.flatMap((x) => x.psus.filter((p) => p.state !== 'removed' && p.inputType === 'AC')));
  const done = [
    !!rack.name,
    pdus.length > 0 && pdus.every((p) => p.voltage !== null && (p.nominalA !== null || p.usableA !== null)),
    active.length > 0 && active.every((d) => normal.typical.devices[d.id].load.inputW !== null),
    psus.length > 0 && psus.every((p) => !!p.connection.outletId),
    false,
  ];
  const steps = ['wiz.s1', 'wiz.s2', 'wiz.s3', 'wiz.s4', 'wiz.s5'];
  return (
    <div>
      <ol className="mb-3 grid grid-cols-5 gap-1" aria-label={t('wiz.progress')}>
        {steps.map((k, i) => (
          <li key={k}>
            <button
              className={`flex w-full flex-col items-center gap-1 rounded-md px-1 py-1.5 text-center text-[11px] leading-tight ${i === step ? 'bg-cyan-900/60 text-cyan-100 ring-1 ring-cyan-600' : 'text-slate-400 hover:bg-slate-800'}`}
              aria-current={i === step ? 'step' : undefined}
              onClick={() => setUi({ wizardStep: i })}
            >
              <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${done[i] ? 'bg-emerald-600 text-white' : i === step ? 'bg-cyan-600 text-white' : 'bg-slate-700'}`}>{done[i] ? '✓' : i + 1}</span>
              {t(k)}
            </button>
          </li>
        ))}
      </ol>
      <div className="min-h-64">
        {step === 0 && <Step1 />}
        {step === 1 && <Step2 />}
        {step === 2 && <Step3 />}
        {step === 3 && <Step4 />}
        {step === 4 && <Step5 />}
      </div>
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-800 pt-3">
        <button className="btn" disabled={step === 0} onClick={() => setUi({ wizardStep: step - 1 })}>
          ← {t('wiz.back')}
        </button>
        <span className="text-[11px] text-slate-400">{done[step] ? t('wiz.stepDone') : t(`wiz.hint${step + 1}`)}</span>
        <button className="btn btn-primary" disabled={step === 4} onClick={() => setUi({ wizardStep: step + 1 })}>
          {t('wiz.next')} →
        </button>
      </div>
    </div>
  );
}

function Step1() {
  const { t } = useT();
  const notify = useNotify();
  const project = useStore((s) => s.project);
  const rackId = useStore((s) => s.selectedRackId);
  const update = useStore((s) => s.update);
  const rack = project.racks.find((r) => r.id === rackId)!;
  const upd = (fn: (r: typeof rack) => void) => update((d) => fn(d.racks.find((x) => x.id === rackId)!));
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label={t('rack.name')} help={t('help.rackName')} example="A01">
        <TextInput value={rack.name} onChange={(v) => upd((r) => (r.name = v || r.name))} />
      </Field>
      <Field label={t('rack.site')} example="DC-1 / Server room">
        <TextInput value={rack.site} onChange={(v) => upd((r) => (r.site = v))} />
      </Field>
      <Field label={t('rack.size')} help={t('help.rackSize')}>
        <div className="flex flex-wrap items-center gap-1">
          {SIZES.map((s) => (
            <button key={s} className={`btn btn-sm ${rack.heightU === s ? 'btn-primary' : ''}`} onClick={() => notify(resizeRack(rackId, s))}>
              {s}U
            </button>
          ))}
          <NumInput value={rack.heightU} allowUnknown={false} min={1} max={60} step={1} width="w-16" onChange={(v) => v !== null && notify(resizeRack(rackId, v))} ariaLabel={t('common.custom')} />
        </div>
      </Field>
      <Field label={t('header.mode')} help={t('help.mode2')}>
        <div className="flex gap-1">
          {(['planning', 'audit'] as const).map((m) => (
            <button key={m} className={`btn btn-sm ${project.mode === m ? 'btn-primary' : ''}`} onClick={() => update((d) => (d.mode = m))}>
              {t(`mode2.${m}`)}
            </button>
          ))}
        </div>
      </Field>
      <Field label={t('header.project')}>
        <TextInput value={project.name} onChange={(v) => update((d) => (d.name = v || d.name))} />
      </Field>
      <Field label={t('header.customer')}>
        <TextInput value={project.customer} onChange={(v) => update((d) => (d.customer = v))} />
      </Field>
      {project.isDemo && <p className="col-span-2 rounded border border-pink-800 bg-pink-950/30 p-2 text-[11px] text-pink-200">{t('wiz.demoNote')}</p>}
    </div>
  );
}

function Step2() {
  const { t } = useT();
  const project = useStore((s) => s.project);
  const rackId = useStore((s) => s.selectedRackId);
  const update = useStore((s) => s.update);
  const rack = project.racks.find((r) => r.id === rackId)!;
  const pdus = project.pdus.filter((p) => p.rackId === rackId);
  const branchIds = new Set(pdus.map((p) => (p.upstream?.kind === 'branch' ? p.upstream.id : null)).filter(Boolean));
  const srcIds = new Set(
    project.branches
      .filter((b) => branchIds.has(b.id))
      .map((b) => (b.upsId ? project.upses.find((u) => u.id === b.upsId)?.sourceId : b.sourceId))
      .filter(Boolean),
  );
  const independence = pdus.some((p) => !p.upstream) ? 'unknown' : srcIds.size > 1 && branchIds.size > 1 ? 'yes' : 'no';
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
        <span>{t('wiz.feedCount')}:</span>
        {([1, 2] as const).map((n) => (
          <button key={n} className={`btn btn-sm ${rack.feedCount === n ? 'btn-primary' : ''}`} onClick={() => update((d) => (d.racks.find((r) => r.id === rackId)!.feedCount = n))}>
            {t(n === 1 ? 'rack.feed1' : 'rack.feed2')}
          </button>
        ))}
      </div>
      <AddPdu />
      {pdus.map((p) => (
        <div key={p.id} className="card mb-2 grid grid-cols-2 gap-2 p-2 sm:grid-cols-4">
          <div className="col-span-2 text-sm font-semibold sm:col-span-4">
            {p.name} · {t('feeds.feed')} {p.feed} · {p.vendor} {p.model}
          </div>
          <Field label={t('feeds.voltage')} unit="V" help={t('help.pduVoltage')}>
            <NumInput value={p.voltage} min={1} max={1000} onChange={(v) => update((d) => (d.pdus.find((x) => x.id === p.id)!.voltage = v))} />
          </Field>
          <Field label={t('feeds.nominalA')} unit="A" help={t('help.nominalA')}>
            <NumInput value={p.nominalA} min={0.1} allowZero={false} onChange={(v) => update((d) => (d.pdus.find((x) => x.id === p.id)!.nominalA = v))} />
          </Field>
          <Field label={t('feeds.outlets')}>
            <span className="text-xs">
              {Object.entries(p.banks.flatMap((b) => b.outlets).reduce<Record<string, number>>((m, o) => ((m[o.type] = (m[o.type] ?? 0) + 1), m), {}))
                .map(([k, v]) => `${v}×${k}`)
                .join(' + ') || t('common.needInfo')}
            </span>
            <span className="text-[10px] text-slate-500">{t('wiz.confirmOutlets')}</span>
          </Field>
          <Field label={t('wiz.upBreaker')} unit="A">
            <NumInput
              value={p.upstream?.kind === 'branch' ? project.branches.find((b) => b.id === p.upstream!.id)?.breakerA ?? null : null}
              min={0.1}
              allowZero={false}
              onChange={(v) =>
                update((d) => {
                  const pp = d.pdus.find((x) => x.id === p.id)!;
                  if (pp.upstream?.kind === 'branch') {
                    const b = d.branches.find((x) => x.id === pp.upstream!.id);
                    if (b) b.breakerA = v;
                  }
                })
              }
            />
            {!p.upstream && <span className="text-[10px] text-amber-300">{t('wiz.setIndependence')}</span>}
          </Field>
        </div>
      ))}
      {pdus.length > 0 && (
        <div className="card p-3">
          <div className="mb-2 text-sm font-semibold">{t('wiz.independent')}</div>
          <p className="mb-2 text-[11px] text-slate-400">{t('help.independent')}</p>
          <div className="flex flex-wrap gap-2">
            <button className={`btn btn-sm ${independence === 'yes' ? 'btn-primary' : ''}`} onClick={() => ensureUpstream(rackId, true)}>
              {t('wiz.indYes')}
            </button>
            <button className={`btn btn-sm ${independence === 'no' ? 'btn-primary' : ''}`} onClick={() => ensureUpstream(rackId, false)}>
              {t('wiz.indNo')}
            </button>
            <span className="self-center text-xs">
              {t('wiz.current')}: <StatusBadge status={independence === 'yes' ? 'pass' : independence === 'no' ? 'fail' : 'unknown'} label={t(`wiz.ind.${independence}`)} small />
            </span>
          </div>
          <p className="mt-2 text-[11px] text-slate-500">{t('wiz.indNote')}</p>
        </div>
      )}
      <p className="mt-2 text-[11px] text-slate-400">{t('wiz.pdu16Note')}</p>
    </div>
  );
}

function Step3() {
  const { t } = useT();
  const project = useStore((s) => s.project);
  const rackId = useStore((s) => s.selectedRackId);
  const setUi = useStore((s) => s.setUi);
  const a = useAnalysis();
  const devices = project.devices.filter((d) => d.rackId === rackId);
  return (
    <div>
      <LibraryPanel compact />
      {devices.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 text-xs font-semibold text-slate-300">{t('wiz.inRack', { n: devices.length })}</div>
          <ul className="divide-y divide-slate-800 rounded-md border border-slate-800 text-xs">
            {devices.map((d) => {
              const l = a.scenarios[0].typical.devices[d.id].load;
              return (
                <li key={d.id}>
                  <button className="flex w-full items-center justify-between px-2 py-1 text-left hover:bg-slate-800/60" onClick={() => setUi({ selectedDeviceId: d.id, rightTab: 'device' })}>
                    <span>
                      {d.name} {d.placement.kind === 'rack' && <span className="text-slate-500">U{d.placement.startU}</span>}
                    </span>
                    {l.inputW === null ? <StatusBadge status="unknown" small label={t('common.needInfo')} /> : <span className="font-mono text-cyan-300">{fmtW(l.inputW)}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function Step4() {
  const { t } = useT();
  const notify = useNotify();
  const project = useStore((s) => s.project);
  const rackId = useStore((s) => s.selectedRackId);
  const devices = project.devices.filter((d) => d.rackId === rackId && !d.power.passiveZero && !d.poweredByPoeSwitchId && d.inputType === 'AC');
  const feeds = Array.from(new Set(project.pdus.filter((p) => p.rackId === rackId).map((p) => p.feed))).sort();
  const used = usedOutletIds(project);
  const [proposals, setProposals] = useState<Record<ID, { psuId: ID; feed: string; outletId: ID | null }[]>>({});
  const outletLabel = (oid: ID | null) => {
    if (!oid) return `⊘ ${t('map.noSocket')}`;
    for (const pdu of project.pdus) for (const b of pdu.banks) for (const o of b.outlets) if (o.id === oid) return `${pdu.feed} #${o.index} ${o.type}`;
    return '?';
  };
  const proposeAll = () => {
    const out: typeof proposals = {};
    for (const d of devices) if (d.domains.some((dom) => dom.psus.some((p) => !p.connection.outletId))) out[d.id] = proposeMapping(project, d);
    setProposals(out);
  };
  return (
    <div>
      <div className="mb-3 rounded-md bg-slate-900 p-2 text-xs">
        <b>{t('wiz.sockets')}:</b>{' '}
        {feeds.map((f) => {
          const free = freeOutletsOnFeed(project, rackId, f, used);
          const by = free.reduce<Record<string, number>>((m, o) => ((m[o.type] = (m[o.type] ?? 0) + 1), m), {});
          return (
            <span key={f} className="mr-3">
              {f}: {Object.entries(by).map(([k, v]) => `${v}×${k}`).join(', ') || '0'} {t('rack.free')}
            </span>
          );
        })}
        {feeds.length === 0 && <span className="text-amber-300">{t('feeds.noPdu')}</span>}
      </div>
      <button className="btn btn-sm mb-2" onClick={proposeAll}>
        {t('wiz.proposeAll')}
      </button>
      <p className="mb-2 text-[11px] text-slate-400">{t('map.confirmNote')}</p>
      <ul className="space-y-2">
        {devices.map((d) => {
          const prop = proposals[d.id];
          const psus = d.domains.flatMap((x) => x.psus);
          return (
            <li key={d.id} className="rounded-md border border-slate-800 p-2 text-xs">
              <div className="mb-1 flex items-center gap-2">
                <b>{d.name}</b>
                <span className="text-slate-500">{d.domains.map((x) => t(`mode.${x.mode}`)).join(', ')}</span>
                {d.domains.some((x) => x.mode === 'unknown') && <StatusBadge status="unknown" small label={t('wiz.modeUnknown')} />}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {psus.map((p) => {
                  const m = prop?.find((x) => x.psuId === p.id);
                  return (
                    <span key={p.id}>
                      {p.label}: {outletLabel(p.connection.outletId)}
                      {m && m.outletId !== p.connection.outletId && <span className="text-cyan-300"> → {outletLabel(m.outletId)}</span>}
                    </span>
                  );
                })}
              </div>
              {prop && (
                <div className="mt-1 flex gap-2">
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => {
                      if (notify(applyMapping(d.id, prop))) setProposals((x) => ({ ...x, [d.id]: undefined as never }));
                    }}
                  >
                    {t('map.apply')}
                  </button>
                  <button className="btn btn-sm" onClick={() => setProposals((x) => ({ ...x, [d.id]: undefined as never }))}>
                    {t('common.cancel')}
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {devices.length === 0 && <p className="text-xs text-slate-400">{t('wiz.noDevices')}</p>}
      <p className="mt-2 text-[11px] text-slate-500">{t('wiz.editInDevice')}</p>
    </div>
  );
}

function Step5() {
  const { t } = useT();
  const rackId = useStore((s) => s.selectedRackId);
  const setUi = useStore((s) => s.setUi);
  return (
    <div>
      <ConclusionView rackId={rackId} />
      <div className="mt-3">
        <ConclusionCards rackId={rackId} />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button className="btn" onClick={() => setUi({ rightTab: 'audit' })}>
          {t('wiz.allFindings')}
        </button>
        <button className="btn btn-primary" onClick={() => setUi({ showReport: true })}>
          🖨 {t('header.report')}
        </button>
      </div>
    </div>
  );
}
