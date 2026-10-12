import { useState } from 'react';
import type { DeviceInstance, ID } from '../../domain/types';
import { useStore } from '../../state/store';
import { useAnalysis } from '../../state/useAnalysis';
import { useT } from '../../i18n';
import { DeviceForm } from '../device/DeviceForm';
import { applyMapping, deleteDevice, duplicateDevice, moveToRack, proposeMapping, setPlacement } from '../../state/actions';
import { Empty, Field, NumInput, Section, Select, StatusBadge } from '../ui/primitives';
import { useNotify } from '../useNotify';
import { scenarioLabel } from '../../audit/rules';
import { fmtW } from '../../engine/format';
import { autoPlace, occupiedRanges } from '../../engine/placement';

export function DevicePanel() {
  const { t } = useT();
  const project = useStore((s) => s.project);
  const id = useStore((s) => s.selectedDeviceId);
  const update = useStore((s) => s.update);
  const d = project.devices.find((x) => x.id === id);
  if (!d) return <Empty>{t('dev.noneSelected')}</Empty>;
  const patch = (fn: (x: DeviceInstance) => void) =>
    update((p) => {
      const x = p.devices.find((y) => y.id === d.id);
      if (x) fn(x);
    });
  return (
    <div>
      <DeviceHeader d={d} />
      <PlacementEditor d={d} />
      {!d.power.passiveZero && !d.poweredByPoeSwitchId && <MappingHelper d={d} />}
      <DeviceForm device={d} onPatch={patch} mode="edit" />
      <ScenarioStates d={d} />
    </div>
  );
}

function DeviceHeader({ d }: { d: DeviceInstance }) {
  const { t } = useT();
  const notify = useNotify();
  const project = useStore((s) => s.project);
  const toast = useStore((s) => s.toast);
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <h3 className="min-w-0 flex-1 truncate text-base font-semibold">{d.name}</h3>
      <button className="btn btn-sm" onClick={() => notify(duplicateDevice(d.id), 'dev.duplicated')}>
        ⧉ {t('dev.duplicate')}
      </button>
      {project.racks.length > 1 && (
        <Select
          ariaLabel={t('dev.moveRack')}
          className="text-xs"
          value={d.rackId}
          onChange={(v) => notify(moveToRack(d.id, v), 'dev.moved')}
          options={project.racks.map((r) => ({ value: r.id, label: `→ ${r.name}` }))}
        />
      )}
      <button
        className="btn btn-danger btn-sm"
        onClick={() => {
          deleteDevice(d.id);
          toast(t('dev.deleted', { name: d.name }), 'info', true);
        }}
      >
        🗑 {t('common.delete')}
      </button>
    </div>
  );
}

function PlacementEditor({ d }: { d: DeviceInstance }) {
  const { t } = useT();
  const notify = useNotify();
  const project = useStore((s) => s.project);
  const shelves = project.devices.filter((x) => x.rackId === d.rackId && x.passiveKind === 'shelf' && x.placement.kind === 'rack');
  const pl = d.placement;
  const kinds: DeviceInstance['placement']['kind'][] = ['rack', 'zero_u', 'outside', 'unplaced', ...(d.category === 'tower_server' || shelves.length ? (['shelf'] as const) : [])];
  const [h, setH] = useState<number | null>(pl.kind === 'rack' ? pl.heightU : 1);
  const change = (kind: DeviceInstance['placement']['kind']) => {
    if (kind === 'rack') {
      const height = pl.kind === 'rack' ? pl.heightU : h ?? 1;
      // first free fit, bottom-up
      const rack = project.racks.find((r) => r.id === d.rackId)!;
      const r = autoPlace(rack, occupiedRanges(rack.id, project.devices.filter((x) => x.id !== d.id), project.pdus), height, 1);
      if (!r.ok) notify({ ok: false, error: 'err.noSpace', params: { requested: 1, placed: 0, missing: 1, h: height, largest: r.largestFree } });
      else notify(setPlacement(d.id, { kind: 'rack', startU: r.startUs[0], heightU: height }));
    } else if (kind === 'shelf') {
      if (!shelves.length) return notify({ ok: false, error: 'err.noShelf' });
      notify(setPlacement(d.id, { kind: 'shelf', shelfId: shelves[0].id, confirmedHeightU: null, confirmedDepthMm: null, confirmedWeightKg: null }));
    } else if (kind === 'zero_u') notify(setPlacement(d.id, { kind: 'zero_u', side: 'left' }));
    else notify(setPlacement(d.id, { kind } as DeviceInstance['placement']));
  };
  return (
    <Section title={t('dev.placement')}>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('dev.placementKind')} help={t('help.placementKind')}>
          <Select value={pl.kind} onChange={change} options={kinds.map((k) => ({ value: k, label: t(`placement.${k}`) }))} />
        </Field>
        {pl.kind === 'rack' && (
          <>
            <Field label={t('lib.startU')}>
              <NumInput value={pl.startU} allowUnknown={false} min={1} step={1} width="w-16" onChange={(v) => v !== null && notify(setPlacement(d.id, { ...pl, startU: v }))} />
            </Field>
            <Field label={t('lib.heightU')} unit="U">
              <NumInput
                value={pl.heightU}
                allowUnknown={false}
                min={1}
                max={60}
                step={1}
                width="w-16"
                onChange={(v) => {
                  if (v === null) return;
                  setH(v);
                  notify(setPlacement(d.id, { ...pl, heightU: v }));
                }}
              />
            </Field>
            <p className="col-span-2 text-[11px] text-slate-500">{t('dev.dragHint')}</p>
          </>
        )}
        {pl.kind === 'shelf' && (
          <>
            <Field label={t('dev.shelf')}>
              <Select value={pl.shelfId} onChange={(v) => notify(setPlacement(d.id, { ...pl, shelfId: v }))} options={shelves.map((s) => ({ value: s.id, label: `${s.name} (U${s.placement.kind === 'rack' ? s.placement.startU : '?'})` }))} />
            </Field>
            <Field label={t('dev.confirmedHeight')} unit="U" help={t('help.shelf')}>
              <NumInput value={pl.confirmedHeightU} min={1} step={1} width="w-16" onChange={(v) => notify(setPlacement(d.id, { ...pl, confirmedHeightU: v }))} />
            </Field>
            <Field label={t('dev.confirmedDepth')} unit="mm">
              <NumInput value={pl.confirmedDepthMm} min={1} onChange={(v) => notify(setPlacement(d.id, { ...pl, confirmedDepthMm: v }))} />
            </Field>
            <Field label={t('dev.confirmedWeight')} unit="kg">
              <NumInput value={pl.confirmedWeightKg} min={0.1} onChange={(v) => notify(setPlacement(d.id, { ...pl, confirmedWeightKg: v }))} />
            </Field>
          </>
        )}
        {pl.kind === 'outside' && <p className="col-span-2 text-[11px] text-slate-400">{t('rack.outsideNote')}</p>}
        {pl.kind === 'zero_u' && <p className="col-span-2 text-[11px] text-slate-400">{t('dev.zeroUNote')}</p>}
      </div>
    </Section>
  );
}

function MappingHelper({ d }: { d: DeviceInstance }) {
  const { t } = useT();
  const notify = useNotify();
  const project = useStore((s) => s.project);
  const [proposal, setProposal] = useState<{ psuId: ID; feed: string; outletId: ID | null }[] | null>(null);
  const psus = d.domains.flatMap((x) => x.psus);
  const disconnected = psus.filter((p) => p.state !== 'removed' && !p.connection.outletId && !p.connection.dcBusId).length;
  const outletLabel = (oid: ID | null) => {
    if (!oid) return `⊘ ${t('map.noSocket')}`;
    for (const pdu of project.pdus) for (const b of pdu.banks) for (const o of b.outlets) if (o.id === oid) return `${pdu.name} #${o.index} ${o.type}`;
    return '?';
  };
  return (
    <div className="card mb-3 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">{t('map.title')}</span>
        {disconnected > 0 ? <StatusBadge status="unknown" label={t('map.disconnected', { n: disconnected })} /> : <StatusBadge status="pass" label={t('map.allConnected')} />}
        <button className="btn btn-sm ml-auto" onClick={() => setProposal(proposeMapping(project, d))}>
          {t('map.propose')}
        </button>
      </div>
      {proposal && (
        <div className="mt-2 text-xs">
          <ul className="mb-2 space-y-1">
            {proposal.map((m) => (
              <li key={m.psuId}>
                {psus.find((p) => p.id === m.psuId)?.label} → <b>{m.feed}</b>: {outletLabel(m.outletId)}
              </li>
            ))}
          </ul>
          <p className="mb-2 text-[11px] text-slate-400">{t('map.confirmNote')}</p>
          <div className="flex gap-2">
            <button
              className="btn btn-primary btn-sm"
              onClick={() => {
                if (notify(applyMapping(d.id, proposal), 'map.applied')) setProposal(null);
              }}
            >
              {t('map.apply')}
            </button>
            <button className="btn btn-sm" onClick={() => setProposal(null)}>
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ScenarioStates({ d }: { d: DeviceInstance }) {
  const { t, tm } = useT();
  const project = useStore((s) => s.project);
  const a = useAnalysis();
  if (d.power.passiveZero) return null;
  return (
    <Section title={t('dev.scenarios')} defaultOpen={false}>
      <table className="tbl">
        <thead>
          <tr>
            <th>{t('common.scenario')}</th>
            <th>{t('power.typical')}</th>
            <th>{t('power.design')}</th>
            <th>{t('rack.status')}</th>
          </tr>
        </thead>
        <tbody>
          {a.scenarios.map((s) => {
            const st = s.design.devices[d.id]?.status ?? 'ok';
            const badge = ['unpowered', 'partially_unpowered', 'shutdown_risk', 'over_capacity'].includes(st) ? 'fail' : ['possible_throttling', 'degraded'].includes(st) ? 'warning' : st === 'unknown_behavior' || st === 'not_connected' ? 'unknown' : 'pass';
            return (
              <tr key={s.def.id}>
                <td>{tm(scenarioLabel(s.def, project))}</td>
                <td className="font-mono">{s.typical.devices[d.id]?.drawnW === null ? '?' : fmtW(s.typical.devices[d.id]?.drawnW)}</td>
                <td className="font-mono">{s.design.devices[d.id]?.drawnW === null ? '?' : fmtW(s.design.devices[d.id]?.drawnW)}</td>
                <td>
                  <StatusBadge status={badge} label={t(`dstatus.${st}`)} small />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Section>
  );
}
