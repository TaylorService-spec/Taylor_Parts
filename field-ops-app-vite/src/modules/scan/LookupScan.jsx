import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "../../shared/ui/primitives/index.js";
import { fetchPartMasterList } from "../../services/partMasterQueries";
import { resolveScannedIdentifier } from "../../services/partAliasCallableClient.js";
import {
  buildPartLookup,
  describePartLookup,
  LOOKUP_STATE,
  FIELD_STATE,
  MATCHED_BY,
  ALIAS_TYPE_LABEL,
} from "../../domain/partLookup.js";

// LOOKUP-ONLY SCANNING.
//
// Scan or type a code, and be told what it is. That is the entire surface.
//
// ============================ IT MOVES NOTHING ============================
//
// There is no quantity input, no submit, no command import and no writer anywhere in this file or
// anything it imports. `fetchPartMasterList` is a one-shot READ. The absence is enforced by a test
// that inspects the imports rather than trusting this comment.
//
// ============================ ONE READ, REUSED ============================
//
// The catalog read is the same governed `parts` read PartsList, PartDetail, Receiving and the Work
// Order plan editor use. Identity resolution is the existing `resolveScannedIdentity` over the
// existing `buildScanCandidates` CATALOG scope. All of the decision-making lives in the pure
// domain/partLookup.js; this component owns the read, the input and the states.
//
// ============================ TWO QUESTIONS, ONE ANSWER (Phase G) ============================
//
// A scanned value can be a Part's own code OR a registered identifier (barcode, UPC, supplier SKU,
// manufacturer part number) that points at one. Both are asked in parallel, and domain/partLookup.js
// combines them — including refusing to answer when they DISAGREE.
//
// Identifier resolution is the existing alias transport (partAliasCallableClient), which is gated
// server-side on `inventory.catalog.alias.read` and fails closed behind
// PART_IDENTIFIER_TRANSPORT_READY. While that constant is false the callable is never invoked and
// the screen says identifier lookup is not switched on — rather than reporting "no match" for a
// barcode it never actually checked.
//
// ============================ WHY IT DOES NOT PRE-CHECK ACCESS ============================
//
// `parts` is governed by firestore.rules, not by a capability, so there is nothing to consult that
// would honestly predict whether this caller may read it. Rather than reimplement the Rules
// predicate client-side — a second copy that can drift and lie in both directions — the read is
// attempted and its refusal is displayed AS a refusal. See access/scanWorkflows.js.

export default function LookupScan({ deps }) {
  const readCatalog = deps?.fetchParts ?? fetchPartMasterList;
  const resolveIdentifier = deps?.resolveIdentifier ?? resolveScannedIdentifier;

  const [query, setQuery] = useState("");
  const [result, setResult] = useState({ state: LOOKUP_STATE.IDLE, token: "", rows: [], candidates: [], message: null, part: null });
  const [loading, setLoading] = useState(false);

  // The catalog is read once per lookup rather than cached across them, because a cached catalog can
  // go stale in a way the operator cannot see and this screen's whole value is being current.
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const look = useCallback(async (raw) => {
    const token = typeof raw === "string" ? raw.trim() : "";
    if (!token) {
      setResult({ state: LOOKUP_STATE.IDLE, token: "", rows: [], candidates: [], message: null, part: null });
      return;
    }
    setLoading(true);

    // Both questions in parallel. The identifier transport never throws by contract, but it is
    // guarded anyway so one half cannot take down the other: a failed identifier lookup must not
    // cost the operator a part-code answer that was available.
    const [catalogResult, aliasOutcome] = await Promise.all([
      readCatalog().catch(() => (
        // A THROWN read is a failed read, never an empty catalog. Collapsing it into "no match"
        // would tell an operator a part does not exist because the network was down.
        { ok: false, code: "unavailable" }
      )),
      Promise.resolve()
        .then(() => resolveIdentifier({ rawValue: token }))
        .catch(() => ({ errorStatus: "internal", errorDetail: null })),
    ]);

    if (!alive.current) return;
    setResult(buildPartLookup({ catalogResult, aliasOutcome, token }));
    setLoading(false);
  }, [readCatalog, resolveIdentifier]);

  return (
    <div className="fo-lookup">
      <form
        className="fo-scan__entry"
        onSubmit={(e) => { e.preventDefault(); look(query); }}
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Scan or type a part code or barcode"
          aria-label="Part code or barcode"
          enterKeyHint="search"
          autoFocus
        />
        <Button type="submit" className="fo-scan__find">Look up</Button>
      </form>

      <p className="fo-lookup__assurance fo-muted">
        Lookup reads only. Nothing here moves, counts or changes stock.
      </p>

      <LookupResult loading={loading} result={result} />
    </div>
  );
}

/**
 * Every outcome gets its own words. LOADING, IDLE, INVALID, NOT_FOUND, AMBIGUOUS, DENIED,
 * READ_FAILED, RESOLVED and the four identifier outcomes (ALIAS_INACTIVE, ALIAS_DENIED,
 * ALIAS_UNAVAILABLE, ALIAS_PART_UNREADABLE) plus CONFLICT are thirteen different situations, and
 * none is collapsed into another — in particular a refusal is never rendered as an absence, a
 * failed read is never rendered as a result, and an identifier that could not be CHECKED is never
 * rendered as an identifier that does not EXIST.
 */
function LookupResult({ loading, result }) {
  if (loading) return <p className="fo-muted" role="status">Looking that up…</p>;

  switch (result.state) {
    case LOOKUP_STATE.IDLE:
      return (
        <p className="fo-muted">
          Scan a part label or barcode, or type a part code. You will see what the part is — this
          does not change anything.
        </p>
      );

    case LOOKUP_STATE.DENIED:
      // role="alert": a refusal is the one outcome a user must not miss, because the next step is
      // asking someone for access rather than trying again.
      return <p className="fo-scan__state fo-scan__state--denied" role="alert">{result.message}</p>;

    case LOOKUP_STATE.READ_FAILED:
      return <p className="fo-scan__state fo-scan__state--denied" role="alert">{result.message}</p>;

    case LOOKUP_STATE.INVALID:
    case LOOKUP_STATE.NOT_FOUND:
      return <p className="fo-scan__state" role="status">{result.message}</p>;

    // ── Phase G ────────────────────────────────────────────────────────────────────────────────
    //
    // Each of these is a DIFFERENT problem with a different fix, so each gets its own words and its
    // own urgency. None of them is worded as "no such part": three of them are situations in which
    // the part may very well exist.

    case LOOKUP_STATE.ALIAS_DENIED:
      // A refusal, like DENIED — the next step is asking someone for access, not trying again.
      return <p className="fo-scan__state fo-scan__state--denied" role="alert">{result.message}</p>;

    case LOOKUP_STATE.ALIAS_UNAVAILABLE:
      // Not a refusal and not an absence: half the search could not run. Status, not alert.
      return <p className="fo-scan__state" role="status">{result.message}</p>;

    case LOOKUP_STATE.ALIAS_INACTIVE:
    case LOOKUP_STATE.ALIAS_PART_UNREADABLE:
      return (
        <div className="fo-scan__state" role="status">
          <p>{result.message}</p>
          <CandidateList candidates={result.candidates} />
        </div>
      );

    case LOOKUP_STATE.CONFLICT:
      // Genuinely wrong data, and the operator is about to act on it. Alert.
      return (
        <div className="fo-scan__state fo-scan__state--denied" role="alert">
          <p>{result.message}</p>
          <CandidateList candidates={result.candidates} />
        </div>
      );

    case LOOKUP_STATE.AMBIGUOUS:
      return (
        <div className="fo-scan__state" role="status">
          <p>{result.message}</p>
          <CandidateList candidates={result.candidates} />
        </div>
      );

    case LOOKUP_STATE.RESOLVED:
      return (
        <ResolvedPart
          part={result.part}
          rows={result.rows}
          matchedBy={result.matchedBy}
          matchedIdentifier={result.matchedIdentifier}
        />
      );

    default:
      return null;
  }
}

/** The parts a scan could not choose between. Never rendered as a pick. */
function CandidateList({ candidates }) {
  if (!candidates?.length) return null;
  return (
    <ul>
      {candidates.map((c) => (
        <li key={`${c.entityType}:${c.entityId}`}>
          {c.entityType.replace("_", " ").toLowerCase()} · {c.entityId}
        </li>
      ))}
    </ul>
  );
}

function ResolvedPart({ part, rows, matchedBy, matchedIdentifier }) {
  const shown = rows?.length ? rows : describePartLookup(part);
  return (
    <section className="fo-scan__result" aria-label={`Part ${part.internalPartNumber}`}>
      <p className="fo-scan__kind">Part</p>
      <h3 className="fo-scan__id">{part.name}</h3>
      {/* WHICH identifier matched, when it was not the part's own code. Without this, a barcode
          registered against the wrong part looks exactly like a correct scan. */}
      {matchedBy === MATCHED_BY.IDENTIFIER && (
        <p className="fo-lookup__matched">
          Matched a registered {ALIAS_TYPE_LABEL[matchedIdentifier?.aliasType] ?? "identifier"}, not
          this part&rsquo;s own code.
        </p>
      )}
      <dl className="fo-lookup__fields">
        {shown.map((row) => (
          <div key={row.label} className="fo-lookup__row">
            <dt>{row.label}</dt>
            <dd className={row.state === FIELD_STATE.KNOWN ? undefined : "fo-lookup__absent"}>
              {row.state === FIELD_STATE.KNOWN ? row.value : <UnknownValue row={row} />}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/**
 * A field with no value SAYS SO, and says which kind of nothing it is.
 *
 * "Unknown" is first-class: it is never rendered as a dash, an empty cell, a zero, or "none". A
 * blank cell in a warehouse is read as "there are none of these", which is a claim this screen has
 * no authority to make.
 */
function UnknownValue({ row }) {
  const word =
    row.state === FIELD_STATE.CAPABILITY_INACTIVE ? "Not switched on"
      : row.state === FIELD_STATE.NO_GOVERNED_READ ? "Not available yet"
        : "Unknown";
  return (
    <>
      <span className="fo-lookup__absent-word">{word}</span>
      {row.detail ? <span className="fo-lookup__absent-why"> — {row.detail}</span> : null}
    </>
  );
}
