import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { equipmentEntity, equipmentIndexList } from "../../metadata/definitions/equipment.js";
import { useMetadataList } from "../../hooks/useMetadataList";
import { useListCriteria } from "../../hooks/useListCriteria.js";
import { useAccountReferenceResolver } from "../../hooks/useAccountReferenceResolver.js";
import { useLocationReferenceResolver } from "../../hooks/useLocationReferenceResolver.js";
import { useAccountPicker } from "../../hooks/useAccountPicker";
import MetadataListGrid from "../../metadata/MetadataListGrid.jsx";
import {
  AddFilter, ActiveCriteria, SortControl, ListEmptyState, DroppedCriteriaNotice,
} from "../../metadata/MetadataListControls.jsx";
import {
  addFilter, removeFilter, clearFilters, setSort, describeDropped, describeRefusal,
} from "../../metadata/listUrlState.js";
import { OBJECT_LIST_KEY } from "../../navigation/objectRoutes.js";

// THE BUSINESS-WIDE INSTALLED EQUIPMENT LIST.
//
// It answers "what installed equipment exists across the governed business", which is a
// different question from the one EquipmentRegister.jsx answers ("what equipment belongs
// to THIS account"). That register stays Account-scoped: §7 defines it that way, and its
// create flow needs one fixed Account because EquipmentCreateModal scopes its Location
// options — and the write itself — to that Account rather than offering a picker.
//
// Two lists over ONE domain and ONE definition. No second Equipment model.
//
// ══════════════════════ WHAT CHANGED: THE FILTERS BECAME REAL ══════════════════════
//
// This tab carried two selects that filtered the LOADED rows only — every customer or
// location it could offer was one it had already downloaded, and choosing one narrowed a
// page rather than the register. It disclosed that in a note, which was honest and still
// meant a person filtering to "Harbor Grill" saw the Harbor Grill units ON THIS PAGE.
//
// The filters are now server-side, from the Equipment metadata, because the composites
// that serve them are live: (accountId, name), (status, name) and (accountId, status,
// name) — measured against the estate, not assumed. Customer is offered as a picker of
// NAMES that yields an id to the query, never an id typed by a person.
//
// Manufacturer and model remain columns. Filtering either would need a composite with the
// sort field, and none exists — declaring it would put a control on screen that errors at
// read time.
//
// ══════════════════════ ONE READ, STILL ══════════════════════
//
// The previous migration deliberately kept `useInstalledEquipmentPage` and rendered its
// rows through the shared presentation builder, to avoid a SECOND live read of the same
// collection. That constraint is honoured by REPLACEMENT rather than by addition: this
// surface now has exactly one read, the metadata runtime's, and the old paging hook is no
// longer called from here. Account and location names come from the two batched reference
// resolvers, which is the same bounded `documentId() in` shape the old hook used.
//
// ══════════════════════ NO DOCUMENT ID AS CONTENT ══════════════════════
//
// `domain/installedEquipmentListView.js`'s `resolveName` falls back to the raw id
// (`nameMap.get(id) ?? id`). This surface no longer calls it. An unresolved reference
// renders as an unresolved reference; the id routes the row and is never a label.

export default function CustomerEquipment() {
  const navigate = useNavigate();

  // Criteria live in the URL, so narrowing the register, opening a unit and coming back
  // returns the register that was narrowed.
  const { criteria, apply } = useListCriteria(equipmentIndexList, equipmentEntity, OBJECT_LIST_KEY.EQUIPMENT);

  // THE CUSTOMER FILTER IS A PICKER OF NAMES. A REFERENCE filter whose value control was a
  // free-text box would ask a person to type a Firestore document id, which is not a thing
  // anybody knows. The picker read is itself bounded and discloses its own truncation.
  const accountPicker = useAccountPicker();
  const valueOptions = useMemo(() => ({
    accountId: (accountPicker.options ?? []).map((a) => ({ value: a.id, label: a.name })),
  }), [accountPicker.options]);

  // The feedback pass: the resolvers need the ids the loaded rows point at, and those rows
  // come from the list hook, so they cannot be built before the call that produces them.
  const [resolvableRows, setResolvableRows] = useState([]);
  const { resolveReference: resolveAccount } = useAccountReferenceResolver(resolvableRows);
  const { resolveReference: resolveLocation } = useLocationReferenceResolver(resolvableRows);

  // Composed, not merged: each resolver owns its own fields and returns undefined for
  // anything else, so neither can answer for the other's references.
  const resolveReference = useCallback(
    (fieldId, id, row) => resolveAccount(fieldId, id, row) ?? resolveLocation(fieldId, id, row),
    [resolveAccount, resolveLocation],
  );

  const { presentation, rows, loadMore, retry, descriptorErrors } = useMetadataList(equipmentIndexList, equipmentEntity, {
    filters: criteria.filters,
    sort: criteria.sort,
    resolveReference,
  });

  useEffect(() => { setResolvableRows(rows ?? []); }, [rows]);

  const droppedMessage = useMemo(() => {
    const fromUrl = describeDropped(criteria.dropped);
    if (fromUrl) return fromUrl;
    return describeRefusal(descriptorErrors, "equipment");
  }, [criteria, descriptorErrors]);

  return (
    <div className="fo-panel">
      <h3>Customer Equipment</h3>

      {/* The picker read is capped. If it was, the Customer filter cannot offer every
          customer, and saying so is the difference between a short menu and a wrong one. */}
      {accountPicker.truncated && (
        <p className="fo-muted" role="status">{accountPicker.message}</p>
      )}

      <div className="fo-listctl">
        <AddFilter
          def={equipmentIndexList}
          entity={equipmentEntity}
          valueOptions={valueOptions}
          onAdd={(c) => apply(addFilter(criteria, c))}
        />
        <SortControl
          entity={equipmentEntity}
          criteria={criteria}
          onSort={(fieldId, direction) => apply(setSort(criteria, fieldId, direction))}
        />
      </div>
      <ActiveCriteria
        criteria={criteria}
        entity={equipmentEntity}
        onRemove={(fieldId, operator) => apply(removeFilter(criteria, fieldId, operator))}
        onClear={() => apply(clearFilters(criteria))}
      />

      <DroppedCriteriaNotice message={droppedMessage} />

      {presentation?.state === "FILTERED" ? (
        <ListEmptyState criteria={criteria} onClear={() => apply(clearFilters(criteria))} />
      ) : (
        <MetadataListGrid
          presentation={presentation}
          caption="Installed equipment"
          onRowClick={(id) => navigate(`/equipment/${id}`)}
          onLoadMore={loadMore}
          onRetry={retry}
        />
      )}
    </div>
  );
}
