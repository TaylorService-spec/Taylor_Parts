import { useMemo, useState } from "react";
import { periodRequestFields, validateCustomRange, periodLabel, DEFAULT_PERIOD_KEY } from "../domain/financialsPeriod.js";

// Period selection state for one Financials surface. Holds the selection, hands the control its
// props, and hands the read its request fields — so a page adds a working period filter in two
// lines and no page reimplements calendar boundaries.
//
// `requestFields` is EMPTY while a custom range is invalid, and `blocked` says so. The page must
// not issue a read in that state: a backwards window returns a correct empty result that reads to
// the user as "no records" when the truth is "that range is backwards".
export function useFinancialsPeriod() {
  const [presetKey, setPresetKey] = useState(DEFAULT_PERIOD_KEY);
  const [custom, setCustom] = useState({ from: "", to: "" });

  // `now` is captured once per selection rather than per render, so a preset window cannot shift
  // underneath a result the user is reading.
  const validation = presetKey === "custom" ? validateCustomRange(custom) : { valid: true };
  const blocked = presetKey === "custom" && !validation.valid;

  const requestFields = useMemo(
    () => (blocked ? {} : periodRequestFields(presetKey, custom, Date.now())),
    [presetKey, custom, blocked],
  );

  return {
    presetKey,
    custom,
    blocked,
    requestFields,
    label: periodLabel(presetKey, custom),
    controlProps: {
      presetKey,
      onPresetChange: setPresetKey,
      custom,
      onCustomChange: setCustom,
      invalidReason: blocked ? validation.reason : null,
    },
  };
}
