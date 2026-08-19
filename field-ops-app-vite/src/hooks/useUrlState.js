import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";

// URL-ADDRESSABLE VIEW STATE.
//
// The Owner's requirement: "back and forward should be on all pages."
//
// Page-to-page navigation already works -- the authenticated app is inside
// BrowserRouter. What did not work is view state held in React state: an open
// record, a wizard step, a tab, a filter. Back cannot undo what was never put
// in history, none of it survives a refresh, and none of it can be sent to a
// colleague. This hook is the shared way to put that state where it belongs.
//
// NOT EVERYTHING BELONGS HERE, and that judgement matters more than the
// mechanism. Keep in local state:
//   - confirm dialogs and destructive-action gates. A Back press that silently
//     dismisses a confirmation someone is halfway through is worse than a Back
//     press that does nothing.
//   - in-flight submit flags, validation errors, unsaved drafts.
//   - idempotency keys held per mount. Putting one in the URL would let a stale
//     link replay a create.
//   - re-fetch nonces and refresh counters. They are not view state.
//
// `replace` exists for values that change on every keystroke: a search box
// pushing one history entry per character makes Back useless, which is the
// opposite of the point.

/**
 * Read and write a single query parameter as view state.
 *
 * @param {string} key             parameter name as it appears in the URL
 * @param {string|null} defaultValue value treated as "absent" -- never written
 * @param {{replace?: boolean}} options `replace: true` to avoid a history entry
 * @returns {[string|null, (next: string|null) => void]}
 */
export function useUrlState(key, defaultValue = null, { replace = false } = {}) {
  const [params, setParams] = useSearchParams();
  const value = params.get(key) ?? defaultValue;

  const setValue = useCallback(
    (next) => {
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          // The default is represented by ABSENCE, so a URL never carries a
          // parameter that says nothing. This keeps shared links clean and makes
          // "is anything filtered?" a simple emptiness check.
          if (next === null || next === undefined || next === "" || next === defaultValue) {
            p.delete(key);
          } else {
            p.set(key, String(next));
          }
          return p;
        },
        { replace },
      );
    },
    [key, defaultValue, replace, setParams],
  );

  return [value, setValue];
}

/**
 * Same contract for a numeric value (wizard steps, page numbers).
 * Falls back to `defaultValue` when the parameter is absent or not a number,
 * so a hand-edited or truncated URL degrades to the default rather than
 * rendering a broken step.
 */
export function useUrlNumber(key, defaultValue = 1, options) {
  const [raw, setRaw] = useUrlState(key, null, options);
  const parsed = Number.parseInt(raw ?? "", 10);
  const value = Number.isFinite(parsed) ? parsed : defaultValue;
  const setValue = useCallback(
    (next) => setRaw(next === defaultValue ? null : String(next)),
    [defaultValue, setRaw],
  );
  return [value, setValue];
}
