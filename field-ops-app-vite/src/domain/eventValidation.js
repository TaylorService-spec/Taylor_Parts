import { EVENT_TYPE, ENTITY_TYPE, EVENT_SEQUENCE_RANK } from "./eventTypes";

// Sprint 3.5.5: read-only structural validation for a derived Operational
// Timeline (domain/timelineBuilder.js's output). No Firestore access, no
// writes, no mutation -- detection only, mirroring
// domain/workOrderValidation.js's role for Work Orders. Intended to catch
// bugs in the event model/timeline builder themselves (a well-formed
// timeline should never actually trip these), not to police external
// data.

function isKnownEventType(type) {
  return Object.values(EVENT_TYPE).includes(type);
}

function isKnownEntityType(type) {
  return Object.values(ENTITY_TYPE).includes(type);
}

function hasValidTimestamp(event) {
  return typeof event.timestamp === "number" && Number.isFinite(event.timestamp);
}

function hasValidEntity(event) {
  return (
    event.entity &&
    typeof event.entity.id !== "undefined" &&
    event.entity.id !== null &&
    isKnownEntityType(event.entity.type)
  );
}

function entityKey(event) {
  return `${event.entity?.type ?? "?"}:${event.entity?.id ?? "?"}`;
}

// Checks a full events array (as produced by timelineBuilder.buildTimeline())
// for structural anomalies. Returns { errors: string[], warnings: string[] }.
export function validateEvents(events) {
  const errors = [];
  const warnings = [];

  events.forEach((event, index) => {
    if (!isKnownEventType(event.type)) {
      errors.push(`Event at index ${index} has an unknown type: ${JSON.stringify(event.type)}`);
      return;
    }
    if (!hasValidTimestamp(event)) {
      errors.push(`Event at index ${index} (${event.type}) has a missing/invalid timestamp`);
    }
    if (!hasValidEntity(event)) {
      errors.push(`Event at index ${index} (${event.type}) has an invalid entity reference`);
    }
  });

  // Group only the structurally valid events for the ordering/duplicate
  // checks below -- an event that already failed a check above can't be
  // meaningfully compared for ordering.
  const validEvents = events.filter(
    (e) => isKnownEventType(e.type) && hasValidTimestamp(e) && hasValidEntity(e)
  );

  const byEntity = {};
  validEvents.forEach((event) => {
    const key = entityKey(event);
    if (!byEntity[key]) byEntity[key] = [];
    byEntity[key].push(event);
  });

  Object.entries(byEntity).forEach(([key, entityEvents]) => {
    // Duplicate events: the same milestone type appearing more than once
    // for one entity (a well-formed timeline emits each milestone at
    // most once per entity -- see timelineBuilder.js).
    const seenTypes = new Set();
    entityEvents.forEach((event) => {
      if (seenTypes.has(event.type)) {
        errors.push(`Duplicate ${event.type} event for entity ${key}`);
      }
      seenTypes.add(event.type);
    });

    // Impossible ordering: a later lifecycle milestone (higher
    // EVENT_SEQUENCE_RANK) timestamped strictly *before* an earlier one
    // for the same entity. Approximated timestamps commonly tie (see
    // timelineBuilder.js) -- a tie is fine; only a genuine inversion is
    // flagged.
    const sortedByRank = [...entityEvents].sort(
      (a, b) => (EVENT_SEQUENCE_RANK[a.type] ?? 0) - (EVENT_SEQUENCE_RANK[b.type] ?? 0)
    );
    for (let i = 1; i < sortedByRank.length; i++) {
      const prev = sortedByRank[i - 1];
      const curr = sortedByRank[i];
      if (curr.timestamp < prev.timestamp) {
        errors.push(
          `Impossible ordering for entity ${key}: ${curr.type} (${curr.timestamp}) occurs before ${prev.type} (${prev.timestamp})`
        );
      }
    }
  });

  if (events.length > 500) {
    warnings.push(`Timeline has ${events.length} events, unusually large for one render`);
  }

  return { errors, warnings };
}
