import { useEffect, useId, useRef, useState } from "react";

import { resolveTechnicianIdentity } from "../../domain/actorDisplayName.js";

// Dispatch North Star P1 · frame 1a — the technician selector.
//
// The artifact draws `TECHNICIANS   All technicians (4) ▾` to the right of the view switcher. It was
// omitted from the first build and the omission only became visible on the deployed board, where the
// sandbox's 24 lanes turned the day grid into a long scroll before the queue.
//
// ════════════════════ PRESENTATION ONLY, AND THAT IS LOAD-BEARING ════════════════════
//
// This narrows WHICH LANES ARE DRAWN. It does not:
//
//   * change what is scheduled, or to whom;
//   * change what the availability read asks for — the board still reads the whole roster, so a
//     hidden technician's capacity is still known and still correct the moment they are shown again;
//   * narrow the RECOMMENDATIONS — the engine keeps scoring every technician, because a ranking that
//     silently excluded people a dispatcher had filtered out of VIEW would be a filter quietly
//     changing advice;
//   * touch the Ready queue, which is about work rather than people.
//
// A filter that altered any of those would stop being a filter and start being a second, invisible
// scheduling policy.
//
// ════════════════════ THE ROSTER IS NOT RE-QUERIED ════════════════════
//
// `technicians` is the board's existing `useFirestoreCollection(TECHNICIANS_COLLECTION)` array,
// passed down. There is no second roster read here and there must not be: two reads is two answers to
// "who works here", and the one this control offers would eventually disagree with the one the lanes
// are drawn from.
export default function TechnicianFilter({ technicians, selectedIds, onChange }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const labelId = useId();

  // `null` means ALL — deliberately not "every id is selected". A roster that grows would silently
  // leave the new technician filtered OUT of a board whose owner believes they are seeing everyone.
  const showingAll = selectedIds === null;
  const shown = showingAll ? technicians.length : selectedIds.size;

  useEffect(() => {
    if (!open) return undefined;
    const onDocument = (e) => { if (!rootRef.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") { setOpen(false); rootRef.current?.querySelector("button")?.focus(); } };
    document.addEventListener("mousedown", onDocument);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDocument); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const toggle = (id) => {
    // Building the next set from the CURRENT roster when we are on "all" keeps the two states
    // convertible without ever persisting a list that could go stale.
    const next = new Set(showingAll ? technicians.map((t) => t.id) : selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    // Back to the honest "all" sentinel rather than a set that happens to hold everyone.
    onChange(next.size === technicians.length ? null : next);
  };

  return (
    <div className="ns-dispatch-techfilter" ref={rootRef}>
      <span className="ns-dispatch-techfilter__label" id={labelId}>Technicians</span>
      <button
        type="button"
        className="ns-dispatch-techfilter__trigger"
        aria-expanded={open}
        aria-haspopup="true"
        aria-labelledby={`${labelId} ${labelId}-value`}
        onClick={() => setOpen((v) => !v)}
      >
        <span id={`${labelId}-value`}>
          {showingAll ? `All technicians (${technicians.length})` : `${shown} of ${technicians.length} technicians`}
        </span>
        <span className="ns-dispatch-techfilter__caret" aria-hidden="true">▾</span>
      </button>

      {open ? (
        <div className="ns-dispatch-techfilter__menu" role="group" aria-labelledby={labelId}>
          <button
            type="button"
            className="ns-dispatch-techfilter__all"
            onClick={() => onChange(null)}
            disabled={showingAll}
          >
            Show all technicians
          </button>
          <ul className="ns-dispatch-techfilter__list">
            {technicians.map((tech) => {
              // The GOVERNED resolver, so a technician whose record carries no name reads as
              // "Unknown technician" here exactly as it does on the lane — never a document id, and
              // never hidden from the list because it could not be named.
              const identity = resolveTechnicianIdentity(tech.id, { technicians });
              const checked = showingAll || selectedIds.has(tech.id);
              return (
                <li key={tech.id}>
                  <label className="ns-dispatch-techfilter__option">
                    <input type="checkbox" checked={checked} onChange={() => toggle(tech.id)} />
                    <span>{identity.name}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The lanes to draw. `null` means every technician.
 *
 * Exported so the day, week and fortnight views narrow through ONE function rather than three
 * filters that could drift — the same reason the three views share one schedule.
 */
export function visibleTechnicians(technicians, selectedIds) {
  if (selectedIds === null) return technicians;
  return technicians.filter((t) => selectedIds.has(t.id));
}
