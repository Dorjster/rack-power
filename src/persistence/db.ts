/** Local persistence in IndexedDB (idb-keyval). Nothing is uploaded. */
import { createStore, del, get, set, keys } from 'idb-keyval';
import type { Project } from '../domain/types';
import { validateProject } from './validate';

const store = typeof indexedDB !== 'undefined' ? createStore('rack-power-planner', 'kv') : undefined;

const PROJECT_KEY = (id: string) => `project:${id}`;
const BLOB_KEY = (id: string) => `blob:${id}`;
const LAST_KEY = 'meta:lastProjectId';

export interface ProjectIndexEntry {
  id: string;
  name: string;
  updatedAt: string;
}

export async function saveProject(p: Project): Promise<void> {
  if (!store) return;
  await set(PROJECT_KEY(p.id), JSON.parse(JSON.stringify(p)), store);
  await set(LAST_KEY, p.id, store);
}

export async function loadProject(id: string): Promise<Project | null> {
  if (!store) return null;
  const raw = await get(PROJECT_KEY(id), store);
  if (!raw) return null;
  const res = validateProject(raw);
  return res.ok ? res.project! : null;
}

export async function loadLastProject(): Promise<Project | null> {
  if (!store) return null;
  const id = await get<string>(LAST_KEY, store);
  return id ? loadProject(id) : null;
}

export async function listProjects(): Promise<ProjectIndexEntry[]> {
  if (!store) return [];
  const all = (await keys(store)).filter((k): k is string => typeof k === 'string' && k.startsWith('project:'));
  const out: ProjectIndexEntry[] = [];
  for (const k of all) {
    const p = await get<Project>(k, store);
    if (p) out.push({ id: p.id, name: p.name, updatedAt: p.updatedAt });
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function deleteProject(id: string): Promise<void> {
  if (!store) return;
  await del(PROJECT_KEY(id), store);
}

export async function saveBlob(id: string, blob: Blob): Promise<void> {
  if (!store) return;
  await set(BLOB_KEY(id), blob, store);
}

export async function loadBlob(id: string): Promise<Blob | null> {
  if (!store) return null;
  return (await get<Blob>(BLOB_KEY(id), store)) ?? null;
}

export async function deleteBlob(id: string): Promise<void> {
  if (!store) return;
  await del(BLOB_KEY(id), store);
}
