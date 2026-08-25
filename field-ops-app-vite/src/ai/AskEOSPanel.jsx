import { useMemo, useState } from "react";
import { askEOSRepository } from "./askEOSClient";
import "./askEOS.css";

function readableError(error) {
  const code = error?.code || "";
  if (code.includes("permission-denied")) return "Ask EOS is not available to this account.";
  if (code.includes("failed-precondition")) return error?.message || "Ask EOS is not configured in this environment.";
  if (code.includes("unavailable") || code.includes("deadline-exceeded")) return "Ask EOS is unavailable right now. EOS itself is unaffected.";
  return "Ask EOS could not answer that question. Try again shortly.";
}

function shortSha(value) {
  return typeof value === "string" && value.length > 8 ? value.slice(0, 8) : value || "unknown";
}

export default function AskEOSPanel({ onClose }) {
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const statusText = useMemo(() => {
    if (!result) return null;
    if (result.indexState === "CURRENT") return `Current at ${shortSha(result.indexedCommit)}`;
    if (result.indexState === "STALE") return `Stale index: ${shortSha(result.indexedCommit)} vs ${shortSha(result.sourceCommit)}`;
    return `Index: ${result.indexState || "unknown"}`;
  }, [result]);

  async function submit(event) {
    event.preventDefault();
    const value = question.trim();
    if (!value || busy) return;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      setResult(await askEOSRepository(value, { contextBudget: 4000 }));
    } catch (err) {
      setError(readableError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ask-eos-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className="ask-eos-panel" role="dialog" aria-modal="true" aria-labelledby="ask-eos-title">
        <div className="ask-eos-head">
          <div>
            <h2 id="ask-eos-title">Ask EOS</h2>
            <p>Repository intelligence · read only</p>
          </div>
          <button type="button" className="ask-eos-close" onClick={onClose} aria-label="Close Ask EOS">×</button>
        </div>

        <form onSubmit={submit} className="ask-eos-form">
          <label htmlFor="ask-eos-question">What do you want to know about EOS?</label>
          <textarea
            id="ask-eos-question"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            maxLength={2000}
            rows={4}
            placeholder="Example: How does Cycle Count authority work?"
            disabled={busy}
          />
          <div className="ask-eos-actions">
            <span>{question.length}/2000</span>
            <button type="submit" disabled={busy || !question.trim()}>{busy ? "Asking…" : "Ask EOS"}</button>
          </div>
        </form>

        {busy && <p className="ask-eos-status" role="status">Searching current EOS repository evidence and verifying the answer…</p>}
        {error && <div className="ask-eos-error" role="alert">{error}</div>}

        {result && (
          <div className="ask-eos-result">
            <div className="ask-eos-meta">
              <span className={`ask-eos-index ask-eos-index--${String(result.indexState || "unknown").toLowerCase()}`}>{statusText}</span>
              <span>Model: {result.model || "unknown"}</span>
              <span>Verified: {result.verification?.passed ? "yes" : "no"}</span>
            </div>

            {result.indexState === "STALE" && (
              <div className="ask-eos-warning">This answer was generated from a stale repository index. Treat it as historical until the index is refreshed.</div>
            )}
            {result.verification && !result.verification.passed && (
              <div className="ask-eos-warning">Verification found a problem with this answer. Review the evidence before relying on it.</div>
            )}
            {Array.isArray(result.authorityConflicts) && result.authorityConflicts.length > 0 && (
              <div className="ask-eos-warning">Repository sources disagree on {result.authorityConflicts.length} point(s). Higher-precedence evidence is shown in the citations.</div>
            )}

            <div className="ask-eos-answer">{result.answer}</div>

            <h3>Evidence</h3>
            {Array.isArray(result.citations) && result.citations.length ? (
              <ol className="ask-eos-citations">
                {result.citations.map((citation, index) => (
                  <li key={`${citation.path}-${citation.startLine}-${index}`}>
                    <code>{citation.path}:{citation.startLine}-{citation.endLine}</code>
                    <span>{citation.authorityClass} · {shortSha(citation.commitSha)}</span>
                  </li>
                ))}
              </ol>
            ) : <p className="ask-eos-status">No repository citations were returned.</p>}
          </div>
        )}

        <p className="ask-eos-boundary">V1 answers questions about the EOS repository only. It cannot read customer or operational records and cannot change EOS data.</p>
      </section>
    </div>
  );
}
