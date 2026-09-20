// THE ZERO-FIREBASE PROGRAMME CENSUS -- Firebase business dependencies, grouped by business domain.
//
// DELIBERATELY NOT UNDER adminPolicy/. This is a programme-planning census, not a policy module:
// it decides nothing, is read by no runtime, and describes the whole repository rather than the
// authorization subsystem. Filing it under adminPolicy would put a document about every domain
// inside the one domain it happens to mention most, and would subject prose describing legacy
// Firestore locations to a guard that exists to stop the policy engine PERSISTING to them.
//
// Pure data plus derivations: no database, no Firebase, no I/O, no clock. Its companion suite reads
// the COMMITTED exit baseline and asserts every business-dependent file maps to exactly one domain,
// so a new dependency cannot land in a domain nobody is accounting for.
//
// ════════════════════ THIS COUNTS FILES, NOT PROGRESS ════════════════════
//
// A domain with few files is not nearly done, and a domain with many is not hopeless. The file
// count says how much SURFACE a cutover has to move; the six-state accounting below says how far
// that domain actually is. The two are reported side by side precisely so neither is mistaken for
// the other.
//
// ════════════════════ WHAT IS COUNTED ════════════════════
//
// Only the four BUSINESS categories of docs/architecture/firebase-exit-baseline.json:
// frontend firestore_client, frontend firebase_functions_client, server firebase_admin_firestore,
// server firebase_functions_server. The `firebase_auth` and `firebase_admin_app` categories are
// EXCLUDED by design -- Firebase Authentication as transitional sign-in identity is allowed after
// exit, and counting it here would make the target unreachable by definition.
export const FIREBASE_EXIT_DOMAINS = Object.freeze([
  "CRM",
  "CATALOG_SUPPLIER",
  "COMMERCIAL",
  "EMPLOYEE_WORKFORCE",
  "WORK_ORDERS_SERVICE",
  "INVENTORY",
  "PURCHASING_RECEIVING_TRANSFER_CYCLE_COUNT",
  "EQUIPMENT",
  "INBOUND_WORK_EMAIL",
  "REPORTING_FINANCIALS",
  "ADMINISTRATION",
  "AI_READINESS",
  "AUTHENTICATION_SESSION",
  /** Shared plumbing that belongs to no single business domain. Reported, never hidden. */
  "PLATFORM_SHARED",
] as const);
export type FirebaseExitDomain = (typeof FIREBASE_EXIT_DOMAINS)[number];

/**
 * The six-state accounting. Each state is a HIGHER bar than the one before it, and a domain is only
 * ever reported at the highest state it has actually reached.
 */
export const MIGRATION_STATES = Object.freeze([
  /** The governed PostgreSQL schema exists. Nothing reads or writes it yet. */
  "BUILT",
  /** DRY RUN / COPY / VERIFY tooling exists and is proven against synthetic data. */
  "MIGRATION_TOOLING_READY",
  /** The real population has been copied and VERIFY passed against the frozen source. */
  "RECONCILED",
  /** The runtime reads and writes PostgreSQL. No Firebase fallback, no dual write. */
  "CUT_OVER_ACTIVE",
  /** The Firebase authority is gone: Rules retired, callables un-exported and un-deployed. */
  "LEGACY_RETIRED",
  /** Owner-accepted in production. */
  "ACCEPTED",
] as const);
export type MigrationState = (typeof MIGRATION_STATES)[number];

/** `null` means the domain has not reached even BUILT. Do not inflate this. */
export type DomainState = MigrationState | null;

export interface DomainAccount {
  readonly domain: FirebaseExitDomain;
  /** Path prefixes that map a baseline file to this domain. Matched longest-first. */
  readonly pathPrefixes: readonly string[];
  readonly currentFirebaseAuthority: string;
  readonly postgresState: DomainState;
  readonly renderState: DomainState;
  readonly migrationToolingState: DomainState;
  readonly runtimeCutoverState: DomainState;
  /** What actually stops this domain reaching LEGACY_RETIRED. Never blank. */
  readonly retirementBlocker: string;
}

const d = (account: DomainAccount): DomainAccount => Object.freeze(account);

export const FIREBASE_EXIT_DOMAIN_ACCOUNTS: readonly DomainAccount[] = Object.freeze([
  d({
    domain: "CRM",
    pathPrefixes: ["functions/src/crm", "functions/src/account", "functions/src/crmActivity",
      "functions/src/coverage", "field-ops-app-vite/src/modules/accounts"],
    currentFirebaseAuthority: "Account, Contact and customer-site documents plus the CRM Activity callables",
    postgresState: "BUILT", renderState: "BUILT", migrationToolingState: "MIGRATION_TOOLING_READY",
    runtimeCutoverState: null,
    retirementBlocker: "the CRM writer authority is not PostgreSQL ACTIVE, so every composed CRM "
      + "route still refuses; the cutover is gated on the committed crmWriterState",
  }),
  d({
    domain: "CATALOG_SUPPLIER",
    pathPrefixes: ["functions/src/partMaster", "functions/src/supplierMaster", "functions/src/catalog"],
    currentFirebaseAuthority: "Part master, part identifiers/aliases and supplier catalog documents and callables",
    postgresState: "BUILT", renderState: null, migrationToolingState: "MIGRATION_TOOLING_READY",
    runtimeCutoverState: null,
    retirementBlocker: "the largest single-domain callable surface in the repository; no Render "
      + "transport composes catalog writes yet",
  }),
  d({
    domain: "COMMERCIAL",
    pathPrefixes: ["functions/src/opportunity", "functions/src/salesAgreement", "functions/src/salesOrder",
      "functions/src/fulfillment"],
    currentFirebaseAuthority: "Opportunity, Sales Agreement and Sales Order documents and write callables",
    postgresState: "BUILT", renderState: "BUILT", migrationToolingState: "MIGRATION_TOOLING_READY",
    runtimeCutoverState: null,
    retirementBlocker: "wave C5/C6 reconciliation has not run against a real population",
  }),
  d({
    domain: "EMPLOYEE_WORKFORCE",
    pathPrefixes: ["functions/src/eosWorkforce", "functions/src/employeeIdentity",
      // UNDER /auth/, BUT NOT AUTHENTICATION. It reads users/{uid} and employees/{id} from
      // Firestore -- Employee BUSINESS data. Mapping it by its folder would file a real blocker
      // under the one domain that is deliberately not a blocker, which is how a programme
      // accidentally reports itself further along than it is.
      "field-ops-app-vite/src/auth/employeeSession.js",
      "field-ops-app-vite/src/auth/employeeSessionResult.js"],
    currentFirebaseAuthority: "legacy Employee profile documents; identity linkage is already PostgreSQL",
    postgresState: "BUILT", renderState: "CUT_OVER_ACTIVE", migrationToolingState: "MIGRATION_TOOLING_READY",
    runtimeCutoverState: "CUT_OVER_ACTIVE",
    retirementBlocker: "the furthest-advanced domain: Employee reads and the governed writers run on "
      + "Render against PostgreSQL. What remains is retiring the legacy profile documents themselves",
  }),
  d({
    domain: "WORK_ORDERS_SERVICE",
    pathPrefixes: ["functions/src/transitionWorkOrder", "functions/src/createWorkOrder",
      "functions/src/updateWorkOrderExecutionData", "functions/src/completeAssignedJob",
      "functions/src/scheduling", "functions/src/workOrderLabor", "functions/src/workOrderInstall",
      "functions/src/workOrderConsumption", "functions/src/getWorkOrderFieldContext",
      "functions/src/transitionEngine", "functions/src/callerContext",
      "functions/src/woNumbering.ts", "functions/src/workOrderPartsPlan",
      "field-ops-app-vite/src/modules/dispatcherBoard"],
    currentFirebaseAuthority: "fieldops_wos documents, written ONLY by Admin SDK callables. The "
      + "callables ARE the authority, not a transport in front of one. Assignee identity is a "
      + "fieldops_technicians id reached from a credential",
    postgresState: "BUILT", renderState: null, migrationToolingState: null, runtimeCutoverState: null,
    retirementBlocker: "Lane A (this branch) has the object authority and the Employee-keyed "
      + "assignment command; migration tooling, Render transport and the runtime cutover are not built",
  }),
  d({
    domain: "INVENTORY",
    pathPrefixes: ["functions/src/inventory", "functions/src/inventoryLedger", "functions/src/inventoryLocation",
      "functions/src/inventoryReturns", "functions/src/warehouseGovernance",
      "functions/src/inventoryAnalyticsCallables.ts"],
    currentFirebaseAuthority: "inventory_transactions ledger and location/warehouse documents",
    postgresState: "BUILT", renderState: null, migrationToolingState: "MIGRATION_TOOLING_READY",
    runtimeCutoverState: null,
    retirementBlocker: "the ledger is the system's stock authority; nothing may move until its "
      + "migration is reconciled against real counts",
  }),
  d({
    domain: "PURCHASING_RECEIVING_TRANSFER_CYCLE_COUNT",
    pathPrefixes: ["functions/src/reorderRequest", "functions/src/inventoryReceiving",
      "functions/src/inventoryTransfer", "functions/src/cycleCount"],
    currentFirebaseAuthority: "Reorder Request, purchase order, receiving, transfer and cycle count documents",
    postgresState: "BUILT", renderState: "BUILT", migrationToolingState: "MIGRATION_TOOLING_READY",
    runtimeCutoverState: null,
    retirementBlocker: "#1961 is HELD and unmerged: the Reorder slice is code-complete but "
      + "BLOCKED_EXTERNAL_OPERATOR_ACCESS. Receiving, transfer and cycle count have not started",
  }),
  d({
    domain: "EQUIPMENT",
    pathPrefixes: ["functions/src/equipmentCompatibility", "functions/src/equipmentInstall",
      "functions/src/serializedAsset", "functions/src/truckRegistry"],
    currentFirebaseAuthority: "equipment model catalog, installed-equipment and serialized asset documents",
    postgresState: "BUILT", renderState: null, migrationToolingState: "MIGRATION_TOOLING_READY",
    runtimeCutoverState: null,
    retirementBlocker: "the equipment custody authority exists in PostgreSQL but nothing serves it",
  }),
  d({
    domain: "INBOUND_WORK_EMAIL",
    pathPrefixes: ["functions/src/inboundWork"],
    currentFirebaseAuthority: "inbound message intake, triage and decision documents and callables",
    postgresState: null, renderState: null, migrationToolingState: null, runtimeCutoverState: null,
    retirementBlocker: "NOT STARTED. No PostgreSQL authority exists for inbound work at all",
  }),
  d({
    domain: "REPORTING_FINANCIALS",
    pathPrefixes: ["functions/src/reporting", "functions/src/finance", "functions/src/performance"],
    currentFirebaseAuthority: "report catalog and execution, invoice and performance metric reads",
    postgresState: "BUILT", renderState: null, migrationToolingState: null, runtimeCutoverState: null,
    retirementBlocker: "reporting reads ACROSS domains, so it can only retire after the domains it "
      + "reads from do. It is a consequence of the others, not an independent cutover",
  }),
  d({
    domain: "ADMINISTRATION",
    pathPrefixes: ["functions/src/adminPolicy", "functions/src/access", "functions/src/dataImport",
      "field-ops-app-vite/src/access", "field-ops-app-vite/src/modules/administration"],
    currentFirebaseAuthority: "the legacy authorization surface, users/{uid}.role, and data import staging",
    postgresState: "CUT_OVER_ACTIVE", renderState: "CUT_OVER_ACTIVE",
    migrationToolingState: "MIGRATION_TOOLING_READY", runtimeCutoverState: null,
    retirementBlocker: "the admin policy engine IS PostgreSQL and served by Render, but the legacy "
      + "users/{uid}.role surface still exists alongside it -- Lane B's subject",
  }),
  d({
    domain: "AI_READINESS",
    pathPrefixes: ["functions/src/ai"],
    currentFirebaseAuthority: "the Work Order readiness context callable and its Firestore reads",
    postgresState: null, renderState: null, migrationToolingState: null, runtimeCutoverState: null,
    retirementBlocker: "readiness reads across Inventory, Work Orders and Purchasing, so it follows "
      + "them. Its procurement dimension is already retired to UNAVAILABLE in #1961",
  }),
  d({
    domain: "AUTHENTICATION_SESSION",
    // DELIBERATELY NARROW. `field-ops-app-vite/src/firebase` is NOT here: firebase.js and
    // collectionStore.js are the shared Firestore HANDLES every domain imports, which makes them
    // platform plumbing rather than sign-in. Claiming them would file the whole client's Firestore
    // surface under the one domain declared not to be a blocker.
    //
    // This domain is expected to match NOTHING in the business census, and its suite asserts that:
    // sign-in identity does not depend on Firebase for business data, by definition.
    pathPrefixes: ["functions/src/auth"],
    currentFirebaseAuthority: "Firebase Authentication for sign-in and the uid used for EOS Principal correlation",
    postgresState: "CUT_OVER_ACTIVE", renderState: "CUT_OVER_ACTIVE",
    migrationToolingState: "MIGRATION_TOOLING_READY", runtimeCutoverState: "CUT_OVER_ACTIVE",
    retirementBlocker: "NONE, AND BY DESIGN. Firebase Auth as transitional sign-in identity is "
      + "ALLOWED after exit; the Principal it correlates to is already the authority. This domain "
      + "is not a blocker and must not be counted as one",
  }),
  d({
    domain: "PLATFORM_SHARED",
    pathPrefixes: ["functions/src/types", "functions/src/constants", "functions/src/eosApi",
      "functions/src/eosOps", "functions/src/ownership", "functions/src/procurementService",
      "functions/src/inventoryService", "functions/src/inventoryAnalyticsService",
      "functions/src/inventoryEffectDetection", "functions/src/inventoryEffectCallables",
      "functions/src/index.ts", "field-ops-app-vite/src/services", "field-ops-app-vite/src/hooks",
      "field-ops-app-vite/src/domain", "field-ops-app-vite/src/metadata",
      "field-ops-app-vite/src/lib", "field-ops-app-vite/src/analytics",
      // The shared Firestore/Functions handles: imported by every domain, owned by none, and
      // retiring only when the last importer does.
      "field-ops-app-vite/src/firebase",
      "field-ops-app-vite/src/types", "field-ops-app-vite/src/modules"],
    currentFirebaseAuthority: "shared clients, hooks, type contracts and cross-domain services",
    postgresState: null, renderState: null, migrationToolingState: null, runtimeCutoverState: null,
    retirementBlocker: "belongs to no single domain and retires with whichever domain last uses it. "
      + "Counted separately so a domain's number is not inflated by shared plumbing",
  }),
]);

export interface DomainCensusRow {
  readonly domain: FirebaseExitDomain;
  readonly fileCount: number;
  readonly account: DomainAccount;
}

/**
 * Map each baseline file to exactly one domain, longest prefix wins.
 *
 * Longest-first matters: `functions/src/inventoryReceiving` must not be swallowed by
 * `functions/src/inventory`, and a file landing in the wrong domain is a count nobody can trust.
 */
export function domainFor(path: string): FirebaseExitDomain | null {
  let best: { domain: FirebaseExitDomain; length: number } | null = null;
  for (const account of FIREBASE_EXIT_DOMAIN_ACCOUNTS) {
    for (const prefix of account.pathPrefixes) {
      if (path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(`${prefix}.`)) {
        if (best === null || prefix.length > best.length) best = { domain: account.domain, length: prefix.length };
      }
    }
  }
  return best?.domain ?? null;
}

/** Group the given business-dependent paths by domain. Deterministic, sorted by count then name. */
export function censusByDomain(paths: readonly string[]): readonly DomainCensusRow[] {
  const counts = new Map<FirebaseExitDomain, number>();
  for (const account of FIREBASE_EXIT_DOMAIN_ACCOUNTS) counts.set(account.domain, 0);
  for (const path of paths) {
    const domain = domainFor(path);
    if (domain !== null) counts.set(domain, (counts.get(domain) ?? 0) + 1);
  }
  return Object.freeze([...counts.entries()]
    .map(([domain, fileCount]) => Object.freeze({
      domain, fileCount,
      account: FIREBASE_EXIT_DOMAIN_ACCOUNTS.find((a) => a.domain === domain) as DomainAccount,
    }))
    .sort((a, b) => b.fileCount - a.fileCount || a.domain.localeCompare(b.domain)));
}

/** Domains that have not reached even BUILT. The honest front of the programme. */
export function notStartedDomains(): readonly FirebaseExitDomain[] {
  return Object.freeze(FIREBASE_EXIT_DOMAIN_ACCOUNTS
    .filter((a) => a.postgresState === null).map((a) => a.domain).sort());
}

/**
 * Domains whose runtime actually reads and writes PostgreSQL.
 *
 * AUTHENTICATION_SESSION is excluded from any "remaining work" reading: Firebase Auth after exit is
 * the intended end state, not an unfinished cutover.
 */
export function cutOverDomains(): readonly FirebaseExitDomain[] {
  return Object.freeze(FIREBASE_EXIT_DOMAIN_ACCOUNTS
    .filter((a) => a.runtimeCutoverState === "CUT_OVER_ACTIVE" && a.domain !== "AUTHENTICATION_SESSION")
    .map((a) => a.domain).sort());
}
