// SHARED TYPEAHEAD (UI corrections package, 2026-10-08, item E / H).
//
// The one suggestion engine behind every autocomplete: it starts after MIN_CHARS characters, waits DEBOUNCE_MS after the
// last keystroke, and PREVENTS STALE RESPONSES -- every request carries a sequence number and an AbortSignal, and only the
// latest request's answer is ever shown, so a slow answer to "jo" can never overwrite the answer to "john".
//
// It decides nothing about authority: `search(query, { signal, limit })` is an EOS API read and the SERVER applies the
// caller's capabilities, operating-company reach and scope. A refusal is a state ("denied"), never an empty list.
import { useCallback, useEffect, useRef, useState } from "react";

export const TYPEAHEAD_MIN_CHARS = 2;
export const TYPEAHEAD_DEBOUNCE_MS = 250;
export const TYPEAHEAD_LIMIT = 8;

export const TYPEAHEAD_STATE = Object.freeze({
  IDLE: "idle", // fewer than MIN_CHARS characters
  PENDING: "pending", // debouncing or in flight
  READY: "ready",
  DENIED: "denied",
  FAILED: "failed",
});

/**
 * @param {object} o
 * @param {(query: string, ctx: { signal: AbortSignal, limit: number }) => Promise<{ ok: boolean, items?: any[], total?: number|null, code?: string, message?: string }>} o.search
 */
export function useTypeahead({ search, minChars = TYPEAHEAD_MIN_CHARS, debounceMs = TYPEAHEAD_DEBOUNCE_MS, limit = TYPEAHEAD_LIMIT } = {}) {
  const [query, setQuery] = useState("");
  const [state, setState] = useState({ status: TYPEAHEAD_STATE.IDLE, items: [], total: null, message: null, forQuery: "" });
  const seq = useRef(0);
  const controller = useRef(null);
  const searchRef = useRef(search);
  searchRef.current = search;

  useEffect(() => {
    const q = query.trim();
    seq.current += 1;
    const mine = seq.current;
    controller.current?.abort();
    controller.current = null;
    if (q.length < minChars) {
      setState({ status: TYPEAHEAD_STATE.IDLE, items: [], total: null, message: null, forQuery: q });
      return undefined;
    }
    setState((s) => ({ ...s, status: TYPEAHEAD_STATE.PENDING }));
    const timer = setTimeout(async () => {
      const ac = typeof AbortController === "function" ? new AbortController() : null;
      controller.current = ac;
      let res;
      try {
        res = await searchRef.current(q, { signal: ac?.signal, limit });
      } catch (error) {
        res = { ok: false, code: error?.name === "AbortError" ? "ABORTED" : "FAILED", message: error?.message };
      }
      if (mine !== seq.current) return; // STALE: a newer keystroke owns the list
      if (!res?.ok) {
        if (res?.code === "ABORTED") return;
        setState({ status: res?.code === "FORBIDDEN" || res?.code === "DENIED" ? TYPEAHEAD_STATE.DENIED : TYPEAHEAD_STATE.FAILED,
          items: [], total: null, message: res?.message ?? null, forQuery: q });
        return;
      }
      setState({ status: TYPEAHEAD_STATE.READY, items: (res.items ?? []).slice(0, limit), total: res.total ?? null, message: null, forQuery: q });
    }, debounceMs);
    return () => clearTimeout(timer);
  }, [query, minChars, debounceMs, limit]);

  useEffect(() => () => controller.current?.abort(), []);

  const clear = useCallback(() => setQuery(""), []);
  return { query, setQuery, clear, ...state };
}

/**
 * The same debounce for a picker that filters a list the server ALREADY returned (no request per keystroke):
 * `value` settles DEBOUNCE_MS after the last change, and is "" until it reaches MIN_CHARS.
 */
export function useSettledQuery(value, { minChars = TYPEAHEAD_MIN_CHARS, debounceMs = TYPEAHEAD_DEBOUNCE_MS } = {}) {
  const [settled, setSettled] = useState("");
  useEffect(() => {
    const q = String(value ?? "").trim();
    if (q.length < minChars) { setSettled(""); return undefined; }
    const t = setTimeout(() => setSettled(q), debounceMs);
    return () => clearTimeout(t);
  }, [value, minChars, debounceMs]);
  return settled;
}
