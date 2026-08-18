import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { componentRegistry, actionRegistry } from "./registry.js";
import { buildCompositionPlan, applyVisibility } from "./pageRuntime.js";
import { REGION } from "./pageDefinition.js";
import { findField } from "./entityDefinition.js";
import { buildQueryDescriptor } from "./listRuntime.js";
import { buildListPresentation, cellValue, buildRowHref } from "./listPresentation.js";
import { fetchPage as fetchFirestorePage } from "./firestoreListSource.js";
import { fetchPage as fetchCallablePage } from "./callableListSource.js";
import MetadataListGrid from "./MetadataListGrid.jsx";
import FailureState from "../shared/ui/FailureState";

// Renders a PageDefinition. Thin by design: every decision about WHICH sections appear,
// where, in what order, and whether a viewer may see them was already made by
// pageRuntime.js, which is pure and exhaustively tested. This component maps a plan to
// EOS markup and does nothing else.
//
// That thinness is the point rather than a style preference. If placement or visibility
// logic lived here, "does an unauthorized section render?" would only be answerable by
// rendering things and looking — and the §6 boundary would be enforced by a component
// that also has to worry about CSS.
//
// §6 — DECISIONS COME IN, THEY ARE NOT MADE HERE. `capabilityDecisions` is the caller's
// already-resolved map. This component never calls a resolver, and passing it an empty
// map hides every gated section rather than revealing them. Rules and trusted commands
// remain the actual boundary; nothing rendered here can perform an action.
//
// §8 — components arrive from the REGISTRY by id. A definition can never supply a
// function, so no configuration path can introduce code.
//
// TWO GENUINE EXCEPTIONS TO "THIN":
//
// A FIELD_GROUP section with no registered componentId and a RELATED_LIST section with
// no injected `listRenderer` both need SOMETHING to render, or they degrade to an empty
// shell — which reads to a user as "this exists and has nothing in it," a false
// statement (see the empty-section handling below, and MetadataListGrid's own "the four
// EMPTIES are the point" reasoning). `FieldGroup` and `DefaultRelatedList` below are the
// DEFAULT, honest renderings for those two cases — generic, not page-specific, and both
// stay fully overridable: a componentId still wins for FIELD_GROUP, and an injected
// `listRenderer` still wins for RELATED_LIST. Neither adds a decision this file is not
// allowed to make; both only render what the plan and the entity/list metadata already
// declare.

/** Regions render in a fixed order. Layout is not a per-page decision. */
const RENDER_ORDER = ["HEADER", "HIGHLIGHTS", "MAIN", "SIDE", "FOOTER"];

const REGION_CLASS = {
  HEADER: "fo-record-header",
  HIGHLIGHTS: "fo-record-highlights",
  MAIN: "fo-record-main",
  SIDE: "fo-account-secondary",
  FOOTER: "fo-record-footer",
};

/**
 * X-CAPABILITY-PARTS-FIELDGROUP-UNCONSUMED — maps each of a section's `capabilityParts`
 * fieldIds back to the owning part's id, so FieldGroup can tell which authority a given
 * field belongs to.
 *
 * Returns `null` (never a partial map) the moment ANYTHING about the declaration cannot
 * be trusted mechanically: not an array, an entry missing a string `id`, a `fieldIds`
 * that isn't a non-empty array of strings, or a field claimed twice. This mirrors
 * pageDefinition.js's own `validatePageDefinition` checks, which normally catch this at
 * definition time — this is the SAME rule applied again at render time, because a
 * runtime that trusted the shape once validation had run would have no defence left the
 * one time a malformed section reaches it anyway (a hand-built test fixture, a definition
 * that skipped validation, a future caller). `null` here is read by its one caller as
 * "ownership cannot be determined" and fails every field in the section closed — see the
 * comment on FieldGroup below for why that is the deliberate choice, not just the safe
 * default.
 */
function resolveFieldGroupPartMap(section) {
  const parts = section.capabilityParts;
  if (!Array.isArray(parts) || parts.length === 0) return null;
  const map = new Map();
  for (const part of parts) {
    if (!part || typeof part !== "object" || typeof part.id !== "string" || !part.id) return null;
    if (part.fieldIds == null) continue; // a part may legitimately own no fields
    if (!Array.isArray(part.fieldIds) || part.fieldIds.length === 0) return null;
    for (const fieldId of part.fieldIds) {
      if (typeof fieldId !== "string" || !fieldId || map.has(fieldId)) return null;
      map.set(fieldId, part.id);
    }
  }
  return map;
}

/**
 * GAP 1 — a generic FIELD_GROUP renderer.
 *
 * Reads its own fieldIds off the section, resolves each against the entity's
 * FieldDefinitions for a real label and enum resolution, and reads its values off the
 * record. Reuses `cellValue` from listPresentation.js rather than re-deriving enum
 * resolution a second time — one definition of "how a raw value becomes a display
 * value," not two that can drift.
 *
 * `entity` is caller-supplied (via the new `entityResolver` prop below) because a
 * PageDefinition only ever names its OWN entityId (§7 — layers stay separate); it does
 * not carry the EntityDefinition object a field's label/type/enumLabels live on.
 *
 * No entity resolvable is a configuration gap, not silence: rendering nothing here would
 * be the exact false "nothing here" statement this section exists to avoid, so it says
 * so instead.
 *
 * X-CAPABILITY-PARTS-FIELDGROUP-UNCONSUMED — `capabilityParts` consumption.
 *
 * Before this, `applyVisibility` (pageRuntime.js) already computed `visiblePartIds` /
 * `withheldPartIds` / `partiallyWithheld` for a partially-gated section, and NOTHING on
 * the generic FIELD_GROUP path read them: every id in `section.fieldIds` rendered
 * unconditionally, so adopting `capabilityParts` on a FIELD_GROUP would have silently
 * shown a viewer fields they were not entitled to — the exact failure the field carried
 * outward specifically to prevent, unread.
 *
 * A section with no `capabilityParts` (the overwhelming majority today, and every
 * existing definition) is completely untouched by any of this — `partMap` stays `null`,
 * `renderableFieldIds` is exactly `section.fieldIds`, and the component falls straight
 * through to the same items/dl/null shape it always rendered. That branch is proved
 * unchanged by the existing GAP 1 tests plus the new "no capabilityParts" regression
 * test below.
 *
 * When `capabilityParts` IS declared, three field-level outcomes are possible, and only
 * one of them renders:
 *
 *   - claimed by a VISIBLE part   → rendered, same as any other field.
 *   - claimed by a WITHHELD part  → dropped, and the section notes that withholding.
 *   - claimed by NO part at all   → dropped and treated as withheld, same as a withheld
 *     field, NOT rendered ungated. `validatePageDefinition` never requires every one of a
 *     section's `fieldIds` to be claimed by some part (a part's `fieldIds` is optional
 *     and coverage is not enforced) — so this case is real, not hypothetical. Ownership
 *     cannot be determined for it, and this codebase's own stated rule for exactly that
 *     ("a field's owning part cannot be determined") is to withhold rather than render.
 *     The alternative — showing an unclaimed field by default — would mean the SAFE way
 *     to add a new gated part to an existing composed section is to remember to also
 *     re-claim every field that part now covers, and the UNSAFE way (forgetting) fails
 *     open. Fail-closed-by-default means the unsafe order of operations (declare the part
 *     before wiring every field to it) fails safe instead.
 *
 * Malformed `capabilityParts` metadata (caught structurally by `resolveFieldGroupPartMap`
 * above) withholds every field in the section, not just the malformed part's — the
 * runtime cannot tell which fields the broken declaration WOULD have claimed, so treating
 * only the parseable parts as authoritative would silently trust a declaration already
 * shown to be unreliable.
 *
 * Withholding is surfaced, never silent, matching the tone AccountAttentionSection.jsx's
 * `sourceStatusNote` already uses for "part of this is unavailable" (a `<p
 * className="fo-muted">` note, phrased as unauthorized/unavailable rather than invented
 * copy) and the exact "not available to you" vocabulary this same file already uses for
 * PAGE-level denial (see the `hiddenByAccess` FailureState below) — one phrase for "you
 * may not see this," not two that could drift.
 *
 * The note renders whenever fewer fields render than were declared — including the
 * all-withheld case, where `items` would otherwise be empty and indistinguishable from
 * "nothing configured." That is the EMPTY vs WITHHELD vs UNAVAILABLE distinction this
 * task is required to preserve: EMPTY is a fully-resolved section with nothing gated
 * (existing `items.length === 0` -> `null` branch, untouched); WITHHELD is this new note;
 * UNAVAILABLE is the entity-not-registered message above, unrelated to capability at all.
 */
function FieldGroup({ section, record, entity }) {
  if (!entity) {
    return <p className="fo-muted">Field details are unavailable — this section&rsquo;s entity is not registered.</p>;
  }

  const allFieldIds = section.fieldIds ?? [];
  const hasParts = !!section.capabilityParts?.length;

  let renderableFieldIds = allFieldIds;
  let someWithheld = false;

  if (hasParts) {
    const partMap = resolveFieldGroupPartMap(section);
    if (!partMap) {
      // Fail closed: the declaration itself cannot be trusted, so no field this section
      // composes is presentable — see the doc comment above.
      renderableFieldIds = [];
      someWithheld = allFieldIds.length > 0;
    } else {
      const visiblePartIds = new Set(section.visiblePartIds ?? []);
      renderableFieldIds = allFieldIds.filter((fieldId) => {
        const partId = partMap.get(fieldId);
        // No claiming part -> ownership undetermined -> withheld, not ungated. See the
        // doc comment above for why this is the deliberate choice.
        if (!partId) return false;
        return visiblePartIds.has(partId);
      });
      someWithheld = renderableFieldIds.length < allFieldIds.length;
    }
  }

  const items = renderableFieldIds.map((fieldId) => {
    const field = findField(entity, fieldId);
    // Falls back to the raw fieldId/value exactly the way resolveColumns() falls back for
    // a list column — a field metadata gap loses its formatting, never its data.
    //
    // No `resolveReference` is passed here (GAP 1 has no injected resolver of its own), so a
    // REFERENCE field routed through this generic renderer gets listPresentation.js's own
    // fail-closed default: `UNRESOLVED_REFERENCE_LABEL`, never the stored document id. That
    // is the same outcome accountPageComponents.js's commercialProfile section already
    // documents choosing to route AROUND this renderer for its two REFERENCE fields
    // (billingContactId/accountOwnerEmployeeId) — this fixes what would otherwise happen to
    // any OTHER definition that lets a REFERENCE field reach GAP 1 unrouted.
    const column = { fieldId, type: field?.type ?? "STRING", enumLabels: field?.enumLabels ?? null };
    const value = cellValue(column, record ?? {});
    return {
      fieldId,
      label: field?.label ?? fieldId,
      display: value === null || value === undefined || value === "" ? "—" : String(value),
    };
  });

  if (items.length === 0 && !someWithheld) return null;

  return (
    <Fragment>
      {someWithheld && (
        <p className="fo-muted">Some fields in this section are not available to you.</p>
      )}
      {items.length > 0 && (
        <dl className="fo-detail-list">
          {/* dt/dd stay DIRECT children of dl, not wrapped — .fo-detail-list is a
              two-column CSS grid (EquipmentDetail.jsx's own Row helper does the same for
              this reason), and a wrapper element would collapse each pair into a single
              grid cell. */}
          {items.map((item) => (
            <Fragment key={item.fieldId}>
              <dt>{item.label}</dt>
              <dd>{item.display}</dd>
            </Fragment>
          ))}
        </dl>
      )}
    </Fragment>
  );
}

/**
 * GAP 2 — the default RELATED_LIST binding.
 *
 * Drives the real list runtime the same three-layer way every other list in this
 * codebase does (descriptor → fetched page → presentation model), threading the PARENT
 * relationship through `buildQueryDescriptor`'s own `parentId`/`relationships` request
 * shape (listRuntime.js) rather than working around it with a client-side filter — a
 * RELATED list scoped any other way is the exact defect `findParentRelationship` exists
 * to prevent (an unscoped section renders every record of the target entity).
 *
 * This is NOT a call to the existing `useMetadataList` hook: that hook's request shape
 * (`{ filters, sort, enabled }`) does not forward `parentId`/`relationships` to
 * `buildQueryDescriptor`, so it cannot scope a RELATED read at all today, and
 * `useMetadataList.js` is outside this change's write scope. `useRelatedListPresentation`
 * below is the same three primitives (`buildQueryDescriptor`, a `readVia`-selected fetch,
 * `buildListPresentation`) composed the way a RELATED surface actually needs.
 *
 * ROUTES BY THE ENTITY'S DECLARED `readVia` (see `selectListSource` below). The entity
 * already states how it may be read — CLIENT_DIRECT via Firestore rules, CALLABLE via a
 * trusted read the entity names as `readCallable` (its collection is deny-all in Rules) —
 * and this is the one place a RELATED section's default binding honors that instead of
 * assuming Firestore. Defaulting every RELATED_LIST to `fetchFirestorePage` regardless of
 * `readVia` is the exact defect this closes: it would issue a live `getDocs` against a
 * deny-all collection for `opportunity`/`salesOrder` and report every viewer as denied —
 * permanently, even one holding the real capability, because the read never had a chance
 * to succeed through the actual trusted path.
 */
// X-ENTITY-SINGLE-READCALLABLE: a list view MAY declare its own `readCallable` (
// listViewDefinition.js), honored ahead of the entity's own. Today no RELATED list
// declares one — the account-scoped callable a RELATED section needs IS the entity's own
// `readCallable` — but a future RELATED list that legitimately needs a different scoped
// callable than its entity's default now has a way to say so, and this resolver is where
// both surfaces (this one and useMetadataList.js's identical copy) honor it. A list view
// that declares nothing (`listDef?.readCallable` null/undefined, the default) falls
// straight through to the entity's own value — a no-op for every RELATED section wired
// before this field existed, including the Account page's Opportunities/Sales Orders
// sections this file already renders.
function resolveReadCallable(listDef, entity) {
  return listDef?.readCallable || entity?.readCallable || null;
}

function selectListSource(entity, listDef) {
  if (entity?.readVia === "CLIENT_DIRECT") return fetchFirestorePage;
  if (entity?.readVia === "CALLABLE" && resolveReadCallable(listDef, entity)) return fetchCallablePage;
  // UNKNOWN readVia, or CALLABLE with no readCallable resolved (neither the list view nor
  // the entity declares one): a misconfigured entity, never a live read to attempt.
  // Returning null here (rather than falling back to `fetchFirestorePage`) is the fix —
  // silently defaulting to Firestore is what would repeat the defect this module exists to
  // close.
  return null;
}

function useRelatedListPresentation({ listDef, entity, parentId, relationships }) {
  const [rows, setRows] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [errorStatus, setErrorStatus] = useState(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const requestRef = useRef(0);

  const relationshipKey = (relationships ?? []).map((r) => r?.id).join(",");

  const { descriptor, errors } = useMemo(
    () => buildQueryDescriptor(listDef, entity, { parentId, relationships }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [listDef, entity, parentId, relationshipKey]
  );

  useEffect(() => {
    const token = (requestRef.current += 1);
    if (!descriptor) {
      // A descriptor the runtime refused (no entity to resolve, no parent id, an
      // unresolved relationship) is a CONFIGURATION problem, never a live failed read —
      // the same distinction useMetadataList draws for an INDEX list with no descriptor.
      setRows([]);
      setLoading(false);
      setErrorStatus(errors?.length ? "unavailable" : null);
      return;
    }
    const source = selectListSource(entity, listDef);
    if (!source) {
      // Misconfigured — the entity's own `readVia` cannot be read at all (UNKNOWN, or
      // CALLABLE with no readCallable declared). Never falls through to
      // `fetchFirestorePage`: that fallthrough against a possibly deny-all collection is
      // the exact defect this binding exists to avoid. Surfaced as "unavailable" — the
      // presentation model (listPresentation.js) has no separate misconfiguration state,
      // and "the read failed" is the honest, if imprecise, thing to tell a viewer; it is
      // still never "denied" (that would claim a real authorization check ran) and never
      // "empty" (that would claim the read succeeded and found nothing).
      setRows([]);
      setLoading(false);
      setErrorStatus("unavailable");
      return;
    }
    setLoading(true);
    // Re-stamped with the resolved readCallable for the same reason useMetadataList.js's
    // load() does: buildQueryDescriptor (listRuntime.js, outside this file's write scope)
    // always carries the ENTITY's readCallable, so a list view's override only reaches
    // callableListSource.fetchPage if it is applied here. A no-op for CLIENT_DIRECT and
    // for every RELATED section that declares nothing on its list view.
    const effectiveDescriptor =
      entity?.readVia === "CALLABLE"
        ? Object.freeze({ ...descriptor, readCallable: resolveReadCallable(listDef, entity) })
        : descriptor;
    source(effectiveDescriptor, {})
      .then((page) => {
        if (token !== requestRef.current) return;
        setRows(page.rows);
        // Carried through, not discarded. buildListPresentation turns hasMore into a
        // RELATED surface's `truncated` flag, which is what renders "Showing the most
        // recent N" and the hand-off to the full list. Dropping it made a capped section
        // present its cap as the whole set -- the precise failure the presentation model
        // was built to prevent, arriving through the one path that computes truncation
        // correctly and then throws the answer away.
        setHasMore(page.hasMore);
        setErrorStatus(null);
      })
      .catch((e) => {
        if (token !== requestRef.current) return;
        // DENIED and UNAVAILABLE stay distinct all the way down, same as every other
        // list read in this codebase — see useMetadataList.js's own comment.
        // callableListSource.js normalizes a callable rejection's error code to the same
        // bare "permission-denied" a Firestore read failure already carries, so this
        // check does not need to know which source produced the error.
        setErrorStatus(e?.code === "permission-denied" ? "denied" : "unavailable");
        setRows([]);
        setHasMore(false);
      })
      .finally(() => {
        if (token === requestRef.current) setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [descriptor, retryNonce, entity]);

  const presentation = useMemo(
    () =>
      buildListPresentation({
        def: listDef,
        entity,
        page: errorStatus ? null : { rows, hasMore },
        loading,
        errorStatus,
        filtersActive: false,
      }),
    [listDef, entity, rows, hasMore, loading, errorStatus]
  );

  return { presentation, retry: () => setRetryNonce((n) => n + 1) };
}

/**
 * X-RELATED-LIST-ACTIONS — resolves a list's declared `rowActions` (registered action
 * ids, per listViewDefinition.js) into the concrete descriptors MetadataListGrid
 * renders.
 *
 * §6 stays intact here the same way it does for section capabilities
 * (declaredPageCapabilities / applyVisibility): `capabilityDecisions` is the caller's
 * already-resolved map, never a resolver called from here. An action whose
 * `capabilityRequirement` is not explicitly `true` in that map is DENIED — an unknown
 * id, an unresolved decision, and a decision the resolver never returned all collapse
 * to the same fail-closed outcome, because the only way to tell them apart from here
 * would be to trust an absence, and an absence is not a grant.
 *
 * An action id the registry does not recognize is dropped rather than rendered denied:
 * that is a configuration gap (the same one `validateRegistryReferences` in registry.js
 * exists to catch before render), not a viewer being denied something real.
 *
 * The actual effect an activated action has is `entry.handler` — the one extension
 * point registry.js documents as application-supplied code (ActionRegistry.validate:
 * "handler, if present, must be a function supplied by application code"). No handler
 * registered means the action has nothing to do when activated; it still renders (it is
 * correctly configured and, if gated, correctly authorized) but activating it is a
 * no-op rather than a silent crash.
 */
function resolveRowActions(listDef, record, capabilityDecisions, navigate) {
  const ids = listDef?.rowActions ?? [];
  if (!ids.length) return null;
  const resolved = ids
    .map((id) => (typeof id === "string" ? actionRegistry.resolve(id) : null))
    .filter(Boolean)
    .map((entry) => {
      const capabilityRequirement = entry.capabilityRequirement ?? null;
      const denied = !!capabilityRequirement && capabilityDecisions?.[capabilityRequirement] !== true;
      return {
        id: entry.id,
        label: entry.label,
        denied,
        deniedReason: denied ? `You do not have access to "${entry.label}".` : null,
        onActivate: (rowKey) => {
          // Fails closed even if something upstream ever manages to invoke a denied
          // action directly — MetadataListGrid already refuses to call onActivate for
          // a denied entry, so this is a second, redundant gate, not the only one.
          if (denied) return;
          if (typeof entry.handler === "function") entry.handler(rowKey, { record, navigate, section: listDef });
        },
      };
    });
  return resolved.length ? resolved : null;
}

function DefaultRelatedList({
  section,
  record,
  definition,
  listResolver,
  entityResolver,
  capabilityDecisions,
  focusRowKey,
  onFocusHandled,
}) {
  const navigate = useNavigate();
  const listDef = listResolver ? listResolver(section.listId) : null;
  const childEntity = listDef && entityResolver ? entityResolver(listDef.entityId) : null;
  // The PARENT's relationships, not the child's — findParentRelationship (via
  // buildQueryDescriptor) looks there FIRST, matching a correctly-declared parent-side
  // edge like account.js's `account.opportunities`.
  const parentEntity = entityResolver ? entityResolver(definition?.entityId) : null;

  const { presentation, retry } = useRelatedListPresentation({
    listDef,
    entity: childEntity,
    parentId: record?.id ?? null,
    relationships: parentEntity?.relationships ?? [],
  });

  // `rowNavigationTo` had zero consumers before this — a declared route nothing read,
  // the same shape of gap as an unconsumed `readVia`. Absent, this passes `undefined`
  // (not a no-op function) so MetadataListGrid takes its OWN already-tested branch for
  // "no handler": non-focusable rows, no onClick/onKeyDown, rather than a handler that
  // silently does nothing and leaves a row looking clickable that is not.
  // buildRowHref deliberately returns null for a missing key, so the result is checked
  // rather than handed straight to navigate(): navigating to null is not a degraded
  // destination, it is a crash. A row with no routing key stays put, which is the same
  // outcome as declaring no route at all.
  const onRowClick = listDef?.rowNavigationTo
    ? (key) => {
        const href = buildRowHref(listDef.rowNavigationTo, key);
        if (href) navigate(href);
      }
    : undefined;

  const rowActions = useMemo(
    () => resolveRowActions(listDef, record, capabilityDecisions, navigate),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [listDef, record, capabilityDecisions, navigate]
  );

  return (
    <MetadataListGrid
      presentation={presentation}
      onRetry={retry}
      onRowClick={onRowClick}
      caption={section.label ?? undefined}
      rowActions={rowActions ?? undefined}
      focusRowKey={focusRowKey ?? undefined}
      onFocusHandled={onFocusHandled}
    />
  );
}

function Section({
  section,
  record,
  definition,
  listRenderer,
  listResolver,
  entityResolver,
  capabilityDecisions,
  relatedListFocus,
}) {
  const entry = section.componentId ? componentRegistry.resolve(section.componentId) : null;

  if (section.kind === "RELATED_LIST") {
    // Related lists are rendered by the list runtime. A caller MAY inject its own
    // `listRenderer` (and it always wins — the injection point stays, so the two
    // runtimes stay independently testable and a caller with a reason to render a
    // section differently still can); when none is supplied, DefaultRelatedList below is
    // the honest default rather than nothing.
    if (listRenderer) return listRenderer({ listId: section.listId, parentId: record?.id, section });
    // Keyed by section id — a page can carry more than one RELATED_LIST section, and a
    // post-create focus request belongs to whichever one just created a row, not to
    // every related list on the page.
    const focus = relatedListFocus?.[section.id];
    return (
      <DefaultRelatedList
        section={section}
        record={record}
        definition={definition}
        listResolver={listResolver}
        entityResolver={entityResolver}
        capabilityDecisions={capabilityDecisions}
        focusRowKey={focus?.rowKey ?? null}
        onFocusHandled={focus?.onHandled}
      />
    );
  }

  if (entry) {
    const Component = entry.component;
    return <Component section={section} record={record} />;
  }

  if (section.kind === "FIELD_GROUP") {
    // No registered component names this FIELD_GROUP — fall back to the generic
    // renderer rather than an empty shell (GAP 1, see the FieldGroup comment above).
    const entity = entityResolver ? entityResolver(definition?.entityId) : null;
    return <FieldGroup section={section} record={record} entity={entity} />;
  }

  return null;
}

export default function MetadataRecordPage({
  definition,
  record,
  capabilityDecisions = {},
  listResolver,
  listRenderer,
  entityResolver,
  // GAP 3 — PAGE-level denial vs REGION-level nothing.
  //
  // `embedded` says this render is one piece of a larger, hand-composed page rather than
  // the whole page — exactly accountPageComponents.js's `accountRecordPageSideSubset`
  // case: a SIDE-region subset naming only the (capability-gated) Account Attention
  // section, rendered alongside hand-written Commercial Profile / Notes panels that keep
  // rendering regardless. This component cannot infer that context from the definition
  // alone — a definition with one section in one region is structurally identical
  // whether it IS the whole page or is a fragment of one (see the "a page hidden
  // entirely by access" test below, which is genuinely a whole page) — so the caller
  // states it. Default false preserves every existing whole-page caller's behavior
  // unchanged.
  embedded = false,
  // X-RELATED-LIST-ACTIONS — post-create focus handoff for RELATED_LIST sections
  // rendered through DefaultRelatedList. Keyed by section id: `{ [sectionId]: { rowKey,
  // onHandled } }`. Optional and empty by default so every existing caller (none of
  // which supplies this yet — no caller creates a row through the default binding
  // today) renders unchanged; a future create flow supplies the id of the row it just
  // created and a callback to clear its own pending state once MetadataListGrid reports
  // the handoff done, the same contract AccountDetail.jsx hand-rolls per section today.
  relatedListFocus = {},
}) {
  const plan = applyVisibility(buildCompositionPlan(definition, { listResolver }), capabilityDecisions);

  // A page whose sections were ALL excluded or hidden is not an empty page — it is a
  // page the viewer cannot see, and saying "nothing here" would send them looking for
  // missing data instead of missing access. Same distinction the list presentation model
  // draws between EMPTY and DENIED.
  if (plan.sections.length === 0) {
    // EMBEDDED: nothing to report at PAGE granularity, because this render never claimed
    // to BE the page. The surrounding page (built by the caller) already keeps rendering
    // its other content — that is the whole point of a caller choosing embedded — and a
    // "not available to you" box in this one slot would replace exactly the graceful,
    // per-source degrade AccountAttentionSection already has for its own denied/loading/
    // unavailable states. A region with nothing to show contributes nothing, not a
    // failure state.
    if (embedded) return null;

    const hiddenByAccess = (plan.hidden ?? []).length > 0;
    return (
      <FailureState
        title={hiddenByAccess ? "Not available to you" : "Nothing to display"}
        message={
          hiddenByAccess
            ? "You do not have access to any part of this record. Contact an administrator if you believe this is an error."
            : "This record has no sections configured."
        }
      />
    );
  }

  return (
    <div className="fo-record-page" data-composition-mode={plan.compositionMode}>
      {RENDER_ORDER.filter((r) => REGION.includes(r)).map((region) => {
        const sections = plan.regions[region] ?? [];
        // A region whose only section(s) were hidden by capability is empty in the SAME
        // sense as a region nothing was ever placed in — plan.regions was already
        // rebuilt from VISIBLE sections by applyVisibility (pageRuntime.js), so there is
        // no separate "hidden vs never-configured" branch to take here: both render no
        // container, and the PAGE-level check above (not this one) is the only place
        // that distinguishes DENIED from EMPTY, at the granularity the caller asked for.
        if (sections.length === 0) return null;
        return (
          <div key={region} className={REGION_CLASS[region] ?? "fo-record-main"}>
            {sections.map((section) => (
              <section key={section.id} className="fo-record-section" aria-label={section.label ?? section.kind}>
                {section.label && <h3 className="fo-record-section-title">{section.label}</h3>}
                <Section
                  section={section}
                  record={record}
                  definition={definition}
                  listRenderer={listRenderer}
                  listResolver={listResolver}
                  entityResolver={entityResolver}
                  capabilityDecisions={capabilityDecisions}
                  relatedListFocus={relatedListFocus}
                />
              </section>
            ))}
          </div>
        );
      })}
    </div>
  );
}
