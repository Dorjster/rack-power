import { useCallback } from 'react';
import { useStore } from '../state/store';
import { useT } from '../i18n';
import type { ActionResult } from '../state/actions';

/** Show an error toast for a failed action; returns whether it succeeded. */
export function useNotify() {
  const { t } = useT();
  const toast = useStore((s) => s.toast);
  return useCallback(
    (r: ActionResult, successKey?: string) => {
      if (!r.ok) {
        toast(t(r.error, r.params), 'error');
        return false;
      }
      if (successKey) toast(t(successKey), 'success');
      return true;
    },
    [t, toast],
  );
}
