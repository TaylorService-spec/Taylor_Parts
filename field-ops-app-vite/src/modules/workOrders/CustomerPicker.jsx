import { useEffect, useId, useMemo, useState } from "react";
import { useLocationsForAccounts } from "../../hooks/useLocationsForAccounts";
import {
  rankCustomerMatches,
  customerSecondaryLine,
  summarizeLocations,
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
  const { byAccount, loading: locLoading } = useLocationsForAccounts(candidateIds);

  const trimmed = query.trim();
  const open = trimmed.length > 0;

  // Reset the active option whenever the result set changes.
  useEffect(() => {
    setActiveIndex(-1);
  }, [query]);

  // Never-blank status: exactly one of the three states while typing.
  let statusMessage = "";
  if (open) {
    if (locLoading) statusMessage = "Searching customers…";
    else if (results.length === 0) statusMessage = "No customers found";
    else statusMessage = `${results.length} customer${results.length === 1 ? "" : "s"} found`;
  }

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
    <div className="fo-customer-picker">
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
        <div className="fo-customer-picker-dropdown">
          {/* Never blank: this status line is always one of the three states. */}
          <div className="fo-customer-picker-status" role="status" aria-live="polite">
            {statusMessage}
          </div>

          {results.length > 0 && (
            <ul className="fo-customer-picker-list" role="listbox" id={listboxId} aria-label="Customer results">
              {results.map((account, i) => {
                const secondary = customerSecondaryLine(account);
                const locs = locLoading ? null : summarizeLocations(byAccount.get(account.id) ?? [], LOCATIONS_SHOWN);
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
                      {locs === null ? (
                        <span className="fo-muted">Searching customers…</span>
                      ) : locs.total === 0 ? (
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
