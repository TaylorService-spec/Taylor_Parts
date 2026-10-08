import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocationsForAccounts } from "../../hooks/useLocationsForAccounts";
import {
  rankCustomerMatches,
  customerSecondaryLine,
  summarizeLocations,
  customerPickerStatus,
  customerLocationState,
  LOCATIONS_ERROR_LINE,
} from "../../domain/customerSearch";
import { accountStatusTone } from "../../domain/accountPortfolio";
import StatusPill from "../../shared/ui/StatusPill.jsx";
import { Button } from "../../shared/ui/primitives";
import { useSettledQuery } from "../../hooks/useTypeahead.js";
import { accountRowFromCrm, callCrmApi } from "../../services/crmApiClient.js";

// GOVERNED SERVER SEARCH (UI corrections integration, 2026-10-08): the picker asks CRM listAccounts { search } -- name or
// customer number CONTAINS the query, inside the caller's tenant, under customer.record.read -- so every customer can be
// found, not only the first 200 a preloaded page held. The server decides what is returned; this ranks what came back.
export async function searchCustomersOnServer(query, { limit = RESULT_LIMIT + 1, call = callCrmApi } = {}) {
  const res = await call("listAccounts", { search: query, limit });
  if (!res?.ok) return { ok: false, code: res?.code, message: res?.message };
  return { ok: true, items: (res.result?.items ?? []).map(accountRowFromCrm), more: Boolean(res.result?.nextCursor) };
}
import { statusLabel } from "../../shared/display/displayLabels.js";

// Work Order wizard, Step 1 -- accessible Customer picker. Replaces the generic
// Global Search box with a combobox whose results are unambiguous: each shows
// the resolved name, status, a safe secondary line (billing city/state, else
// external customer number -- never a raw id), and the customer's locations
// (name + city/state, with "No locations"/"+N more locations"). Two identically
// named customers are told apart by that billing + location context.
//
// It filters the ALREADY-LOADED accounts client-side (no per-keystroke read),
// then fetches locations for ONLY the bounded visible candidates in ONE batched
// query (useLocationsForAccounts -> `accountId in [...]`). The dropdown is never
// blank: it shows "Searching customers…", "No customers found", or results.
// Selection hands the chosen account to the caller, which continues into the
// existing Step 2 Location workflow unchanged.
//
// TYPEAHEAD STANDARD (UI corrections item E, 2026-10-08): results begin at 2 characters and settle 250 ms after the
// last keystroke (useSettledQuery, the shared typeahead's own constants), so the batched location read runs once per
// settled query instead of once per keystroke.

const RESULT_LIMIT = 8;
const LOCATIONS_SHOWN = 2;

export default function CustomerPicker({ accounts = null, search = searchCustomersOnServer, onSelect, inputId }) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const generatedId = useId();
  const boxId = inputId ?? `${generatedId}-input`;
  const listboxId = `${generatedId}-listbox`;
  const optionId = (i) => `${generatedId}-opt-${i}`;

  const settled = useSettledQuery(query);
  // Server mode (the default): the settled query is sent to the governed search; only the LATEST answer is kept.
  const [served, setServed] = useState({ forQuery: "", items: [], more: false, failed: null });
  const seq = useRef(0);
  useEffect(() => {
    if (accounts || !settled) return undefined;
    seq.current += 1;
    const mine = seq.current;
    let alive = true;
    search(settled).then((res) => {
      if (!alive || mine !== seq.current) return; // a newer query owns the list
      setServed(res.ok ? { forQuery: settled, items: res.items, more: res.more, failed: null } : { forQuery: settled, items: [], more: false, failed: res });
    });
    return () => { alive = false; };
  }, [accounts, settled, search]);
  const pool = accounts ?? (served.forQuery === settled ? served.items : []);
  const ranked = useMemo(() => (settled ? rankCustomerMatches(pool, settled, RESULT_LIMIT) : { results: [], total: 0 }), [pool, settled]);
  const results = ranked.results;
  const total = accounts ? ranked.total : ranked.total + (served.more && served.forQuery === settled ? 1 : 0);
  const candidateIds = useMemo(() => results.map((a) => a.id), [results]);
  const { byAccount, loading: locLoading, error: locError, retry } = useLocationsForAccounts(candidateIds);

  const trimmed = query.trim();
  const open = trimmed.length > 0;
  // Typing but not yet 2 characters, or not yet settled: say so rather than "No customers found".
  const pendingQuery = open && (settled !== trimmed || (!accounts && served.forQuery !== settled));

  const containerRef = useRef(null);
  const listRef = useRef(null);
  const [dropUp, setDropUp] = useState(false);
  // Space (px) available for the dropdown below (or, when flipped, above) the
  // input. Written to a CSS custom property so the dropdown's max-height is the
  // MIN of a bounded clamp()/dvh rule and this measured space -- so the panel
  // stays natural height, the dropdown never leaves the viewport, and only the
  // result list scrolls. Recomputed on open, viewport resize, and page scroll.
  const [space, setSpace] = useState(null);

  useLayoutEffect(() => {
    if (!open) return undefined;
    const compute = () => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect(); // the input's box (dropdown is absolute)
      const margin = 8;
      const below = window.innerHeight - rect.bottom - margin;
      const above = rect.top - margin;
      // Flip up only when there is genuinely little room below AND more above.
      const up = below < 200 && above > below;
      setDropUp(up);
      setSpace(Math.max(140, Math.floor(up ? above : below)));
    };
    compute();
    window.addEventListener("resize", compute);
    window.addEventListener("scroll", compute, true);
    return () => {
      window.removeEventListener("resize", compute);
      window.removeEventListener("scroll", compute, true);
    };
  }, [open, results.length]);

  // Reset the active option whenever the result set changes.
  useEffect(() => {
    setActiveIndex(-1);
  }, [query]);

  // Keyboard navigation scrolls the active option into view WITHIN the result
  // list (block:"nearest" -> scrolls the list, never the page).
  useEffect(() => {
    if (activeIndex < 0) return;
    listRef.current?.children?.[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  // Never-blank status: exactly one distinct state (loading / query-error /
  // no-results / results) while the combobox is open.
  const statusMessage = !accounts && served.failed && served.forQuery === settled
    ? (served.failed.code === "FORBIDDEN" ? "Searching customers is not available to you." : "Customers could not be searched. Try again.")
    : trimmed.length > 0 && trimmed.length < 2 ? "Type at least 2 characters."
    : pendingQuery ? "Searching customers…"
    : customerPickerStatus({ open, locLoading, locError, resultCount: results.length });

  function choose(account) {
    if (account) onSelect?.(account);
  }

  function onKeyDown(e) {
    if (!open || results.length === 0) {
      if (e.key === "Escape") { setQuery(""); setActiveIndex(-1); }
      return;
    }
    const max = results.length;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % max);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + max) % max);
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(results[activeIndex >= 0 ? activeIndex : 0]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setQuery("");
      setActiveIndex(-1);
    }
  }

  return (
    <div className="fo-customer-picker" ref={containerRef}>
      <input
        id={boxId}
        type="text"
        role="combobox"
        className="fo-customer-picker-input fo-wizard-control"
        placeholder="Search customers by name or number..."
        autoComplete="off"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={open && activeIndex >= 0 ? optionId(activeIndex) : undefined}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
      />

      {open && (
        <div
          className={`fo-customer-picker-dropdown${dropUp ? " fo-customer-picker-dropdown-up" : ""}`}
          style={space != null ? { "--fo-picker-space": `${space}px` } : undefined}
        >
          {/* Never blank: exactly one distinct state (incl. a fail-closed query
              error) with an explicit Retry -- never stuck on "Searching…". */}
          <div className="fo-customer-picker-status" role="status" aria-live="polite">
            <span>{statusMessage}</span>
            {locError && (
              <Button variant="tertiary" className="fo-link-btn fo-customer-picker-retry" onClick={retry}>
                Retry
              </Button>
            )}
          </div>

          {results.length > 0 && (
            <ul className="fo-customer-picker-list" role="listbox" id={listboxId} aria-label="Customer results" ref={listRef}>
              {results.map((account, i) => {
                const secondary = customerSecondaryLine(account);
                const locs = summarizeLocations(byAccount.get(account.id) ?? [], LOCATIONS_SHOWN);
                const locState = customerLocationState({ locLoading, locError, total: locs.total });
                return (
                  <li
                    key={account.id}
                    id={optionId(i)}
                    role="option"
                    aria-selected={i === activeIndex}
                    className={`fo-customer-picker-option${i === activeIndex ? " fo-customer-picker-option-active" : ""}`}
                    onMouseEnter={() => setActiveIndex(i)}
                    onMouseDown={(e) => { e.preventDefault(); choose(account); }}
                  >
                    <div className="fo-customer-picker-name">{account.name}</div>
                    <div className="fo-customer-picker-meta">
                      {account.status && (
                        <StatusPill tone={accountStatusTone(account.status)} label={statusLabel(account.status)} />
                      )}
                      {secondary && <span className="fo-customer-picker-secondary">{secondary}</span>}
                    </div>
                    <div className="fo-customer-picker-locs">
                      {locState === "loading" ? (
                        <span className="fo-muted">Searching customers…</span>
                      ) : locState === "error" ? (
                        <span className="fo-muted fo-customer-picker-loc-error">{LOCATIONS_ERROR_LINE}</span>
                      ) : locState === "none" ? (
                        <span className="fo-muted">No locations</span>
                      ) : (
                        <>
                          {locs.shown.map((l, j) => (
                            <span key={j} className="fo-customer-picker-loc">
                              {l.name}{l.cityState ? ` — ${l.cityState}` : ""}
                            </span>
                          ))}
                          {locs.moreCount > 0 && (
                            <span className="fo-muted fo-customer-picker-more-locs">
                              +{locs.moreCount} more location{locs.moreCount === 1 ? "" : "s"}
                            </span>
                          )}
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {!accounts && served.more && served.forQuery === settled ? (
            <div className="fo-customer-picker-more">More customers match — keep typing to narrow the list</div>
          ) : total > results.length && (
            <div className="fo-customer-picker-more">
              +{total - results.length} more result{total - results.length === 1 ? "" : "s"} — refine your search
            </div>
          )}
        </div>
      )}
    </div>
  );
}
