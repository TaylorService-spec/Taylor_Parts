import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader, SectionHeader, StatusIndicator, CompactMetric, Button } from "../../shared/ui/primitives";
import { Field, FormError, FormStatus } from "../../shared/ui/form";
import { binCommandClient } from "../../services/binCommandClient";
import { fetchWarehouses } from "../../services/operationsQueries";
import { applyProposals, summarizeApply, APPLY_CONCURRENCY } from "../../services/rackingApply";
import {
  generateRackingLayout,
  binIdempotencyKey,
  normalizeArea,
  normalizeAisle,
  toCreateRequest,
  PROPOSAL_STATE,
} from "../../domain/rackingLayoutGenerator";

// Administration -> Warehouse Racking.
//
// Where a warehouse's physical racking is DESCRIBED once, instead of one bin at a time. Per
// docs/specifications/bin-administration-racking-generator.md.
//
// ============================ THE HONEST PARTS ============================
//
// READ and MANAGE are gated INDEPENDENTLY, and the screen says which one it is missing. Both
// `inventory.location.bin.read` and `inventory.location.bin.manage` are registered `active: false`
// and granted to no Role, so today this screen renders its honest ungated state everywhere. That is
// the truth, and it is stated rather than dressed up as "no bins configured" -- an empty list and a
// refused read look identical to an operator, and only one of them means the rack is unconfigured.
//
// NOTHING here is a preview the client computed. The classification beside every proposed bin, and
// the code shown for it, come from the trusted `previewBinCreates` read. The client cannot see
// `bin_code_claims` (deny-all to every client, permanently) and `listBins` returns no idempotency
// key, so a locally guessed verdict would be a guess presented as a fact.
//
// APPLY IS N GOVERNED CREATES. One `createBin` per bin, bounded concurrency, per-row outcomes. There
// is no bulk write path and no aggregate "success"; partial success is normal and shown as such.
//
// NO QUANTITY, NO CUSTODY. This screen configures PLACES. What sits in them is the ledger's business
// and appears nowhere here.

const CAP_READ = "inventory.location.bin.read";
const CAP_MANAGE = "inventory.location.bin.manage";

// The server refuses a larger batch rather than truncating it, so the client chunks to match.
// Mirrors BIN_PREVIEW_MAX_PROPOSALS.
const PREVIEW_CHUNK = 250;

const CLASSIFICATION_COPY = {
  NEW: { tone: "positive", label: "New", hint: "Will be created." },
  ALREADY_EXISTS: { tone: "info", label: "Already exists", hint: "Applying again changes nothing." },
  CODE_RESERVED: { tone: "attention", label: "Code taken", hint: "Another bin already holds this code. It cannot be created." },
  INVALID: { tone: "critical", label: "Invalid", hint: "The registry refused this location." },
  INTEGRITY_ERROR: { tone: "critical", label: "Needs attention", hint: "The stored record is inconsistent. Do not apply." },
};

const chunk = (items, size) => {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

const intOr = (raw, fallback) => {
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
};

/** A capability this screen needs, stated plainly when it is not held. */
function Ungated({ what, capability }) {
  return (
    <StatusIndicator tone="neutral">
      {what} is not available to you. It needs <code>{capability}</code>, which is not active for
      this environment and is not granted to any role yet.
    </StatusIndicator>
  );
}

// ═══════════════════════════════════ existing bins ═══════════════════════════════════

function BinRow({ bin, canManage, onRename, onSetStatus, busy }) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(bin.name ?? "");

  return (
    <tr>
      <td className="fo-tabular-nums">{bin.code}</td>
      <td>{bin.area}</td>
      <td className="fo-tabular-nums">{`${bin.aisle} / ${bin.bay} / ${bin.position}`}</td>
      <td>
        {renaming ? (
          <input
            type="text"
            value={name}
            aria-label={`Name for ${bin.code}`}
            onChange={(e) => setName(e.target.value)}
          />
        ) : (
          bin.name || <span className="fo-muted">No name</span>
        )}
      </td>
      <td>
        <StatusIndicator tone={bin.status === "ACTIVE" ? "positive" : "neutral"}>
          {/* The concept is named rather than left bare (ADR-012 2.2a): a bin's ACTIVE status means the place is
              available to stow into, which is a different thing from an active employee, an active
              role assignment or an active capability. */}
          {bin.status === "ACTIVE" ? "In use" : "Out of use"}
        </StatusIndicator>
      </td>
      <td>
        {!canManage ? (
          <span className="fo-muted">View only</span>
        ) : renaming ? (
          <>
            <Button
              onClick={() => {
                // The bin keeps its binId and its scanned label keeps working: renameBin moves the
                // code claim, it does not mint a new bin.
                onRename(bin, name.trim() === "" ? null : name.trim());
                setRenaming(false);
              }}
              disabled={busy}
            >
              Save name
            </Button>
            <Button variant="tertiary" onClick={() => { setName(bin.name ?? ""); setRenaming(false); }}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            <Button variant="tertiary" onClick={() => setRenaming(true)} disabled={busy}>
              Rename
            </Button>
            <Button
              variant="tertiary"
              disabled={busy}
              onClick={() => onSetStatus(bin, bin.status === "ACTIVE" ? "INACTIVE" : "ACTIVE")}
            >
              {bin.status === "ACTIVE" ? "Deactivate" : "Reactivate"}
            </Button>
          </>
        )}
      </td>
    </tr>
  );
}

// ═══════════════════════════════════ the screen ═══════════════════════════════════

export default function AdminWarehouseRacking({ client = binCommandClient, loadWarehouses = fetchWarehouses, hasCapability }) {
  // Fail closed: an absent previewer means no capability, never "assume yes".
  const canRead = typeof hasCapability === "function" ? hasCapability(CAP_READ) === true : false;
  const canManage = typeof hasCapability === "function" ? hasCapability(CAP_MANAGE) === true : false;

  const [warehouses, setWarehouses] = useState([]);
  const [warehouseId, setWarehouseId] = useState("");
  const [bins, setBins] = useState(null);
  const [listError, setListError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  const [area, setArea] = useState("");
  const [aisleMode, setAisleMode] = useState("range");
  const [aisleFrom, setAisleFrom] = useState("A");
  const [aisleTo, setAisleTo] = useState("C");
  const [aisleList, setAisleList] = useState("");
  const [bayCount, setBayCount] = useState("4");
  const [positionCount, setPositionCount] = useState("4");

  const [single, setSingle] = useState({ aisle: "", bay: "", position: "" });

  // Transient by design: a plan is a description of intent, not a saved artifact. Persisting it
  // would be the second racking-configuration authority this programme explicitly refused.
  const [plan, setPlan] = useState(null);
  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState(null);
  const [applied, setApplied] = useState(null);

  useEffect(() => {
    let live = true;
    loadWarehouses()
      .then((rows) => { if (live) setWarehouses(rows ?? []); })
      .catch(() => { if (live) setWarehouses([]); });
    return () => { live = false; };
  }, [loadWarehouses]);

  const refreshBins = useCallback(async (id) => {
    if (!id || !canRead) { setBins(null); return; }
    setListError(null);
    try {
      const res = await client.listBins({ warehouseId: id });
      setBins(res?.bins ?? []);
    } catch (err) {
      // A refused read is a refusal, never an empty rack.
      setBins(null);
      setListError(err?.message || "The bin list could not be read.");
    }
  }, [client, canRead]);

  useEffect(() => { refreshBins(warehouseId); }, [warehouseId, refreshBins]);

  // Any change to the description invalidates the plan AND its verdicts. A preview shown against
  // inputs the operator has since edited is a stale answer to a question nobody asked.
  const invalidate = useCallback(() => {
    setPlan(null);
    setPreview(null);
    setPreviewError(null);
    setApplied(null);
  }, []);

  const layoutInput = useMemo(() => ({
    warehouseId,
    area,
    aisles: aisleMode === "range"
      ? { mode: "range", from: aisleFrom, to: aisleTo }
      : { mode: "explicit", list: aisleList },
    defaultBayCount: intOr(bayCount, 0),
    defaultPositionCount: intOr(positionCount, 0),
  }), [warehouseId, area, aisleMode, aisleFrom, aisleTo, aisleList, bayCount, positionCount]);

  const runPreview = useCallback(async (rows) => {
    setPreviewError(null);
    const creatable = rows.filter((r) => r.state === PROPOSAL_STATE.PROPOSED);
    try {
      const batches = await Promise.all(
        chunk(creatable.map(toCreateRequest), PREVIEW_CHUNK)
          .map((proposals) => client.previewBinCreates({ proposals })),
      );
      const byKey = new Map();
      for (const b of batches) for (const row of b?.rows ?? []) byKey.set(row.idempotencyKey, row);
      setPreview(byKey);
    } catch (err) {
      // No local fallback classification. Not knowing is shown as not knowing.
      setPreview(null);
      setPreviewError(err?.message || "The registry could not be asked about these bins.");
    }
  }, [client]);

  const onGenerate = useCallback(async () => {
    const result = generateRackingLayout(layoutInput);
    setApplied(null);
    if (!result.ok) {
      setPlan(null);
      setPreview(null);
      setPreviewError(result.errors.join(", "));
      return;
    }
    setPlan(result.rows);
    await runPreview(result.rows);
  }, [layoutInput, runPreview]);

  const onAddOne = useCallback(async () => {
    setApplied(null);
    const row = {
      warehouseId,
      area: normalizeArea(area),
      aisle: normalizeAisle(single.aisle),
      bay: intOr(single.bay, -1),
      position: intOr(single.position, -1),
      state: PROPOSAL_STATE.PROPOSED,
    };
    // The SAME deterministic key the generator would derive, so a hand-added bin and a generated one
    // are one bin rather than a collision.
    row.idempotencyKey = binIdempotencyKey(row);
    setPlan([row]);
    await runPreview([row]);
  }, [warehouseId, area, single, runPreview]);

  const applicable = useMemo(() => {
    if (!plan || !preview) return [];
    return plan
      .map((row) => ({ row, verdict: preview.get(row.idempotencyKey) }))
      .filter(({ verdict }) => verdict?.classification === "NEW")
      .map(({ row }) => ({ request: toCreateRequest(row) }));
  }, [plan, preview]);

  const onApply = useCallback(async () => {
    setBusy(true);
    try {
      const results = await applyProposals({ rows: applicable, createBin: client.createBin });
      setApplied(results);
      await refreshBins(warehouseId);
      // The plan's verdicts are now stale by definition -- the rows just created are no longer NEW.
      // Re-asking is cheaper than reasoning about it, and it is the registry's answer either way.
      if (plan) await runPreview(plan);
    } finally {
      setBusy(false);
    }
  }, [applicable, client, refreshBins, warehouseId, plan, runPreview]);

  const mutate = useCallback(async (label, fn) => {
    setBusy(true);
    setNotice(null);
    try {
      await fn();
      setNotice({ tone: "positive", text: `${label} saved.` });
      await refreshBins(warehouseId);
    } catch (err) {
      setNotice({ tone: "critical", text: err?.message || `${label} could not be saved.` });
    } finally {
      setBusy(false);
    }
  }, [refreshBins, warehouseId]);

  const summary = applied ? summarizeApply(applied) : null;
  const previewRows = plan?.map((row) => ({ row, verdict: preview?.get(row.idempotencyKey) ?? null })) ?? [];

  return (
    <div className="fo-panel">
      <PageHeader
        eyebrow="Administration"
        title="Warehouse Racking"
        description="Describe a warehouse's racking once and create its bins in one pass. Bins are places; what sits in them is tracked separately."
      />

      {!canRead && <Ungated what="Reading a warehouse's racking" capability={CAP_READ} />}
      {canRead && !canManage && <Ungated what="Creating or changing bins" capability={CAP_MANAGE} />}

      <SectionHeader title="Warehouse" description="Racking belongs to one warehouse. Bin codes are unique within it, never across the company." />
      <Field id="racking-warehouse" label="Warehouse">
        <select
          value={warehouseId}
          onChange={(e) => { setWarehouseId(e.target.value); invalidate(); }}
        >
          <option value="">Select a warehouse</option>
          {warehouses.map((w) => (
            <option key={w.id} value={w.id}>{w.name || w.id}</option>
          ))}
        </select>
      </Field>

      {warehouseId && canRead && (
        <>
          <SectionHeader
            level={3}
            title="Existing bins"
            description="Every bin already configured in this warehouse."
            actions={bins ? <CompactMetric value={bins.length} label="Bins" /> : null}
          />
          {listError && <FormError id="racking-list-error">{listError}</FormError>}
          {!listError && bins?.length === 0 && (
            <StatusIndicator tone="info">No bins are configured in this warehouse yet.</StatusIndicator>
          )}
          {bins?.length > 0 && (
            <table className="fo-table">
              <thead>
                <tr>
                  <th scope="col">Code</th>
                  <th scope="col">Area</th>
                  <th scope="col">Aisle / Bay / Position</th>
                  <th scope="col">Name</th>
                  <th scope="col">Status</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {bins.map((bin) => (
                  <BinRow
                    key={bin.binId}
                    bin={bin}
                    canManage={canManage}
                    busy={busy}
                    onRename={(b, name) => mutate("Name", () => client.renameBin({ binId: b.binId, name }))}
                    onSetStatus={(b, status) => mutate(
                      status === "ACTIVE" ? "Reactivation" : "Deactivation",
                      () => (status === "ACTIVE"
                        ? client.reactivateBin({ binId: b.binId })
                        : client.deactivateBin({ binId: b.binId })),
                    )}
                  />
                ))}
              </tbody>
            </table>
          )}
          {notice && <FormStatus visible>{notice.text}</FormStatus>}
        </>
      )}

      {warehouseId && canManage && (
        <>
          <SectionHeader
            title="Describe the racking"
            description="Aisles, bays within each aisle, positions within each bay. Positions are numbered 1, 3, 5 and so on, leaving the even numbers free for shelves added later."
          />

          <Field id="racking-area" label="Area" hint="The part of the warehouse this racking sits in, for example PARTS ROOM.">
            <input type="text" value={area} onChange={(e) => { setArea(e.target.value); invalidate(); }} />
          </Field>

          <Field id="racking-aisle-mode" label="Aisles">
            <select value={aisleMode} onChange={(e) => { setAisleMode(e.target.value); invalidate(); }}>
              <option value="range">A range of letters</option>
              <option value="explicit">A specific list</option>
            </select>
          </Field>

          {aisleMode === "range" ? (
            <>
              <Field id="racking-aisle-from" label="From aisle">
                <input type="text" value={aisleFrom} onChange={(e) => { setAisleFrom(e.target.value); invalidate(); }} />
              </Field>
              <Field id="racking-aisle-to" label="To aisle">
                <input type="text" value={aisleTo} onChange={(e) => { setAisleTo(e.target.value); invalidate(); }} />
              </Field>
            </>
          ) : (
            <Field id="racking-aisle-list" label="Aisles" hint="Separate with commas, for example A, B, D, F.">
              <input type="text" value={aisleList} onChange={(e) => { setAisleList(e.target.value); invalidate(); }} />
            </Field>
          )}

          <Field id="racking-bays" label="Bays in each aisle">
            <input type="number" min="0" value={bayCount} onChange={(e) => { setBayCount(e.target.value); invalidate(); }} />
          </Field>
          <Field id="racking-positions" label="Positions in each bay">
            <input type="number" min="0" value={positionCount} onChange={(e) => { setPositionCount(e.target.value); invalidate(); }} />
          </Field>

          <Button onClick={onGenerate} disabled={busy}>Preview these bins</Button>

          <SectionHeader
            level={3}
            title="Add one bin"
            description="For a single shelf added to racking that already exists."
          />
          <Field id="racking-one-aisle" label="Aisle">
            <input type="text" value={single.aisle} onChange={(e) => { setSingle((s) => ({ ...s, aisle: e.target.value })); invalidate(); }} />
          </Field>
          <Field id="racking-one-bay" label="Bay">
            <input type="number" min="0" value={single.bay} onChange={(e) => { setSingle((s) => ({ ...s, bay: e.target.value })); invalidate(); }} />
          </Field>
          <Field id="racking-one-position" label="Position" hint="Even numbers are allowed: 002 sits between 001 and 003.">
            <input type="number" min="0" value={single.position} onChange={(e) => { setSingle((s) => ({ ...s, position: e.target.value })); invalidate(); }} />
          </Field>
          <Button onClick={onAddOne} disabled={busy}>Preview this bin</Button>
        </>
      )}

      {previewError && <FormError id="racking-preview-error">{previewError}</FormError>}

      {plan && (
        <>
          <SectionHeader
            level={3}
            title="Preview"
            description="What the registry says about each of these bins. Nothing has been created yet."
          />
          {!preview && !previewError && <StatusIndicator tone="neutral">Asking the registry…</StatusIndicator>}
          {preview && (
            <>
              <div className="fo-racking__summary">
                {["NEW", "ALREADY_EXISTS", "CODE_RESERVED", "INVALID", "INTEGRITY_ERROR"].map((c) => {
                  const n = previewRows.filter(({ verdict }) => verdict?.classification === c).length;
                  return n > 0 ? <CompactMetric key={c} value={n} label={CLASSIFICATION_COPY[c].label} /> : null;
                })}
              </div>
              <table className="fo-table">
                <thead>
                  <tr>
                    <th scope="col">Code</th>
                    <th scope="col">Aisle / Bay / Position</th>
                    <th scope="col">Status</th>
                    <th scope="col">What happens</th>
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map(({ row, verdict }) => {
                    const copy = verdict ? CLASSIFICATION_COPY[verdict.classification] : null;
                    return (
                      <tr key={row.idempotencyKey ?? `${row.aisle}-${row.bay}-${row.position}`}>
                        {/* The SERVER's code, never one guessed here. */}
                        <td className="fo-tabular-nums">{verdict?.code ?? <span className="fo-muted">—</span>}</td>
                        <td className="fo-tabular-nums">{`${row.aisle} / ${row.bay} / ${row.position}`}</td>
                        <td>
                          {row.state === PROPOSAL_STATE.DUPLICATE ? (
                            <StatusIndicator tone="attention">Listed twice</StatusIndicator>
                          ) : copy ? (
                            <StatusIndicator tone={copy.tone}>{copy.label}</StatusIndicator>
                          ) : (
                            <StatusIndicator tone="neutral">Not classified</StatusIndicator>
                          )}
                        </td>
                        <td>{copy?.hint ?? "The registry was not asked about this row."}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              <Button onClick={onApply} disabled={busy || applicable.length === 0}>
                {applicable.length === 0
                  ? "Nothing to create"
                  : `Create ${applicable.length} bin${applicable.length === 1 ? "" : "s"}`}
              </Button>
              {applicable.length > APPLY_CONCURRENCY && (
                <p className="fo-wizard-hint">
                  Bins are created one at a time, a few at once. Some may succeed while others do not —
                  each row below says which.
                </p>
              )}
            </>
          )}
        </>
      )}

      {applied && (
        <>
          <SectionHeader level={3} title="Result" description="One line per bin. A partial result is normal." />
          <div className="fo-racking__summary">
            <CompactMetric value={summary.created} label="Created" />
            <CompactMetric value={summary.unchanged} label="Already there" />
            <CompactMetric value={summary.failed} label="Not created" />
          </div>
          <table className="fo-table">
            <thead>
              <tr>
                <th scope="col">Code</th>
                <th scope="col">Outcome</th>
                <th scope="col">Detail</th>
              </tr>
            </thead>
            <tbody>
              {applied.map((r) => (
                <tr key={r.idempotencyKey}>
                  <td className="fo-tabular-nums">{r.code ?? <span className="fo-muted">—</span>}</td>
                  <td>
                    <StatusIndicator tone={r.outcome === "failed" ? "critical" : r.outcome === "unchanged" ? "info" : "positive"}>
                      {r.outcome === "failed" ? "Not created" : r.outcome === "unchanged" ? "Already there" : "Created"}
                    </StatusIndicator>
                  </td>
                  <td>{r.error ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
