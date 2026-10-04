// SITE-WIDE SEARCH — one box in the application header, under EOS authority only (Application Assembly, DECISIONS #209).
//
// The browser sends the words; the SERVER (/operations/workspace searchEos) decides which record kinds this person may search,
// each on its own EXISTING read and scope (sales channel, Reorder queue reach), and says which kinds it did NOT search and why.
// A result is a link to the record's own governed page, which re-checks the read. No Firebase, no AI, no client-side index.
import { useId, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "../../shared/ui/primitives";
import { callWorkspaceApi } from "../../services/workspaceApiClient";

export default function SiteSearch({ callApi = callWorkspaceApi }) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [result, setResult] = useState(null);
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    const q = query.trim();
    if (q.length < 2) { setResult(null); setMessage("Type at least two characters."); return; }
    setBusy(true);
    const res = await callApi("searchEos", { query: q });
    setBusy(false);
    if (!res.ok) { setResult(null); setMessage(res.message ?? "Search could not be run."); return; }
    setMessage(null);
    setResult(res.result);
  };
  const close = () => { setResult(null); setMessage(null); };

  return (
    <div className="fo-sitesearch" role="search">
      <form onSubmit={submit}>
        <label htmlFor={`${id}-q`} className="fo-visually-hidden">Search EOS</label>
        <input id={`${id}-q`} className="fo-input" type="search" placeholder="Search work orders, customers, parts, people…" value={query}
          maxLength={100} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") close(); }} />
        <Button type="submit" size="sm" variant="secondary" disabled={busy}>Search</Button>
      </form>
      {(result || message) && (
        <div className="fo-sitesearch__results" aria-live="polite">
          {message && <p className="fo-muted">{message}</p>}
          {result && (result.results.length === 0
            ? <p className="fo-muted">No record you can read matches “{result.query}”.</p>
            : (
              <ul>
                {result.results.map((r) => (
                  <li key={`${r.kind}-${r.id}`}>
                    <span className="fo-muted">{r.kindLabel}</span>{" "}
                    {r.path ? <Link to={r.path} onClick={close}>{r.label}</Link> : r.label}
                    {r.detail ? <span className="fo-muted"> · {r.detail}</span> : null}
                  </li>
                ))}
              </ul>
            ))}
          {result?.notSearched?.length > 0 && (
            <p className="fo-muted">Not searched with your access: {(result.notSearchedLabels ?? result.notSearched).join(", ")}.</p>
          )}
          <Button type="button" size="sm" variant="secondary" onClick={close}>Close</Button>
        </div>
      )}
    </div>
  );
}
