import { useStore } from '../../state/store';
import { useAnalysis } from '../../state/useAnalysis';
import { useT } from '../../i18n';
import { RackElevation, FEED_COLOR } from './RackElevation';
import { addRack, deleteRack, moveDevice, resizeRack } from '../../state/actions';
import { Field, NumInput, Section, Select, TextInput } from '../ui/primitives';
import { fmtNum } from '../../engine/format';
import { useNotify } from '../useNotify';

const SIZES = [12, 18, 24, 42, 45, 48];

export function RackPane() {
  const { t } = useT();
  const notify = useNotify();
  const project = useStore((s) => s.project);
  const rackId = useStore((s) => s.selectedRackId);
  const view = useStore((s) => s.rackView);
  const showWiring = useStore((s) => s.showWiring);
  const selectedId = useStore((s) => s.selectedDeviceId);
  const scenarioId = useStore((s) => s.scenarioId);
  const setUi = useStore((s) => s.setUi);
  const update = useStore((s) => s.update);
  const analysis = useAnalysis();
  const rack = project.racks.find((r) => r.id === rackId) ?? project.racks[0];
  const pair = analysis.scenarios.find((s) => s.def.id === scenarioId) ?? analysis.scenarios[0];
  const devices = project.devices.filter((d) => d.rackId === rack.id);
  const pdus = project.pdus.filter((p) => p.rackId === rack.id);
  const outside = devices.filter((d) => d.placement.kind === 'outside' || d.placement.kind === 'unplaced' || d.placement.kind === 'zero_u');
  const upd = (fn: (r: typeof rack) => void) => update((d) => fn(d.racks.find((x) => x.id === rack.id)!));

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          ariaLabel={t('rack.select')}
          value={rack.id}
          onChange={(v) => setUi({ selectedRackId: v, selectedDeviceId: null })}
          options={project.racks.map((r) => ({ value: r.id, label: `${r.name} (${r.heightU}U)` }))}
        />
        <button className="btn btn-sm" onClick={() => addRack({ site: rack.site, nominalVoltage: rack.nominalVoltage })}>
          + {t('rack.add')}
        </button>
        <div role="group" aria-label={t('rack.view')} className="ml-auto inline-flex overflow-hidden rounded-md border border-slate-700">
          {(['front', 'rear'] as const).map((v) => (
            <button key={v} className={`px-2.5 py-1 text-xs ${view === v ? 'bg-cyan-800 text-white' : 'bg-slate-900 text-slate-300'}`} aria-pressed={view === v} onClick={() => setUi({ rackView: v })}>
              {t(`rack.${v}`)}
            </button>
          ))}
        </div>
        <label className="inline-flex items-center gap-1 text-xs text-slate-300">
          <input type="checkbox" checked={showWiring} onChange={(e) => setUi({ showWiring: e.target.checked })} disabled={view !== 'rear'} />
          {t('rack.wiring')}
        </label>
      </div>

      <div className="card mx-auto w-full max-w-[760px] overflow-hidden p-2">
        <RackElevation
          rack={rack}
          devices={devices}
          allDevices={project.devices}
          pdus={pdus}
          allPdus={project.pdus}
          result={pair.design}
          typical={pair.typical}
          view={view}
          showWiring={showWiring}
          selectedId={selectedId}
          onSelect={(id) => setUi({ selectedDeviceId: id, rightTab: 'device', mobileTab: 'settings' })}
          onMove={(id, u) => notify(moveDevice(id, u))}
        />
        <p className="mt-1 px-1 text-[10px] text-slate-500">{t('rack.schematicNote')}</p>
      </div>

      <Legend />

      {outside.length > 0 && (
        <Section title={`${t('rack.outsideTitle')} (${outside.length})`}>
          <ul className="space-y-1 text-sm">
            {outside.map((d) => (
              <li key={d.id}>
                <button className="flex w-full items-center justify-between rounded px-2 py-1 text-left hover:bg-slate-800" onClick={() => setUi({ selectedDeviceId: d.id, rightTab: 'device', mobileTab: 'settings' })}>
                  <span>
                    {d.name} <span className="text-xs text-slate-500">· {t(`placement.${d.placement.kind}`)}</span>
                  </span>
                  <span className="font-mono text-xs text-cyan-300">{pair.typical.devices[d.id]?.load.inputW === null ? '? W' : `${fmtNum(pair.typical.devices[d.id]?.load.inputW, 0)} W`}</span>
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[11px] text-slate-500">{t('rack.outsideNote')}</p>
        </Section>
      )}

      <Section title={t('rack.properties')} defaultOpen={false}>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('rack.name')}>
            <TextInput value={rack.name} onChange={(v) => upd((r) => (r.name = v || r.name))} />
          </Field>
          <Field label={t('rack.site')}>
            <TextInput value={rack.site} onChange={(v) => upd((r) => (r.site = v))} />
          </Field>
          <Field label={t('rack.size')} help={t('help.rackSize')}>
            <div className="flex flex-wrap items-center gap-1">
              <Select
                value={SIZES.includes(rack.heightU) ? String(rack.heightU) : 'custom'}
                onChange={(v) => v !== 'custom' && notify(resizeRack(rack.id, Number(v)))}
                options={[...SIZES.map((s) => ({ value: String(s), label: `${s}U` })), { value: 'custom', label: t('common.custom') }]}
              />
              <NumInput value={rack.heightU} allowUnknown={false} min={1} max={60} step={1} width="w-16" onChange={(v) => v !== null && notify(resizeRack(rack.id, v))} ariaLabel={t('rack.size')} />
            </div>
          </Field>
          <Field label={t('rack.feeds')}>
            <Select value={String(rack.feedCount)} onChange={(v) => upd((r) => (r.feedCount = Number(v) as 1 | 2))} options={[{ value: '1', label: t('rack.feed1') }, { value: '2', label: t('rack.feed2') }]} />
          </Field>
          <Field label={t('rack.voltage')} unit="V">
            <NumInput value={rack.nominalVoltage} allowUnknown={false} min={1} max={1000} onChange={(v) => v && upd((r) => (r.nominalVoltage = v))} />
          </Field>
          <Field label={t('rack.frequency')} unit="Hz">
            <NumInput value={rack.frequencyHz} allowUnknown={false} min={1} max={400} onChange={(v) => v && upd((r) => (r.frequencyHz = v))} />
          </Field>
          <Field label={t('rack.topology')}>
            <Select value={rack.topology} onChange={(v) => upd((r) => (r.topology = v))} options={(['1ph', '3ph_wye', '3ph_delta'] as const).map((x) => ({ value: x, label: t(`topo.${x}`) }))} />
          </Field>
          <Field label={t('rack.depth')} unit="mm">
            <NumInput value={rack.usableDepthMm} min={1} onChange={(v) => upd((r) => (r.usableDepthMm = v))} />
          </Field>
          <Field label={t('rack.weight')} unit="kg">
            <NumInput value={rack.ratedWeightKg} min={1} onChange={(v) => upd((r) => (r.ratedWeightKg = v))} />
          </Field>
          <Field label={t('rack.budget')} unit="W" help={t('help.budget')}>
            <NumInput value={rack.powerBudgetW} min={1} onChange={(v) => upd((r) => (r.powerBudgetW = v))} />
            <label className="mt-1 inline-flex items-center gap-1 text-[11px] text-slate-400">
              <input type="checkbox" checked={rack.powerBudgetConfirmed} onChange={(e) => upd((r) => (r.powerBudgetConfirmed = e.target.checked))} />
              {t('rack.budgetConfirmed')}
            </label>
          </Field>
          <Field label={t('rack.cooling')} unit="W">
            <NumInput value={rack.coolingCapacityW} min={1} onChange={(v) => upd((r) => (r.coolingCapacityW = v))} />
          </Field>
          <Field label={t('rack.liquidCooling')} unit="W">
            <NumInput value={rack.liquidCoolingCapacityW} min={1} onChange={(v) => upd((r) => (r.liquidCoolingCapacityW = v))} />
          </Field>
        </div>
        <InletReadings rackId={rack.id} />
        <div className="mt-3 flex justify-end">
          <button className="btn btn-danger btn-sm" disabled={project.racks.length <= 1} onClick={() => confirm(t('rack.confirmDelete', { name: rack.name })) && notify(deleteRack(rack.id))}>
            {t('rack.delete')}
          </button>
        </div>
      </Section>
    </div>
  );
}

function InletReadings({ rackId }: { rackId: string }) {
  const { t } = useT();
  const rack = useStore((s) => s.project.racks.find((r) => r.id === rackId)!);
  const update = useStore((s) => s.update);
  const upd = (fn: (r: typeof rack) => void) => update((d) => fn(d.racks.find((x) => x.id === rackId)!));
  return (
    <div className="mt-3">
      <div className="mb-1 flex items-center gap-2 text-xs font-medium text-slate-300">
        {t('rack.inlet')}
        <button
          className="btn btn-sm"
          onClick={() =>
            upd((r) =>
              r.inletReadings.push({ id: `in_${Date.now()}`, position: 'middle', tempC: 22, timestamp: new Date().toISOString().slice(0, 16) }),
            )
          }
        >
          + {t('common.add')}
        </button>
      </div>
      <p className="mb-1 text-[11px] text-slate-500">{t('help.inletTemp')}</p>
      {rack.inletReadings.map((rd, i) => (
        <div key={rd.id} className="mb-1 flex flex-wrap items-center gap-2 text-xs">
          <Select value={rd.position} onChange={(v) => upd((r) => (r.inletReadings[i].position = v))} options={(['top', 'middle', 'bottom'] as const).map((x) => ({ value: x, label: t(`inlet.${x}`) }))} />
          <NumInput value={rd.tempC} allowUnknown={false} min={-20} max={80} width="w-16" onChange={(v) => v !== null && upd((r) => (r.inletReadings[i].tempC = v))} ariaLabel="°C" />
          <span>°C</span>
          <input type="datetime-local" value={rd.timestamp.slice(0, 16)} onChange={(e) => upd((r) => (r.inletReadings[i].timestamp = e.target.value))} />
          <button className="btn btn-ghost btn-sm" aria-label={t('common.delete')} onClick={() => upd((r) => r.inletReadings.splice(i, 1))}>
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

function Legend() {
  const { t } = useT();
  return (
    <div className="card flex flex-wrap gap-x-4 gap-y-1 px-3 py-2 text-[11px] text-slate-300">
      <span className="font-semibold text-slate-400">{t('legend.title')}:</span>
      <span>
        <i className="mr-1 inline-block h-2 w-4 align-middle" style={{ background: FEED_COLOR.A }} />
        {t('legend.feedA')}
      </span>
      <span>
        <i className="mr-1 inline-block h-2 w-4 align-middle" style={{ background: FEED_COLOR.B }} />
        {t('legend.feedB')}
      </span>
      <span>
        <i className="mr-1 inline-block h-2 w-4 align-middle bg-red-500" />⊘ {t('legend.disconnected')}
      </span>
      <span>✕ {t('legend.bad')}</span>
      <span>⚠ {t('legend.warn')}</span>
      <span className="font-mono text-cyan-300">{t('legend.watts')}</span>
      <span className="font-mono text-amber-300">? W = {t('common.unknown')}</span>
    </div>
  );
}
