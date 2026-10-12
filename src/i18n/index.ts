import { useCallback } from 'react';
import type { Lang } from '../domain/types';
import type { Msg } from '../audit/types';
import { useStore } from '../state/store';
import { findingsEn, findingsMn } from './findings';
import { uiEn, uiMn } from './ui';

export const DICTS: Record<Lang, Record<string, string>> = {
  mn: { ...findingsMn, ...uiMn },
  en: { ...findingsEn, ...uiEn },
};

export function translate(lang: Lang, key: string, params: Record<string, string | number> = {}): string {
  const s = DICTS[lang][key] ?? DICTS.en[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => (params[k] !== undefined ? String(params[k]) : `{${k}}`));
}

export function useT() {
  const lang = useStore((s) => s.lang);
  const t = useCallback((key: string, params?: Record<string, string | number>) => translate(lang, key, params), [lang]);
  const tm = useCallback((m: Msg | null | undefined) => (m ? translate(lang, m.key, m.params) : ''), [lang]);
  return { t, tm, lang };
}
