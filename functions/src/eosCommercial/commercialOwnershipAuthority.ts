// EOS Commercial Data Plane — the PURE ownership authority for the three PERSON-owned commercial
// records, and the reconciliation that says whether a Firestore document may become a PostgreSQL
// row (migration 008).
//
// NO I/O. No Firestore, no `pg`, no `firebase-admin`, no `firebase-functions`. Everything here is a
// function of its arguments, which is why it can be tested without a database and without an
// emulator, and why it can be reused unchanged by a governed command, by a reconciliation report,
// and by the repository.
//
// ════════════════════ WHAT THIS ADDS, AND WHAT IT REFUSES TO RESTATE ════════════════════
//
// It adds exactly one thing: the PostgreSQL-side shape of a commercial record's ownership and
// company authority, and the rules for moving that ownership.
//
// It restates nothing. In particular it does NOT re-derive who the owner should be — that is
// ownership/creationOwnerResolution.ts (ruling D-4), which already encodes "explicit, else inherit
// the governed upstream, else REFUSE" and the six forbidden fallbacks. A second copy of that
// resolver here would be a second authority, and the only thing two authorities can do that one
// cannot is disagree. This module takes the owner the governed resolver produced and enforces what
// the STORE must be able to say about it.
//
// Nor does it re-declare the operating companies: `resolveOperatingCompany` in
// ownership/operatingCompanyAuthority.ts is the authority for `taylor | ventana`, and it is called,
// not mirrored.

import {
  OWNERSHIP_RESOLUTION,
  OWNER_TYPES,
  deriveEmployeeRefOwner,
  type OwnerDerivation,
} from "../ownership/typedOwner";
import { resolveOperatingCompany } from "../ownership/operatingCompanyAuthority";
import { ownershipFamily } from "../ownership/ownershipMatrix";

/**
 * The three commercial families migration 008 gives a table. These are exactly the rows
 * ownershipMatrix.ts classifies `ownerClass: "PERSON"` in the commercial chain, and they are
 * cross-checked against the matrix by `assertFamilyIsGovernedHere` below rather than trusted.
 *
 * `salesTerritory` is ABSENT, and that absence is a ruling rather than an omission: the matrix
 * classifies it EXCLUDED ("coverage is not ownership, credit, commission or security",
 * ownershipMatrix.ts:452). It is a real, built object -- coverage/coverageCallables.ts writes it
 * through a governed command -- but it has no owner to enforce, so there is nothing for this
 * module to hold. See the migration header.
 */
export const COMMERCIAL_RECORD_KINDS = ["OPPORTUNITY", "SALES_AGREEMENT", "SALES_ORDER"] as const;

export type CommercialRecordKind = (typeof COMMERCIAL_RECORD_KINDS)[number];

/** kind -> the ownership-matrix family key, so the two vocabularies cannot drift apart silently. */
export const COMMERCIAL_FAMILY_BY_KIND: Readonly<Record<CommercialRecordKind, string>> = Object.freeze({
  OPPORTUNITY: "opportunity",
  SALES_AGREEMENT: "salesAgreement",
  SALES_ORDER: "salesOrder",
});

/** kind -> the eos_commercial table. The Firestore collection name is NOT restated here. */
export const COMMERCIAL_TABLE_BY_KIND: Readonly<Record<CommercialRecordKind, string>> = Object.freeze({
  OPPORTUNITY: "opportunities",
  SALES_AGREEMENT: "sales_agreements",
  SALES_ORDER: "sales_orders",
});

/**
 * Which kinds the STORE refuses without an operating company, mirroring what the governed commands
 * already refuse rather than tightening it.
 *
 *   SALES_ORDER        salesOrderCommands.ts:274-285 throws COMPANY_REQUIRED at creation.
 *   SALES_AGREEMENT    salesAgreementCommands.ts:354-361 throws only at ACCEPT, not at draft.
 *   OPPORTUNITY        opportunityCommands.ts:175 resolves to a nullable value by design.
 *
 * Only the Sales Order is unconditionally required, because only its requirement is unconditional.
 * An Agreement's is conditional on a lifecycle state this schema deliberately does not hold, so the
 * command stays the authority on when it must be filled -- the store would otherwise reject drafts
 * the governed path accepts, and the disagreement would surface at cutover.
 */
export const COMPANY_REQUIRED_KINDS: readonly CommercialRecordKind[] = Object.freeze(["SALES_ORDER"]);

/** Mirrors OWNERSHIP_HANDOFF_SOURCES (access/auditEventWriter.ts:429-433) and the SQL enum. */
export const COMMERCIAL_HANDOFF_SOURCES = [
  "DIRECT_HANDOFF",
  "CUSTOMER_HANDOFF_REVIEW",
  "ADMIN_CORRECTION",
] as const;

export type CommercialHandoffSource = (typeof COMMERCIAL_HANDOFF_SOURCES)[number];

/** The audit writer's ceiling (auditEventWriter.ts:438), so a reason this accepts it also accepts. */
export const MAX_HANDOFF_REASON_LENGTH = 500;

export class CommercialOwnershipError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "CommercialOwnershipError";
  }
}

const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

export function isCommercialRecordKind(value: unknown): value is CommercialRecordKind {
  return typeof value === "string" && (COMMERCIAL_RECORD_KINDS as readonly string[]).includes(value);
}

export function isCommercialHandoffSource(value: unknown): value is CommercialHandoffSource {
  return typeof value === "string" && (COMMERCIAL_HANDOFF_SOURCES as readonly string[]).includes(value);
}

/**
 * The matrix is the authority, not this file's constant list. If a family this module claims is
 * PERSON-owned and transferable were ever reclassified, this throws instead of quietly writing rows
 * under a rule that no longer holds.
 */
export function assertFamilyIsGovernedHere(kind: CommercialRecordKind): void {
  const family = ownershipFamily(COMMERCIAL_FAMILY_BY_KIND[kind]);
  if (family === null) {
    throw new CommercialOwnershipError("FAMILY_UNKNOWN", `${kind} names no ownership-matrix family`);
  }
  if (family.ownerClass !== "PERSON" || family.ownerType !== OWNER_TYPES.USER) {
    throw new CommercialOwnershipError(
      "FAMILY_NOT_PERSON_OWNED",
      `${kind} is ${family.ownerClass}/${String(family.ownerType)} in the ownership matrix -- ` +
        "eos_commercial holds an employee owner and cannot represent it",
    );
  }
  if (family.transfer !== "HANDOFF") {
    throw new CommercialOwnershipError(
      "FAMILY_NOT_TRANSFERABLE",
      `${kind} is transfer=${family.transfer} in the ownership matrix -- historical ownership remains`,
    );
  }
}

// ════════════════════ the row an INSERT is allowed to make ════════════════════

export interface CommercialOwnershipInput {
  kind: CommercialRecordKind;
  recordNumber: string;
  accountId: string;
  ownerEmployeeId: string;
  operatingCompanyId?: string | null;
  createdBy: string;
  opportunityId?: string | null;
  salesAgreementId?: string | null;
}

export interface CommercialOwnershipRow {
  kind: CommercialRecordKind;
  recordNumber: string;
  accountId: string;
  ownerEmployeeId: string;
  operatingCompanyKey: string | null;
  createdBy: string;
  opportunityId: string | null;
  salesAgreementId: string | null;
}

/**
 * Validate-and-normalize. Every refusal here is a refusal the database would also make -- this is
 * the readable half of the same rule, not a substitute for it, which is why the PostgreSQL suite
 * proves each one against a real server as well.
 */
export function buildCommercialOwnershipRow(input: CommercialOwnershipInput): CommercialOwnershipRow {
  if (!isCommercialRecordKind(input?.kind)) {
    throw new CommercialOwnershipError("KIND_INVALID", "kind must be one of " + COMMERCIAL_RECORD_KINDS.join(", "));
  }
  assertFamilyIsGovernedHere(input.kind);

  if (!nonEmpty(input.recordNumber)) {
    throw new CommercialOwnershipError("NUMBER_REQUIRED", "the canonical record number is required");
  }
  if (!nonEmpty(input.accountId)) {
    throw new CommercialOwnershipError(
      "ACCOUNT_REQUIRED",
      "accountId is required -- the Customer is the governed upstream a missing owner is inherited from",
    );
  }
  // RULING 1, and the reason it is a refusal rather than a default: an owner picked here would be
  // indistinguishable afterwards from one a person assigned. See creationOwnerResolution.ts:20-24.
  if (!nonEmpty(input.ownerEmployeeId)) {
    throw new CommercialOwnershipError(
      "OWNER_REQUIRED",
      "ownerEmployeeId is required and is never defaulted, inferred or manufactured -- " +
        "resolve it through creationOwnerResolution before writing",
    );
  }
  if (!nonEmpty(input.createdBy)) {
    throw new CommercialOwnershipError("CREATED_BY_REQUIRED", "createdBy is required");
  }

  const company = normalizeOperatingCompany(input.kind, input.operatingCompanyId);

  if (input.kind === "OPPORTUNITY" && (nonEmpty(input.opportunityId) || nonEmpty(input.salesAgreementId))) {
    throw new CommercialOwnershipError(
      "LINEAGE_INVALID",
      "an Opportunity is the head of the commercial chain and has no commercial upstream",
    );
  }
  if (input.kind === "SALES_AGREEMENT" && nonEmpty(input.salesAgreementId)) {
    throw new CommercialOwnershipError("LINEAGE_INVALID", "a Sales Agreement has no Sales Agreement upstream");
  }

  return Object.freeze({
    kind: input.kind,
    recordNumber: input.recordNumber.trim(),
    accountId: input.accountId.trim(),
    ownerEmployeeId: input.ownerEmployeeId.trim(),
    operatingCompanyKey: company,
    createdBy: input.createdBy.trim(),
    opportunityId: nonEmpty(input.opportunityId) ? input.opportunityId.trim() : null,
    salesAgreementId: nonEmpty(input.salesAgreementId) ? input.salesAgreementId.trim() : null,
  });
}

/**
 * `operatingCompanyId` is never inferred (R-14/R-15, ownership/commercialCompanyScope.ts:14-19). A
 * supplied value must be a governed company; an absent one is refused only where the command
 * refuses it.
 */
export function normalizeOperatingCompany(
  kind: CommercialRecordKind,
  operatingCompanyId: unknown,
): string | null {
  if (!nonEmpty(operatingCompanyId)) {
    if (COMPANY_REQUIRED_KINDS.includes(kind)) {
      throw new CommercialOwnershipError(
        "COMPANY_REQUIRED",
        "a Sales Order is a commercial commitment and requires a governed operatingCompanyId",
      );
    }
    return null;
  }
  const resolution = resolveOperatingCompany(operatingCompanyId.trim());
  if (resolution.state === "INVALID" || resolution.state === "UNKNOWN") {
    throw new CommercialOwnershipError(
      "COMPANY_UNGOVERNED",
      `operatingCompanyId ${JSON.stringify(operatingCompanyId)} is not a governed operating company`,
    );
  }
  // INACTIVE passes, exactly as commercialCompanyScope.ts:64-67 lets it pass: a company that has
  // stopped trading still owns the records it wrote.
  return operatingCompanyId.trim();
}

// ════════════════════ the transfer ════════════════════

export interface CommercialHandoffInput {
  kind: CommercialRecordKind;
  recordId: string;
  /** `null` only where the record genuinely had none -- never a placeholder. */
  previousOwnerEmployeeId: string | null;
  newOwnerEmployeeId: string;
  source: CommercialHandoffSource;
  reason?: string | null;
}

export interface CommercialHandoffRow {
  kind: CommercialRecordKind;
  recordId: string;
  previousOwnerEmployeeId: string | null;
  newOwnerEmployeeId: string;
  source: CommercialHandoffSource;
  reason: string | null;
}

/**
 * RULING 4 (negotiated transfer is allowed) and RULING 5 (historical ownership remains) are the same
 * event seen from two sides, so they are validated in one place:
 *
 *   - the family must be transfer=HANDOFF in the matrix (an IMMUTABLE family is refused);
 *   - a no-op is refused, because a handoff that moves nothing is not a negotiation;
 *   - ONE record, never a list. There is no cascade parameter and no children flag
 *     (ownershipHandoffCommand.ts:25-30). Handing off an Opportunity leaves its Sales Orders where
 *     they were -- moving one is a separate row.
 *
 * RULING 6 (future sales follow the new owner) needs nothing here, and that is the point: it is
 * satisfied by the record's CURRENT owner column being the thing creationOwnerResolution inherits
 * from. Once the column moves, tomorrow's records inherit the new owner; yesterday's do not move,
 * which is ruling 5 again.
 */
export function buildCommercialHandoff(input: CommercialHandoffInput): CommercialHandoffRow {
  if (!isCommercialRecordKind(input?.kind)) {
    throw new CommercialOwnershipError("KIND_INVALID", "kind must be one of " + COMMERCIAL_RECORD_KINDS.join(", "));
  }
  assertFamilyIsGovernedHere(input.kind);

  if (!nonEmpty(input.recordId)) {
    throw new CommercialOwnershipError("RECORD_REQUIRED", "recordId is required");
  }
  if (!nonEmpty(input.newOwnerEmployeeId)) {
    throw new CommercialOwnershipError("OWNER_REQUIRED", "newOwnerEmployeeId is required");
  }
  if (input.previousOwnerEmployeeId !== null && !nonEmpty(input.previousOwnerEmployeeId)) {
    throw new CommercialOwnershipError(
      "PREVIOUS_OWNER_INVALID",
      "previousOwnerEmployeeId is an employee id or null -- null means the record genuinely had none, " +
        "and an empty string is not a way of saying that",
    );
  }
  const previous = input.previousOwnerEmployeeId === null ? null : input.previousOwnerEmployeeId.trim();
  const next = input.newOwnerEmployeeId.trim();
  if (previous === next) {
    throw new CommercialOwnershipError(
      "HANDOFF_NO_OP",
      "the record is already owned by that employee -- a no-op is not a handoff",
    );
  }
  if (!isCommercialHandoffSource(input.source)) {
    throw new CommercialOwnershipError(
      "SOURCE_INVALID",
      "source must be one of " + COMMERCIAL_HANDOFF_SOURCES.join(", "),
    );
  }
  const reason = nonEmpty(input.reason) ? input.reason.trim() : null;
  if (reason !== null && reason.length > MAX_HANDOFF_REASON_LENGTH) {
    throw new CommercialOwnershipError(
      "REASON_TOO_LONG",
      `reason must be at most ${MAX_HANDOFF_REASON_LENGTH} characters`,
    );
  }

  return Object.freeze({
    kind: input.kind,
    recordId: input.recordId.trim(),
    previousOwnerEmployeeId: previous,
    newOwnerEmployeeId: next,
    source: input.source,
    reason,
  });
}

// ════════════════════ reconciliation: may this document become a row? ════════════════════

/**
 * The migration-readiness question, answered per document and never guessed.
 *
 * It derives the owner with `deriveEmployeeRefOwner` -- the SAME derivation ownershipCensus.ts uses
 * for these three families -- so a document this reports as READY cannot be one the census calls
 * unresolved, and vice versa. That equivalence is the reconciliation proof: two counts of the same
 * documents that are computed from one derivation cannot disagree.
 */
export type CommercialReconciliationVerdict = "READY" | "OWNERLESS" | "COMPANY_MISSING" | "COMPANY_UNGOVERNED" | "ACCOUNT_MISSING";

export interface CommercialReconciliationRow {
  id: string;
  kind: CommercialRecordKind;
  verdict: CommercialReconciliationVerdict;
  reason: string | null;
}

export interface CommercialReconciliationReport {
  kind: CommercialRecordKind;
  table: string;
  scanned: number;
  ready: number;
  blocked: number;
  /** verdict -> count, so a large collection reports WHY without listing every id. */
  verdicts: Record<string, number>;
  blockedSamples: CommercialReconciliationRow[];
}

export const MAX_RECONCILIATION_SAMPLES = 10;

/** The fields this reconciliation reads. A document is a bag of unknowns until it is read. */
export interface CommercialDocumentLike {
  id: string;
  data: Record<string, unknown>;
}

export function reconcileCommercialDocument(
  kind: CommercialRecordKind,
  doc: CommercialDocumentLike,
): CommercialReconciliationRow {
  const data = doc?.data ?? {};
  const ownerDerivation: OwnerDerivation = deriveEmployeeRefOwner(data);
  if (ownerDerivation.resolution !== OWNERSHIP_RESOLUTION.RESOLVED) {
    return {
      id: doc.id,
      kind,
      verdict: "OWNERLESS",
      reason: ownerDerivation.reason ?? "no governed owner could be derived",
    };
  }
  if (!nonEmpty(data.accountId)) {
    return { id: doc.id, kind, verdict: "ACCOUNT_MISSING", reason: "accountId is absent" };
  }
  try {
    normalizeOperatingCompany(kind, data.operatingCompanyId);
  } catch (err) {
    const code = err instanceof CommercialOwnershipError ? err.code : "COMPANY_UNGOVERNED";
    return {
      id: doc.id,
      kind,
      verdict: code === "COMPANY_REQUIRED" ? "COMPANY_MISSING" : "COMPANY_UNGOVERNED",
      reason: err instanceof Error ? err.message : String(err),
    };
  }
  return { id: doc.id, kind, verdict: "READY", reason: null };
}

export function reconcileCommercialFamily(
  kind: CommercialRecordKind,
  docs: readonly CommercialDocumentLike[],
): CommercialReconciliationReport {
  assertFamilyIsGovernedHere(kind);
  const verdicts: Record<string, number> = {};
  const blockedSamples: CommercialReconciliationRow[] = [];
  let ready = 0;

  for (const doc of docs) {
    const row = reconcileCommercialDocument(kind, doc);
    verdicts[row.verdict] = (verdicts[row.verdict] ?? 0) + 1;
    if (row.verdict === "READY") {
      ready += 1;
    } else if (blockedSamples.length < MAX_RECONCILIATION_SAMPLES) {
      blockedSamples.push(row);
    }
  }

  return {
    kind,
    table: COMMERCIAL_TABLE_BY_KIND[kind],
    scanned: docs.length,
    ready,
    blocked: docs.length - ready,
    verdicts,
    blockedSamples,
  };
}
