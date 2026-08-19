// Action Rail (Wave-0 composition primitive) — the one action row with an explicit hierarchy: exactly one
// dominant primary action, quiet secondary actions, and ghost/utility actions. Replaces the cross-used
// dispatcher-board toolbar class and the scattered inline `justifyContent` hacks. Callers pass rendered
// controls into slots; the rail owns alignment + hierarchy, not the buttons' behavior.
//
// Slot content is the Button primitive (src/shared/ui/primitives/Button.jsx): `variant="primary"`
// (dominant, once per rail), `variant="secondary"`/`fo-btn-secondary` (existing quiet), `variant="tertiary"`
// for ghost/utility actions, `variant="protected"` for a permission-gated action that should explain why
// it is unavailable rather than silently doing nothing.
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
