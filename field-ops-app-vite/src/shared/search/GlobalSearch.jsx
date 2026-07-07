import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { SEARCH_PROVIDERS } from "./searchProviders";

// Sprint 2.0.2 -- reusable search component, provider-pattern per the
// approved design. AccountsList.jsx's search bar IS this component
// (providerKeys={["accounts"]}), not a separately hand-rolled <input> +
// debounce -- the whole point of building this now instead of a local
// search box. Same 250ms debounce timing as DispatcherBoard.jsx's
// existing search, just relocated into a shared component instead of
// duplicated per screen.
export default function GlobalSearch({ providerKeys, context, placeholder = "Search..." }) {
  const navigate = useNavigate();
  const [input, setInput] = useState("");
  const [debounced, setDebounced] = useState("");
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(input.trim()), 250);
    return () => clearTimeout(timer);
  }, [input]);

  const results = useMemo(() => {
    if (!debounced) return [];
    return providerKeys.flatMap((key) => SEARCH_PROVIDERS[key]?.search(debounced, context) ?? []).slice(0, 20);
  }, [debounced, providerKeys, context]);

  function handleSelect(result) {
    setInput("");
    setDebounced("");
    setIsFocused(false);
    navigate(result.route);
  }

  return (
    <div className="fo-global-search">
      <input
        type="text"
        placeholder={placeholder}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setTimeout(() => setIsFocused(false), 150)}
        aria-label={placeholder}
      />
      {isFocused && debounced && (
        <div className="fo-global-search-results">
          {results.length === 0 ? (
            <div className="fo-muted fo-global-search-empty">No matches for "{debounced}"</div>
          ) : (
            results.map((result) => (
              <button
                type="button"
                key={`${result.entityType}-${result.id}`}
                className="fo-global-search-result"
                onClick={() => handleSelect(result)}
              >
                <span>{result.primaryText}</span>
                {result.secondaryText && <span className="fo-muted"> -- {result.secondaryText}</span>}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
