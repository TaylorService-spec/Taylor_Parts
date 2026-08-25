import StatusPill from "./StatusPill.jsx";

// THE ENTERPRISE RECORD HEADER (North Star pattern 1).
//
// ════════════════════ WHAT THE CONCEPT SPECIFIES ════════════════════
//
// From the pilot report, verbatim: "Kicker (object type · governed reference), a serif title, status
// in words, owner, and the 3–5 facts that identify the record. Use on every detail page. Don't use
// on index/workspace pages (they get a workspace header)." That last sentence is why this is not
// WorkspaceHeader with different props — the two are different patterns with different jobs, and
// collapsing them is how a record page starts looking like a list.
//
// ════════════════════ THE REFERENCE IS THE TITLE ════════════════════
//
// The governed reference is the page's single h1 (Grammar R02). Not the customer name, not the
// complaint — the reference, because it is the thing a person says out loud on the phone and types
// into a search box.
//
// A record with no governed reference renders the truthful generic name instead. It NEVER falls back
// to the document id: DECISIONS #106 has no escape clause, and "a missing name is not permission to
// display a record id" is the invariant this product is strongest at. The id is not even accepted as
// a prop, so a caller cannot pass one by mistake.
//
// ════════════════════ STATUS IN WORDS ════════════════════
//
// `statusWords` is a rendered sentence fragment supplied by the caller's domain layer, never an enum
// this component prettifies. A component that formats status has become a second derivation of it
// (NS-P4), and the two will disagree the first time one of them is updated.
export default function RecordIdentity({
  kicker,
  reference,
  fallbackName,
  statusWords = null,
  statusTone = "neutral",
  facts = [],
  actions = null,
}) {
  const title = reference ?? fallbackName;
  const shown = facts.filter((f) => f && f.value != null && f.value !== "");

  return (
    <header className="ns-identity">
      <div className="ns-identity__main">
        {kicker ? <p className="ns-identity__kicker">{kicker}</p> : null}
        <h1 className="ns-identity__title">{title}</h1>
        <div className="ns-identity__facts">
          {statusWords ? (
            <StatusPill tone={statusTone}>{statusWords}</StatusPill>
          ) : (
            // An unrecognised status is stated, not hidden. A blank where the state belongs reads as
            // "no state", which is never true of a governed record.
            <span className="ns-identity__unknown">State not recognised</span>
          )}
          {shown.map((f) => (
            <span className="ns-identity__fact" key={f.key ?? f.label}>
              {f.label ? <span className="ns-identity__fact-label">{f.label}</span> : null}
              <span className="ns-identity__fact-value">{f.value}</span>
            </span>
          ))}
        </div>
      </div>
      {actions ? <div className="ns-identity__actions">{actions}</div> : null}
    </header>
  );
}
