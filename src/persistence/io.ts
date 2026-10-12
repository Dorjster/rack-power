import type { Project } from '../domain/types';
import type { Finding } from '../audit/types';
import type { ScenarioPair } from '../engine/scenario';
import { EXPORT_FORMAT } from './validate';
import { loadBlob } from './db';
import { installedPsus, installedNameplateW } from '../engine/devicePower';

export function exportPayload(project: Project, blobs?: Record<string, { mime: string; data: string }>) {
  return {
    format: EXPORT_FORMAT,
    schemaVersion: project.schemaVersion,
    exportedAt: new Date().toISOString(),
    attachments: blobs
      ? 'Evidence images embedded as base64 (project bundle).'
      : 'Evidence metadata only — image/blob contents are NOT included in this JSON. Use "Export bundle" to include them.',
    project,
    ...(blobs ? { blobs } : {}),
  };
}

export function exportJson(project: Project): string {
  return JSON.stringify(exportPayload(project), null, 2);
}

async function blobToBase64(b: Blob): Promise<string> {
  const buf = new Uint8Array(await b.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}

export async function exportBundle(project: Project): Promise<string> {
  const blobs: Record<string, { mime: string; data: string }> = {};
  for (const ev of project.evidence) {
    if (!ev.blobKey) continue;
    const b = await loadBlob(ev.blobKey);
    if (b) blobs[ev.blobKey] = { mime: ev.mime, data: await blobToBase64(b) };
  }
  return JSON.stringify(exportPayload(project, blobs));
}

export function base64ToBlob(data: string, mime: string): Blob {
  const bin = atob(data);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

/** RFC 4180 CSV with UTF-8 BOM so Excel opens Mongolian Cyrillic correctly. */
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  const esc = (v: string | number | null | undefined) => {
    if (v === null || v === undefined) return '';
    let s = String(v);
    // Neutralise spreadsheet formula injection
    if (/^[=+\-@\t\r]/.test(s) && typeof v === 'string') s = `'${s}`;
    return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + rows.map((r) => r.map(esc).join(',')).join('\r\n');
}

export function equipmentCsv(project: Project, normal: ScenarioPair, t: (k: string, p?: Record<string, string | number>) => string): string {
  const header = [
    t('csv.rack'),
    t('csv.device'),
    t('csv.category'),
    t('csv.vendor'),
    t('csv.model'),
    t('csv.position'),
    t('csv.psus'),
    t('csv.nameplate'),
    t('csv.mode'),
    t('csv.typical'),
    t('csv.design'),
    t('csv.basis'),
    t('csv.connections'),
  ];
  const outletLabel = new Map<string, string>();
  for (const pdu of project.pdus) for (const b of pdu.banks) for (const o of b.outlets) outletLabel.set(o.id, `${pdu.name}#${o.index}`);
  const rows = project.devices.map((d) => {
    const rack = project.racks.find((r) => r.id === d.rackId);
    const pl = d.placement;
    const pos = pl.kind === 'rack' ? `U${pl.startU}–U${pl.startU + pl.heightU - 1}` : t(`placement.${pl.kind}`);
    const psus = installedPsus(d);
    return [
      rack?.name ?? '',
      d.name,
      t(`cat.${d.category}`),
      d.vendor,
      d.model,
      pos,
      psus.map((p) => `${p.label}:${p.ratedDcW ?? '?'}W`).join(' '),
      installedNameplateW(d),
      d.domains.map((x) => x.mode).join('/'),
      normal.typical.devices[d.id].load.inputW,
      normal.design.devices[d.id].load.inputW,
      t(`basis.${normal.typical.devices[d.id].load.basis}`),
      psus.map((p) => `${p.label}→${p.connection.outletId ? outletLabel.get(p.connection.outletId) ?? '?' : '—'}`).join(' '),
    ];
  });
  return toCsv([header, ...rows]);
}

export function findingsCsv(findings: Finding[], t: (k: string, p?: Record<string, string | number>) => string, tm: (m: { key: string; params: Record<string, string | number> }) => string): string {
  const header = [t('csv.rule'), t('csv.status'), t('csv.severity'), t('csv.type'), t('csv.affected'), t('csv.scenario'), t('csv.level'), t('csv.observed'), t('csv.threshold'), t('csv.finding'), t('csv.action'), t('csv.calc'), t('csv.evidence')];
  const rows = findings.map((f) => [
    f.ruleId,
    t(`status.${f.status}`),
    t(`sev.${f.severity}`),
    t(`ruletype.${f.ruleType}`),
    f.affected.label,
    f.scenarioLabel ? tm(f.scenarioLabel) : '',
    f.level ? t(`level.${f.level}`) : '',
    f.observed,
    f.threshold,
    tm(f.msg),
    f.rec ? tm(f.rec) : '',
    f.calc,
    t(`evidence.${f.evidence}`),
  ]);
  return toCsv([header, ...rows]);
}

export function download(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
