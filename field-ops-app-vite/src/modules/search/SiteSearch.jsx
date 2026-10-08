// SITE-WIDE SEARCH — one box in the application header, under EOS authority only (Application Assembly, DECISIONS #209).
//
// The browser sends the words; the SERVER (/operations/workspace searchEos) decides which record kinds this person may search,
// each on its own EXISTING read and scope (sales channel, operating company, Reorder queue reach), and says which kinds it did
// NOT search and why. A result is a link to the record's own governed page, which re-checks the read. No Firebase, no AI, no
// client-side index.
//
// TYPEAHEAD (UI corrections package item E, 2026-10-08): suggestions appear after 2 characters and 250 ms through the shared
// Autocomplete (stale answers are dropped). Choosing a suggestion opens its record; Enter, the Search button or "View All
// Results" runs the same search and shows every result with what was not searched.
import { useCallback, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "../../shared/ui/primitives";
import Autocomplete from "../../shared/ui/Autocomplete.jsx";
import { callWorkspaceApi } from "../../services/workspaceApiClient";
import { titleCase } from "../../shared/display/displayLabels.js";

// The server's detail line carries stored enum words (ACTIVE, IN_PROGRESS); show them as words, keep everything else as sent.
const detailWords = (detail) => (detail ? String(detail).replace(/\b[A-Z][A-Z_]{2,}\b/g, (w) => titleCase(w)) : null);

export default function SiteSearch({ callApi = callWorkspaceApi }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [result, setResult] = useState(null);
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);

  const suggest = useCallback(async (q) => {
    const res = await callApi("searchEos", { query: q });
    if (!res.ok) return { ok: false, code: res.code, message: res.message };
    return { ok: true, items: res.result.results, total: res.result.results.length };
  }, [callApi]);

  const runAll = async (raw) => {
    const q = (raw ?? query).trim();
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
      <form onSubmit={(e) => { e.preventDefault(); runAll(); }}>
        <Autocomplete
          label="Search EOS"
          hideLabel
          placeholder="Search work orders, customers, parts, people…"
          search={suggest}
          getKey={(r) => `${r.kind}-${r.id}`}
          getLabel={(r) => r.label}
          getContext={(r) => [r.kindLabel, detailWords(r.detail)].filter(Boolean).join(" · ")}
          onSelect={(r) => { if (r?.path) { close(); navigate(r.path); } }}
          onViewAll={(q) => runAll(q)}
          onQueryChange={setQuery}
          inputProps={{ maxLength: 100, onKeyUp: (e) => { if (e.key === "Escape") close(); } }}
        />
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
                    {r.detail ? <span className="fo-muted"> · {detailWords(r.detail)}</span> : null}
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
