// THE SESSION CAPABILITY FEED, FROM EOS -- PURE (no React, no Firebase, no network; node-testable).
// Firebase exit F1 (DECISIONS #244).
//
// Where an environment declares an EOS API (config/environments.json `eosApi`, compile-time flag
// EOS_NAVIGATION_AUTHORITY_READY) the shell's capability answers come from the caller's OWN EOS capability set --
// `resolveMyCapabilities`, POST /operations/inventory, answered from the resolved EOS Principal, ACTIVE membership and
// Role capabilities -- and not from the Firebase effective-access callable. Everywhere else the Firebase feed
// (access/useReportCapabilities.js) is the sole source, unchanged.
//
// THE CLIENT GATE FOLLOWS THE SERVER. Every gated action already goes through an EOS command that enforces the EOS
// capability, so a gate answered from this set shows exactly what the server allows.
//
// A FIREBASE ID IS ASKED UNDER ITS EOS NAME ONLY WHEN THE MEANING IS THE SAME. The table below is closed. An id that is
// neither an EOS key nor in the table is denied: a rename is never inferred.
export const MY_CAPABILITIES_OPERATION = "resolveMyCapabilities";

/**
 * Firebase permission id -> the EOS capability key with the SAME meaning (F1 rule 2). Each row names its evidence.
 * An id absent from this table is looked up under its own name, which is right for every id the two catalogs share.
 */
export const EOS_KEY_FOR_FIREBASE_ID = Object.freeze({
  // migration 1764340000000 header: "inboundWork.request.read (Firebase: service.inboundWork.read)".
  "service.inboundWork.read": "inboundWork.request.read",
  // Same words, same Object, identical holders (admin, owner, reportViewer) -- migration 1762300800000.
  "report.definition.read": "reportDefinition.read",
  // Owner ruling recorded in credEquivalence.ts: finance.read split into finance.invoice.read / finance.payment.read.
  // F7c (DECISIONS #245): the Account's receivables area now READS the Finance register (listObligations), whose view key is
  // finance.payment.read -- so that is the key this gate is asked under, the gate following the read it opens. The Owner's
  // split gave BOTH keys to exactly the 14 Roles that held finance.read (migration 1761609600000), so the holders are identical
  // to the invoice.read mapping F1 used and nobody gains or loses the door. The server still decides company reach per read.
  "finance.read": "finance.payment.read",
  // Data Import staging. NOT a registration: the Data Import screen is reached through the EOS surface administration.dataImport,
  // which is earned by admin.dataImport.execute, and the holders are the same (admin only; Firebase gives stage to admin and nobody
  // else). execute is already Owner-excluded (Owner ruling A), so asking stage under this name widens no EOS grant and creates no
  // new grantable capability.
  "admin.dataImport.stage": "admin.dataImport.execute",
});

/**
 * Firebase ids the shell still declares that have NO EOS key and NO reachable consumer when EOS decides navigation.
 * They answer false (not held) and nothing is hidden by that: every one of their screens is already absent from the
 * EOS-sourced navigation (navConfig NAV_SURFACE_GAPS), so the gate is never reached. Each re-enters this feed with
 * the slice that makes its surface reachable -- registering the id in EOS then, mirrored from the Firebase holders.
 */
export const FIREBASE_IDS_WITHOUT_EOS_TWIN = Object.freeze({
  "report.customer.read": "Report Builder (reporting/builder): NAV_SURFACE_GAPS; reporting moves with F7e.",
  "report.contact.read": "Report Builder (reporting/builder): NAV_SURFACE_GAPS; reporting moves with F7e.",
  "report.location.read": "Report Builder (reporting/builder): NAV_SURFACE_GAPS; reporting moves with F7e.",
  "report.equipment.read": "Report Builder (reporting/builder): NAV_SURFACE_GAPS; reporting moves with F7e.",
  "report.definition.create": "Saved Reports (reporting/savedReports): NAV_SURFACE_GAPS; reporting moves with F7e.",
  "report.definition.rename": "Saved Reports (reporting/savedReports): NAV_SURFACE_GAPS; reporting moves with F7e.",
  "report.definition.duplicate": "Saved Reports (reporting/savedReports): NAV_SURFACE_GAPS; reporting moves with F7e.",
  "report.definition.delete": "Saved Reports (reporting/savedReports): NAV_SURFACE_GAPS; reporting moves with F7e.",
  "inventory.location.bin.read": "Warehouse Racking (administration/warehouseRacking): NAV_SURFACE_GAPS; bins move with F6.",
  "inventory.location.bin.manage": "Warehouse Racking (administration/warehouseRacking): NAV_SURFACE_GAPS; bins move with F6.",
  "inventory.balance.read": "Only My Dashboard cards and the legacy phone shell read it; neither is reachable under the EOS source.",
  "finance.visibility.self": "Only My Dashboard cards read it; not reachable under the EOS source. The EOS receivables read (listObligations) decides company reach.",
  "finance.visibility.team": "Only My Dashboard cards read it; not reachable under the EOS source. The EOS receivables read (listObligations) decides company reach.",
  "finance.visibility.businessUnit": "Only My Dashboard cards read it; not reachable under the EOS source. The EOS receivables read (listObligations) decides company reach.",
  "finance.visibility.company": "Only My Dashboard cards read it; not reachable under the EOS source. The EOS receivables read (listObligations) decides company reach.",
  "finance.visibility.consolidated": "Only My Dashboard cards read it; not reachable under the EOS source. The EOS receivables read (listObligations) decides company reach.",
  "financialPolicy.profile.read": "Read by no mounted control: AdminFinancialPolicy reads the EOS finance.policy operations directly. read -> finance.policy.read is the only like-for-like pair; it is not translated because nothing asks.",
  "financialPolicy.profile.configure": "Read by no mounted control, and configure -> finance.policy.prepare is not a same-meaning equivalence (configure is a deployment-time act on a DRAFT or APPROVED profile; prepare drafts and submits).",
  "administration.emailIntake.read": "Declared, never consulted: the Email & Communications door is earned by inboundWork.intake.manage.",
});

/** The EOS key a Firebase permission id is asked under. */
export const eosKeyForFirebaseId = (id) => EOS_KEY_FOR_FIREBASE_ID[id] ?? id;

/**
 * The EOS capability keys a `resolveMyCapabilities` answer lists, or null when it is not the governed shape (not an
 * object, `capabilities` not an array, or a non-string entry). Malformed is NOT empty: it is a transport fault.
 */
export function eosCapabilitiesFrom(result) {
  if (!result || typeof result !== "object" || Array.isArray(result)) return null;
  const { capabilities } = result;
  if (!Array.isArray(capabilities)) return null;
  if (!capabilities.every((id) => typeof id === "string" && id.length > 0)) return null;
  return new Set(capabilities);
}

/** A stable signature of a capability set, so "did the caller's access change" is one string comparison. */
export const capabilitySignature = (held) => [...held].sort().join("\n");
