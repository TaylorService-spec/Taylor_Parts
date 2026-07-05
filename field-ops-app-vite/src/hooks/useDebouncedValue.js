import { useEffect, useState } from "react";

// Generic debounce -- returns `value` after it's stayed unchanged for
// `delayMs`. Not Work-Order-specific; lives in hooks/ alongside the
// other generic hooks so a future search/filter elsewhere can reuse it
// instead of writing a second debounce implementation.
export function useDebouncedValue(value, delayMs = 250) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
