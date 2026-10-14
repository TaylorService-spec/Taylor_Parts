# Scheduler & Dispatch visual direction

**Direction: Operational canvas.** The Service workspace uses a calm dark-teal operational header, compact status signals, and a schedule-first flow. Information is grouped by the decision it supports: technician capacity first, then the ready-to-dispatch queue and recommendation detail.

This slice preserves the canonical status legend and the existing Work Order transition service. Existing records expose `scheduledStart`/`scheduledEnd`, but do not expose estimated duration or a non-work-time model; the UI therefore does not manufacture either concept. Those require a separately governed product/data decision.
