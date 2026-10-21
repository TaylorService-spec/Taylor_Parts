// CLC (DECISIONS #CLC; Owner review 2026-10-20, direction 2026-10-21): the GOVERNED, AUDITED, SET-ONCE correction of a COMPANY-LESS Commercial record.
// Reached only through the Commercial transport (commercialHttp.ts). Closes the Q-1a design gap: nothing in the application could set a company on an
// Opportunity or Sales Agreement that had none (DECISIONS #Q-1a-company).
//
//   assignRecordOperatingCompany { family: OPPORTUNITY | SALES_AGREEMENT, recordId, operatingCompanyId, reason, idempotencyKey }
//
// It sets the operating company of a record whose company is NULL, ONCE. It never changes a company already set and never clears one.
//
// THE ORDER (every refusal before any write; a refusal rolls everything back -- no receipt, no audit row, no edit version):
//   1. capability            commercial.recordCompany.assign (the kernel; registered with NO grants)
//   2. VISIBILITY            the record is locked through the Q-1a predicate: a record the caller cannot see under the null-company rule (owner / creator,
//                            the protected Administrator, the protected Owner) or the company rule is NONEXISTENT (RECORD_NOT_FOUND), and is never locked
//   3. TARGET REACH          the caller reaches the company it assigns (the SAME Q-1a decision a creation uses); a company it does not reach reads as an ungoverned one
//   4. STILL COMPANY-LESS    a record that already has a company refuses OPERATING_COMPANY_ALREADY_SET and changes nothing
//   5. LINEAGE               an Agreement's company must equal its Opportunity's. Correcting an Opportunity CORRECTS ITS COMPANY-LESS AGREEMENT IN THE SAME TRANSACTION
//                            (at most one exists: sales_agreements_one_per_opportunity); an Agreement whose Opportunity has no company, or a different one, refuses
//                            LINEAGE_DISAGREEMENT -- its company follows the Opportunity's. An Order is NOT NULL and never applies.
//
// ONE audit row per applied command (action = the operation), carrying the governed reason and the before (null) / after company. Replay is the kernel's
// receipt; two assigns on one record have exactly one winner (the record is locked, and the UPDATE also requires the company to still be NULL).
//
// The result never names a linked record the caller may not see: a cascaded Agreement is recorded in the audit row, not returned.
import { fail, runCommercialCommand, COMMERCIAL_RECORD_COMPANY_ASSIGN_CAPABILITY, type CommercialActorContext, type CommercialCommandDeps } from "./commercialCommandKernel";
import { lockAgreement, lockOpportunity, operatingCompanyKeyFor } from "./commercialRecordStore";
import { sourceOpportunityChannel } from "./salesAgreementCommandService";

const FAMILY_OF: Readonly<Record<string, "opportunity" | "salesAgreement">> = Object.freeze({ OPPORTUNITY: "opportunity", SALES_AGREEMENT: "salesAgreement" });
const ACCEPTED_FIELDS: ReadonlySet<string> = new Set(["family", "recordId", "operatingCompanyId", "reason", "idempotencyKey"]);
const MAX_REASON_LENGTH = 500;
const COMPANY_ID_SHAPE = /^[a-z][a-z0-9_-]{1,62}$/;
const LABEL = { opportunity: "Opportunity", salesAgreement: "Sales Agreement" } as const;

export function assignRecordOperatingCompany(deps: CommercialCommandDeps, actor: CommercialActorContext, input: Record<string, unknown>) {
  const family = typeof input?.family === "string" && Object.prototype.hasOwnProperty.call(FAMILY_OF, input.family) ? FAMILY_OF[input.family] : undefined;
  // A key reused on a different record (or with an unknown family) is never a replay (IDEMPOTENCY_KEY_REUSED).
  const replayTarget = { family: family ?? ("opportunity" as const), id: family ? input?.recordId : undefined };
  return runCommercialCommand(deps, actor, "commercial.recordCompany.assign", [COMMERCIAL_RECORD_COMPANY_ASSIGN_CAPABILITY], input?.idempotencyKey, async (db, _now, scope) => {
    const extra = Object.keys(input).filter((k) => !ACCEPTED_FIELDS.has(k));
    if (extra.length > 0) fail("FIELD_NOT_ACCEPTED", "INVALID_INPUT", `this command does not accept: ${extra.sort().join(", ")}`);
    if (!family) return fail("FAMILY_INVALID", "INVALID_INPUT", "family is OPPORTUNITY or SALES_AGREEMENT");
    if (typeof input.recordId !== "string" || input.recordId.trim() === "" || input.recordId.length > 200) fail("RECORD_ID_REQUIRED", "INVALID_INPUT", "recordId is required");
    if (typeof input.operatingCompanyId !== "string" || !COMPANY_ID_SHAPE.test(input.operatingCompanyId)) {
      fail("OPERATING_COMPANY_REQUIRED", "INVALID_INPUT", "operatingCompanyId is required: the operating company to assign");
    }
    const reason = typeof input.reason === "string" ? input.reason.trim() : "";
    if (reason === "") fail("REASON_REQUIRED", "INVALID_INPUT", "correcting a record's operating company states its reason");
    if (reason.length > MAX_REASON_LENGTH) fail("REASON_TOO_LONG", "INVALID_INPUT", `reason must be at most ${MAX_REASON_LENGTH} characters`);
    const recordId = (input.recordId as string).trim();
    const companyId = input.operatingCompanyId as string;
    const tenantId = actor.tenantId;

    // 2. VISIBILITY -- the Q-1a predicate is inside the locking SELECT: an invisible record is not found and is never locked.
    const current = family === "opportunity" ? await lockOpportunity(db, tenantId, recordId, scope) : await lockAgreement(db, tenantId, recordId, scope);
    if (!current) return fail("RECORD_NOT_FOUND", "NOT_FOUND", `the ${LABEL[family]} does not exist in this tenant`);
    // DQ-020: the governing channel (an Agreement's is its Opportunity's). The capability is held globally, so this admits; stated for the kernel's fail-closed rule.
    scope.admitChannel(family === "opportunity" ? (current as { salesChannel: string | null }).salesChannel
      : await sourceOpportunityChannel(db, tenantId, current as Parameters<typeof sourceOpportunityChannel>[2]));

    // 3. TARGET REACH -- the governed ACTIVE company and its key, then the caller's reach over it (same words as an ungoverned company).
    const key = await operatingCompanyKeyFor(db, tenantId, companyId) as string;
    scope.admitNewCompany(key, companyId);

    // 4. STILL COMPANY-LESS -- never a change, never a clear.
    if (current.operatingCompanyKey !== null) {
      fail("OPERATING_COMPANY_ALREADY_SET", "PRECONDITION_FAILED", "the record already has an operating company; this command sets it once and never changes it");
    }

    // 5. LINEAGE.
    const cascaded: string[] = [];
    let editVersion: number | null = null;
    if (family === "opportunity") {
      const disagreeing = await db.query(
        `SELECT 1 FROM eos_commercial.sales_agreements WHERE tenant_id = $1 AND opportunity_id = $2 AND operating_company_key IS NOT NULL AND operating_company_key <> $3`,
        [tenantId, recordId, key]);
      if (disagreeing.rows.length > 0) fail("LINEAGE_DISAGREEMENT", "PRECONDITION_FAILED", "the operating company must agree with the records of this lineage");
      const set = await db.query(
        `UPDATE eos_commercial.opportunities SET operating_company_key = $3, edit_version = edit_version + 1, updated_by = $4, updated_at = now()
          WHERE tenant_id = $1 AND id = $2 AND operating_company_key IS NULL RETURNING edit_version`,
        [tenantId, recordId, key, actor.principalId]);
      if (set.rowCount !== 1) fail("CONCURRENT_MODIFICATION", "CONFLICT", "the record changed since it was read; reload and retry");
      editVersion = Number(set.rows[0].edit_version);
      // The company-less Agreement of this Opportunity follows it, in this transaction (it may not be visible to the caller: it is recorded in the audit row only).
      const children = await db.query<{ id: string }>(
        `UPDATE eos_commercial.sales_agreements SET operating_company_key = $3, updated_by = $4, updated_at = now()
          WHERE tenant_id = $1 AND opportunity_id = $2 AND operating_company_key IS NULL RETURNING id`,
        [tenantId, recordId, key, actor.principalId]);
      cascaded.push(...children.rows.map((r) => r.id).sort());
    } else {
      const agreement = current as { opportunityId: string | null };
      if (agreement.opportunityId !== null) {
        const parent = await db.query<{ operating_company_key: string | null }>(
          `SELECT operating_company_key FROM eos_commercial.opportunities WHERE tenant_id = $1 AND id = $2`, [tenantId, agreement.opportunityId]);
        if ((parent.rows[0]?.operating_company_key ?? null) !== key) {
          fail("LINEAGE_DISAGREEMENT", "PRECONDITION_FAILED", "the operating company must agree with the records of this lineage");
        }
      }
      const set = await db.query(
        `UPDATE eos_commercial.sales_agreements SET operating_company_key = $3, updated_by = $4, updated_at = now()
          WHERE tenant_id = $1 AND id = $2 AND operating_company_key IS NULL`,
        [tenantId, recordId, key, actor.principalId]);
      if (set.rowCount !== 1) fail("CONCURRENT_MODIFICATION", "CONFLICT", "the record changed since it was read; reload and retry");
    }

    return {
      result: { family: input.family, recordId, operatingCompanyId: companyId, editVersion },
      target: { family, id: recordId },
      audit: {
        action: "commercial.recordCompany.assign", targetKind: family, targetId: recordId,
        before: { operatingCompanyId: null, operatingCompanyKey: null },
        after: { operatingCompanyId: companyId, operatingCompanyKey: key, cascadedSalesAgreementIds: cascaded, editVersion },
        reason,
      },
    };
  }, replayTarget);
}
