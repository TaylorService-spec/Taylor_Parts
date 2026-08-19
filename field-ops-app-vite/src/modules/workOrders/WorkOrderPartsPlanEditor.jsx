import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchPartMasterList } from "../../services/partMasterQueries";
import { useWorkOrderPartsPlan, PLAN_OUTCOME } from "../../hooks/useWorkOrderPartsPlan";
import { WORK_ORDER_PARTS_PLAN_CAPABILITY } from "../../access/workOrderPartsPlanCapabilityAccess.js";
import {
  planLinesFromSnapshot,
  planRemovals,
  planRemovalBlocked,
  planHasUnresolvedLines,
  isPlanEditableStatus,
} from "../../domain/workOrderPartsPlan";
import {
  snapshotPartName,
  snapshotPartSku,
  snapshotPartCategory,
  snapshotPartUnit,
} from "../../domain/workOrderInventorySnapshot";
import { Button } from "../../shared/ui/primitives";

// WO Parts Planning -- the operational planning surface for a single Work Order.
//
// SCOPE DISCIPLINE: this plans DEMAND. It is not a second inventory system.
//
//   PLAN PARTS  !=  RESERVE PARTS  !=  USE PARTS.
//
// It writes exactly one thing, through exactly one authority: the governed setWorkOrderPartsPlan
// command, which owns qtyPlanned on the Work Order's inventorySnapshot. It creates no reservation, no
// inventory movement, no procurement, and never writes qtyUsed -- those belong to dispatch/reservation,
// the reorder chain, and execution capture respectively.
//
// It shows recorded USAGE read-only, because a planner has to see what execution already consumed
// (and because a used part may not be un-planned), but usage is never part of the payload.
//
// Availability/readiness (RESERVED, warehouse on-hand, on-truck) is deliberately NOT shown here. That
// projection already exists (domain/workOrderPartsReadiness.js) but needs reads of inventory_transactions
// and stock_locations that this slice does not perform. Rendering a placeholder number would be a
// fabricated availability -- the one thing that projection's own contract forbids -- so this surface
// shows only what the Work Order document itself authoritatively carries.
//
// Identity is the canonical partId. The client never sends sku: the command resolves it server-side from
// Part Master's internalPartNumber, so a stale or mistyped SKU can never enter the snapshot.
//
// LEGACY ROWS. A snapshot row predating canonical part identity has no partId. Because the command
// replaces the WHOLE plan, a payload omitting such a row would DELETE a real planned part -- and the
// client cannot include it, having no identity to send. So when any planned row is unresolved this
// surface refuses to edit at all and says why, rather than offering a save that silently drops data.
// Reconciling those rows is the server's job (it matches and backfills them); the UI must not guess.
//
// Part names/categories/units are rendered through the shared safe snapshot projections
// (domain/workOrderInventorySnapshot.js) -- snapshot-authoritative, NO catalog lookup, and a
// malformed legacy value degrades instead of crashing the view (invariant OD-3).

const numOrZero = (v) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);

function PlanMessage({ tone, children }) {
  if (!children) return null;
  return <div className={tone === "error" ? "fo-error" : "fo-muted"}>{children}</div>;
}

// Fail-closed default: with no `capability` prop injected, the "Edit parts plan" affordance never
// renders as live -- matching the server's own default deny for the (today ungranted) capability.
const DEFAULT_CAPABILITY = { hasCapability: () => false, resolving: false };

export default function WorkOrderPartsPlanEditor({ workOrder, onPlanSaved, deps, capability }) {
  const workOrderId = workOrder?.id ?? workOrder?.workOrderId ?? null;
  const editableStatus = isPlanEditableStatus(workOrder?.status);
  const cap = capability ?? DEFAULT_CAPABILITY;
  const canEdit = typeof cap.hasCapability === "function" && cap.hasCapability(WORK_ORDER_PARTS_PLAN_CAPABILITY);

  const persistedLines = useMemo(
    () => planLinesFromSnapshot(workOrder?.inventorySnapshot),
    [workOrder?.inventorySnapshot],
  );

  const [draft, setDraft] = useState(persistedLines);
  const [editing, setEditing] = useState(false);
  const [result, setResult] = useState(null);
  const [catalog, setCatalog] = useState({ loading: false, code: null, parts: [] });
  const [search, setSearch] = useState("");

  const { saving, savePlan } = useWorkOrderPartsPlan(deps);

  // Re-sync the draft whenever the persisted plan changes (initial load, and after a successful save
  // refetches the document). Never merge a stale draft over freshly persisted state.
  useEffect(() => {
    if (!editing) setDraft(persistedLines);
  }, [persistedLines, editing]);

  const loadCatalog = useCallback(async () => {
    setCatalog({ loading: true, code: null, parts: [] });
    const fetchParts = deps?.fetchParts ?? fetchPartMasterList;
    const res = await fetchParts();
    if (res?.ok) setCatalog({ loading: false, code: null, parts: res.parts ?? [] });
    else setCatalog({ loading: false, code: res?.code ?? "unavailable", parts: [] });
  }, [deps]);

  const beginEditing = useCallback(() => {
    setResult(null);
    setDraft(persistedLines);
    setEditing(true);
    loadCatalog();
  }, [persistedLines, loadCatalog]);

  const cancelEditing = useCallback(() => {
    setEditing(false);
    setSearch("");
    setResult(null);
    setDraft(persistedLines);
  }, [persistedLines]);

  const setQty = useCallback((partId, raw) => {
    const parsed = Number.parseInt(raw, 10);
    setDraft((lines) =>
      lines.map((l) => (l.partId === partId ? { ...l, qtyPlanned: Number.isNaN(parsed) ? 0 : parsed } : l)),
    );
  }, []);

  const removeLine = useCallback((partId) => {
    setDraft((lines) => lines.filter((l) => l.partId !== partId));
  }, []);

  const addPart = useCallback((part) => {
    setDraft((lines) => {
      if (lines.some((l) => l.partId === part.partId)) return lines;
      return [
        ...lines,
        {
          partId: part.partId,
          editable: true,
          // Shaped like a snapshot row so the same safe projections render it.
          raw: { sku: part.internalPartNumber, name: part.name },
          qtyPlanned: 1,
          qtyUsed: 0,
        },
      ];
    });
    setSearch("");
  }, []);

  // The payload is planned quantities ONLY. A line dropped to 0 is an intent to un-plan it, so it is
  // omitted rather than sent as a zero (the command's contract is positive integers).
  const proposed = useMemo(
    () =>
      draft
        .filter((l) => l.editable && numOrZero(l.qtyPlanned) > 0)
        .map((l) => ({ partId: l.partId, name: snapshotPartName(l.raw), qtyPlanned: l.qtyPlanned })),
    [draft],
  );

  // Any planned row without canonical identity makes a safe full-plan payload impossible.
  const unresolved = useMemo(() => planHasUnresolvedLines(persistedLines), [persistedLines]);

  const blockedPartIds = useMemo(
    () => planRemovalBlocked(persistedLines, proposed),
    [persistedLines, proposed],
  );
  const removedPartIds = useMemo(() => planRemovals(persistedLines, proposed), [persistedLines, proposed]);

  const dirty = useMemo(() => {
    const before = persistedLines
      .filter((l) => l.editable && l.qtyPlanned > 0)
      .map((l) => `${l.partId}:${l.qtyPlanned}`)
      .sort()
      .join("|");
    const after = proposed.map((l) => `${l.partId}:${l.qtyPlanned}`).sort().join("|");
    return before !== after;
  }, [persistedLines, proposed]);

  const onSave = useCallback(async () => {
    setResult(null);
    const outcome = await savePlan(workOrderId, proposed, persistedLines);
    setResult(outcome);
    if (outcome.outcome === PLAN_OUTCOME.SUCCESS) {
      setEditing(false);
      setSearch("");
      // Never optimistically rewrite the plan: refetch so what renders is what persisted.
      if (typeof onPlanSaved === "function") await onPlanSaved();
    }
  }, [savePlan, workOrderId, proposed, persistedLines, onPlanSaved]);

  const candidates = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    const chosen = new Set(draft.map((l) => l.partId));
    return catalog.parts
      .filter((p) => !chosen.has(p.partId))
      .filter(
        (p) =>
          (p.name ?? "").toLowerCase().includes(q) ||
          (p.internalPartNumber ?? "").toLowerCase().includes(q),
      )
      .slice(0, 8);
  }, [search, catalog.parts, draft]);

  const rows = editing ? draft : persistedLines;

  return (
    <div className="fo-card">
      <h3>Parts Plan</h3>
      <div className="fo-muted">
        Planned demand for this Work Order. Planning does not reserve stock or record usage.
      </div>

      {rows.length === 0 ? (
        <div className="fo-muted">No parts planned for this Work Order.</div>
      ) : (
        <table className="fo-table">
          <thead>
            <tr>
              <th>Part</th>
              <th>SKU</th>
              <th>Category</th>
              <th>Planned</th>
              <th>Used</th>
              {editing && <th />}
            </tr>
          </thead>
          <tbody>
            {rows.map((line, idx) => {
              const blocked = line.qtyUsed > 0;
              const name = snapshotPartName(line.raw);
              const sku = snapshotPartSku(line.raw);
              return (
                <tr key={line.partId || `legacy-${sku}-${idx}`}>
                  <td>{name}</td>
                  <td>{sku}</td>
                  <td>{snapshotPartCategory(line.raw)}</td>
                  <td>
                    {editing && line.editable ? (
                      <input
                        type="number"
                        min="0"
                        step="1"
                        aria-label={`Planned quantity for ${name}`}
                        value={line.qtyPlanned}
                        onChange={(e) => setQty(line.partId, e.target.value)}
                      />
                    ) : (
                      line.qtyPlanned || "—"
                    )}{" "}
                    {line.qtyPlanned ? snapshotPartUnit(line.raw) : null}
                  </td>
                  <td>{line.qtyUsed || "—"}</td>
                  {editing && (
                    <td>
                      {line.editable ? (
                        <Button
                          variant="tertiary"
                          onClick={() => removeLine(line.partId)}
                          disabled={blocked}
                          title={blocked ? "This part has recorded usage and cannot be un-planned." : undefined}
                        >
                          Remove
                        </Button>
                      ) : (
                        <span className="fo-muted">Legacy record</span>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {/* Gated on the trusted effective-access feed (access/useWorkOrderPartsPlanCapability), not just
          on Work Order status: `workOrder.parts.plan` is registered active:false in permissionCatalog.ts
          (fail-closed for every caller until a separate Owner grant), so rendering the edit affordance
          on status alone let every admin/dispatcher run a full add/remove/quantity session that could
          only ever be rejected at Save. This mirrors the fix already shipped for Opportunity write
          (access/useOpportunityCapabilities.js / opportunityWriteReadiness.js). */}
      {!editing && editableStatus && !unresolved && canEdit && (
        <Button variant="secondary" onClick={beginEditing}>
          Edit parts plan
        </Button>
      )}

      {!editing && editableStatus && !unresolved && !canEdit && (
        <PlanMessage tone={cap.resolving ? undefined : "error"}>
          {cap.resolving
            ? "Checking parts-planning access…"
            : "Parts planning is not yet enabled for your role."}
        </PlanMessage>
      )}

      {!editing && editableStatus && unresolved && (
        <PlanMessage tone="error">
          This plan contains parts recorded before canonical part identity, so it cannot be edited here
          without risking their removal. They must be reconciled to canonical Parts first.
        </PlanMessage>
      )}

      {!editableStatus && (
        <div className="fo-muted">
          This Work Order is {String(workOrder?.status ?? "in a terminal state").toLowerCase()}; its parts
          plan can no longer be changed.
        </div>
      )}

      {editing && (
        <div>
          <div>
            <label htmlFor="wo-plan-part-search">Add a part</label>
            <input
              id="wo-plan-part-search"
              type="search"
              value={search}
              placeholder="Search by name or SKU"
              onChange={(e) => setSearch(e.target.value)}
              disabled={catalog.loading || catalog.code !== null}
            />
          </div>

          {catalog.loading && <PlanMessage>Loading the parts catalog…</PlanMessage>}
          {catalog.code === "permission-denied" && (
            <PlanMessage tone="error">
              You do not have permission to read the parts catalog, so parts cannot be added.
            </PlanMessage>
          )}
          {catalog.code === "unavailable" && (
            <PlanMessage tone="error">The parts catalog is unavailable. Try again shortly.</PlanMessage>
          )}

          {candidates.length > 0 && (
            <ul>
              {candidates.map((p) => (
                <li key={p.partId}>
                  <Button variant="tertiary" onClick={() => addPart(p)}>
                    Add {p.name} ({p.internalPartNumber})
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {search.trim() && !catalog.loading && catalog.code === null && candidates.length === 0 && (
            <PlanMessage>No matching part.</PlanMessage>
          )}

          {blockedPartIds.length > 0 && (
            <PlanMessage tone="error">
              {blockedPartIds.length} part(s) have recorded usage and cannot be removed from the plan.
            </PlanMessage>
          )}
          {removedPartIds.length > blockedPartIds.length && (
            <PlanMessage>
              Saving will remove {removedPartIds.length - blockedPartIds.length} part(s) from the plan.
            </PlanMessage>
          )}

          <Button
            variant="primary"
            onClick={onSave}
            loading={saving}
            disabled={!dirty || blockedPartIds.length > 0}
          >
            Save parts plan
          </Button>
          <Button variant="tertiary" onClick={cancelEditing} disabled={saving}>
            Cancel
          </Button>
        </div>
      )}

      {result && result.outcome !== PLAN_OUTCOME.SUCCESS && (
        <PlanMessage tone="error">
          {result.message ||
            (result.outcome === PLAN_OUTCOME.VALIDATION_FAILED
              ? `The plan is not valid (${result.error}).`
              : result.outcome === PLAN_OUTCOME.REMOVAL_BLOCKED
                ? "A part with recorded usage cannot be removed from the plan."
                : "Could not save the parts plan.")}
        </PlanMessage>
      )}
      {result && result.outcome === PLAN_OUTCOME.SUCCESS && (
        <PlanMessage>Parts plan saved ({result.plannedCount} part(s) planned).</PlanMessage>
      )}
    </div>
  );
}
