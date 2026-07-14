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

const RESULT_LIMIT = 8;
const LOCATIONS_SHOWN = 2;

export default function CustomerPicker({ accounts = [], onSelect, inputId }) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const generatedId = useId();
  const boxId = inputId ?? `${generatedId}-input`;
  const listboxId = `${generatedId}-listbox`;
  const optionId = (i) => `${generatedId}-opt-${i}`;

  const { results, total } = useMemo(() => rankCustomerMatches(accounts, query, RESULT_LIMIT), [accounts, query]);
  const candidateIds = useMemo(() => results.map((a) => a.id), [results]);
  const { byAccount, loading: locLoading, error: locError, retry } = useLocationsForAccounts(candidateIds);

  const trimmed = query.trim();
  const open = trimmed.length > 0;

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
  const statusMessage = customerPickerStatus({ open, locLoading, locError, resultCount: results.length });

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
              <button type="button" className="fo-link-btn fo-customer-picker-retry" onClick={retry}>
                Retry
              </button>
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
                        <span className={`fo-badge fo-badge-${account.status.toLowerCase()}`}>{account.status}</span>
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

          {total > results.length && (
            <div className="fo-customer-picker-more">
              +{total - results.length} more result{total - results.length === 1 ? "" : "s"} — refine your search
            </div>
          )}
        </div>
      )}
    </div>
  );
}
