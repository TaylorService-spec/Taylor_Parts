// Wave 4 -- the ONE reorder/health "urgency" tone map (CRITICAL/HIGH/MEDIUM/LOW), shared by
// every Inventory/InventoryRole surface that renders a reorder request's or a health
// recommendation's urgency (PartDetail.jsx, PartsList.jsx, PartsAssociateHome.jsx,
// PartsManagerHome.jsx, WarehouseManagerHome.jsx -- all of which used the SAME
// `fo-badge fo-badge-${urgency.toLowerCase()}` string before Wave 4). Pure and
// dependency-free (no Firebase, no React), matching domain/accountPortfolio.js /
// domain/truckInventoryView.js / domain/equipment.js's own pure-tone-map convention.
//
// The retired CSS (index.css, still live for the NOT-yet-migrated operations/panels
// surfaces -- InventoryHealthPanel/ProcurementPanel/WarehousePanel -- which reuse this
// exact vocabulary and stay on the fo-badge allowlist until their own wave) mapped:
//   CRITICAL -> color-danger / danger-surface     (exact StatusPill match: "critical")
//   HIGH     -> a custom burnt-orange (#B2591F) / surface-sunken (no exact tone match)
//   MEDIUM   -> color-warning / warning-surface   (exact StatusPill match: "attention")
//   LOW      -> color-success / success-surface   (exact StatusPill match: "positive")
// HIGH has no exact counterpart in the shared 7-tone vocabulary (positive/attention/
// unknown/muted/neutral/info/critical) -- it collapses into "attention" alongside MEDIUM,
// the same kind of compression Wave 2 made for Account relationship/line-of-business (both
// -> "info"). This is a disclosed, deliberate loss of one shade of visual distinction, not
// an accidental one; CRITICAL and LOW keep their exact original colour intent.
const URGENCY_TONE = {
  CRITICAL: "critical",
  HIGH: "attention",
  MEDIUM: "attention",
  LOW: "positive",
};

export function inventoryUrgencyTone(urgency) {
  if (typeof urgency !== "string") return "unknown";
  return URGENCY_TONE[urgency.toUpperCase()] ?? "unknown";
}
