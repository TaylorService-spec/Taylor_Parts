import { useEffect, useState } from "react";
import { useDebouncedValue } from "../../../hooks/useDebouncedValue";

// Debounced per this phase's architectural requirement -- onDebouncedChange
// fires only after typing pauses for 250ms, not on every keystroke.
// Extensibility (searching more fields later) lives entirely in
// searchConfig.js; this component only owns the raw text input + the
// debounce itself.
export default function SearchBox({ onDebouncedChange, placeholder }) {
  const [raw, setRaw] = useState("");
  const debounced = useDebouncedValue(raw, 250);

  useEffect(() => {
    onDebouncedChange(debounced);
  }, [debounced, onDebouncedChange]);

  return (
    <input
      type="search"
      className="fo-search-box"
      placeholder={placeholder ?? "Search WO #, customer, location, technician…"}
      value={raw}
      onChange={(e) => setRaw(e.target.value)}
    />
  );
}
