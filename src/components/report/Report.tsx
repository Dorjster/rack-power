import type { ReactNode } from 'react';
import { useStore } from '../../state/store';
import { useAnalysis } from '../../state/useAnalysis';
import { useT } from '../../i18n';
import { RackElevation } from '../rack/RackElevation';
import { scenarioLabel } from '../../audit/rules';
import { fmtA, fmtBtu, fmtKw, fmtNum, fmtPct, fmtW } from '../../engine/format';
import { installedNameplateW } from '../../engine/devicePower';
import { wattsToBtuh } from '../../engine/electrical';
import { CHECKLIST_KEYS } from '../../audit/checklist';
import { CATALOG_ACCESS_NOTE, CATALOG_VERSION } from '../../catalog/devices';
import { BUILTIN_PDU_TEMPLATES } from '../../catalog/pdus';
import type { CheckStatus } from '../../domain/types';

const ST: Record<CheckStatus, string> = { pass: '✓ ', warning: '! ', fail: '✕ ', unknown: '? ', na: '– ' };

export function Report() {
  const { t, tm, lang } = useT();
  const project = useStore((s) => s.project);
  const rackId = useStore((s) => s.selectedRackId);
  const scenarioId = useStore((s) => s.scenarioId);
  const setUi = useStore((s) => s.setUi);
  const a = useAnalysis();
  const rack = project.racks.find((r) => r.id === rackId)!;
  const ra = a.byRack[rackId];
  const normal = a.scenarios[0];
  const sel = a.scenarios.find((s) => s.def.id === scenarioId) ?? normal;
  const devices = project.devices.filter((d) => d.rackId === rackId);
  const pdus = project.pdus.filter((p) => p.rackId === rackId);
  const rt = normal.typical.racks[rackId];
  const rd = normal.design.racks[rackId];
  const issues = ra.findings.filter((f) => f.status === 'fail' || f.status === 'warning' || f.status === 'unknown');
  const sevRank = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  const statusRank = { fail: 0, warning: 1, unknown: 2, pass: 3, na: 4 };
  issues.sort((x, y) => statusRank[x.status] - statusRank[y.status] || sevRank[x.severity] - sevRank[y.severity]);
  const top = issues.filter((f) => f.severity === 'critical' || f.severity === 'high').slice(0, 8);
  const outletLabel = new Map<string, string>();
  for (const p of project.pdus) for (const b of p.banks) for (const o of b.outlets) outletLabel.set(o.id, `${p.name}#${o.index}`);
  const measured = devices.filter((d) => normal.typical.devices[d.id].load.basis === 'measured');
  const estimated = devices.filter((d) => !d.power.passiveZero && !['measured', 'unknown', 'passive', 'poe_endpoint'].includes(normal.typical.devices[d.id].load.basis));
  const unknown = devices.filter((d) => !d.power.passiveZero && !d.poweredByPoeSwitchId && normal.typical.devices[d.id].load.inputW === null);
  const v = ra.conclusion.verdict;

  return (
    <div className="report-screen fixed inset-0 z-50 overflow-auto bg-slate-200 print:static print:overflow-visible print:bg-white">
      <div className="no-print sticky top-0 z-10 flex items-center gap-2 border-b border-slate-300 bg-white px-4 py-2 text-slate-900">
        <b className="text-sm">{t('report.preview')}</b>
        <span className="text-xs text-slate-500">{t('report.printHint')}</span>
        <button className="btn btn-primary ml-auto" onClick={() => window.print()}>
          🖨 {t('report.print')}
        </button>
        <button className="btn" onClick={() => setUi({ showReport: false })}>
          ✕ {t('common.close')}
        </button>
      </div>
      <article className="report-doc mx-auto my-4 max-w-[210mm] bg-white p-[12mm] text-[10.5pt] leading-snug text-black shadow-lg print:my-0 print:max-w-none print:p-0 print:shadow-none" lang={lang}>
        {/* Cover */}
        <section className="report-page">
          <div className="border-b-2 border-black pb-2">
            <div className="text-[9pt] tracking-widest text-gray-600 uppercase">Rack Power Planner & Audit</div>
            <h1 className="text-[20pt] font-bold">{t('report.title')}</h1>
          </div>
          <table className="rtbl mt-3">
            <tbody>
              <Row k={t('header.project')} v={project.name} />
              <Row k={t('header.customer')} v={project.customer || project.audit.customer || '—'} />
              <Row k={t('header.site')} v={rack.site || project.site || '—'} />
              <Row k={t('report.rack')} v={`${rack.name} (${rack.heightU}U)`} />
              <Row k={t('audit.date')} v={project.audit.date || new Date().toISOString().slice(0, 10)} />
              <Row k={t('audit.auditor')} v={project.audit.auditor || '—'} />
              <Row k={t('header.mode')} v={t(`mode2.${project.mode}`)} />
              <Row k={t('common.scenario')} v={tm(scenarioLabel(sel.def, project))} />
              <Row k={t('report.policy')} v={`${project.policy.name} v${project.policy.version}`} />
            </tbody>
          </table>
          {project.isDemo && <p className="mt-2 border border-black p-1 text-[9pt]">{t('header.demoBanner')}</p>}
          <h2 className="rh2">{t('report.conclusion')}</h2>
          <div className="border-2 border-black p-2">
            <div className="text-[13pt] font-bold">
              {v === 'ok' ? '✓' : v === 'insufficient' ? '?' : v === 'overloaded' ? '✕' : '!'} {t(`verdict.${v}`)}
            </div>
            <div className="text-[9pt]">{t(`verdict.${v}.sub`)}</div>
            {ra.conclusion.alsoIncomplete && <div className="mt-1 text-[9pt]">? {t('verdict.alsoIncomplete', { n: ra.conclusion.essentialUnknowns.length })}</div>}
          </div>
          <h2 className="rh2">{t('report.coverage')}</h2>
          <p className="text-[9.5pt]">
            {t('cov.measured')}: {ra.coverage.devices.measured} · {t('cov.estimated')}: {ra.coverage.devices.estimated + ra.coverage.devices.manufacturer} · {t('cov.component')}: {ra.coverage.devices.component} · {t('cov.proxy')}: {ra.coverage.devices.proxy} · {t('cov.unknown')}: {ra.coverage.devices.unknown} · {t('cov.passive')}: {ra.coverage.devices.passive}
            <br />
            {t('report.checks')}: {(['pass', 'warning', 'fail', 'unknown', 'na'] as const).map((s) => `${ST[s]}${t(`status.${s}`)} ${ra.coverage.checks[s]}`).join(' · ')}
          </p>
          <p className="text-[8.5pt] text-gray-600">{t('cov.note')}</p>
          <h2 className="rh2">{t('report.topFindings')}</h2>
          {top.length === 0 ? (
            <p>{t('report.noHigh')}</p>
          ) : (
            <ol className="list-decimal pl-5 text-[9.5pt]">
              {top.map((f) => (
                <li key={f.key}>
                  <b>
                    {ST[f.status]}
                    {f.affected.label}
                  </b>
                  {f.scenarioLabel && ` [${tm(f.scenarioLabel)}${f.level ? `, ${t(`level.${f.level}`)}` : ''}]`}: {tm(f.msg)}
                </li>
              ))}
            </ol>
          )}
          <div className="mt-3 grid grid-cols-3 gap-2 text-[9.5pt]">
            <Box k={t('pw.normalTypical')} v={`${fmtKw(rt.knownW)}${rt.unknownCount ? ` + ${rt.unknownCount}?` : ''}`} />
            <Box k={t('pw.normalDesign')} v={`${fmtKw(rd.knownW)}${rd.unknownCount ? ` + ${rd.unknownCount}?` : ''}`} />
            <Box k={t('pw.heat')} v={rd.airHeatW === null ? t('common.unknown') : fmtBtu(wattsToBtuh(rd.airHeatW))} />
          </div>
        </section>

        {/* Elevation + inventory */}
        <section className="report-page">
          <h2 className="rh2">{t('report.elevation')}</h2>
          <div className="grid grid-cols-2 gap-2" style={{ printColorAdjust: 'exact', WebkitPrintColorAdjust: 'exact' }}>
            {(['front', 'rear'] as const).map((view) => (
              <RackElevation key={view} rack={rack} devices={devices} allDevices={project.devices} pdus={pdus} allPdus={project.pdus} result={sel.design} typical={sel.typical} view={view} showWiring selectedId={null} onSelect={() => {}} onMove={() => {}} />
            ))}
          </div>
          <p className="text-[8pt] text-gray-600">{t('rack.schematicNote')}</p>
        </section>
        <section className="report-page">
          <h2 className="rh2">{t('report.inventory')}</h2>
          <table className="rtbl">
            <thead>
              <tr>
                <th>{t('dev.name')}</th>
                <th>U</th>
                <th>PSU</th>
                <th>{t('power.nameplate')}</th>
                <th>{t('power.typical')}</th>
                <th>{t('power.design')}</th>
                <th>{t('power.basis')}</th>
                <th>{t('psu.connection')}</th>
              </tr>
            </thead>
            <tbody>
              {devices.map((d) => {
                const psus = d.domains.flatMap((x) => x.psus);
                const l = normal.typical.devices[d.id].load;
                const ld = normal.design.devices[d.id].load;
                return (
                  <tr key={d.id}>
                    <td>
                      {d.name}
                      <div className="text-[7.5pt] text-gray-600">
                        {d.vendor} {d.model}
                      </div>
                    </td>
                    <td className="whitespace-nowrap">{d.placement.kind === 'rack' ? `${d.placement.startU}–${d.placement.startU + d.placement.heightU - 1}` : t(`placement.${d.placement.kind}`)}</td>
                    <td>{psus.length ? `${psus.length}× ${psus.map((p) => p.ratedDcW ?? '?').join('/')} W, ${d.domains.map((x) => t(`mode.${x.mode}`)).join('; ')}` : '—'}</td>
                    <td>{fmtW(installedNameplateW(d))}</td>
                    <td>{l.inputW === null ? '?' : fmtW(l.inputW)}</td>
                    <td>{ld.inputW === null ? '?' : fmtW(ld.inputW)}</td>
                    <td>{t(`basis.${l.basis}`)}</td>
                    <td className="text-[8pt]">{psus.map((p) => `${p.label}→${p.connection.outletId ? outletLabel.get(p.connection.outletId) ?? '?' : '⊘'}`).join(', ')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-1 text-[8pt] text-gray-600">{t('help.psuVsLoad')}</p>

          <h2 className="rh2">{t('report.subtotals')}</h2>
          <table className="rtbl">
            <tbody>
              <Row k={t('report.measuredDevices')} v={`${measured.length}: ${fmtW(measured.reduce((s, d) => s + (normal.typical.devices[d.id].load.inputW ?? 0), 0))}`} />
              <Row k={t('report.estimatedDevices')} v={`${estimated.length}: ${fmtW(estimated.reduce((s, d) => s + (normal.typical.devices[d.id].load.inputW ?? 0), 0))}`} />
              <Row k={t('report.unknownDevices')} v={unknown.length ? unknown.map((d) => d.name).join(', ') : '0'} />
              <Row k={t('pw.normalTypical')} v={`${fmtW(rt.knownW)} ${rt.unknownCount ? `(${t('pw.knownSubtotal', { n: rt.unknownCount })})` : ''}`} />
              <Row k={t('pw.normalDesign')} v={`${fmtW(rd.knownW)} ${rd.unknownCount ? `(${t('pw.knownSubtotal', { n: rd.unknownCount })})` : ''}`} />
              <Row k={t('pw.outside')} v={fmtW(rt.outsideKnownW)} />
            </tbody>
          </table>
        </section>

        {/* Scenario table */}
        <section className="report-page">
          <h2 className="rh2">{t('report.scenarios')}</h2>
          <table className="rtbl">
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
                    <tr key={s.def.id + p.id}>
                      <td>{i === 0 ? tm(scenarioLabel(s.def, project)) : ''}</td>
                      <td>{p.name}</td>
                      {de.powered ? (
                        <>
                          <td>
                            {fmtW(ty.w)} / {fmtA(ty.governingA)}
                            {ty.unknownCount ? ' +?' : ''}
                          </td>
                          <td>
                            {fmtW(de.w)} / {fmtA(de.governingA)}
                            {de.unknownCount ? ' +?' : ''}
                          </td>
                          <td>{fmtA(de.limits.planningA)}</td>
                          <td>{fmtA(de.limits.hardA)}</td>
                          <td>{de.limits.planningA !== null && de.governingA !== null ? fmtA(de.limits.planningA - de.governingA) : '—'}</td>
                          <td>{t(`lstatus.${de.status}`)}</td>
                        </>
                      ) : (
                        <td colSpan={6}>{t('pw.unpowered')}</td>
                      )}
                    </tr>
                  );
                }),
              )}
            </tbody>
          </table>
          {project.upses.length > 0 && (
            <>
              <h3 className="rh3">{t('pw.ups')}</h3>
              <table className="rtbl">
                <tbody>
                  {project.upses.map((u) => {
                    const r = normal.design.upses[u.id];
                    return <Row key={u.id} k={u.name} v={`${fmtNum(r.w / 1000, 2)} kW / ${u.ratedKw ?? '?'} kW (${fmtPct(r.kwUtil)}), ${fmtNum(r.va / 1000, 2)} kVA / ${u.ratedKva ?? '?'} kVA — ${r.complete ? t('pw.complete') : t('f.UPS.contribution_only')}`} />;
                  })}
                </tbody>
              </table>
            </>
          )}
        </section>

        {/* Findings */}
        <section className="report-page">
          <h2 className="rh2">{t('report.findings')}</h2>
          <table className="rtbl">
            <thead>
              <tr>
                <th>{t('csv.status')}</th>
                <th>{t('csv.rule')}</th>
                <th>{t('csv.finding')}</th>
                <th>{t('csv.observed')}</th>
                <th>{t('csv.action')}</th>
              </tr>
            </thead>
            <tbody>
              {issues.map((f) => (
                <tr key={f.key} className="report-avoid-break">
                  <td className="whitespace-nowrap">
                    {ST[f.status]}
                    {t(`status.${f.status}`)}
                    <div className="text-[7pt] text-gray-600">{t(`sev.${f.severity}`)}</div>
                  </td>
                  <td className="text-[8pt]">
                    {f.ruleId}
                    <div className="text-[7pt] text-gray-600">{t(`ruletype.${f.ruleType}`)}</div>
                  </td>
                  <td>
                    <b>{f.affected.label}</b>
                    {f.scenarioLabel && ` [${tm(f.scenarioLabel)}${f.level ? `, ${t(`level.${f.level}`)}` : ''}]`}: {tm(f.msg)}
                    {f.calc && <div className="font-mono text-[7.5pt] text-gray-700">{f.calc}</div>}
                    {ackNote(project, f.key) && <div className="text-[7.5pt]">{t('audit.acked')}: {ackNote(project, f.key)}</div>}
                  </td>
                  <td className="text-[8pt]">
                    {f.observed}
                    {f.threshold && <div className="text-gray-600">≤ {f.threshold}</div>}
                  </td>
                  <td className="text-[8pt]">{f.rec ? tm(f.rec) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h2 className="rh2">{t('audit.checklist')}</h2>
          <table className="rtbl">
            <thead>
              <tr>
                <th>{t('report.item')}</th>
                <th>{t('csv.status')}</th>
                <th>{t('audit.comment')}</th>
                <th>{t('audit.action')}</th>
                <th>{t('report.evidence')}</th>
              </tr>
            </thead>
            <tbody>
              {CHECKLIST_KEYS.map((k) => {
                const m = project.manualChecks.find((x) => x.rackId === rackId && x.key === k);
                return (
                  <tr key={k}>
                    <td>{t(`chk.${k}`)}</td>
                    <td>
                      {ST[m?.status ?? 'unknown']}
                      {t(`status.${m?.status ?? 'unknown'}`)}
                    </td>
                    <td>{m?.comment}</td>
                    <td>
                      {m?.action} {m?.responsible && `(${m.responsible}${m.dueDate ? `, ${m.dueDate}` : ''})`}
                    </td>
                    <td className="text-[8pt]">{(m?.evidenceIds ?? []).map((id) => project.evidence.find((e) => e.id === id)?.name).filter(Boolean).join(', ')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        {/* Appendix */}
        <section>
          <h2 className="rh2">{t('report.appendix')}</h2>
          <h3 className="rh3">{t('report.assumptions')}</h3>
          <ul className="list-disc pl-5 text-[9pt]">
            <li>
              PF {project.assumptions.defaultPf} ({project.assumptions.pfConfirmed ? t('report.confirmed') : t('report.unconfirmed')}); η {project.assumptions.defaultEfficiency}; PoE η {project.assumptions.poeEfficiency}
            </li>
            <li>{t('report.sharing')}</li>
            <li>
              {t('pw.hoursDay')}: {project.assumptions.hoursPerDay}; {t('pw.daysMonth')}: {project.assumptions.daysPerMonth}; {t('pw.tariff')}: {project.assumptions.tariffPerKwh ?? t('pw.noTariff')} {project.assumptions.currency}/kWh; PUE: {project.assumptions.pue ?? '—'}
            </li>
            <li>
              {t('policy.alert')}: {fmtPct(project.policy.alertFraction)}; {t('policy.derate')}: {project.policy.applyPlanningDerate ? fmtPct(project.policy.planningDerateFraction) : t('report.notApplied')}; {t('policy.reserve')}: {fmtPct(project.policy.growthReserveFraction)}; {t('policy.imbalance')}: {fmtPct(project.policy.phaseImbalanceFraction)} ({project.policy.phaseImbalanceDefinition}); {t('policy.stale')}: {project.policy.staleDays}
            </li>
            <li>
              {t('policy.inletRec')}: {project.policy.inletRecommendedMinC}–{project.policy.inletRecommendedMaxC} °C ({project.policy.inletEnvelopeVerified ? t('report.confirmed') : t('report.unconfirmed')})
            </li>
            {Object.entries(project.policy.overrides)
              .filter(([, o]) => o.disabled)
              .map(([id, o]) => (
                <li key={id}>
                  {t('report.disabledRule')}: {id} — {o.note || '—'}
                </li>
              ))}
          </ul>
          <h3 className="rh3">{t('report.formulas')}</h3>
          <ul className="list-disc pl-5 font-mono text-[8.5pt]">
            <li>S = P / PF; I(1φ) = P / (V × PF); I(3φ bal.) = P / (√3 × V_LL × PF)</li>
            <li>{t('pw.f.unbalanced')}</li>
            <li>P_AC = P_DC / η; P_DC = P_AC × η</li>
            <li>kWh = kW_avg × h; BTU/h = W × 3.412142</li>
          </ul>
          <h3 className="rh3">{t('report.sources')}</h3>
          <ul className="list-disc pl-5 text-[8.5pt]">
            <li>
              {t('report.catalog')} {CATALOG_VERSION}: {CATALOG_ACCESS_NOTE}
            </li>
            {BUILTIN_PDU_TEMPLATES.filter((x) => !x.generic).map((x) => (
              <li key={x.id}>
                {x.vendor} {x.model}: {x.nominalA.source?.url} ({t('prov.unverified')})
              </li>
            ))}
            <li>Dell — Full redundancy vs fault-tolerant redundancy for PowerEdge PSUs: https://infohub.delltechnologies.com/en-au/p/full-redundancy-vs-fault-tolerant-redundancy-for-poweredge-server-psus/</li>
            <li>Dell — PowerEdge power settings: https://www.dell.com/support/kbdoc/en-us/000202926/poweredge-power-settings</li>
            <li>ASHRAE Handbook — Data Centers and Telecommunication Facilities: https://handbook.ashrae.org/Handbooks/A23/SI/A23_Ch20/a23_ch20_si.aspx</li>
            <li>APC/Schneider FA156189 (UL489 continuous-load guidance, not generalized): https://www.apc.com/us/en/faqs/FA156189/</li>
          </ul>
          <p className="text-[8pt] text-gray-600">{t('report.refNote')}</p>
          <h3 className="rh3">{t('report.exclusions')}</h3>
          <p className="text-[9pt]">{t('report.exclusionsText')}</p>
          <p className="mt-2 text-[8pt] text-gray-600">
            {t('report.units')} · {t('report.generated')}: {new Date().toLocaleString()} · schema v{project.schemaVersion}
          </p>
        </section>
      </article>
    </div>
  );
}

function ackNote(project: ReturnType<typeof useStore.getState>['project'], key: string) {
  return project.acks.find((a) => a.findingKey === key)?.note;
}

function Row({ k, v }: { k: string; v: ReactNode }) {
  return (
    <tr>
      <th className="w-1/3">{k}</th>
      <td>{v}</td>
    </tr>
  );
}

function Box({ k, v }: { k: string; v: string }) {
  return (
    <div className="border border-black p-1.5">
      <div className="text-[8pt] text-gray-600">{k}</div>
      <div className="font-mono text-[11pt] font-bold">{v}</div>
    </div>
  );
}
