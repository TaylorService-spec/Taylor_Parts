// A BUSINESS OBJECT IS A SET OF FIELDS, NOT A SENTENCE.
//
// ============================ THE THING THIS EXISTS TO STOP ============================
//
//     Taylor C161 · S/N CW-C161-0001 · AVAILABLE · wh-main
//
// That line contains five separate business attributes and exposes none of them. Nothing can filter
// by status, sort by location, report on quantity, or read it aloud in a sensible order, because by
// the time it reaches the screen it is one opaque string. The join that would have turned `wh-main`
// into "Main Warehouse" was never asked for, so a raw id is showing to a human as a primary label.
//
// The rule, and it holds all the way down:
//
//     STORAGE -> PROJECTION -> READ MODEL -> UI -> FILTER -> SORT -> REPORT -> ANALYTICS
//
// A responsive layout may rearrange fields, stack them, or hide low-priority ones on a narrow
// screen. It must never CONCATENATE them, because that is the one transformation that cannot be
// undone by the next consumer.
//
// ============================ STATUS IS A FIELD, NOT A COLOUR ============================
//
// `IN_TRANSIT` is a domain value and stays exactly that underneath. What a person reads is
// "In Transit". Both exist at once: the raw value for filtering, sorting and reporting; the label
// for the human. Colour may reinforce a status and may never be its only representation — a
// greyscale screenshot in a support ticket has to be readable, and so does a phone in sunlight.
//
// PURE. No JSX, no I/O. The renderer is separate on purpose: the same field list drives a phone
// card, a desktop table row and, later, a report column.

/** How a value should be read, so a renderer never has to guess from the value's shape. */
export const FIELD_KIND = Object.freeze({
  TEXT: "TEXT",
  IDENTIFIER: "IDENTIFIER",
  QUANTITY: "QUANTITY",
  STATUS: "STATUS",
  LOCATION: "LOCATION",
  DATE: "DATE",
  /** A value the platform genuinely does not have. NOT zero, NOT blank. */
  UNKNOWN: "UNKNOWN",
});

/**
 * What to show when a value is absent, and WHY it is absent.
 *
 * Three different absences that must never collapse into one blank cell: nobody recorded it, we are
 * not allowed to see it, and a join did not resolve. A technician acts differently on each.
 */
export const ABSENCE = Object.freeze({
  NOT_RECORDED: "Not recorded",
  NOT_AUTHORIZED: "Not available to you",
  UNRESOLVED: "Unavailable",
});

const isBlank = (v) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");

/**
 * One field.
 *
 * @param label     what a person calls it. "Serial Number", never "serialNo".
 * @param value     the display value, already resolved.
 * @param raw       the domain value, preserved for filtering, sorting and reporting.
 * @param kind      FIELD_KIND.
 * @param absence   which ABSENCE applies when value is blank.
 * @param priority  1 = always shown, 2 = shown when there is room, 3 = detail only. A narrow screen
 *                  DROPS low-priority fields; it never merges them into another field's text.
 */
export function field({ label, value, raw = undefined, kind = FIELD_KIND.TEXT, absence = ABSENCE.NOT_RECORDED, priority = 1 } = {}) {
  const present = !isBlank(value);
  return Object.freeze({
    label,
    value: present ? value : absence,
    raw: raw === undefined ? (present ? value : null) : raw,
    kind: present ? kind : FIELD_KIND.UNKNOWN,
    present,
    priority,
  });
}

/**
 * A domain enum, made readable without losing itself.
 *
 * `IN_TRANSIT` -> "In Transit". The raw value travels alongside, so a filter still compares against
 * the enum and a report still groups by it. Deriving the label rather than keeping a hand-written
 * map means a new status never renders as a blank or as a raw token — it renders as its own words
 * the day it is added, and somebody can improve the wording later without a screen having lied in
 * the meantime.
 */
export function statusLabel(raw) {
  if (isBlank(raw)) return null;
  return String(raw)
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

/** A status field. Always its own field, never folded into a description. */
export function statusField(raw, { label = "Status", priority = 1 } = {}) {
  return field({
    label, value: statusLabel(raw), raw: raw ?? null,
    kind: FIELD_KIND.STATUS, absence: ABSENCE.NOT_RECORDED, priority,
  });
}

/**
 * A location field, resolved through the canonical display authority by the CALLER.
 *
 * `resolved` being null is a real answer and renders as "Unavailable" — never as the raw id. A
 * warehouse id shown to a person is a defect, not a fallback: it is unreadable, unsearchable by the
 * name they know, and it teaches people to memorise internal keys.
 */
export function locationField(resolved, { label = "Location", priority = 1 } = {}) {
  return field({
    label, value: resolved, raw: resolved ?? null,
    kind: FIELD_KIND.LOCATION, absence: ABSENCE.UNRESOLVED, priority,
  });
}

/**
 * A quantity. ZERO IS A VALUE and must render as 0.
 *
 * The bug this prevents is old and common: a falsy check treats 0 as absent, so "0 on hand" renders
 * as "Not recorded", and an empty shelf becomes indistinguishable from one nobody has looked at.
 */
export function quantityField(n, { label = "Quantity", priority = 1, unknown = false } = {}) {
  if (unknown) {
    return field({ label, value: null, raw: null, kind: FIELD_KIND.QUANTITY, absence: ABSENCE.NOT_AUTHORIZED, priority });
  }
  const numeric = typeof n === "number" && Number.isFinite(n);
  return field({
    label, value: numeric ? String(n) : null, raw: numeric ? n : null,
    kind: FIELD_KIND.QUANTITY, absence: ABSENCE.NOT_RECORDED, priority,
  });
}

/** Drop everything below a priority. DROPS fields; never merges them. */
export function fieldsForWidth(fields, maxPriority = 3) {
  return Object.freeze((fields ?? []).filter((f) => f.priority <= maxPriority));
}

/**
 * A whole-unit serialized machine, as fields.
 *
 * The worked example from the brief, and the shape every other object here follows. Six attributes,
 * six fields — `wholeUnitAssetDisplay` previously produced a single line and this is its correction.
 */
export function serializedUnitFields(unit = {}, { locationName = null } = {}) {
  return Object.freeze([
    field({ label: "Equipment", value: unit.productName ?? unit.equipmentModelId ?? null, kind: FIELD_KIND.TEXT, priority: 1 }),
    field({ label: "Serial Number", value: unit.serialNo ?? null, kind: FIELD_KIND.IDENTIFIER, priority: 1 }),
    // A serialized unit is ALWAYS one. Stated rather than assumed, because the moment a screen shows
    // a quantity next to a serial somebody will try to receive four of them.
    quantityField(1, { label: "Quantity", priority: 2 }),
    statusField(unit.inventoryState ?? unit.status ?? null),
    locationField(locationName, { priority: 1 }),
    field({ label: "Description", value: unit.description ?? "Whole Unit Equipment", kind: FIELD_KIND.TEXT, priority: 3 }),
  ]);
}

/**
 * An available serialized unit, as fields.
 *
 * This replaces a line that read
 *
 *     Taylor C161 — S/N CW-C161-0001 · AVAILABLE · wh-main (unresolved id)
 *
 * Five attributes in one string, and a raw location id presented to a person twice over: once as a
 * place, and once with a parenthetical admitting it was not one. An id that will not resolve is an
 * ABSENCE — "Location unavailable" — because showing the key teaches people to memorise internal
 * identifiers and gives them nothing they can search by.
 */
export function availableUnitFields(row = {}) {
  return Object.freeze([
    field({ label: "Equipment", value: row.title ?? null, kind: FIELD_KIND.TEXT, priority: 1 }),
    field({ label: "Serial Number", value: row.serialNo ?? null, kind: FIELD_KIND.IDENTIFIER, priority: 1 }),
    // A serialized unit is ALWAYS one. Stated rather than implied.
    quantityField(1, { label: "Quantity", priority: 2 }),
    statusField(row.lifecycleState ?? null, { priority: 1 }),
    // Resolved only. `locationResolved === false` means the projection could not map it, and that is
    // an absence, never the raw key.
    locationField(row.locationResolved === false ? null : (row.location ?? null), { priority: 1 }),
    field({ label: "Description", value: row.category ?? null, kind: FIELD_KIND.TEXT, priority: 3 }),
  ]);
}

/** A part, as the handheld needs it. Master-data editing is a different authority and surface. */
export function partFields(part = {}, { availableQty = null, availabilityUnknown = false, locationName = null } = {}) {
  return Object.freeze([
    field({ label: "Part", value: part.name ?? null, kind: FIELD_KIND.TEXT, priority: 1 }),
    field({ label: "SKU", value: part.internalPartNumber ?? part.sku ?? part.partId ?? null, kind: FIELD_KIND.IDENTIFIER, priority: 1 }),
    field({ label: "Description", value: part.description ?? null, kind: FIELD_KIND.TEXT, priority: 3 }),
    field({ label: "Tracking", value: statusLabel(part.trackingMode ?? part.controlType ?? null), raw: part.trackingMode ?? null, kind: FIELD_KIND.STATUS, priority: 2 }),
    statusField(part.status ?? null, { priority: 2 }),
    // UNKNOWN IS NOT ZERO. There is no governed client read for stock balances in several
    // environments, and rendering that as "0 available" would send somebody to an empty shelf
    // confident, or away from a full one.
    quantityField(availableQty, { label: "Available", priority: 1, unknown: availabilityUnknown }),
    locationField(locationName, { priority: 2 }),
  ]);
}

/** A transfer. Endpoints are two fields, because they are two places. */
export function transferFields(transfer = {}, { sourceName = null, destinationName = null } = {}) {
  return Object.freeze([
    field({ label: "Transfer", value: transfer.transferNumber ?? transfer.id ?? null, kind: FIELD_KIND.IDENTIFIER, priority: 1 }),
    statusField(transfer.status ?? null),
    locationField(sourceName, { label: "Source", priority: 1 }),
    locationField(destinationName, { label: "Destination", priority: 1 }),
    field({ label: "Part", value: transfer.partName ?? null, kind: FIELD_KIND.TEXT, priority: 2 }),
    quantityField(typeof transfer.quantity === "number" ? transfer.quantity : null, { priority: 2 }),
  ]);
}

/**
 * A receiving line.
 *
 * Expected, Received and Remaining are three fields because they answer three questions, and the
 * third is derived rather than stored — a stored remainder drifts from the other two the moment one
 * of them changes.
 */
export function receivingLineFields(line = {}, { destinationName = null } = {}) {
  const expected = typeof line.expectedQty === "number" ? line.expectedQty : null;
  const received = typeof line.receivedQty === "number" ? line.receivedQty : null;
  const remaining = expected !== null && received !== null ? Math.max(0, expected - received) : null;
  return Object.freeze([
    field({ label: "Part", value: line.partName ?? null, kind: FIELD_KIND.TEXT, priority: 1 }),
    field({ label: "SKU", value: line.sku ?? line.partId ?? null, kind: FIELD_KIND.IDENTIFIER, priority: 2 }),
    quantityField(expected, { label: "Expected", priority: 1 }),
    quantityField(received, { label: "Received", priority: 1 }),
    quantityField(remaining, { label: "Remaining", priority: 1 }),
    statusField(line.status ?? null, { priority: 2 }),
    locationField(destinationName, { label: "Destination", priority: 2 }),
  ]);
}
