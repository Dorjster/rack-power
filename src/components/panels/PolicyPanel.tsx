import { useState } from 'react';
import type { DeviceTemplate, Sourced } from '../../domain/types';
import { useStore } from '../../state/store';
import { useT } from '../../i18n';
import { Field, NumInput, ProvBadge, Section, Select, TextInput } from '../ui/primitives';
import { BUILTIN_DEVICE_TEMPLATES, CATEGORIES, allDeviceTemplates } from '../../catalog/devices';
import { download } from '../../persistence/io';
import { nowIso } from '../../domain/factory';

const RULE_IDS = ['PHY-001', 'PHY-002', 'DATA-001', 'DATA-002', 'DATA-003', 'DATA-004', 'PSU-001', 'PSU-002', 'PSU-003', 'PSU-004', 'PSU-005', 'PSU-006', 'FEED-001', 'FEED-002', 'FEED-003', 'FEED-004', 'CAP-PDU-HARD', 'CAP-PDU-PLAN', 'CAP-PDU-KW', 'CAP-PHASE', 'CAP-IMB', 'CAP-BANK', 'CAP-OUTLET', 'CAP-BRANCH', 'UPS-KW', 'UPS-KVA', 'UPS-SHARED', 'UPS-RUNTIME', 'CONN-TYPE', 'CONN-DUP', 'CONN-DC', 'RACK-BUDGET', 'RACK-WEIGHT', 'RACK-DEPTH', 'RACK-SHELF', 'COOL-001', 'AIR-001', 'AIR-002', 'ENV-INLET', 'FAIL-DEV', 'POE-001', 'DC-001'];

export function PolicyPanel() {
  const { t } = useT();
  const project = useStore((s) => s.project);
  const update = useStore((s) => s.update);
  const p = project.policy;
  const a = project.assumptions;
  const upP = (fn: (x: typeof p) => void) => update((d) => fn(d.policy));
  const upA = (fn: (x: typeof a) => void) => update((d) => fn(d.assumptions));
  return (
    <div>
      <Section title={t('policy.assumptions')}>
        <p className="mb-2 text-[11px] text-slate-400">{t('policy.assumptionsNote')}</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('policy.defaultPf')} help={t('help.pf')} example="0.95">
            <NumInput value={a.defaultPf} allowUnknown={false} min={0.01} max={1} onChange={(v) => v !== null && upA((x) => (x.defaultPf = v))} />
            <label className="mt-1 inline-flex items-center gap-1 text-[11px]">
              <input type="checkbox" checked={a.pfConfirmed} onChange={(e) => upA((x) => (x.pfConfirmed = e.target.checked))} />
              {t('policy.pfConfirmed')}
            </label>
          </Field>
          <Field label={t('policy.defaultEta')} help={t('help.eta')} example="0.90">
            <NumInput value={a.defaultEfficiency} allowUnknown={false} min={0.01} max={1} onChange={(v) => v !== null && upA((x) => (x.defaultEfficiency = v))} />
          </Field>
          <Field label={t('policy.poeEta')}>
            <NumInput value={a.poeEfficiency} allowUnknown={false} min={0.01} max={1} onChange={(v) => v !== null && upA((x) => (x.poeEfficiency = v))} />
          </Field>
          <Field label={t('policy.currency')}>
            <TextInput value={a.currency} onChange={(v) => upA((x) => (x.currency = v || 'MNT'))} />
          </Field>
        </div>
      </Section>

      <Section title={t('policy.title')}>
        <p className="mb-2 text-[11px] text-slate-400">{t('policy.note')}</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('policy.name')}>
            <TextInput value={p.name} onChange={(v) => upP((x) => (x.name = v))} />
          </Field>
          <Field label={t('policy.version')}>
            <TextInput value={p.version} onChange={(v) => upP((x) => (x.version = v))} />
          </Field>
          <Field label={t('policy.alert')} help={t('help.alert')} example="0.70">
            <NumInput value={p.alertFraction} allowUnknown={false} min={0.01} max={1} onChange={(v) => v !== null && upP((x) => (x.alertFraction = v))} />
          </Field>
          <Field label={t('policy.derate')} help={t('help.derate')} example="0.80">
            <label className="inline-flex items-center gap-1 text-xs">
              <input type="checkbox" checked={p.applyPlanningDerate} onChange={(e) => upP((x) => (x.applyPlanningDerate = e.target.checked))} />
              {t('policy.applyDerate')}
            </label>
            <NumInput value={p.planningDerateFraction} allowUnknown={false} min={0.01} max={1} onChange={(v) => v !== null && upP((x) => (x.planningDerateFraction = v))} />
          </Field>
          <Field label={t('policy.reserve')} help={t('help.reserve')}>
            <NumInput value={p.growthReserveFraction} allowUnknown={false} min={0} max={2} onChange={(v) => v !== null && upP((x) => (x.growthReserveFraction = v))} />
          </Field>
          <Field label={t('policy.stale')} unit={t('common.days')}>
            <NumInput value={p.staleDays} allowUnknown={false} min={1} step={1} onChange={(v) => v !== null && upP((x) => (x.staleDays = v))} />
          </Field>
          <Field label={t('policy.imbalanceDef')} help={t('help.imbalance')}>
            <Select value={p.phaseImbalanceDefinition} onChange={(v) => upP((x) => (x.phaseImbalanceDefinition = v))} options={[{ value: 'max_dev_from_mean', label: 'max|Iₚ−Ī|/Ī' }, { value: 'max_minus_min_over_max', label: '(Imax−Imin)/Imax' }]} />
          </Field>
          <Field label={t('policy.imbalance')}>
            <NumInput value={p.phaseImbalanceFraction} allowUnknown={false} min={0.01} max={1} onChange={(v) => v !== null && upP((x) => (x.phaseImbalanceFraction = v))} />
          </Field>
          <Field label={t('policy.inletRec')} unit="°C" help={t('help.ashrae')}>
            <div className="flex items-center gap-1">
              <NumInput value={p.inletRecommendedMinC} allowUnknown={false} width="w-16" onChange={(v) => v !== null && upP((x) => (x.inletRecommendedMinC = v))} />–
              <NumInput value={p.inletRecommendedMaxC} allowUnknown={false} width="w-16" onChange={(v) => v !== null && upP((x) => (x.inletRecommendedMaxC = v))} />
            </div>
            <label className="mt-1 inline-flex items-center gap-1 text-[11px]">
              <input type="checkbox" checked={p.inletEnvelopeVerified} onChange={(e) => upP((x) => (x.inletEnvelopeVerified = e.target.checked))} />
              {t('policy.envelopeVerified')}
            </label>
          </Field>
          <Field label={t('policy.inletAllowable')} unit="°C" help={t('help.allowable')}>
            <div className="flex items-center gap-1">
              <NumInput value={p.inletAllowableMinC} width="w-16" onChange={(v) => upP((x) => (x.inletAllowableMinC = v))} />–
              <NumInput value={p.inletAllowableMaxC} width="w-16" onChange={(v) => upP((x) => (x.inletAllowableMaxC = v))} />
            </div>
            <TextInput className="mt-1" placeholder={t('policy.allowableSource')} value={p.inletAllowableSource} onChange={(v) => upP((x) => (x.inletAllowableSource = v))} />
          </Field>
        </div>
      </Section>

      <Section title={t('policy.overrides')} defaultOpen={false}>
        <p className="mb-2 text-[11px] text-slate-400">{t('policy.overridesNote')}</p>
        <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
          {RULE_IDS.map((id) => (
            <div key={id} className="flex items-center gap-2 text-xs">
              <label className="inline-flex w-36 items-center gap-1 font-mono">
                <input type="checkbox" checked={!p.overrides[id]?.disabled} onChange={(e) => upP((x) => (x.overrides[id] = { ...x.overrides[id], disabled: !e.target.checked }))} />
                {id}
              </label>
              {p.overrides[id]?.disabled && <TextInput className="flex-1 text-xs" placeholder={t('policy.overrideReason')} value={p.overrides[id]?.note ?? ''} onChange={(v) => upP((x) => (x.overrides[id] = { ...x.overrides[id], note: v }))} />}
            </div>
          ))}
        </div>
      </Section>

      <CatalogEditor />
    </div>
  );
}

function CatalogEditor() {
  const { t } = useT();
  const project = useStore((s) => s.project);
  const update = useStore((s) => s.update);
  const toast = useStore((s) => s.toast);
  const [editId, setEditId] = useState<string | null>(null);
  const user = project.catalog.devices;
  const all = allDeviceTemplates(user);
  const editing = user.find((x) => x.id === editId);

  const cloneTpl = (src: DeviceTemplate) => {
    const id = BUILTIN_DEVICE_TEMPLATES.some((b) => b.id === src.id) && !user.some((u) => u.id === src.id) ? src.id : `user-${Date.now()}`;
    const copy: DeviceTemplate = { ...structuredClone(src), id, userDefined: true };
    update((d) => d.catalog.devices.push(copy));
    setEditId(id);
  };
  const setField = (_field: keyof DeviceTemplate, fn: (x: DeviceTemplate) => void) =>
    update((d) => {
      const x = d.catalog.devices.find((y) => y.id === editId);
      if (x) fn(x);
    });
  const sourcedNum = (k: 'heightU' | 'typicalAcW' | 'maxAcW' | 'depthMm' | 'weightKg', v: number | null) =>
    setField(k, (x) => {
      const cur = x[k] as Sourced<number>;
      x[k] = { ...cur, original: cur.original !== undefined ? cur.original : cur.value, value: v, status: 'user_supplied' } as never;
    });

  const importCatalog = async (file: File) => {
    try {
      const data = JSON.parse(await file.text());
      if (data?.format !== 'rack-power-catalog' || !Array.isArray(data.devices)) throw new Error('format');
      const ok = data.devices.filter((x: DeviceTemplate) => typeof x?.id === 'string' && typeof x?.model === 'string' && CATEGORIES.includes(x.category) && x.heightU && 'value' in x.heightU);
      update((d) => {
        for (const tpl of ok) {
          const i = d.catalog.devices.findIndex((y) => y.id === tpl.id);
          const clean = { ...tpl, userDefined: true };
          if (i >= 0) d.catalog.devices[i] = clean;
          else d.catalog.devices.push(clean);
        }
      });
      toast(t('cat.imported', { n: ok.length, skipped: data.devices.length - ok.length }), 'success');
    } catch {
      toast(t('cat.importFail'), 'error');
    }
  };

  return (
    <Section title={t('cat.title')} defaultOpen={false}>
      <p className="mb-2 text-[11px] text-slate-400">{t('cat.note')}</p>
      <div className="mb-2 flex flex-wrap gap-2">
        <button
          className="btn btn-sm"
          onClick={() => {
            const id = `user-${Date.now()}`;
            update((d) =>
              d.catalog.devices.push({
                id,
                category: 'custom',
                vendor: 'Custom',
                model: t('cat.newModel'),
                heightU: { value: 1, status: 'user_supplied' },
                depthMm: { value: null, status: 'user_supplied' },
                weightKg: { value: null, status: 'user_supplied' },
                airflow: { value: null, status: 'user_supplied' },
                psuOptions: [],
                supportedPsuCounts: { value: null, status: 'user_supplied' },
                supportedModes: { value: null, status: 'user_supplied' },
                typicalAcW: { value: null, status: 'user_supplied' },
                maxAcW: { value: null, status: 'user_supplied' },
                userDefined: true,
              }),
            );
            setEditId(id);
          }}
        >
          + {t('cat.create')}
        </button>
        <button className="btn btn-sm" onClick={() => download(`rack-power-catalog-${nowIso().slice(0, 10)}.json`, JSON.stringify({ format: 'rack-power-catalog', exportedAt: nowIso(), devices: all, pdus: project.catalog.pdus }, null, 2), 'application/json')}>
          ⬇ {t('cat.export')}
        </button>
        <label className="btn btn-sm cursor-pointer">
          ⬆ {t('cat.import')}
          <input type="file" accept="application/json,.json" className="hidden" onChange={(e) => e.target.files?.[0] && importCatalog(e.target.files[0])} />
        </label>
      </div>
      <Field label={t('cat.cloneFrom')}>
        <Select value="" onChange={(v) => v && cloneTpl(all.find((x) => x.id === v)!)} options={[{ value: '', label: '—' }, ...all.map((x) => ({ value: x.id, label: `${x.vendor} ${x.model}` }))]} />
      </Field>
      {user.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs">
          {user.map((u) => (
            <li key={u.id} className="flex items-center gap-2">
              <button className={`text-left ${editId === u.id ? 'text-cyan-300' : ''}`} onClick={() => setEditId(u.id)}>
                {u.vendor} {u.model}
              </button>
              <ProvBadge status="user_supplied" />
              <button className="btn btn-ghost btn-sm ml-auto" onClick={() => update((d) => (d.catalog.devices = d.catalog.devices.filter((x) => x.id !== u.id)))}>
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <div className="mt-3 grid grid-cols-2 gap-2 rounded-md border border-slate-700 p-2">
          <Field label={t('dev.vendor')}>
            <TextInput value={editing.vendor} onChange={(v) => setField('vendor', (x) => (x.vendor = v))} />
          </Field>
          <Field label={t('dev.model')}>
            <TextInput value={editing.model} onChange={(v) => setField('model', (x) => (x.model = v))} />
          </Field>
          <Field label={t('dev.category')}>
            <Select value={editing.category} onChange={(v) => setField('category', (x) => (x.category = v))} options={CATEGORIES.map((c) => ({ value: c, label: t(`cat.${c}`) }))} />
          </Field>
          <Field label="U">
            <NumInput value={editing.heightU.value} min={1} max={60} step={1} onChange={(v) => sourcedNum('heightU', v)} />
            {editing.heightU.original !== undefined && <span className="text-[10px] text-slate-500">{t('cat.original')}: {String(editing.heightU.original ?? '—')}</span>}
          </Field>
          <Field label={t('dev.depth')} unit="mm">
            <NumInput value={editing.depthMm.value} min={1} onChange={(v) => sourcedNum('depthMm', v)} />
          </Field>
          <Field label={t('dev.weight')} unit="kg">
            <NumInput value={editing.weightKg.value} min={0.1} onChange={(v) => sourcedNum('weightKg', v)} />
          </Field>
          <Field label={t('cat.maxAc')} unit="W" help={t('help.catMax')}>
            <NumInput value={editing.maxAcW.value} min={0} onChange={(v) => sourcedNum('maxAcW', v)} />
          </Field>
          <Field label={t('cat.sourceTitle')}>
            <TextInput value={editing.maxAcW.source?.title ?? ''} onChange={(v) => setField('maxAcW', (x) => (x.maxAcW = { ...x.maxAcW, source: { ...x.maxAcW.source, title: v, accessDate: nowIso().slice(0, 10) } }))} />
          </Field>
          <Field label={t('cat.sourceUrl')} className="col-span-2">
            <TextInput value={editing.maxAcW.source?.url ?? ''} onChange={(v) => setField('maxAcW', (x) => (x.maxAcW = { ...x.maxAcW, source: { title: x.maxAcW.source?.title ?? '', ...x.maxAcW.source, url: v } }))} />
          </Field>
          <p className="col-span-2 text-[10px] text-slate-500">{t('cat.userNote')}</p>
        </div>
      )}
    </Section>
  );
}
