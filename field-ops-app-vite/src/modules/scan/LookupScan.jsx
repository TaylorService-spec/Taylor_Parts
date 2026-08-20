import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "../../shared/ui/primitives/index.js";
import { fetchPartMasterList } from "../../services/partMasterQueries";
import {
  buildPartLookup,
  describePartLookup,
  LOOKUP_STATE,
  FIELD_STATE,
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
// ============================ WHY IT DOES NOT PRE-CHECK ACCESS ============================
//
// `parts` is governed by firestore.rules, not by a capability, so there is nothing to consult that
// would honestly predict whether this caller may read it. Rather than reimplement the Rules
// predicate client-side — a second copy that can drift and lie in both directions — the read is
// attempted and its refusal is displayed AS a refusal. See access/scanWorkflows.js.

export default function LookupScan({ deps }) {
  const readCatalog = deps?.fetchParts ?? fetchPartMasterList;

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
    let catalogResult;
    try {
      catalogResult = await readCatalog();
    } catch {
      // A THROWN read is a failed read, never an empty catalog. Collapsing it into "no match" would
      // tell an operator a part does not exist because the network was down.
      catalogResult = { ok: false, code: "unavailable" };
    }
    if (!alive.current) return;
    setResult(buildPartLookup({ catalogResult, token }));
    setLoading(false);
  }, [readCatalog]);

  return (
    <div className="fo-lookup">
      <form
        className="fo-scan__entry"
        onSubmit={(e) => { e.preventDefault(); look(query); }}
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Scan or type a part code"
          aria-label="Part code"
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
 * READ_FAILED and RESOLVED are eight different situations and are never collapsed — in particular
 * a refusal is never rendered as an absence, and a failed read is never rendered as a result.
 */
function LookupResult({ loading, result }) {
  if (loading) return <p className="fo-muted" role="status">Looking that up…</p>;

  switch (result.state) {
    case LOOKUP_STATE.IDLE:
      return (
        <p className="fo-muted">
          Scan a part label or type a part code. You will see what the part is — this does not change
          anything.
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

    case LOOKUP_STATE.AMBIGUOUS:
      return (
        <div className="fo-scan__state" role="status">
          <p>{result.message}</p>
          <ul>
            {result.candidates.map((c) => (
              <li key={`${c.entityType}:${c.entityId}`}>
                {c.entityType.replace("_", " ").toLowerCase()} · {c.entityId}
              </li>
            ))}
          </ul>
        </div>
      );

    case LOOKUP_STATE.RESOLVED:
      return <ResolvedPart part={result.part} rows={result.rows} />;

    default:
      return null;
  }
}

function ResolvedPart({ part, rows }) {
  const shown = rows?.length ? rows : describePartLookup(part);
  return (
    <section className="fo-scan__result" aria-label={`Part ${part.internalPartNumber}`}>
      <p className="fo-scan__kind">Part</p>
      <h3 className="fo-scan__id">{part.name}</h3>
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
