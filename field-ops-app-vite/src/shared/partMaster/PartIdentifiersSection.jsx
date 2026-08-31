import { useState } from "react";
import RuledSection from "../ui/RuledSection.jsx";
import PartsInfoDisclosure from "../../modules/inventory/PartsInfoDisclosure.jsx";
import { Button } from "../ui/primitives/index.js";
import { usePartIdentifiers } from "../../hooks/usePartIdentifiers.js";
import { PART_IDENTIFIER_UNAVAILABLE_REASON } from "../../config/partIdentifierReadiness.js";
import {
  ALIAS_TYPES,
  ALIAS_TYPE_LABEL,
  requiresManufacturer,
  validateIdentifierDraft,
  describeProbe,
} from "../../domain/partIdentifiers.js";

// PART MASTER > BARCODE / IDENTIFIERS.
//
// A barcode is an IDENTIFIER, not a quantity and not an authority. Scanning one resolves WHICH Part
// you are holding; it grants nothing and moves nothing. That separation is the whole design and is
// enforced upstream in domain/scannedIdentity.js: "Scanning resolves IDENTITY. Scanning does NOT
// determine AUTHORITY."
//
// ONE IDENTITY SYSTEM, NOT A SECOND ONE. Part barcodes belong to the governed `part_aliases`
// authority that already exists -- createPartAlias / deactivatePartAlias / reactivatePartAlias /
// resolvePartAlias are written and unit-tested in functions/src/partMaster/partAliasCommands.ts.
// This screen is their front end, not a new store. A serialized-equipment tag is NOT a Part barcode
// and belongs to serialized-asset identity; a location barcode belongs to the warehouse/location
// authority. They are deliberately not interchangeable, so this section talks about Part identifiers
// only.
//
// ============ WHAT CHANGED, AND WHAT DELIBERATELY DID NOT ============
//
// This section used to render UNAVAILABLE and name three missing pieces: no onCall adapter, Rules
// deny-all on part_aliases, and an unpopulated collection. Two of those are now closed -- adapters
// exist, and a callable runs on the Admin SDK where Rules do not apply. The third was never a
// blocker, only a consequence of the first two.
//
// What did NOT change is the honesty. There are still four distinct reasons this list can be empty
// of content, and they are still never collapsed:
//   unavailable — the transport is switched off in this environment (the common case today);
//   denied      — the caller lacks inventory.catalog.manage;
//   failed      — the read broke;
//   ready+empty — this Part genuinely has no identifiers.
// Only the last is an empty list. The other three are unread ones, and saying "no identifiers" for
// any of them would assert something about data this screen did not read.
//
// THERE IS NO EDIT. An identifier's document id derives from its type and value, so changing the
// value IS a different identifier. The governed model is deactivate-then-add, and deactivation
// preserves history rather than deleting. The surface offers exactly that rather than an "edit"
// control that would have to secretly delete and recreate.

function StatusLine({ tone, children }) {
  const cls = tone === "ok" ? "fo-muted" : tone === "attention" ? "fo-warning" : "fo-inline-error";
  return (
    <p className={cls} role={tone === "error" ? "alert" : "status"}>
      {children}
    </p>
  );
}

function AddIdentifierForm({ onAdd, onProbe, partId, busy }) {
  const [draft, setDraft] = useState({ aliasType: "INTERNAL_PN", rawValue: "", manufacturerId: "" });
  const [error, setError] = useState(null);
  const [probeResult, setProbeResult] = useState(null);
  const set = (k, v) => {
    setDraft((d) => ({ ...d, [k]: v }));
    setError(null);
    setProbeResult(null);
  };

  const submit = async (e) => {
    e.preventDefault();
    const check = validateIdentifierDraft(draft);
    if (!check.valid) {
      setError(check);
      return;
    }
    const outcome = await onAdd({
      aliasType: draft.aliasType,
      rawValue: draft.rawValue.trim(),
      ...(requiresManufacturer(draft.aliasType) ? { manufacturerId: draft.manufacturerId.trim() } : {}),
    });
    // The draft SURVIVES a conflict. The recovery is "look at the list and decide", and throwing
    // away what they typed would make them retype it to do that.
    if (outcome?.kind === "applied" || outcome?.kind === "replayed") {
      setDraft({ aliasType: draft.aliasType, rawValue: "", manufacturerId: draft.manufacturerId });
    }
  };

  const runProbe = async () => {
    const check = validateIdentifierDraft(draft);
    if (!check.valid) {
      setError(check);
      return;
    }
    const raw = await onProbe({
      aliasType: draft.aliasType,
      rawValue: draft.rawValue.trim(),
      ...(requiresManufacturer(draft.aliasType) ? { manufacturerId: draft.manufacturerId.trim() } : {}),
    });
    setProbeResult(describeProbe(raw, { partId }));
  };

  return (
    <form className="fo-identifier-form" onSubmit={submit}>
      <div className="fo-identifier-form__row">
        <label htmlFor="alias-type">Type</label>
        <select
          id="alias-type"
          className="fo-input"
          value={draft.aliasType}
          onChange={(e) => set("aliasType", e.target.value)}
        >
          {ALIAS_TYPES.map((t) => (
            <option key={t} value={t}>
              {ALIAS_TYPE_LABEL[t]}
            </option>
          ))}
        </select>
      </div>

      <div className="fo-identifier-form__row">
        <label htmlFor="alias-value">Value</label>
        <input
          id="alias-value"
          className="fo-input"
          type="text"
          inputMode="text"
          autoComplete="off"
          value={draft.rawValue}
          placeholder="Scan or type the identifier"
          onChange={(e) => set("rawValue", e.target.value)}
          aria-invalid={error?.field === "rawValue" ? "true" : undefined}
        />
      </div>

      {/* Shown only for the one type it means something for. A manufacturer part number is scoped
          per manufacturer -- the same number from two manufacturers is two different identifiers. */}
      {requiresManufacturer(draft.aliasType) && (
        <div className="fo-identifier-form__row">
          <label htmlFor="alias-mfr">Manufacturer</label>
          <input
            id="alias-mfr"
            className="fo-input"
            type="text"
            autoComplete="off"
            value={draft.manufacturerId}
            placeholder="Manufacturer id"
            onChange={(e) => set("manufacturerId", e.target.value)}
            aria-invalid={error?.field === "manufacturerId" ? "true" : undefined}
          />
        </div>
      )}

      {error && <StatusLine tone="error">{error.message}</StatusLine>}
      {probeResult && <StatusLine tone={probeResult.tone}>{probeResult.message}</StatusLine>}

      <div className="fo-chip-row">
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? "Adding…" : "Add identifier"}
        </Button>
        {/* Scan-to-test uses the SAME resolver the real scan path uses. A test-only matcher could
            agree with the administrator and disagree with the scanner, which is the whole failure
            this control exists to catch. */}
        <Button type="button" variant="secondary" onClick={runProbe} disabled={busy}>
          Test this scan
        </Button>
      </div>
    </form>
  );
}

function IdentifierRow({ alias, onDeactivate, onReactivate, pending }) {
  const isActive = alias.status === "ACTIVE";
  const busy = !!pending[`${isActive ? "deactivate" : "reactivate"}:${alias.aliasId}`];
  return (
    <tr className={isActive ? undefined : "is-inactive"}>
      <td>{ALIAS_TYPE_LABEL[alias.aliasType] ?? alias.aliasType}</td>
      <td>
        <code>{alias.value}</code>
        {alias.manufacturerId && <span className="fo-muted"> · {alias.manufacturerId}</span>}
      </td>
      <td>
        {/* The concept is NAMED rather than left unqualified (ADR-012 §2.2a): this screen sits
            beside Part status and Employee status, and a bare status word here would read as
            whichever of those the reader had in mind. The title attribute says what the state
            MEANS — whether a scan resolves — which is what an administrator actually needs. */}
        {isActive ? (
          <span title="A scan resolves this identifier to this part">Identifier active</span>
        ) : (
          // Inactive is shown, not hidden. Re-adding a deactivated identifier is refused as a
          // conflict, and an administrator who cannot see this record cannot understand why.
          <span className="fo-muted" title="A scan will not resolve this identifier">
            Identifier inactive
          </span>
        )}
      </td>
      <td className="fo-muted">{alias.source}</td>
      <td>
        <Button
          type="button"
          variant="tertiary"
          disabled={busy}
          onClick={() => (isActive ? onDeactivate(alias) : onReactivate(alias))}
        >
          {busy ? "Working…" : isActive ? "Deactivate" : "Reactivate"}
        </Button>
      </td>
    </tr>
  );
}

export default function PartIdentifiersSection({ partId, partNumber, deps }) {
  const {
    status,
    aliases,
    truncated,
    limit,
    message,
    pending,
    outcome,
    addIdentifier,
    deactivate,
    reactivate,
    probe,
    reload,
  } = usePartIdentifiers(partId, deps);

  const label = partNumber || partId || "this part";

  return (
    // PARTS NORTH STAR P1 -- the shared record-section grammar. The heading loses "Barcode &":
    // a barcode is one of the identifier TYPES listed below, so naming it in the title made one
    // member of the set look like half the subject.
    <RuledSection title="Identifiers">

      {/* ══════ A3 — THE P1v2 IDENTIFIER GRAMMAR (Owner ruling, 2026-08-31) ══════
          Frame 1b draws this as two lines: the identity a scan resolves, then one sentence about
          what is not readable. It was three explanatory paragraphs wrapped around the facts --
          191px on a 1,050px record, and the "explanation outranks fact" finding of the audit
          reproduced one tier down.

          WHAT WAS NOT ALLOWED TO CHANGE, and did not: the identifier facts actually available, the
          UNAVAILABLE / DENIED / EMPTY distinction, the "unread, not empty" semantics, the capability
          gating, and the manage authority when it is genuinely granted. Only the prose that stood
          on every record regardless of state has moved to where it is earned.

          THE PART NUMBER LEADS, because it is the one identifier this page can always state and the
          one a scan actually resolves today. ND-26: it is `internalPartNumber`, never the document
          key -- `label` falls back to partId only when there is no Part Number at all, and that
          fallback is the caller's existing contract, not a substitution made here. */}
      <p className="ns-ident__line">
        <strong>{label}</strong>
        <span className="fo-muted"> · part number — the identity a scan resolves</span>
      </p>

      {status === "loading" && <p className="fo-muted">Loading identifiers…</p>}

      {/* UNAVAILABLE, not EMPTY. An empty list would assert this Part has no identifiers, which is a
          claim about data this screen has not read. The sentence is unchanged in substance and now
          costs a line rather than a block. */}
      {/* CONCISE VISIBLE SENTENCE + THE GOVERNED CONSTANT BEHIND A DISCLOSURE — Owner ruling B §5.
          PART_IDENTIFIER_UNAVAILABLE_REASON stays exactly as it is and remains authoritative; the
          domain constant is NOT mutated to save pixels. What changed is that the record no longer
          prints all 148 characters of it as permanent page copy.

          THE VISIBLE LINE CARRIES THREE THINGS, all required: alternate identifiers are UNREAD, NOT
          EMPTY; the capability is GOVERNED; and it is UNAVAILABLE IN THIS ENVIRONMENT.

          WHAT THE DISCLOSURE CARRIES, and why it exists at all: the constant's second sentence draws
          a distinction the short line cannot hold without becoming the paragraph it replaced —
          commands that EXIST AND ARE GOVERNED but have been NEITHER DEPLOYED NOR GRANTED. Those are
          two different reasons a capability is off and they resolve differently. Dropping that
          silently was the one thing the ruling forbade, so it is one tap away instead. The mockup
          draws no icon here; the Owner authorised this one as an authority-preserving adaptation. */}
      {status === "unavailable" && (
        <p className="ns-state ns-state--not-enabled" role="status">
          Alternate identifiers are unread, not empty — identifier administration is built and
          governed, and is not available in this environment.
          <PartsInfoDisclosure label="Identifiers — why identifier administration is unavailable">
            {PART_IDENTIFIER_UNAVAILABLE_REASON}
          </PartsInfoDisclosure>
        </p>
      )}

      {status === "denied" && (
        <p className="fo-warning" role="status">
          {message} You can still see this Part; identifier administration is a separate authority.
        </p>
      )}

      {status === "failed" && (
        <p className="fo-inline-error" role="alert">
          {message}{" "}
          <button type="button" className="fo-link-btn" onClick={reload}>
            Retry
          </button>
        </p>
      )}

      {status === "ready" && (
        <>
          {aliases.length === 0 ? (
            // The ONE case that really is an empty list, and it is stated as a fact about this Part
            // rather than about the screen.
            <p className="fo-muted">
              No identifiers are recorded for {label} yet. A scan will not resolve to this part until
              one is added.
            </p>
          ) : (
            <div className="fo-table-scroll">
              <table className="fo-table" aria-label={`Identifiers for ${label}`}>
                <thead>
                  <tr>
                    <th scope="col">Type</th>
                    <th scope="col">Value</th>
                    <th scope="col">Status</th>
                    <th scope="col">Source</th>
                    <th scope="col">
                      <span className="fo-sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {aliases.map((a) => (
                    <IdentifierRow
                      key={a.aliasId}
                      alias={a}
                      pending={pending}
                      onDeactivate={deactivate}
                      onReactivate={reactivate}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {truncated && (
            <p className="fo-warning" role="status">
              Showing the first {limit}. A part with more identifiers than that is a data-quality
              problem rather than a paging one — this list is not complete.
            </p>
          )}

          {outcome && outcome.kind !== "applied" && (
            <StatusLine tone={outcome.kind === "conflict" ? "attention" : "error"}>{outcome.message}</StatusLine>
          )}

          <AddIdentifierForm
            onAdd={addIdentifier}
            onProbe={probe}
            partId={partId}
            busy={!!pending.create}
          />

          {/* THE STANDING STATEMENT, NOW WHERE IT IS EARNED. It explains a rule of the MANAGE
              surface -- why there is no Edit button -- and it stood on every Part record whether or
              not that surface was present, including the environments where identifier
              administration is switched off entirely. A reader who cannot add or deactivate an
              identifier does not need to be told why there is no Edit. It is unchanged, and it is
              now rendered beside the controls it describes. */}
          <p className="fo-muted ns-ident__note">
            There is no edit. An identifier’s identity <em>is</em> its type and value, so changing
            the value makes it a different identifier — deactivate the old one and add the new.
            Nothing is deleted; deactivation preserves the history.
          </p>
        </>
      )}
    </RuledSection>
  );
}
