import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { componentRegistry } from "./registry.js";
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
 */
function FieldGroup({ section, record, entity }) {
  if (!entity) {
    return <p className="fo-muted">Field details are unavailable — this section&rsquo;s entity is not registered.</p>;
  }
  const items = (section.fieldIds ?? []).map((fieldId) => {
    const field = findField(entity, fieldId);
    // Falls back to the raw fieldId/value exactly the way resolveColumns() falls back for
    // a list column — a field metadata gap loses its formatting, never its data.
    const column = { fieldId, type: field?.type ?? "STRING", enumLabels: field?.enumLabels ?? null };
    const value = cellValue(column, record ?? {});
    return {
      fieldId,
      label: field?.label ?? fieldId,
      display: value === null || value === undefined || value === "" ? "—" : String(value),
    };
  });
  if (items.length === 0) return null;
  return (
    <dl className="fo-detail-list">
      {/* dt/dd stay DIRECT children of dl, not wrapped — .fo-detail-list is a two-column
          CSS grid (EquipmentDetail.jsx's own Row helper does the same for this reason),
          and a wrapper element would collapse each pair into a single grid cell. */}
      {items.map((item) => (
        <Fragment key={item.fieldId}>
          <dt>{item.label}</dt>
          <dd>{item.display}</dd>
        </Fragment>
      ))}
    </dl>
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
function selectListSource(entity) {
  if (entity?.readVia === "CLIENT_DIRECT") return fetchFirestorePage;
  if (entity?.readVia === "CALLABLE" && entity.readCallable) return fetchCallablePage;
  // UNKNOWN readVia, or CALLABLE with no readCallable declared: a misconfigured entity,
  // never a live read to attempt. Returning null here (rather than falling back to
  // `fetchFirestorePage`) is the fix — silently defaulting to Firestore is what would
  // repeat the defect this module exists to close.
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
    const source = selectListSource(entity);
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
    source(descriptor, {})
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

function DefaultRelatedList({ section, record, definition, listResolver, entityResolver }) {
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

  return (
    <MetadataListGrid presentation={presentation} onRetry={retry} onRowClick={onRowClick} caption={section.label ?? undefined} />
  );
}

function Section({ section, record, definition, listRenderer, listResolver, entityResolver }) {
  const entry = section.componentId ? componentRegistry.resolve(section.componentId) : null;

  if (section.kind === "RELATED_LIST") {
    // Related lists are rendered by the list runtime. A caller MAY inject its own
    // `listRenderer` (and it always wins — the injection point stays, so the two
    // runtimes stay independently testable and a caller with a reason to render a
    // section differently still can); when none is supplied, DefaultRelatedList below is
    // the honest default rather than nothing.
    if (listRenderer) return listRenderer({ listId: section.listId, parentId: record?.id, section });
    return (
      <DefaultRelatedList
        section={section}
        record={record}
        definition={definition}
        listResolver={listResolver}
        entityResolver={entityResolver}
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
                />
              </section>
            ))}
          </div>
        );
      })}
    </div>
  );
}
