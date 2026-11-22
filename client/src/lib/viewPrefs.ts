import { trpc } from "@/lib/trpc";
import { mergeViewPref } from "@shared/viewPrefs";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const SAVE_DELAY_MS = 600;

/**
 * View state for a screen (filters, sort, layout), stored on the server per user so it
 * follows them across devices.
 *
 *   const [view, setView, { ready }] = useViewPref("jobs.list", "", DEFAULTS);
 *
 * `defaults` must be a stable reference (a module-level constant). Stored values are laid
 * over it key by key, so a pref saved by an older build can never break the screen.
 * Changes apply instantly and are written after a short pause. If the server cannot be
 * reached the screen simply runs on its defaults.
 */
export function useViewPref<T extends Record<string, unknown>>(scope: string, scopeId: string | number, defaults: T) {
  const sid = String(scopeId ?? "");
  const address = useMemo(() => ({ scope, scopeId: sid }), [scope, sid]);
  const utils = trpc.useUtils();
  const q = trpc.prefs.get.useQuery(address, { staleTime: 5 * 60_000, retry: false, refetchOnWindowFocus: false });
  const save = trpc.prefs.set.useMutation();
  const clear = trpc.prefs.reset.useMutation();

  // Local edits win over the server copy until the next address change.
  const [local, setLocal] = useState<{ key: string; value: T } | null>(null);
  const key = `${scope}\u0000${sid}`;
  const stored = useMemo(() => mergeViewPref(defaults, q.data?.value), [defaults, q.data]);
  const value = local && local.key === key ? local.value : stored;

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<{ address: typeof address; value: T } | null>(null);
  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const p = pending.current;
    pending.current = null;
    if (!p) return;
    utils.prefs.get.setData(p.address, { value: p.value });
    save.mutate({ ...p.address, value: p.value });
    // `save` and `utils` are stable for the life of the component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Write any unsaved change when the screen goes away or switches to another record.
  useEffect(() => flush, [flush, key]);

  const set = useCallback(
    (patch: Partial<T> | ((prev: T) => Partial<T>)) => {
      setLocal(prev => {
        const base = prev && prev.key === key ? prev.value : stored;
        const next = { ...base, ...(typeof patch === "function" ? patch(base) : patch) };
        pending.current = { address, value: next };
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(flush, SAVE_DELAY_MS);
        return { key, value: next };
      });
    },
    [address, flush, key, stored]
  );

  const reset = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    pending.current = null;
    setLocal(null);
    utils.prefs.get.setData(address, { value: null });
    clear.mutate(address);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);

  /** False only while the first read is in flight; true once loaded or failed. */
  const ready = !q.isLoading;
  return [value, set, { ready, reset }] as const;
}
