// Action Rail (Wave-0 composition primitive) — the one action row with an explicit hierarchy: exactly one
// dominant primary action, quiet secondary actions, and ghost/utility actions. Replaces the cross-used
// dispatcher-board toolbar class and the scattered inline `justifyContent` hacks. Callers pass rendered
// controls into slots; the rail owns alignment + hierarchy, not the buttons' behavior.
//
// Use the shared button variant classes for weight: `fo-btn-primary` (dominant, once per rail),
// `fo-btn-secondary` (existing quiet), `fo-linkbtn`/ghost for utility.
export default function ActionRail({ primary = null, secondary = null, start = null, className = "" }) {
  return (
    <div className={`fo-action-rail ${className}`.trim()}>
      {start ? <div className="fo-action-rail__start">{start}</div> : null}
      <div className="fo-action-rail__end">
        {secondary}
        {primary}
      </div>
    </div>
  );
}
