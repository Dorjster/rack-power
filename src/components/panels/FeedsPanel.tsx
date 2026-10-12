import { useState } from 'react';
import type { Ats, BankPhase, BranchCircuit, DcBus, FeedLetter, OutletType, Pdu, Ups, UpstreamSource } from '../../domain/types';
import { useStore } from '../../state/store';
import { useAnalysis } from '../../state/useAnalysis';
import { useT } from '../../i18n';
import { allPduTemplates, PDU_VENDORS } from '../../catalog/pdus';
import { addPduFromTemplate, deletePdu } from '../../state/actions';
import { Empty, Field, Help, NumInput, ProvBadge, Section, Select, StatusBadge, TextInput } from '../ui/primitives';
import { makeOutlets, uid } from '../../domain/factory';
import { useNotify } from '../useNotify';
import { fmtA, fmtNum, fmtW } from '../../engine/format';
import { nominalCapacityVa } from '../../engine/electrical';
import type { LimitStatus } from '../../engine/limits';

export const limitBadge = (s: LimitStatus): 'pass' | 'warning' | 'fail' | 'unknown' | 'na' =>
  s === 'within' ? 'pass' : s === 'alert' ? 'warning' : s === 'planning_exceeded' || s === 'hard_exceeded' ? 'fail' : s === 'na' ? 'na' : 'unknown';

export function FeedsPanel() {
  const { t } = useT();
  const project = useStore((s) => s.project);
  const rackId = useStore((s) => s.selectedRackId);
  const pdus = project.pdus.filter((p) => p.rackId === rackId);
  return (
    <div>
      <AddPdu />
      {pdus.length === 0 && <Empty>{t('feeds.noPdu')}</Empty>}
      {pdus.map((p) => (
        <PduCard key={p.id} pdu={p} />
      ))}
      <UpstreamEditor />
    </div>
  );
}

export function AddPdu({ onAdded }: { onAdded?: () => void }) {
  const { t } = useT();
  const notify = useNotify();
  const project = useStore((s) => s.project);
  const rackId = useStore((s) => s.selectedRackId);
  const templates = allPduTemplates(project.catalog.pdus);
  const [tplId, setTplId] = useState(templates[1]?.id ?? templates[0].id);
  const [pair, setPair] = useState(true);
  const [vendor, setVendor] = useState<string>('Custom');
  const tpl = templates.find((x) => x.id === tplId)!;
  const rackPdus = project.pdus.filter((p) => p.rackId === rackId);
  const add = () => {
    if (tplId === '__manual') {
      const manual = {
        ...templates[0],
        id: '__manual',
        vendor,
        model: t('feeds.manualModel'),
        generic: false,
        voltage: { value: null, status: 'user_supplied' as const },
        nominalA: { value: null, status: 'user_supplied' as const },
        outlets: { value: [], status: 'user_supplied' as const },
      };
      const r = addPduFromTemplate(rackId, manual, rackPdus.some((p) => p.feed === 'A') ? 'B' : 'A', rackPdus.some((p) => p.side === 'left') ? 'right' : 'left');
      if (notify(r)) onAdded?.();
      return;
    }
    if (pair) {
      const a = addPduFromTemplate(rackId, tpl, 'A', 'left');
      if (!notify(a)) return;
      const b = addPduFromTemplate(rackId, tpl, 'B', 'right');
      if (notify(b)) onAdded?.();
    } else {
      const feed: FeedLetter = rackPdus.some((p) => p.feed === 'A') ? 'B' : 'A';
      if (notify(addPduFromTemplate(rackId, tpl, feed, feed === 'A' ? 'left' : 'right'))) onAdded?.();
    }
  };
  const va = tpl ? nominalCapacityVa(tpl.topology, tpl.voltage.value, tpl.nominalA.value) : null;
  return (
    <div className="card mb-3 p-3">
      <div className="mb-2 text-sm font-semibold">{t('feeds.addPdu')}</div>
      <div className="flex flex-wrap items-end gap-2">
        <Field label={t('feeds.template')}>
          <select value={tplId} onChange={(e) => setTplId(e.target.value)} className="max-w-72">
            <optgroup label={t('feeds.presets')}>
              {templates
                .filter((x) => x.generic)
                .map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.model}
                  </option>
                ))}
            </optgroup>
            <optgroup label={t('feeds.models')}>
              {templates
                .filter((x) => !x.generic)
                .map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.vendor} {x.model}
                  </option>
                ))}
            </optgroup>
            <option value="__manual">{t('feeds.manual')}</option>
          </select>
        </Field>
        {tplId === '__manual' ? (
          <Field label={t('dev.vendor')}>
            <Select value={vendor} onChange={setVendor} options={PDU_VENDORS.map((v) => ({ value: v, label: v }))} />
          </Field>
        ) : (
          <label className="inline-flex items-center gap-1 pb-1 text-xs">
            <input type="checkbox" checked={pair} onChange={(e) => setPair(e.target.checked)} />
            {t('feeds.abPair')}
          </label>
        )}
        <button className="btn btn-primary" onClick={add}>
          + {t('common.add')}
        </button>
      </div>
      {tplId !== '__manual' && tpl && (
        <div className="mt-2 text-[11px] text-slate-400">
          <ProvBadge status={tpl.generic ? 'assumption' : tpl.nominalA.status} /> {tpl.description} · {t('feeds.nominalVa')}: {va === null ? '—' : `${fmtNum(va / 1000, 2)} kVA`}
          <div className="mt-1">{tpl.generic ? t('feeds.presetNote') : t('feeds.modelNote')}</div>
        </div>
      )}
    </div>
  );
}

function PduCard({ pdu }: { pdu: Pdu }) {
  const { t } = useT();
  const advanced = useStore((s) => s.advanced);
  const project = useStore((s) => s.project);
  const update = useStore((s) => s.update);
  const a = useAnalysis();
  const normal = a.scenarios[0];
  const pr = normal.design.pdus[pdu.id];
  const prT = normal.typical.pdus[pdu.id];
  const upd = (fn: (p: Pdu) => void) => update((d) => fn(d.pdus.find((x) => x.id === pdu.id)!));
  const outlets = pdu.banks.flatMap((b) => b.outlets);
  const counts = outlets.reduce<Record<string, number>>((m, o) => ((m[o.type] = (m[o.type] ?? 0) + 1), m), {});
  const lossScenarios = a.scenarios.filter((s) => s.def.kind === 'loss_feed' && s.def.target !== pdu.feed);
  return (
    <Section
      title={`${pdu.name} · ${t('feeds.feed')} ${pdu.feed}`}
      badge={<StatusBadge status={limitBadge(pr.status)} small label={`${fmtA(pr.governingA)} / ${fmtA(pr.limits.planningA)}`} />}
      right={
        <button className="btn btn-ghost btn-sm" aria-label={t('common.delete')} onClick={() => confirm(t('feeds.confirmDelete', { name: pdu.name })) && deletePdu(pdu.id)}>
          🗑
        </button>
      }
    >
      <div className="mb-3 grid grid-cols-2 gap-2 rounded-md bg-slate-900 p-2 text-xs sm:grid-cols-4">
        <div>
          {t('power.typical')}: <b>{fmtW(prT.w)}</b> · {fmtA(prT.governingA)}
        </div>
        <div>
          {t('power.design')}: <b>{fmtW(pr.w)}</b> · {fmtA(pr.governingA)}
        </div>
        <div>
          {t('feeds.outlets')}: <b>{pr.outletsUsed}</b>/{pr.outletsTotal} ({Object.entries(pr.freeByType).map(([k, v]) => `${v}×${k} ${t('rack.free')}`).join(', ') || '—'})
        </div>
        <div>
          {t('feeds.limits')}: {fmtA(pr.limits.planningA)} {t('feeds.planning')} / {fmtA(pr.limits.hardA)} {t('feeds.hard')}
        </div>
        {lossScenarios.map((s) => (
          <div key={s.def.id} className="col-span-2">
            {t('sc.loss_feed', { feed: s.def.target ?? '' })}: <b>{fmtA(s.design.pdus[pdu.id].governingA)}</b> <StatusBadge status={limitBadge(s.design.pdus[pdu.id].status)} small />
          </div>
        ))}
        {pr.unknownCount > 0 && <div className="col-span-4 text-amber-300">⚠ {t('feeds.unknownLoads', { n: pr.unknownCount })}</div>}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('feeds.name')}>
          <TextInput value={pdu.name} onChange={(v) => upd((p) => (p.name = v || p.name))} />
        </Field>
        <Field label={t('feeds.feed')}>
          <Select value={pdu.feed} onChange={(v) => upd((p) => (p.feed = v))} options={(['A', 'B', 'C'] as const).map((f) => ({ value: f, label: f }))} />
        </Field>
        <Field label={t('feeds.vendorModel')}>
          <span className="text-xs text-slate-300">
            {pdu.vendor} {pdu.model} <ProvBadge status={pdu.provenance} />
          </span>
        </Field>
        <Field label={t('feeds.mounting')}>
          <div className="flex gap-1">
            <Select value={pdu.mounting} onChange={(v) => upd((p) => ((p.mounting = v), (p.heightU = v === 'zero_u' ? 0 : Math.max(1, p.heightU)), (p.startU = v === 'zero_u' ? null : p.startU)))} options={[{ value: 'zero_u', label: t('feeds.zeroU') }, { value: 'horizontal', label: t('feeds.horizontal') }]} />
            {pdu.mounting === 'zero_u' && <Select value={pdu.side} onChange={(v) => upd((p) => (p.side = v))} options={[{ value: 'left', label: t('feeds.left') }, { value: 'right', label: t('feeds.right') }]} />}
          </div>
        </Field>
        {pdu.mounting === 'horizontal' && (
          <Field label={t('lib.startU')}>
            <NumInput value={pdu.startU} min={1} step={1} width="w-16" onChange={(v) => upd((p) => (p.startU = v))} />
          </Field>
        )}
        <Field label={t('feeds.voltage')} unit="V" help={t('help.pduVoltage')} example="230 / 400">
          <NumInput value={pdu.voltage} min={1} max={1000} onChange={(v) => upd((p) => (p.voltage = v))} />
        </Field>
        <Field label={t('feeds.nominalA')} unit="A" help={t('help.nominalA')} example="16 / 32">
          <NumInput value={pdu.nominalA} min={0.1} allowZero={false} onChange={(v) => upd((p) => (p.nominalA = v))} />
        </Field>
        <Field label={t('feeds.outletCount')}>
          <div className="flex flex-wrap items-center gap-1 text-xs">
            {(['C13', 'C19'] as OutletType[]).map((type) => (
              <span key={type} className="inline-flex items-center gap-1">
                {type}
                <NumInput
                  value={counts[type] ?? 0}
                  allowUnknown={false}
                  min={0}
                  max={60}
                  step={1}
                  width="w-14"
                  onChange={(v) =>
                    v !== null &&
                    upd((p) => {
                      const bank = p.banks[0];
                      if (!bank) return;
                      const cur = bank.outlets.filter((o) => o.type === type);
                      if (v > cur.length) bank.outlets.push(...makeOutlets([{ type, count: v - cur.length, ratedA: cur[0]?.ratedA ?? null }]));
                      else {
                        const usedIds = new Set(project.devices.flatMap((dd) => dd.domains.flatMap((dm) => dm.psus.map((ps) => ps.connection.outletId))));
                        let remove = cur.length - v;
                        for (let i = bank.outlets.length - 1; i >= 0 && remove > 0; i--) if (bank.outlets[i].type === type && !usedIds.has(bank.outlets[i].id)) (bank.outlets.splice(i, 1), remove--);
                      }
                      let idx = 1;
                      for (const b of p.banks) for (const o of b.outlets) o.index = idx++;
                    })
                  }
                />
              </span>
            ))}
          </div>
        </Field>
        <Field label={t('feeds.upstream')} help={t('help.upstream')}>
          <Select
            value={pdu.upstream ? `${pdu.upstream.kind}:${pdu.upstream.id}` : ''}
            onChange={(v) => upd((p) => (p.upstream = v ? { kind: v.split(':')[0] as 'branch' | 'ats', id: v.split(':')[1] } : null))}
            options={[
              { value: '', label: `— ${t('common.unknown')} —` },
              ...project.branches.map((b) => ({ value: `branch:${b.id}`, label: `${t('feeds.branch')}: ${b.name}` })),
              ...project.atses.map((x) => ({ value: `ats:${x.id}`, label: `ATS: ${x.name}` })),
            ]}
          />
        </Field>
      </div>
      {advanced && (
        <div className="mt-3 grid grid-cols-2 gap-3 border-t border-slate-800 pt-3">
          <Field label={t('feeds.topology')}>
            <Select value={pdu.topology} onChange={(v) => upd((p) => (p.topology = v))} options={(['1ph', '3ph_wye', '3ph_delta'] as const).map((x) => ({ value: x, label: t(`topo.${x}`) }))} />
          </Field>
          <Field label={t('feeds.usableA')} unit="A" help={t('help.usableA')}>
            <NumInput value={pdu.usableA} min={0.1} allowZero={false} onChange={(v) => upd((p) => (p.usableA = v))} />
          </Field>
          <Field label={t('feeds.usableKw')} unit="kW">
            <NumInput value={pdu.usableKw} min={0.01} allowZero={false} onChange={(v) => upd((p) => (p.usableKw = v))} />
          </Field>
          <Field label={t('feeds.usableKva')} unit="kVA">
            <NumInput value={pdu.usableKva} min={0.01} allowZero={false} onChange={(v) => upd((p) => (p.usableKva = v))} />
          </Field>
          <Field label={t('feeds.plug')}>
            <TextInput value={pdu.plug} onChange={(v) => upd((p) => (p.plug = v))} />
          </Field>
          <Field label={t('feeds.capabilities')} help={t('help.capabilities')} className="col-span-2">
            <div className="flex flex-wrap gap-3 text-xs">
              {(Object.keys(pdu.capabilities) as (keyof Pdu['capabilities'])[]).map((k) => (
                <label key={k} className="inline-flex items-center gap-1">
                  <input type="checkbox" checked={pdu.capabilities[k]} onChange={(e) => upd((p) => (p.capabilities[k] = e.target.checked))} />
                  {t(`cap.${k}`)}
                </label>
              ))}
            </div>
            <span className="text-[10px] text-slate-500">{t('feeds.noLiveMetering')}</span>
          </Field>
          <div className="col-span-2">
            <div className="mb-1 flex items-center gap-2 text-xs font-medium text-slate-300">
              {t('feeds.banks')} <Help text={t('help.banks')} />
              <button
                className="btn btn-sm"
                onClick={() => upd((p) => p.banks.push({ id: uid('bank'), name: `Bank ${p.banks.length + 1}`, phase: null, breakerA: null, outlets: [] }))}
              >
                + {t('feeds.addBank')}
              </button>
            </div>
            <table className="tbl">
              <thead>
                <tr>
                  <th>{t('feeds.bank')}</th>
                  <th>{t('feeds.phase')}</th>
                  <th>{t('feeds.breaker')} (A)</th>
                  <th>{t('feeds.outletRating')} (A)</th>
                  <th>{t('feeds.outlets')}</th>
                  <th>{t('feeds.load')}</th>
                </tr>
              </thead>
              <tbody>
                {pdu.banks.map((b, bi) => {
                  const br = pr.banks.find((x) => x.bankId === b.id)!;
                  return (
                    <tr key={b.id}>
                      <td>
                        <TextInput value={b.name} className="w-20" onChange={(v) => upd((p) => (p.banks[bi].name = v))} />
                      </td>
                      <td>
                        <select value={b.phase ?? ''} onChange={(e) => upd((p) => (p.banks[bi].phase = (e.target.value || null) as BankPhase | null))}>
                          <option value="">{t('common.unknown')}</option>
                          {(pdu.topology === '1ph' ? ['L1'] : pdu.topology === '3ph_wye' ? ['L1', 'L2', 'L3', 'L1-L2', 'L2-L3', 'L3-L1'] : ['L1-L2', 'L2-L3', 'L3-L1']).map((ph) => (
                            <option key={ph} value={ph}>
                              {ph}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <NumInput value={b.breakerA} min={0.1} allowZero={false} width="w-16" onChange={(v) => upd((p) => (p.banks[bi].breakerA = v))} />
                      </td>
                      <td>
                        <NumInput value={b.outlets[0]?.ratedA ?? null} min={0.1} allowZero={false} width="w-16" onChange={(v) => upd((p) => p.banks[bi].outlets.forEach((o) => (o.ratedA = v)))} />
                      </td>
                      <td>{b.outlets.length}</td>
                      <td className="font-mono">{fmtA(br?.currentA)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {pdu.topology !== '1ph' && pr.phaseCurrents && (
              <div className="mt-1 text-xs">
                L1 {fmtA(pr.phaseCurrents.L1)} · L2 {fmtA(pr.phaseCurrents.L2)} · L3 {fmtA(pr.phaseCurrents.L3)} · N {fmtA(pr.phaseCurrents.N)}
              </div>
            )}
          </div>
        </div>
      )}
      {pdu.sourceNote && <p className="mt-2 text-[10px] text-slate-500">{pdu.sourceNote}</p>}
    </Section>
  );
}

function UpstreamEditor() {
  const { t } = useT();
  const advanced = useStore((s) => s.advanced);
  const project = useStore((s) => s.project);
  const update = useStore((s) => s.update);
  const a = useAnalysis();
  const normal = a.scenarios[0];
  const list = <K extends 'branches' | 'upses' | 'sources' | 'atses' | 'dcBuses'>(k: K) => project[k];
  const updItem = <K extends 'branches' | 'upses' | 'sources' | 'atses' | 'dcBuses'>(k: K, id: string, fn: (x: Project[K][number]) => void) =>
    update((d) => {
      const arr = d[k] as Project[K];
      const item = (arr as { id: string }[]).find((x) => x.id === id);
      if (item) fn(item as Project[K][number]);
    });
  type Project = typeof project;

  return (
    <>
      <Section title={t('up.sources')} defaultOpen={advanced}>
        <p className="mb-2 text-[11px] text-slate-400">{t('help.sources')}</p>
        {list('sources').map((s: UpstreamSource) => (
          <div key={s.id} className="mb-2 flex flex-wrap items-center gap-2">
            <TextInput value={s.name} onChange={(v) => updItem('sources', s.id, (x) => (x.name = v))} className="w-48" />
            <Select value={s.kind} onChange={(v) => updItem('sources', s.id, (x) => (x.kind = v))} options={(['utility', 'generator', 'other', 'unknown'] as const).map((k) => ({ value: k, label: t(`srckind.${k}`) }))} />
            <span className="font-mono text-[10px] text-slate-500">ID {s.id}</span>
            <button className="btn btn-ghost btn-sm" onClick={() => update((d) => ((d.sources = d.sources.filter((x) => x.id !== s.id)), d.upses.forEach((u) => u.sourceId === s.id && (u.sourceId = null)), d.branches.forEach((b) => b.sourceId === s.id && (b.sourceId = null))))}>
              ✕
            </button>
          </div>
        ))}
        <button className="btn btn-sm" onClick={() => update((d) => d.sources.push({ id: uid('src'), name: `Source ${d.sources.length + 1}`, kind: 'unknown', note: '' }))}>
          + {t('up.addSource')}
        </button>
      </Section>

      <Section title={t('up.ups')} defaultOpen={advanced}>
        {list('upses').map((u: Ups) => {
          const ur = normal.design.upses[u.id];
          return (
            <div key={u.id} className="mb-3 rounded-md border border-slate-700 p-2">
              <div className="mb-2 flex items-center gap-2">
                <TextInput value={u.name} onChange={(v) => updItem('upses', u.id, (x) => (x.name = v))} className="w-40" />
                <span className="text-xs text-slate-400">
                  {t('up.rackLoad')}: {fmtW(ur.w)} {!ur.complete && <span className="text-amber-300">· {t('up.contribOnly')}</span>}
                </span>
                <button className="btn btn-ghost btn-sm ml-auto" onClick={() => update((d) => ((d.upses = d.upses.filter((x) => x.id !== u.id)), d.branches.forEach((b) => b.upsId === u.id && (b.upsId = null))))}>
                  ✕
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field label={t('up.ratedKw')} unit="kW">
                  <NumInput value={u.ratedKw} min={0.01} allowZero={false} onChange={(v) => updItem('upses', u.id, (x) => (x.ratedKw = v))} />
                </Field>
                <Field label={t('up.ratedKva')} unit="kVA" help={t('help.kwKva')}>
                  <NumInput value={u.ratedKva} min={0.01} allowZero={false} onChange={(v) => updItem('upses', u.id, (x) => (x.ratedKva = v))} />
                </Field>
                <Field label={t('up.redundancy')}>
                  <Select value={u.redundancy} onChange={(v) => updItem('upses', u.id, (x) => (x.redundancy = v))} options={(['single', 'N+1', '2N', 'unknown'] as const).map((k) => ({ value: k, label: k === 'unknown' ? t('common.unknown') : k }))} />
                </Field>
                <Field label={t('up.source')}>
                  <Select value={u.sourceId ?? ''} onChange={(v) => updItem('upses', u.id, (x) => (x.sourceId = v || null))} options={[{ value: '', label: t('common.unknown') }, ...project.sources.map((s) => ({ value: s.id, label: s.name }))]} />
                </Field>
                <label className="col-span-2 inline-flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={u.otherLoadsKnown} onChange={(e) => updItem('upses', u.id, (x) => (x.otherLoadsKnown = e.target.checked))} />
                  {t('up.otherKnown')}
                </label>
                {u.otherLoadsKnown && (
                  <Field label={t('up.otherW')} unit="W">
                    <NumInput value={u.otherLoadW} min={0} onChange={(v) => updItem('upses', u.id, (x) => (x.otherLoadW = v))} />
                  </Field>
                )}
                <Field label={t('up.eta')} help={t('help.upsEta')}>
                  <NumInput value={u.efficiency} min={0.01} max={1} onChange={(v) => updItem('upses', u.id, (x) => (x.efficiency = v))} />
                </Field>
                <label className="inline-flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={u.inRack} onChange={(e) => updItem('upses', u.id, (x) => (x.inRack = e.target.checked))} />
                  {t('up.inRack')}
                </label>
                {u.inRack && (
                  <Field label={t('up.rackDevice')}>
                    <Select value={u.rackDeviceId ?? ''} onChange={(v) => updItem('upses', u.id, (x) => (x.rackDeviceId = v || null))} options={[{ value: '', label: '—' }, ...project.devices.filter((d) => d.category === 'ups').map((d) => ({ value: d.id, label: d.name }))]} />
                  </Field>
                )}
                <Field label={t('up.runtime')} help={t('help.runtime')} className="col-span-2">
                  <div className="flex flex-wrap items-center gap-1 text-xs">
                    <NumInput value={u.runtime?.minutes ?? null} min={0} width="w-16" onChange={(v) => updItem('upses', u.id, (x) => (x.runtime = v === null ? null : { minutes: v, atLoadW: x.runtime?.atLoadW ?? 0, evidence: x.runtime?.evidence ?? '' }))} />
                    min @
                    <NumInput value={u.runtime?.atLoadW ?? null} min={0} width="w-20" allowUnknown={false} onChange={(v) => u.runtime && updItem('upses', u.id, (x) => (x.runtime = { ...x.runtime!, atLoadW: v ?? 0 }))} />W
                    <TextInput placeholder={t('up.runtimeEvidence')} value={u.runtime?.evidence ?? ''} onChange={(v) => u.runtime && updItem('upses', u.id, (x) => (x.runtime = { ...x.runtime!, evidence: v }))} />
                  </div>
                </Field>
              </div>
            </div>
          );
        })}
        <button
          className="btn btn-sm"
          onClick={() => update((d) => d.upses.push({ id: uid('ups'), name: `UPS ${d.upses.length + 1}`, ratedKw: null, ratedKva: null, redundancy: 'unknown', sourceId: null, otherLoadsKnown: false, otherLoadW: null, efficiency: null, inRack: false, rackDeviceId: null, runtime: null }))}
        >
          + {t('up.addUps')}
        </button>
      </Section>

      <Section title={t('up.branches')} defaultOpen={advanced}>
        {list('branches').map((b: BranchCircuit) => {
          const br = normal.design.branches[b.id];
          return (
            <div key={b.id} className="mb-3 rounded-md border border-slate-700 p-2">
              <div className="mb-2 flex items-center gap-2">
                <TextInput value={b.name} onChange={(v) => updItem('branches', b.id, (x) => (x.name = v))} className="w-40" />
                <StatusBadge status={limitBadge(br.status)} small label={`${fmtA(br.currentA)} / ${fmtA(br.limits.planningA)}`} />
                <button className="btn btn-ghost btn-sm ml-auto" onClick={() => update((d) => ((d.branches = d.branches.filter((x) => x.id !== b.id)), d.pdus.forEach((p) => p.upstream?.id === b.id && (p.upstream = null))))}>
                  ✕
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field label={t('up.breaker')} unit="A">
                  <NumInput value={b.breakerA} min={0.1} allowZero={false} onChange={(v) => updItem('branches', b.id, (x) => (x.breakerA = v))} />
                  <label className="inline-flex items-center gap-1 text-[10px]">
                    <input type="checkbox" checked={b.breakerIsUsable} onChange={(e) => updItem('branches', b.id, (x) => (x.breakerIsUsable = e.target.checked))} />
                    {t('up.breakerUsable')}
                  </label>
                </Field>
                <Field label={t('feeds.voltage')} unit="V">
                  <NumInput value={b.voltage} min={1} onChange={(v) => updItem('branches', b.id, (x) => (x.voltage = v))} />
                </Field>
                <Field label={t('up.phases')}>
                  <Select value={String(b.phases)} onChange={(v) => updItem('branches', b.id, (x) => (x.phases = Number(v) as 1 | 3))} options={[{ value: '1', label: '1' }, { value: '3', label: '3' }]} />
                </Field>
                <Field label={t('up.fedBy')}>
                  <Select
                    value={b.upsId ? `ups:${b.upsId}` : b.sourceId ? `src:${b.sourceId}` : ''}
                    onChange={(v) =>
                      updItem('branches', b.id, (x) => {
                        x.upsId = v.startsWith('ups:') ? v.slice(4) : null;
                        x.sourceId = v.startsWith('src:') ? v.slice(4) : null;
                      })
                    }
                    options={[{ value: '', label: t('common.unknown') }, ...project.upses.map((u) => ({ value: `ups:${u.id}`, label: `UPS: ${u.name}` })), ...project.sources.map((s) => ({ value: `src:${s.id}`, label: `${t('up.source')}: ${s.name}` }))]}
                  />
                </Field>
              </div>
            </div>
          );
        })}
        <button className="btn btn-sm" onClick={() => update((d) => d.branches.push({ id: uid('br'), name: `Branch ${d.branches.length + 1}`, breakerA: null, breakerIsUsable: false, phases: 1, voltage: 230, upsId: null, sourceId: null }))}>
          + {t('up.addBranch')}
        </button>
      </Section>

      <Section title="ATS" defaultOpen={false}>
        <p className="mb-2 text-[11px] text-slate-400">{t('help.ats')}</p>
        {list('atses').map((x: Ats) => (
          <div key={x.id} className="mb-2 grid grid-cols-2 gap-2 rounded-md border border-slate-700 p-2">
            <TextInput value={x.name} onChange={(v) => updItem('atses', x.id, (y) => (y.name = v))} />
            <button className="btn btn-ghost btn-sm justify-self-end" onClick={() => update((d) => ((d.atses = d.atses.filter((y) => y.id !== x.id)), d.pdus.forEach((p) => p.upstream?.id === x.id && (p.upstream = null))))}>
              ✕
            </button>
            {(['primaryBranchId', 'secondaryBranchId'] as const).map((k) => (
              <Field key={k} label={t(`ats.${k}`)}>
                <Select value={x[k] ?? ''} onChange={(v) => updItem('atses', x.id, (y) => (y[k] = v || null))} options={[{ value: '', label: '—' }, ...project.branches.map((b) => ({ value: b.id, label: b.name }))]} />
              </Field>
            ))}
            <Field label={t('ats.rated')} unit="A">
              <NumInput value={x.ratedA} min={0.1} onChange={(v) => updItem('atses', x.id, (y) => (y.ratedA = v))} />
            </Field>
            <Field label={t('ats.transfer')}>
              <Select value={x.transfer} onChange={(v) => updItem('atses', x.id, (y) => (y.transfer = v))} options={(['open_transition', 'closed_transition', 'unknown'] as const).map((k) => ({ value: k, label: t(`ats.${k}`) }))} />
            </Field>
            <label className="col-span-2 inline-flex items-center gap-2 text-xs">
              <input type="checkbox" checked={x.validated} onChange={(e) => updItem('atses', x.id, (y) => (y.validated = e.target.checked))} />
              {t('ats.validated')}
            </label>
          </div>
        ))}
        <button className="btn btn-sm" onClick={() => update((d) => d.atses.push({ id: uid('ats'), name: `ATS ${d.atses.length + 1}`, primaryBranchId: null, secondaryBranchId: null, ratedA: null, transfer: 'unknown', validated: false }))}>
          + ATS
        </button>
      </Section>

      <Section title={t('up.dcBus')} defaultOpen={false}>
        <p className="mb-2 text-[11px] text-slate-400">{t('help.dcBus')}</p>
        {list('dcBuses').map((b: DcBus) => {
          const r = normal.design.dcBuses[b.id];
          return (
            <div key={b.id} className="mb-2 grid grid-cols-2 gap-2 rounded-md border border-slate-700 p-2">
              <TextInput value={b.name} onChange={(v) => updItem('dcBuses', b.id, (y) => (y.name = v))} />
              <span className="text-xs text-slate-400">
                {fmtW(r?.w)} · {fmtA(r?.currentA)}
              </span>
              <Field label={t('up.dcVoltage')} unit="V">
                <NumInput value={b.voltage} allowUnknown={false} min={-400} max={400} onChange={(v) => v !== null && v !== 0 && updItem('dcBuses', b.id, (y) => (y.voltage = v))} />
              </Field>
              <Field label={t('up.dcCapacity')} unit="A">
                <NumInput value={b.capacityA} min={0.1} onChange={(v) => updItem('dcBuses', b.id, (y) => (y.capacityA = v))} />
              </Field>
              <Field label={t('up.rectEta')}>
                <NumInput value={b.rectifierEfficiency} min={0.01} max={1} onChange={(v) => updItem('dcBuses', b.id, (y) => (y.rectifierEfficiency = v))} />
              </Field>
              <Field label={t('up.rectOutlets')}>
                <select
                  multiple
                  size={4}
                  value={b.rectifierOutletIds}
                  onChange={(e) => updItem('dcBuses', b.id, (y) => (y.rectifierOutletIds = Array.from(e.target.selectedOptions).map((o) => o.value)))}
                >
                  {project.pdus.flatMap((p) => p.banks.flatMap((bk) => bk.outlets.map((o) => <option key={o.id} value={o.id}>{`${p.name} #${o.index} ${o.type}`}</option>)))}
                </select>
              </Field>
              <button className="btn btn-ghost btn-sm" onClick={() => update((d) => (d.dcBuses = d.dcBuses.filter((y) => y.id !== b.id)))}>
                ✕ {t('common.delete')}
              </button>
            </div>
          );
        })}
        <button className="btn btn-sm" onClick={() => update((d) => d.dcBuses.push({ id: uid('dc'), name: `DC bus ${d.dcBuses.length + 1}`, voltage: -48, capacityA: null, rectifierEfficiency: null, rectifierOutletIds: [] }))}>
          + {t('up.addDc')}
        </button>
      </Section>
    </>
  );
}
