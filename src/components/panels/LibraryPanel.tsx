import { useMemo, useState } from 'react';
import { produce } from 'immer';
import type { DeviceCategory, DeviceInstance, DeviceTemplate } from '../../domain/types';
import { useStore } from '../../state/store';
import { useT } from '../../i18n';
import { allDeviceTemplates, CATEGORIES, CATALOG_ACCESS_NOTE } from '../../catalog/devices';
import { deviceFromTemplate, newDevice, newDomain, cloneDevice } from '../../domain/factory';
import { DeviceForm } from '../device/DeviceForm';
import { addDevices } from '../../state/actions';
import { Field, NeedInfo, NumInput, ProvBadge, Select } from '../ui/primitives';
import { useNotify } from '../useNotify';
import { freeBlocks, occupiedRanges } from '../../engine/placement';

type PlaceMode = 'auto' | 'manual' | 'outside' | 'unplaced';

export function LibraryPanel({ compact = false }: { compact?: boolean }) {
  const { t } = useT();
  const notify = useNotify();
  const project = useStore((s) => s.project);
  const rackId = useStore((s) => s.selectedRackId);
  const setUi = useStore((s) => s.setUi);
  const toast = useStore((s) => s.toast);
  const templates = allDeviceTemplates(project.catalog.devices);
  const [cat, setCat] = useState<DeviceCategory | 'all'>('all');
  const [vendor, setVendor] = useState<string>('all');
  const [q, setQ] = useState('');
  const [draft, setDraft] = useState<DeviceInstance | null>(null);
  const [heightU, setHeightU] = useState<number | null>(null);
  const [qty, setQty] = useState(1);
  const [placeMode, setPlaceMode] = useState<PlaceMode>('auto');
  const [startU, setStartU] = useState<number | null>(1);
  const [autoConnect, setAutoConnect] = useState(true);
  const rack = project.racks.find((r) => r.id === rackId)!;

  const vendors = useMemo(() => Array.from(new Set(templates.map((x) => x.vendor))).sort(), [templates]);
  const list = templates.filter((x) => (cat === 'all' || x.category === cat) && (vendor === 'all' || x.vendor === vendor) && `${x.vendor} ${x.model}`.toLowerCase().includes(q.toLowerCase()));
  const free = freeBlocks(rack, occupiedRanges(rack.id, project.devices, project.pdus));

  const pick = (tpl: DeviceTemplate | null) => {
    if (tpl) {
      const d = deviceFromTemplate(rackId, tpl);
      setDraft(d);
      setHeightU(tpl.heightU.value);
      setPlaceMode(tpl.category === 'tower_server' ? 'outside' : 'auto');
    } else {
      setDraft(newDevice(rackId, { name: t('lib.customName'), vendor: 'Custom', domains: [newDomain(2, null, 'unknown')] }));
      setHeightU(1);
      setPlaceMode('auto');
    }
    setQty(1);
  };

  const add = () => {
    if (!draft) return;
    const needsU = placeMode === 'auto' || placeMode === 'manual';
    if (needsU && (heightU === null || !Number.isInteger(heightU) || heightU < 1)) {
      toast(t('err.place.invalid_height'), 'error');
      return;
    }
    const mode = placeMode === 'manual' ? { mode: 'manual' as const, startU: startU ?? 1 } : placeMode === 'auto' ? { mode: 'auto' as const } : { mode: placeMode };
    const base = draft;
    // Each instance gets unique device/domain/PSU IDs.
    const r = addDevices(rackId, () => cloneDevice(base, ''), qty, mode, heightU ?? 1, autoConnect && !base.power.passiveZero);
    if (notify(r)) {
      toast(t('lib.added', { n: qty }), 'success');
      setUi({ selectedDeviceId: r.ok && r.ids ? r.ids[0] : null });
      setDraft(null);
    }
  };

  if (draft) {
    return (
      <div>
        <div className="mb-3 flex items-center gap-2">
          <button className="btn btn-sm" onClick={() => setDraft(null)}>
            ← {t('lib.back')}
          </button>
          <h3 className="truncate text-sm font-semibold">{t('lib.configure')}</h3>
        </div>
        <div className="card mb-3 p-3">
          <div className="mb-2 text-sm font-semibold text-slate-100">{t('lib.placement')}</div>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('lib.quantity')} help={t('help.quantity')}>
              <NumInput value={qty} allowUnknown={false} min={1} max={60} step={1} width="w-16" onChange={(v) => v !== null && setQty(Math.round(v))} />
            </Field>
            <Field label={t('lib.heightU')} unit="U" help={t('help.heightU')}>
              <NumInput value={heightU} min={1} max={60} step={1} width="w-16" onChange={setHeightU} />
              {draft.templateId && <span className="text-[10px] text-amber-300">{t('lib.confirmHeight')}</span>}
            </Field>
            <Field label={t('lib.location')} className="col-span-2">
              <div className="flex flex-wrap gap-3 text-xs">
                {(['auto', 'manual', 'outside', 'unplaced'] as const).map((m) => (
                  <label key={m} className="inline-flex items-center gap-1">
                    <input type="radio" name="place" checked={placeMode === m} onChange={() => setPlaceMode(m)} />
                    {t(`lib.place.${m}`)}
                  </label>
                ))}
              </div>
            </Field>
            {placeMode === 'manual' && (
              <Field label={t('lib.startU')} help={t('help.startU')}>
                <NumInput value={startU} allowUnknown={false} min={1} max={rack.heightU} step={1} width="w-16" onChange={setStartU} />
              </Field>
            )}
            <div className="col-span-2 text-[11px] text-slate-400">
              {t('lib.freeBlocks')}: {free.length ? free.map((b) => `U${b.start}–${b.start + b.size - 1} (${b.size}U)`).join(', ') : t('lib.noFree')}
            </div>
            {!draft.power.passiveZero && (
              <label className="col-span-2 inline-flex items-center gap-2 text-xs text-slate-300">
                <input type="checkbox" checked={autoConnect} onChange={(e) => setAutoConnect(e.target.checked)} />
                {t('lib.autoConnect')}
              </label>
            )}
          </div>
        </div>
        <DeviceForm device={draft} mode="add" onPatch={(fn) => setDraft((d) => (d ? produce(d, (x) => { fn(x); }) : d))} />
        <div className="sticky bottom-0 mt-3 flex justify-end gap-2 border-t border-slate-800 bg-[#0b1220] py-2">
          <button className="btn" onClick={() => setDraft(null)}>
            {t('common.cancel')}
          </button>
          <button className="btn btn-primary" onClick={add}>
            + {t('lib.addToRack', { n: qty, rack: rack.name })}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      {!compact && <p className="mb-2 text-xs text-slate-400">{t('lib.intro')}</p>}
      <div className="mb-3 flex flex-wrap gap-2">
        <button className="btn btn-primary" onClick={() => pick(null)}>
          + {t('lib.custom')}
        </button>
        <Select value={cat} onChange={setCat} ariaLabel={t('dev.category')} options={[{ value: 'all', label: t('lib.allCategories') }, ...CATEGORIES.map((c) => ({ value: c, label: t(`cat.${c}`) }))]} />
        <Select value={vendor} onChange={setVendor} ariaLabel={t('dev.vendor')} options={[{ value: 'all', label: t('lib.allVendors') }, ...vendors.map((v) => ({ value: v, label: v }))]} />
        <input type="search" placeholder={t('lib.search')} value={q} onChange={(e) => setQ(e.target.value)} className="min-w-32 flex-1" aria-label={t('lib.search')} />
      </div>
      <p className="mb-2 rounded border border-amber-900/60 bg-amber-950/30 p-2 text-[11px] text-amber-200">{t('lib.catalogNote')}</p>
      <ul className="divide-y divide-slate-800 rounded-md border border-slate-800">
        {list.map((x) => (
          <li key={x.id}>
            <button className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-slate-800/60" onClick={() => pick(x)}>
              <span className="min-w-0">
                <span className="block truncate text-sm text-slate-100">
                  {x.vendor} {x.model}
                </span>
                <span className="text-[11px] text-slate-400">
                  {t(`cat.${x.category}`)} · {x.heightU.value ? `${x.heightU.value}U` : t('common.needInfo')}
                  {x.isPassive ? ` · 0 W (${t('lib.passive')})` : ''}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-1">
                {!x.isPassive && x.typicalAcW.value === null && <NeedInfo />}
                <ProvBadge status={x.userDefined ? 'user_supplied' : x.isPassive ? 'assumption' : 'unverified'} />
              </span>
            </button>
          </li>
        ))}
        {list.length === 0 && <li className="p-3 text-center text-sm text-slate-500">{t('lib.none')}</li>}
      </ul>
      <p className="mt-2 text-[10px] text-slate-500" title={CATALOG_ACCESS_NOTE}>
        {t('lib.catalogVersion')}
      </p>
    </div>
  );
}
