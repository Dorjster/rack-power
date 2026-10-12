import type { DeviceInstance, InletType, PowerDomain, Psu, RedundancyMode, SharingMode } from '../../domain/types';
import { useStore } from '../../state/store';
import { useT } from '../../i18n';
import { Field, Help, NumInput, ProvBadge, Section, Select, TextInput } from '../ui/primitives';
import { CATEGORIES, EXAMPLE_PSU_WATTS, allDeviceTemplates } from '../../catalog/devices';
import { newDomain, newPsu } from '../../domain/factory';
import { resolveLoad, installedNameplateW, componentDcW } from '../../engine/devicePower';
import { fmtNum, fmtW } from '../../engine/format';

const MODES: RedundancyMode[] = ['single', '1+1', 'N+1', 'N+N', 'load_sharing', 'vendor_fault_tolerant', 'unknown'];
const SHARING: SharingMode[] = ['equal', 'configured', 'measured', 'hot_standby'];
const INLETS: InletType[] = ['C14', 'C20', 'C16', 'C8', 'C6', 'DC_terminal', 'other', 'unknown'];

export type Patch = (fn: (d: DeviceInstance) => void) => void;

export function DeviceForm({ device, onPatch, mode }: { device: DeviceInstance; onPatch: Patch; mode: 'add' | 'edit' }) {
  const { t } = useT();
  const advanced = useStore((s) => s.advanced);
  const project = useStore((s) => s.project);
  const template = device.templateId ? allDeviceTemplates(project.catalog.devices).find((x) => x.id === device.templateId) : undefined;
  const typ = resolveLoad(device, project.assumptions, 'typical');
  const des = resolveLoad(device, project.assumptions, 'design');
  const nameplate = installedNameplateW(device);
  const markOverride = (key: string) => (d: DeviceInstance) => {
    if (d.templateId && !d.userOverrides.includes(key)) d.userOverrides.push(key);
  };

  return (
    <div>
      <Section title={t('dev.identity')}>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('dev.name')}>
            <TextInput value={device.name} onChange={(v) => onPatch((d) => (d.name = v || d.name))} />
          </Field>
          <Field label={t('dev.category')}>
            <Select
              value={device.category}
              onChange={(v) =>
                onPatch((d) => {
                  d.category = v;
                  if (v === 'passive') {
                    d.power.passiveZero = true;
                    d.domains = [];
                    d.critical = false;
                  } else if (d.power.passiveZero) {
                    d.power.passiveZero = false;
                    if (d.domains.length === 0) d.domains = [newDomain(1, null)];
                  }
                  if (v === 'poe_switch' && !d.poe) d.poe = { baseTypicalW: null, baseDesignW: null, deliveredTypicalW: null, deliveredDesignW: null, efficiency: null, budgetW: null, inRackFraction: 0 };
                })
              }
              options={CATEGORIES.map((c) => ({ value: c, label: t(`cat.${c}`) }))}
            />
          </Field>
          <Field label={t('dev.vendor')}>
            <TextInput value={device.vendor} onChange={(v) => onPatch((d) => (d.vendor = v))} />
          </Field>
          <Field label={t('dev.model')}>
            <TextInput value={device.model} onChange={(v) => onPatch((d) => (d.model = v))} />
          </Field>
          {device.category === 'passive' && (
            <Field label={t('dev.passiveKind')}>
              <Select value={device.passiveKind ?? 'other'} onChange={(v) => onPatch((d) => (d.passiveKind = v))} options={(['blanking', 'patch_panel', 'cable_manager', 'shelf', 'other'] as const).map((x) => ({ value: x, label: t(`passive.${x}`) }))} />
            </Field>
          )}
          {device.passiveKind === 'shelf' && (
            <Field label={t('dev.shelfCapacity')} unit="kg">
              <NumInput value={device.shelfCapacityKg ?? null} min={0} onChange={(v) => onPatch((d) => (d.shelfCapacityKg = v))} />
            </Field>
          )}
          {device.category !== 'passive' && (
            <label className="col-span-2 inline-flex items-center gap-2 text-xs text-slate-300">
              <input type="checkbox" checked={device.critical} onChange={(e) => onPatch((d) => (d.critical = e.target.checked))} />
              {t('dev.critical')} <Help text={t('help.critical')} />
            </label>
          )}
          {project.mode === 'audit' && (
            <Field label={t('dev.assetLabel')} className="col-span-2">
              <TextInput value={device.assetLabel ?? ''} onChange={(v) => onPatch((d) => (d.assetLabel = v))} />
            </Field>
          )}
        </div>
        {template && (
          <div className="mt-3 rounded-md border border-amber-800/60 bg-amber-950/30 p-2 text-[11px] text-amber-200">
            <div className="mb-1 flex items-center gap-2 font-semibold">
              {t('dev.templateFrom')}: {template.vendor} {template.model} <ProvBadge status={template.heightU.status} />
            </div>
            <div>{t('dev.templateNote')}</div>
            {device.userOverrides.length > 0 && (
              <div className="mt-1 text-sky-300">
                {t('dev.userOverrides')}: {device.userOverrides.join(', ')}
              </div>
            )}
          </div>
        )}
      </Section>

      {device.category !== 'passive' && (
        <Section title={t('dev.power')} badge={typ.inputW === null ? <span className="text-[10px] text-amber-300">{t('common.needInfo')}</span> : undefined}>
          <div className="mb-3 rounded-md border border-cyan-900 bg-cyan-950/40 p-2 text-[11px] text-cyan-100">{t('help.psuVsLoad')}</div>
          <label className="mb-3 inline-flex items-center gap-2 text-xs text-slate-300">
            <input type="checkbox" checked={!!device.poweredByPoeSwitchId} onChange={(e) => onPatch((d) => (d.poweredByPoeSwitchId = e.target.checked ? project.devices.find((x) => x.category === 'poe_switch' && x.rackId === d.rackId)?.id ?? null : null))} />
            {t('dev.poePowered')}
          </label>
          {device.poweredByPoeSwitchId !== undefined && device.poweredByPoeSwitchId !== null ? (
            <Field label={t('dev.poeSwitch')}>
              <Select
                value={device.poweredByPoeSwitchId}
                onChange={(v) => onPatch((d) => (d.poweredByPoeSwitchId = v))}
                options={project.devices.filter((x) => x.category === 'poe_switch' && x.id !== device.id).map((x) => ({ value: x.id, label: x.name }))}
              />
              <span className="text-[10px] text-slate-500">{t('help.poeEndpoint')}</span>
            </Field>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field label={t('power.typical')} unit="W AC" help={t('help.typical')} example={t('ex.typical')}>
                  <NumInput value={device.power.typicalW} min={0} onChange={(v) => onPatch((d) => (d.power.typicalW = v))} />
                  <TextInput className="mt-1 text-xs" placeholder={t('power.sourcePh')} value={device.power.typicalSource} onChange={(v) => onPatch((d) => (d.power.typicalSource = v))} />
                </Field>
                <Field label={t('power.design')} unit="W AC" help={t('help.design')} example={t('ex.design')}>
                  <NumInput value={device.power.designW} min={0} onChange={(v) => onPatch((d) => (d.power.designW = v))} />
                  <TextInput className="mt-1 text-xs" placeholder={t('power.sourcePh')} value={device.power.designSource} onChange={(v) => onPatch((d) => (d.power.designSource = v))} />
                </Field>
              </div>
              <MeasuredBlock device={device} onPatch={onPatch} />
              {(advanced || device.category === 'gpu_server' || device.power.useComponentEstimate) && <ComponentBlock device={device} onPatch={onPatch} />}
              {(advanced || device.power.useProxy) && (
                <div className="mt-3 rounded-md border border-violet-900 p-2">
                  <label className="inline-flex items-center gap-2 text-xs font-medium text-violet-200">
                    <input type="checkbox" checked={device.power.useProxy} onChange={(e) => onPatch((d) => (d.power.useProxy = e.target.checked))} />
                    {t('power.proxy')} <Help text={t('help.proxy')} />
                  </label>
                  {device.power.useProxy && (
                    <div className="mt-2">
                      <Field label={t('power.proxyDc')} unit="W DC">
                        <NumInput value={device.power.proxy?.assumedDcW ?? null} min={0} onChange={(v) => onPatch((d) => (d.power.proxy = v === null ? null : { assumedDcW: v }))} />
                      </Field>
                    </div>
                  )}
                </div>
              )}
              {advanced && (
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <Field label="PF" help={t('help.pf')} example={t('ex.pf', { pf: project.assumptions.defaultPf })}>
                    <NumInput value={device.power.pf} min={0.01} max={1} onChange={(v) => onPatch((d) => (d.power.pf = v))} />
                  </Field>
                  <Field label={t('power.eta')} help={t('help.eta')} example={t('ex.eta', { eta: project.assumptions.defaultEfficiency })}>
                    <NumInput value={device.power.efficiency} min={0.01} max={1} onChange={(v) => onPatch((d) => (d.power.efficiency = v))} />
                  </Field>
                  <Field label={t('power.confidence')}>
                    <Select value={device.power.confidence} onChange={(v) => onPatch((d) => (d.power.confidence = v))} options={(['high', 'medium', 'low'] as const).map((x) => ({ value: x, label: t(`conf.${x}`) }))} />
                  </Field>
                  <Field label={t('dev.inputType')} help={t('help.dc')}>
                    <Select value={device.inputType} onChange={(v) => onPatch((d) => (d.inputType = v))} options={[{ value: 'AC', label: 'AC' }, { value: 'DC', label: 'DC (-48 V)' }]} />
                  </Field>
                  <Field label={t('power.assumptions')} className="col-span-2">
                    <TextInput value={device.power.assumptions} onChange={(v) => onPatch((d) => (d.power.assumptions = v))} />
                  </Field>
                </div>
              )}
              {device.category === 'poe_switch' && <PoeBlock device={device} onPatch={onPatch} />}
              <div className="mt-3 rounded-md bg-slate-900 p-2 text-xs">
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  <span>
                    {t('power.resolvedTypical')}: <b className="text-cyan-300">{typ.inputW === null ? t('common.unknown') : fmtW(typ.inputW)}</b> ({t(`basis.${typ.basis}`)})
                  </span>
                  <span>
                    {t('power.resolvedDesign')}: <b className="text-cyan-300">{des.inputW === null ? t('common.unknown') : fmtW(des.inputW)}</b> ({t(`basis.${des.basis}`)})
                  </span>
                  <span>
                    {t('power.nameplate')}: <b>{nameplate === null ? t('common.unknown') : fmtW(nameplate)}</b> <Help text={t('help.nameplate')} />
                  </span>
                </div>
                {[...new Set([...typ.assumptions, ...des.assumptions])].length > 0 && (
                  <div className="mt-1 text-[11px] text-violet-300">
                    {t('power.assumptionsUsed')}: {[...new Set([...typ.assumptions, ...des.assumptions])].map((a) => t(`asm.${a}`, { pf: project.assumptions.defaultPf, eta: project.assumptions.defaultEfficiency, poe: project.assumptions.poeEfficiency })).join('; ')}
                  </div>
                )}
              </div>
            </>
          )}
        </Section>
      )}

      {device.category !== 'passive' && !device.poweredByPoeSwitchId && (
        <Section title={t('dev.psus')}>
          {device.domains.map((dom, di) => (
            <DomainBlock key={dom.id} device={device} domain={dom} index={di} onPatch={onPatch} templatePsuOptions={template?.psuOptions ?? []} markOverride={markOverride} />
          ))}
          {advanced && (
            <button
              className="btn btn-sm mt-2"
              onClick={() =>
                onPatch((d) => {
                  const n = d.domains.length + 1;
                  d.domains.push(newDomain(2, null, 'unknown', { name: `Domain ${n}`, loadFraction: 0 }));
                })
              }
            >
              + {t('dev.addDomain')}
            </button>
          )}
          {advanced && device.domains.length > 1 && (
            <p className="mt-1 text-[11px] text-slate-400">
              {t('dev.domainFractions')}: Σ = {fmtNum(device.domains.reduce((s, d) => s + d.loadFraction, 0), 2)} {Math.abs(device.domains.reduce((s, d) => s + d.loadFraction, 0) - 1) > 1e-6 && <span className="text-amber-300">⚠ {t('dev.fractionWarn')}</span>}
            </p>
          )}
        </Section>
      )}

      {device.category !== 'passive' && (
        <Section title={t('dev.physical')} defaultOpen={mode === 'edit' && advanced}>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('dev.depth')} unit="mm">
              <NumInput value={device.depthMm} min={1} onChange={(v) => onPatch((d) => (d.depthMm = v))} />
            </Field>
            <Field label={t('dev.weight')} unit="kg">
              <NumInput value={device.weightKg} min={0.1} onChange={(v) => onPatch((d) => (d.weightKg = v))} />
            </Field>
            <Field label={t('dev.airflow')}>
              <Select value={device.airflow} onChange={(v) => onPatch((d) => (d.airflow = v))} options={(['front_to_back', 'back_to_front', 'side_to_side', 'unknown'] as const).map((x) => ({ value: x, label: t(`airflow.${x}`) }))} />
            </Field>
            <div className="flex flex-col gap-1 text-xs">
              <label className="inline-flex items-center gap-2 text-slate-300">
                <input type="checkbox" checked={device.cooling.liquidCooled} onChange={(e) => onPatch((d) => (d.cooling.liquidCooled = e.target.checked))} />
                {t('dev.liquid')}
              </label>
              {device.cooling.liquidCooled && (
                <Field label={t('dev.liquidFraction')} help={t('help.liquid')}>
                  <NumInput value={device.cooling.liquidFraction} min={0} max={1} onChange={(v) => onPatch((d) => (d.cooling.liquidFraction = v))} />
                </Field>
              )}
            </div>
            {device.category === 'gpu_server' && (
              <>
                <Field label={t('dev.cpuCount')}>
                  <NumInput value={device.cpuCount ?? null} min={0} step={1} onChange={(v) => onPatch((d) => (d.cpuCount = v))} />
                </Field>
                <Field label={t('dev.gpuCount')}>
                  <NumInput value={device.gpuCount ?? null} min={0} step={1} onChange={(v) => onPatch((d) => (d.gpuCount = v))} />
                </Field>
              </>
            )}
          </div>
        </Section>
      )}

      <Field label={t('dev.notes')}>
        <textarea rows={2} value={device.notes} onChange={(e) => onPatch((d) => (d.notes = e.target.value))} />
      </Field>
    </div>
  );
}

function MeasuredBlock({ device, onPatch }: { device: DeviceInstance; onPatch: Patch }) {
  const { t } = useT();
  const m = device.power.measured;
  return (
    <div className="mt-3 rounded-md border border-emerald-900 p-2">
      <div className="mb-2 flex items-center gap-2 text-xs font-medium text-emerald-200">
        {t('power.measured')} <Help text={t('help.measured')} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('power.measuredW')} unit="W AC">
          <NumInput
            value={m?.totalW ?? null}
            min={0}
            onChange={(v) =>
              onPatch((d) => {
                d.power.measured = v === null ? null : { totalW: v, method: m?.method ?? 'whole_device', window: m?.window ?? 'instant', timestamp: m?.timestamp ?? new Date().toISOString().slice(0, 16), source: m?.source ?? '' };
              })
            }
          />
        </Field>
        {m && (
          <>
            <Field label={t('power.method')}>
              <Select
                value={m.method}
                onChange={(v) => onPatch((d) => (d.power.measured!.method = v))}
                options={(['whole_device', 'per_psu_sum', 'pdu_outlet', 'clamp_meter'] as const).map((x) => ({ value: x, label: t(`method.${x}`) }))}
              />
            </Field>
            <Field label={t('power.window')} example={t('ex.window')}>
              <TextInput value={m.window} onChange={(v) => onPatch((d) => (d.power.measured!.window = v))} />
            </Field>
            <Field label={t('power.timestamp')}>
              <input type="datetime-local" value={m.timestamp.slice(0, 16)} onChange={(e) => onPatch((d) => (d.power.measured!.timestamp = e.target.value))} />
            </Field>
            <Field label={t('power.measSource')} example="iDRAC / iLO / PDU">
              <TextInput value={m.source} onChange={(v) => onPatch((d) => (d.power.measured!.source = v))} />
            </Field>
          </>
        )}
      </div>
      {m && <p className="mt-1 text-[11px] text-slate-400">{t('help.measuredNotPeak')}</p>}
    </div>
  );
}

function ComponentBlock({ device, onPatch }: { device: DeviceInstance; onPatch: Patch }) {
  const { t } = useT();
  const c = device.power.component ?? { cpuCount: 0, cpuTdpW: 0, gpuCount: 0, gpuTdpW: 0, memoryW: 0, disksW: 0, fansW: 0, boardW: 0, otherW: 0 };
  const set = (k: keyof typeof c, v: number | null) => onPatch((d) => (d.power.component = { ...c, [k]: v ?? 0 }));
  const dc = componentDcW(device);
  return (
    <div className="mt-3 rounded-md border border-sky-900 p-2">
      <label className="inline-flex items-center gap-2 text-xs font-medium text-sky-200">
        <input type="checkbox" checked={device.power.useComponentEstimate} onChange={(e) => onPatch((d) => ((d.power.useComponentEstimate = e.target.checked), (d.power.component = d.power.component ?? c)))} />
        {t('power.component')} <Help text={t('help.component')} />
      </label>
      {device.power.useComponentEstimate && (
        <div className="mt-2 grid grid-cols-3 gap-2">
          {(['cpuCount', 'cpuTdpW', 'gpuCount', 'gpuTdpW', 'memoryW', 'disksW', 'fansW', 'boardW', 'otherW'] as const).map((k) => (
            <Field key={k} label={t(`comp.${k}`)}>
              <NumInput value={c[k]} min={0} allowUnknown={false} width="w-20" onChange={(v) => set(k, v)} />
            </Field>
          ))}
          <Field label={t('power.manufacturerW')} unit="W AC" help={t('help.manufacturerW')} className="col-span-3">
            <NumInput value={device.power.manufacturerW} min={0} onChange={(v) => onPatch((d) => (d.power.manufacturerW = v))} />
          </Field>
          <p className="col-span-3 text-[11px] text-slate-400">
            Σ DC = {fmtW(dc)} → AC = Σ DC / η {device.power.manufacturerW !== null && <span className="text-amber-300">— {t('power.manufacturerOverrides')}</span>}
          </p>
        </div>
      )}
    </div>
  );
}

function PoeBlock({ device, onPatch }: { device: DeviceInstance; onPatch: Patch }) {
  const { t } = useT();
  const p = device.poe ?? { baseTypicalW: null, baseDesignW: null, deliveredTypicalW: null, deliveredDesignW: null, efficiency: null, budgetW: null, inRackFraction: 0 };
  const set = (k: keyof typeof p, v: number | null) => onPatch((d) => (d.poe = { ...p, [k]: k === 'inRackFraction' ? v ?? 0 : v }));
  return (
    <div className="mt-3 rounded-md border border-yellow-900 p-2">
      <div className="mb-2 text-xs font-medium text-yellow-200">
        PoE <Help text={t('help.poe')} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label={t('poe.baseTypical')} unit="W AC">
          <NumInput value={p.baseTypicalW} min={0} onChange={(v) => set('baseTypicalW', v)} />
        </Field>
        <Field label={t('poe.baseDesign')} unit="W AC">
          <NumInput value={p.baseDesignW} min={0} onChange={(v) => set('baseDesignW', v)} />
        </Field>
        <Field label={t('poe.deliveredTypical')} unit="W DC">
          <NumInput value={p.deliveredTypicalW} min={0} onChange={(v) => set('deliveredTypicalW', v)} />
        </Field>
        <Field label={t('poe.deliveredDesign')} unit="W DC">
          <NumInput value={p.deliveredDesignW} min={0} onChange={(v) => set('deliveredDesignW', v)} />
        </Field>
        <Field label={t('poe.eta')}>
          <NumInput value={p.efficiency} min={0.01} max={1} onChange={(v) => set('efficiency', v)} />
        </Field>
        <Field label={t('poe.budget')} unit="W">
          <NumInput value={p.budgetW} min={0} onChange={(v) => set('budgetW', v)} />
        </Field>
        <Field label={t('poe.inRack')} help={t('help.poeInRack')}>
          <NumInput value={p.inRackFraction} min={0} max={1} allowUnknown={false} onChange={(v) => set('inRackFraction', v)} />
        </Field>
      </div>
    </div>
  );
}

function DomainBlock({
  device,
  domain,
  index,
  onPatch,
  templatePsuOptions,
  markOverride,
}: {
  device: DeviceInstance;
  domain: PowerDomain;
  index: number;
  onPatch: Patch;
  templatePsuOptions: { id: string; label: string; ratedDcW: { value: number | null; status: string } }[];
  markOverride: (k: string) => (d: DeviceInstance) => void;
}) {
  const { t } = useT();
  const advanced = useStore((s) => s.advanced);
  const project = useStore((s) => s.project);
  const patchDom = (fn: (d: PowerDomain) => void) => onPatch((d) => fn(d.domains[index]));
  const verifiedOptions = templatePsuOptions.filter((o) => o.ratedDcW.status === 'verified' && o.ratedDcW.value !== null);
  const count = domain.psus.length;
  const commonRating = domain.psus.length && domain.psus.every((p) => p.ratedDcW === domain.psus[0].ratedDcW) ? domain.psus[0].ratedDcW : null;

  const setCount = (n: number) =>
    patchDom((dom) => {
      if (!Number.isInteger(n) || n < 0 || n > 16) return;
      while (dom.psus.length < n) {
        const ref = dom.psus[0];
        dom.psus.push(newPsu({ label: `PSU${dom.psus.length + 1}`, ratedDcW: ref?.ratedDcW ?? null, inlet: ref?.inlet ?? 'unknown', efficiency: ref?.efficiency ?? null, inputVoltageMin: ref?.inputVoltageMin ?? null, inputVoltageMax: ref?.inputVoltageMax ?? null, inputType: device.inputType }));
      }
      dom.psus.length = n;
      if (n === 1) dom.mode = 'single';
      else if (dom.mode === 'single') dom.mode = 'unknown';
      if (dom.mode === 'N+1') dom.requiredPsus = n - 1;
      if (dom.mode === 'N+N') dom.requiredPsus = n / 2;
    });

  const outletsInRack = project.pdus.filter((p) => p.rackId === device.rackId);

  return (
    <div className="mb-3 rounded-md border border-slate-700 p-2">
      {device.domains.length > 1 && (
        <div className="mb-2 flex items-center gap-2">
          <TextInput value={domain.name} onChange={(v) => patchDom((d) => (d.name = v))} className="w-32" />
          <Field label={t('dev.loadFraction')}>
            <NumInput value={domain.loadFraction} min={0} max={1} allowUnknown={false} width="w-16" onChange={(v) => v !== null && patchDom((d) => (d.loadFraction = v))} />
          </Field>
          <button className="btn btn-ghost btn-sm ml-auto" onClick={() => onPatch((d) => d.domains.splice(index, 1))}>
            ✕
          </button>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('psu.count')} help={t('help.psuCount')}>
          <div className="flex items-center gap-1">
            <Select value={[1, 2, 4, 6].includes(count) ? String(count) : 'custom'} onChange={(v) => v !== 'custom' && setCount(Number(v))} options={[...[1, 2, 4, 6].map((n) => ({ value: String(n), label: String(n) })), { value: 'custom', label: t('common.custom') }]} />
            <NumInput value={count} allowUnknown={false} min={0} max={16} step={1} width="w-14" onChange={(v) => v !== null && setCount(v)} />
          </div>
        </Field>
        <Field label={t('psu.rating')} unit="W DC" help={t('help.psuRating')}>
          {verifiedOptions.length > 0 && (
            <Select
              value={String(commonRating ?? '')}
              onChange={(v) => patchDom((d) => d.psus.forEach((p) => ((p.ratedDcW = Number(v)), (p.compatVerified = true))))}
              options={[{ value: '', label: '—' }, ...verifiedOptions.map((o) => ({ value: String(o.ratedDcW.value), label: `${o.label} (✓)` }))]}
            />
          )}
          <NumInput
            value={commonRating}
            min={1}
            allowZero={false}
            onChange={(v) =>
              onPatch((d) => {
                d.domains[index].psus.forEach((p) => ((p.ratedDcW = v), (p.compatVerified = false)));
                markOverride('psu.ratedDcW')(d);
              })
            }
            placeholder={domain.psus.length > 1 && commonRating === null && domain.psus.some((p) => p.ratedDcW !== null) ? t('psu.mixed') : undefined}
          />
          <span className="text-[10px] text-slate-500">
            {t('psu.examples')}: {EXAMPLE_PSU_WATTS.join('/')} W · {verifiedOptions.length ? '' : t('psu.unverifiedCompat')}
          </span>
        </Field>
        <Field label={t('psu.mode')} help={t('help.mode')}>
          <Select
            value={domain.mode}
            onChange={(v) =>
              patchDom((d) => {
                d.mode = v;
                if (v === '1+1') d.requiredPsus = 1;
                if (v === 'N+1') d.requiredPsus = Math.max(1, d.psus.length - 1);
                if (v === 'N+N') d.requiredPsus = Math.max(1, Math.floor(d.psus.length / 2));
                if (v === 'single') d.requiredPsus = 1;
              })
            }
            options={MODES.map((m) => ({ value: m, label: t(`mode.${m}`) }))}
          />
        </Field>
        {(domain.mode === 'N+1' || domain.mode === 'N+N' || domain.mode === 'vendor_fault_tolerant') && (
          <Field label={t('psu.requiredN')} help={t('help.requiredN')}>
            <NumInput value={domain.requiredPsus} min={1} step={1} onChange={(v) => patchDom((d) => (d.requiredPsus = v))} />
          </Field>
        )}
        {advanced && (
          <Field label={t('psu.sharing')} help={t('help.sharing')}>
            <Select value={domain.sharing} onChange={(v) => patchDom((d) => (d.sharing = v))} options={SHARING.map((s) => ({ value: s, label: t(`sharing.${s}`) }))} />
          </Field>
        )}
        <Field label={t('psu.inlet')} help={t('help.inlet')}>
          <Select value={domain.psus[0]?.inlet ?? 'unknown'} onChange={(v) => patchDom((d) => d.psus.forEach((p) => (p.inlet = v)))} options={INLETS.map((x) => ({ value: x, label: x === 'unknown' ? t('common.unknown') : x }))} />
        </Field>
        {advanced && (
          <>
            <Field label={t('psu.vrange')} unit="V">
              <div className="flex items-center gap-1">
                <NumInput value={domain.psus[0]?.inputVoltageMin ?? null} min={1} width="w-16" onChange={(v) => patchDom((d) => d.psus.forEach((p) => (p.inputVoltageMin = v)))} />–
                <NumInput value={domain.psus[0]?.inputVoltageMax ?? null} min={1} width="w-16" onChange={(v) => patchDom((d) => d.psus.forEach((p) => (p.inputVoltageMax = v)))} />
              </div>
            </Field>
            <Field label={t('psu.eta')}>
              <NumInput value={domain.psus[0]?.efficiency ?? null} min={0.01} max={1} onChange={(v) => patchDom((d) => d.psus.forEach((p) => (p.efficiency = v)))} />
            </Field>
          </>
        )}
      </div>

      {domain.psus.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>PSU</th>
                <th>{t('psu.rating')}</th>
                <th>{t('psu.state')}</th>
                <th>{t('psu.connection')}</th>
                {advanced && <th>{t('psu.measured')}</th>}
              </tr>
            </thead>
            <tbody>
              {domain.psus.map((p, pi) => (
                <PsuRow key={p.id} psu={p} advanced={advanced} pdus={outletsInRack} device={device} onChange={(fn) => patchDom((d) => fn(d.psus[pi]))} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function PsuRow({ psu, advanced, pdus, device, onChange }: { psu: Psu; advanced: boolean; pdus: ReturnType<typeof useStore.getState>['project']['pdus']; device: DeviceInstance; onChange: (fn: (p: Psu) => void) => void }) {
  const { t } = useT();
  const project = useStore((s) => s.project);
  const owner = new Map<string, string>();
  for (const d of project.devices) for (const dom of d.domains) for (const ps of dom.psus) if (ps.connection.outletId && ps.id !== psu.id) owner.set(ps.connection.outletId, `${d.name} ${ps.label}`);
  return (
    <tr>
      <td className="whitespace-nowrap">{psu.label}</td>
      <td>
        <NumInput value={psu.ratedDcW} min={1} allowZero={false} width="w-20" onChange={(v) => onChange((p) => ((p.ratedDcW = v), (p.compatVerified = false)))} />
      </td>
      <td>
        <Select value={psu.state} onChange={(v) => onChange((p) => (p.state = v))} options={(['ok', 'standby', 'failed', 'removed'] as const).map((s) => ({ value: s, label: t(`psustate.${s}`) }))} />
      </td>
      <td>
        {psu.inputType === 'DC' ? (
          <Select
            value={psu.connection.dcBusId ?? ''}
            onChange={(v) => onChange((p) => (p.connection = { outletId: null, dcBusId: v || null }))}
            options={[{ value: '', label: t('psu.notConnected') }, ...project.dcBuses.map((b) => ({ value: b.id, label: `${b.name} (${b.voltage} V)` }))]}
          />
        ) : (
          <select
            aria-label={`${psu.label} ${t('psu.connection')}`}
            value={psu.connection.outletId ?? ''}
            onChange={(e) => onChange((p) => (p.connection = { outletId: e.target.value || null }))}
            className={!psu.connection.outletId ? 'border-red-700!' : ''}
          >
            <option value="">⊘ {t('psu.notConnected')}</option>
            {pdus.map((pdu) => (
              <optgroup key={pdu.id} label={`${pdu.name} (${pdu.feed})`}>
                {pdu.banks.flatMap((b) =>
                  b.outlets.map((o) => (
                    <option key={o.id} value={o.id} disabled={owner.has(o.id)}>
                      {pdu.feed} #{o.index} {o.type}
                      {owner.has(o.id) ? ` — ${owner.get(o.id)}` : ''}
                    </option>
                  )),
                )}
              </optgroup>
            ))}
          </select>
        )}
        {device.rackId && pdus.length === 0 && <div className="text-[10px] text-amber-300">{t('psu.noPdu')}</div>}
      </td>
      {advanced && (
        <td>
          <NumInput value={psu.measuredAcW ?? null} min={0} width="w-20" onChange={(v) => onChange((p) => (p.measuredAcW = v))} />
        </td>
      )}
    </tr>
  );
}
