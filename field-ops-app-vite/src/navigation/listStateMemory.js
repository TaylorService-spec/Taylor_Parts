// THE LIST A PERSON WAS ACTUALLY LOOKING AT.
//
// ============================ WHY THIS EXISTS AT ALL ============================
//
// The list keeps its filters and sort in the URL, which is right: shareable, bookmarkable, and
// restored by a plain navigation. But a DETAIL page cannot read the list's URL — by the time it
// renders, that URL is gone.
//
// So the list records its own search string as it changes, and "Back to Work Orders" reads it. The
// result is that returning from a record lands on the list somebody had, not a reset one.
//
// ============================ WHY NOT BROWSER HISTORY ============================
//
// History would restore the previous URL only when the record was opened FROM the list. Opened from
// Dispatch, from a dashboard tile, or from a pasted link, "back" would mean four different things
// from one control. An explicit "Back to Work Orders" must always mean Work Orders — and land on the
// most recent one the person actually used, if there was one.
//
// ============================ SESSION, NOT LOCAL ============================
//
// sessionStorage on purpose: a working list is a working-session fact. Restoring last Tuesday's
// filters on Monday morning would be a surprise, not a convenience.

const KEY_PREFIX = "eos.listState";

const store = () => {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    // Private modes and locked-down browsers throw on access. A remembered list is a convenience,
    // never a requirement -- losing it must not take a screen down.
    return null;
  }
};

/** Record the list state for an object. Called by the list as its URL changes. */
export function rememberListState(objectKey, search) {
  const s = store();
  if (!s || !objectKey) return;
  try {
    const value = typeof search === "string" ? search.replace(/^\?/, "") : "";
    if (value) s.setItem(`${KEY_PREFIX}.${objectKey}`, value);
    else s.removeItem(`${KEY_PREFIX}.${objectKey}`);
  } catch { /* full or unavailable -- the list simply will not be remembered */ }
}

/** The saved list state, or "" when there is none. Never throws. */
export function savedListState(objectKey) {
  const s = store();
  if (!s || !objectKey) return "";
  try {
    return s.getItem(`${KEY_PREFIX}.${objectKey}`) ?? "";
  } catch {
    return "";
  }
}

export function forgetListState(objectKey) {
  const s = store();
  if (!s || !objectKey) return;
  try { s.removeItem(`${KEY_PREFIX}.${objectKey}`); } catch { /* nothing to do */ }
}
