import {
  EVENT_TYPE,
  EVENT_ENTITY_TYPE,
  EVENT_SEVERITY,
  EVENT_SEQUENCE_RANK,
  EVENT_LABEL,
} from "./eventTypes";
import { normalizeSeverity } from "./controlTower/types";

// Canonical Operational Event shape (Sprint 3.5):
//   { timestamp, type, entity: { type, id }, severity, metadata }
//
// Pure, derived-only -- no Firestore access, no persistence, no writes.
// Every event is synthesized on read by domain/timelineBuilder.js; this
// module only defines the shape and generic operations over a list of
// events. Nothing here knows how to build events from Jobs/Work Orders --
// that's timelineBuilder.js's job, kept separate so there's exactly one
// place event generation happens.

// Builds one canonical event. Throws on an unrecognized `type` --
// domain/timelineBuilder.js is the only producer, so an unknown type
// here means a real bug in that builder, not bad external input.
export function normalizeEvent({ timestamp, type, entityId, metadata = {} }) {
  if (!Object.values(EVENT_TYPE).includes(type)) {
    throw new Error(`Unknown event type: ${type}`);
  }

  return {
    timestamp,
    type,
    entity: { type: EVENT_ENTITY_TYPE[type], id: entityId },
    severity: normalizeSeverity(EVENT_SEVERITY[type]),
    metadata,
  };
}

// Newest first by default -- matches the Activity Timeline panel's
// primary consumption pattern. Ties are common (most timestamps are
// approximated from job.createdAt, see timelineBuilder.js) and are
// broken by EVENT_SEQUENCE_RANK so lifecycle order still displays
// correctly even when two events share an instant.
export function sortEvents(events, order = "desc") {
  const direction = order === "asc" ? 1 : -1;

  return [...events].sort((a, b) => {
    if (a.timestamp !== b.timestamp) {
      return direction * (a.timestamp - b.timestamp);
    }
    const rankA = EVENT_SEQUENCE_RANK[a.type] ?? 0;
    const rankB = EVENT_SEQUENCE_RANK[b.type] ?? 0;
    return direction * (rankA - rankB);
  });
}

// Groups events by an arbitrary key function -- e.g.
// groupEvents(events, (e) => e.entity.type) for the Activity Timeline's
// Job/Work Order/System filter, or groupEvents(events, (e) => e.entity.id)
// for one entity's own history.
export function groupEvents(events, keyFn) {
  const groups = {};
  events.forEach((event) => {
    const key = keyFn(event);
    if (!groups[key]) groups[key] = [];
    groups[key].push(event);
  });
  return groups;
}

// Short human-readable text for one event. Defined once here so every
// consumer (ActivityTimelinePanel, WorkOrderDetail's Operational History)
// describes an event identically instead of each formatting its own text.
export function describeEvent(event) {
  return EVENT_LABEL[event.type] ?? event.type;
}
