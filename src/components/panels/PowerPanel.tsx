import { useStore } from '../../state/store';
import { useAnalysis } from '../../state/useAnalysis';
import { useT } from '../../i18n';
import { Field, Help, NumInput, Section, Select, StatusBadge } from '../ui/primitives';
import { scenarioLabel } from '../../audit/rules';
import { fmtA, fmtBtu, fmtKw, fmtNum, fmtPct, fmtVa, fmtW } from '../../engine/format';
import { costFromKwh, energyKwh, wattsToBtuh, withGrowthReserve } from '../../engine/electrical';
import { installedNameplateW } from '../../engine/devicePower';
import { limitBadge } from './FeedsPanel';

export function PowerPanel() {
  const { t, tm } = useT();
  const project = useStore((s) => s.project);
  const rackId = useStore((s) => s.selectedRackId);
  const psuLossId = useStore((s) => s.psuLossId);
  const setUi = useStore((s) => s.setUi);
  const update = useStore((s) => s.update);
  const a = useAnalysis();
  const rack = project.racks.find((r) => r.id === rackId)!;
  const normal = a.scenarios[0];
  const rt = normal.typical.racks[rackId];
  const rd = normal.design.racks[rackId];
  const pdus = project.pdus.filter((p) => p.rackId === rackId);
  const devices = project.devices.filter((d) => d.rackId === rackId);
  const as = project.assumptions;
  const hoursMonth = as.hoursPerDay * as.daysPerMonth;
  const kwhMonth = energyKwh(rt.knownW, hoursMonth);
  const cost = costFromKwh(kwhMonth, as.tariffPerKwh);
  const reserve = project.policy.growthReserveFraction;
  const allPsus = project.devices.filter((d) => d.rackId === rackId).flatMap((d) => d.domains.flatMap((dom) => dom.psus.map((p) => ({ d, p }))));
  const upd = (fn: (x: typeof as) => void) => update((d) => fn(d.assumptions));

  return (
    <div>
      <Section title={t('pw.totals')}>
        <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
          <Stat label={t('pw.normalTypical')} value={fmtKw(rt.knownW)} sub={rt.unknownCount ? t('pw.knownSubtotal', { n: rt.unknownCount }) : t('pw.complete')} warn={rt.unknownCount > 0} />
          <Stat label={t('pw.normalDesign')} value={fmtKw(rd.knownW)} sub={rd.unknownCount ? t('pw.knownSubtotal', { n: rd.unknownCount }) : t('pw.complete')} warn={rd.unknownCount > 0} />
          <Stat label={t('pw.withReserve', { pct: fmtPct(reserve) })} value={fmtKw(withGrowthReserve(rd.knownW, reserve))} sub={t('pw.reserveOnce')} />
          <Stat label={t('pw.va')} value={fmtVa(rd.knownVa)} sub={t('pw.vaNote')} />
          <Stat label={t('pw.heat')} value={rd.airHeatW === null ? t('common.unknown') : fmtBtu(wattsToBtuh(rd.airHeatW))} sub={rd.airHeatW === null ? t('pw.liquidUnknown') : `${fmtW(rd.airHeatW)}${rd.poeOutsideW ? ` · −PoE ${fmtW(rd.poeOutsideW)}` : ''}${rd.liquidHeatW ? ` · ${t('pw.liquid')} ${fmtW(rd.liquidHeatW)}` : ''}`} />
          <Stat label={t('pw.outside')} value={fmtW(rt.outsideKnownW)} sub={rt.outsideUnknownCount ? t('pw.knownSubtotal', { n: rt.outsideUnknownCount }) : t('pw.outsideNote')} />
        </div>
        <p className="mt-2 text-[11px] text-slate-400">{t('pw.knownExplain')}</p>
      </Section>

      <Section title={t('pw.scenarioTable')}>
        <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
          <span>{t('pw.psuLoss')}:</span>
          <Select
            value={psuLossId ?? ''}
            onChange={(v) => setUi({ psuLossId: v || null, scenarioId: v ? `loss_psu_${v}` : 'normal' })}
            options={[{ value: '', label: '—' }, ...allPsus.map(({ d, p }) => ({ value: p.id, label: `${d.name} / ${p.label}` }))]}
          />
          <Help text={t('help.scenarios')} />
        </div>
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>{t('common.scenario')}</th>
                <th>PDU</th>
                <th>{t('power.typical')}</th>
                <th>{t('power.design')}</th>
                <th>{t('feeds.planning')}</th>
                <th>{t('feeds.hard')}</th>
                <th>{t('pw.headroom')}</th>
                <th>{t('rack.status')}</th>
              </tr>
            </thead>
            <tbody>
              {a.scenarios.map((s) =>
                pdus.map((p, i) => {
                  const ty = s.typical.pdus[p.id];
                  const de = s.design.pdus[p.id];
                  return (
                    <tr key={`${s.def.id}-${p.id}`} className={i === 0 ? 'border-t-2 border-slate-700' : ''}>
                      <td>{i === 0 ? tm(scenarioLabel(s.def, project)) : ''}</td>
                      <td className="whitespace-nowrap">
                        {p.name} ({p.feed})
                      </td>
                      {!de.powered ? (
                        <td colSpan={6} className="text-slate-500">
                          {t('pw.unpowered')}
                        </td>
                      ) : (
                        <>
                          <td className="font-mono whitespace-nowrap">
                            {fmtW(ty.w)} · {fmtA(ty.governingA)}
                            {ty.unknownCount ? ' +?' : ''}
                          </td>
                          <td className="font-mono whitespace-nowrap">
                            {fmtW(de.w)} · {fmtA(de.governingA)}
                            {de.unknownCount ? ' +?' : ''}
                          </td>
                          <td className="font-mono">{fmtA(de.limits.planningA)}</td>
                          <td className="font-mono">{fmtA(de.limits.hardA)}</td>
                          <td className="font-mono">{de.limits.planningA !== null && de.governingA !== null ? fmtA(de.limits.planningA - de.governingA) : '—'}</td>
                          <td>
                            <StatusBadge status={limitBadge(de.status)} small label={t(`lstatus.${de.status}`)} />
                          </td>
                        </>
                      )}
                    </tr>
                  );
                }),
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-slate-400">{t('pw.tableNote')}</p>
        <details className="mt-2 text-xs text-slate-300">
          <summary className="cursor-pointer text-cyan-300">{t('pw.formulas')}</summary>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 font-mono text-[11px]">
            <li>S = P / PF</li>
            <li>I (1φ) = P / (V × PF)</li>
            <li>I (3φ balanced) = P / (√3 × V_LL × PF)</li>
            <li>{t('pw.f.unbalanced')}</li>
            <li>P_AC = P_DC / η ; P_DC = P_AC × η</li>
            <li>kWh = kW_avg × h ; {t('pw.f.cost')}</li>
            <li>BTU/h = W × 3.412142</li>
            <li>{t('pw.f.reserve')}</li>
          </ul>
        </details>
      </Section>

      {project.upses.length > 0 && (
        <Section title={t('pw.ups')} defaultOpen={false}>
          <table className="tbl">
            <thead>
              <tr>
                <th>UPS</th>
                <th>{t('common.scenario')}</th>
                <th>kW</th>
                <th>kVA</th>
                <th>{t('rack.status')}</th>
              </tr>
            </thead>
            <tbody>
              {project.upses.map((u) =>
                a.scenarios
                  .filter((s) => s.design.upses[u.id].powered && s.design.upses[u.id].w > 0)
                  .map((s) => {
                    const r = s.design.upses[u.id];
                    return (
                      <tr key={u.id + s.def.id}>
                        <td>{u.name}</td>
                        <td>{tm(scenarioLabel(s.def, project))}</td>
                        <td className="font-mono">
                          {fmtNum(r.w / 1000, 2)} / {u.ratedKw ?? '?'} ({fmtPct(r.kwUtil)})
                        </td>
                        <td className="font-mono">
                          {fmtNum(r.va / 1000, 2)} / {u.ratedKva ?? '?'} ({fmtPct(r.kvaUtil)})
                        </td>
                        <td>{r.complete ? <StatusBadge status="pass" small label={t('pw.complete')} /> : <StatusBadge status="unknown" small label={t('up.contribOnly')} />}</td>
                      </tr>
                    );
                  }),
              )}
            </tbody>
          </table>
        </Section>
      )}

      <Section title={t('pw.inventory')} defaultOpen={false}>
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>{t('dev.name')}</th>
                <th>U</th>
                <th>PSU</th>
                <th>
                  {t('power.nameplate')} <Help text={t('help.nameplate')} />
                </th>
                <th>{t('power.typical')}</th>
                <th>{t('power.design')}</th>
                <th>{t('power.basis')}</th>
              </tr>
            </thead>
            <tbody>
              {devices.map((d) => {
                const l = normal.typical.devices[d.id].load;
                const ld = normal.design.devices[d.id].load;
                const psus = d.domains.flatMap((x) => x.psus);
                return (
                  <tr key={d.id} className="cursor-pointer hover:bg-slate-800/50" onClick={() => setUi({ selectedDeviceId: d.id, rightTab: 'device' })}>
                    <td>{d.name}</td>
                    <td className="whitespace-nowrap">{d.placement.kind === 'rack' ? `${d.placement.startU}–${d.placement.startU + d.placement.heightU - 1}` : t(`placement.${d.placement.kind}`)}</td>
                    <td className="whitespace-nowrap">{psus.length ? `${psus.length}×${psus[0].ratedDcW ?? '?'} W` : '—'}</td>
                    <td className="font-mono">{fmtW(installedNameplateW(d))}</td>
                    <td className={`font-mono ${l.inputW === null ? 'text-amber-300' : ''}`}>{l.inputW === null ? '?' : fmtW(l.inputW)}</td>
                    <td className={`font-mono ${ld.inputW === null ? 'text-amber-300' : ''}`}>{ld.inputW === null ? '?' : fmtW(ld.inputW)}</td>
                    <td>{t(`basis.${l.basis}`)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title={t('pw.energy')}>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('pw.hoursDay')} unit="h">
            <NumInput value={as.hoursPerDay} allowUnknown={false} min={0} max={24} onChange={(v) => v !== null && upd((x) => (x.hoursPerDay = v))} />
          </Field>
          <Field label={t('pw.daysMonth')}>
            <NumInput value={as.daysPerMonth} allowUnknown={false} min={0} max={31} onChange={(v) => v !== null && upd((x) => (x.daysPerMonth = v))} />
          </Field>
          <Field label={t('pw.tariff')} unit={`${as.currency}/kWh`} help={t('help.tariff')}>
            <NumInput value={as.tariffPerKwh} min={0} onChange={(v) => upd((x) => (x.tariffPerKwh = v))} />
          </Field>
          <Field label="PUE" help={t('help.pue')}>
            <NumInput value={as.pue} min={1} max={5} onChange={(v) => upd((x) => (x.pue = v))} />
          </Field>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          <Stat label={t('pw.avgKw')} value={fmtKw(rt.knownW)} sub={t('pw.typicalBasis')} warn={rt.unknownCount > 0} />
          <Stat label={t('pw.kwhMonth')} value={kwhMonth === null ? '—' : `${fmtNum(kwhMonth, 0)} kWh`} sub={`${as.hoursPerDay} h × ${as.daysPerMonth} d`} />
          <Stat label={t('pw.costMonth')} value={cost === null ? t('pw.noTariff') : `${fmtNum(cost, 0)} ${as.currency}`} sub={t('pw.itOnly')} />
          <Stat label={t('pw.facility')} value={as.pue && kwhMonth !== null ? `${fmtNum(kwhMonth * as.pue, 0)} kWh` : '—'} sub={as.pue && as.tariffPerKwh !== null && kwhMonth !== null ? `${fmtNum(kwhMonth * as.pue * as.tariffPerKwh, 0)} ${as.currency} · ${t('pw.pueNote')}` : t('pw.pueNote')} />
        </div>
      </Section>
      <p className="text-[11px] text-slate-500">
        {t('pw.rackNote', { rack: rack.name })}
      </p>
    </div>
  );
}

export function Stat({ label, value, sub, warn }: { label: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <div className="rounded-md border border-slate-800 bg-slate-900/60 p-2">
      <div className="text-[11px] text-slate-400">{label}</div>
      <div className={`font-mono text-base font-semibold ${warn ? 'text-amber-300' : 'text-slate-100'}`}>{value}</div>
      {sub && <div className="text-[10px] text-slate-500">{sub}</div>}
    </div>
  );
}
