// Compact, read-only stage-progression indicator for LIST/queue rows.
//
// Sibling of LifecycleChevrons, not a replacement for it. That component is the DETAIL control: full
// stage labels plus the one clickable "Advance to X" action. This one is for a table row, where four
// text labels per row would out-shout the customer name and value the queue exists to be scanned for.
// It renders the same domain projection (domain/opportunityLifecycle.js's stageProgress) as a short
// run of segments -- filled for reached stages, hollow for future ones.
//
// Business-rule-free, exactly like LifecycleChevrons: it is handed steps and a terminal badge and
// knows nothing about Opportunity, stage names, or transition legality.
//
// ACCESSIBILITY: the segments are decorative (aria-hidden) because a screen reader user must not have
// to count bars. The real information is one text label -- "Qualified, stage 2 of 4" or "Won" -- which
// is exactly what the visual conveys, so the two channels stay in step.
export default function StageProgressTrack({ steps, terminal = null }) {
  const list = steps ?? [];
  if (list.length === 0) return null;

  const reached = list.filter((s) => s.status === "complete" || s.status === "current").length;
  const current = list.find((s) => s.status === "current") ?? null;

  // A terminal outcome (Won/Lost) is the whole story -- naming a stage as well would imply the
  // Opportunity is still moving through the pipeline when it has already closed.
  const summary = terminal
    ? terminal.label
    : current
      ? `${current.label}, stage ${reached} of ${list.length}`
      : `Not started, 0 of ${list.length}`;

  return (
    <span className={`fo-stagetrack${terminal ? ` fo-stagetrack--${terminal.tone}` : ""}`}>
      <span className="fo-stagetrack__bars" aria-hidden="true">
        {list.map((s) => (
          <span key={s.key} className={`fo-stagetrack__bar is-${s.status}`} />
        ))}
      </span>
      <span className="fo-stagetrack__summary">{summary}</span>
    </span>
  );
}
