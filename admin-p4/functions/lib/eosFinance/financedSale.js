"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.FUNDING_ENTITLED_STATES = exports.FINANCING_TRANSITIONS = exports.FINANCING_STATUSES = void 0;
exports.recordFinancingArrangement = recordFinancingArrangement;
exports.recordFinancingApprovalEvidence = recordFinancingApprovalEvidence;
exports.transitionFinancingArrangement = transitionFinancingArrangement;
exports.restructureFinancedSale = restructureFinancedSale;
exports.financedConsequenceOn = financedConsequenceOn;
exports.readFinancingArrangement = readFinancingArrangement;
exports.providerCounterpartyOn = providerCounterpartyOn;
const node_crypto_1 = require("node:crypto");
const financeFoundation_1 = require("./financeFoundation");
// Used at call time only (billingPackage imports this module for the financed consequence).
const billingPackage = __importStar(require("./billingPackage"));
exports.FINANCING_STATUSES = Object.freeze(["APPLIED", "APPROVED", "FUNDING_ENTITLED", "FUNDED", "DECLINED", "CANCELLED"]);
/** Exact transitions (the database enforces the same set). FUNDED, DECLINED and CANCELLED are terminal. */
exports.FINANCING_TRANSITIONS = Object.freeze({
    APPLIED: ["APPROVED", "DECLINED", "CANCELLED"],
    APPROVED: ["FUNDING_ENTITLED", "DECLINED", "CANCELLED"],
    FUNDING_ENTITLED: ["FUNDED"],
    FUNDED: [],
    DECLINED: [],
    CANCELLED: [],
});
/** States in which the provider's payment is owed to Taylor: only then does any receivable exist. */
exports.FUNDING_ENTITLED_STATES = Object.freeze(["FUNDING_ENTITLED", "FUNDED"]);
const refuse = (code, category, message) => {
    throw new financeFoundation_1.FinanceFoundationError(code, category, message);
};
const text = (v, name, max = 200) => {
    if (typeof v !== "string" || v.trim() === "" || v.length > max)
        refuse(`${name.replace(/[A-Z]/g, (m) => `_${m}`).toUpperCase()}_REQUIRED`, "INVALID_INPUT", `${name} is required`);
    return v.trim();
};
async function tx(pool, fn) {
    const c = await pool.connect();
    try {
        await c.query("BEGIN");
        const out = await fn(c);
        await c.query("COMMIT");
        return out;
    }
    catch (err) {
        await c.query("ROLLBACK").catch(() => undefined);
        throw err;
    }
    finally {
        c.release();
    }
}
/** Record the customer's financing arrangement on its Sales Agreement. The commercial customer is never replaced. */
async function recordFinancingArrangement(pool, actor, input) {
    for (const k of Object.keys(input ?? {})) {
        if (!["salesAgreementId", "financingProviderAccountId", "arrangementKind", "customerContributionMinor", "providerReference", "idempotencyKey"].includes(k)) {
            refuse("FIELD_NOT_ACCEPTED", "INVALID_INPUT", `not accepted: ${k}`);
        }
    }
    const agreementId = text(input.salesAgreementId, "salesAgreementId");
    const providerId = text(input.financingProviderAccountId, "financingProviderAccountId");
    const key = text(input.idempotencyKey, "idempotencyKey");
    if (input.arrangementKind !== "LEASE" && input.arrangementKind !== "FINANCING")
        refuse("ARRANGEMENT_KIND_INVALID", "INVALID_INPUT", "arrangementKind is LEASE or FINANCING");
    // The contribution is stated explicitly -- 0 is a real "none", an omission is not.
    if (!Number.isSafeInteger(input.customerContributionMinor) || input.customerContributionMinor < 0) {
        refuse("CUSTOMER_CONTRIBUTION_INVALID", "INVALID_INPUT", "customerContributionMinor is stated in non-negative minor units (0 = none)");
    }
    const reference = input.providerReference === undefined || input.providerReference === null ? null : text(input.providerReference, "providerReference");
    return tx(pool, async (c) => {
        const { rows: replay } = await c.query(`SELECT * FROM eos_commercial.financing_arrangements WHERE tenant_id = $1 AND idempotency_key = $2`, [actor.tenantId, key]);
        if (replay[0])
            return Object.freeze({ outcome: "replayed", arrangementId: String(replay[0].id), status: String(replay[0].status) });
        const { rows: ag } = await c.query(`SELECT id, account_id, currency, state::text AS state FROM eos_commercial.sales_agreements WHERE tenant_id = $1 AND id = $2 FOR SHARE`, [actor.tenantId, agreementId]);
        const a = ag[0] ?? refuse("SALES_AGREEMENT_NOT_FOUND", "NOT_FOUND", "no Sales Agreement with that id");
        if (a.state === "DECLINED")
            refuse("SALES_AGREEMENT_DECLINED", "PRECONDITION_FAILED", "a declined Agreement takes no financing");
        if (a.account_id === providerId)
            refuse("FINANCING_PROVIDER_IS_CUSTOMER", "PRECONDITION_FAILED", "the financing provider never replaces the commercial customer");
        const id = `fin_${(0, node_crypto_1.randomUUID)()}`;
        await c.query(`INSERT INTO eos_commercial.financing_arrangements (id, tenant_id, sales_agreement_id, commercial_customer_account_id, financing_provider_account_id,
          arrangement_kind, currency, customer_contribution_minor, provider_reference, idempotency_key, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)`, [id, actor.tenantId, agreementId, a.account_id, providerId, input.arrangementKind, a.currency ?? "USD", input.customerContributionMinor, reference, key, actor.principalId])
            .catch((e) => {
            if (/FINANCING_PROVIDER_NOT_GOVERNED/.test(e.message ?? ""))
                refuse("FINANCING_PROVIDER_NOT_GOVERNED", "PRECONDITION_FAILED", "the organization is not governed as a financing provider");
            if (e.constraint === "financing_arrangement_one_current_per_agreement")
                refuse("FINANCING_ARRANGEMENT_EXISTS", "CONFLICT", "the Agreement already has a financing arrangement");
            throw e;
        });
        await c.query(`INSERT INTO eos_commercial.financing_arrangement_events (id, tenant_id, arrangement_id, from_status, to_status, reason, provider_reference, recorded_by, idempotency_key)
       VALUES ($1,$2,$3,NULL,'APPLIED','financing arrangement recorded',$4,$5,$6)`, [`fev_${(0, node_crypto_1.randomUUID)()}`, actor.tenantId, id, reference, actor.principalId, `${key}:applied`]);
        return Object.freeze({ outcome: "recorded", arrangementId: id, status: "APPLIED" });
    });
}
/**
 * FINANCING PROVIDER APPROVAL DOCUMENTATION (#201): record evidence that the provider's documents are signed and/or
 * approved. Append-only; a record that is not BOTH signed and approved is kept but never entitles. The reference is a
 * document identifier (never a file, never a credential).
 */
async function recordFinancingApprovalEvidence(pool, actor, input) {
    for (const k of Object.keys(input ?? {})) {
        if (!["arrangementId", "documentReference", "signed", "approved", "documentSha256", "providerReference", "correlationId", "idempotencyKey"].includes(k)) {
            refuse("FIELD_NOT_ACCEPTED", "INVALID_INPUT", `not accepted: ${k} (no document content or credential is stored here)`);
        }
    }
    const id = text(input.arrangementId, "arrangementId");
    const documentReference = text(input.documentReference, "documentReference", 300);
    const key = text(input.idempotencyKey, "idempotencyKey");
    if (typeof input.signed !== "boolean" || typeof input.approved !== "boolean")
        refuse("EVIDENCE_FLAGS_REQUIRED", "INVALID_INPUT", "signed and approved are stated explicitly (true / false)");
    const sha = input.documentSha256 === undefined || input.documentSha256 === null ? null : String(input.documentSha256);
    if (sha !== null && !/^[0-9a-f]{64}$/.test(sha))
        refuse("DOCUMENT_SHA256_INVALID", "INVALID_INPUT", "documentSha256 is 64 lowercase hex characters");
    const reference = input.providerReference === undefined || input.providerReference === null ? null : text(input.providerReference, "providerReference");
    const correlation = input.correlationId === undefined || input.correlationId === null ? null : text(input.correlationId, "correlationId");
    return tx(pool, async (c) => {
        const { rows: replay } = await c.query(`SELECT id FROM eos_commercial.financing_approval_evidence WHERE tenant_id = $1 AND idempotency_key = $2`, [actor.tenantId, key]);
        if (replay[0])
            return Object.freeze({ outcome: "replayed", evidenceId: String(replay[0].id) });
        const { rows } = await c.query(`SELECT * FROM eos_commercial.financing_arrangements WHERE tenant_id = $1 AND id = $2 FOR SHARE`, [actor.tenantId, id]);
        const fa = rows[0] ?? refuse("FINANCING_ARRANGEMENT_NOT_FOUND", "NOT_FOUND", "no financing arrangement with that id");
        if (!["APPLIED", "APPROVED"].includes(fa.status) || fa.restructure_id !== null) {
            refuse("FINANCING_EVIDENCE_NOT_ACCEPTED", "CONFLICT", `approval documentation is recorded for an open arrangement; this one is ${fa.status}`);
        }
        const evidenceId = `fae_${(0, node_crypto_1.randomUUID)()}`;
        await c.query(`INSERT INTO eos_commercial.financing_approval_evidence (id, tenant_id, arrangement_id, financing_provider_account_id, provider_reference, document_reference,
          document_sha256, signed, approved, recorded_by, correlation_id, idempotency_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [evidenceId, actor.tenantId, id, fa.financing_provider_account_id, reference ?? fa.provider_reference, documentReference, sha, input.signed, input.approved,
            actor.principalId, correlation, key]);
        return Object.freeze({ outcome: "recorded", evidenceId, entitles: input.signed === true && input.approved === true });
    });
}
/**
 * Move an arrangement along its governed lifecycle. APPROVED -> FUNDING_ENTITLED requires `evidenceId`: this arrangement's
 * SIGNED + APPROVED provider documentation (the database checks it too); in the same transaction the provider's
 * FUNDING_RECEIVABLE is opened for the current READY financed package (or when the package becomes READY). A decline /
 * cancellation before entitlement re-evaluates the package (HELD) -- the sale is not destroyed and may be restructured.
 */
async function transitionFinancingArrangement(pool, actor, input) {
    const id = text(input.arrangementId, "arrangementId");
    const reason = text(input.reason, "reason", 500);
    const key = text(input.idempotencyKey, "idempotencyKey");
    const to = input.toStatus;
    if (!exports.FINANCING_STATUSES.includes(to))
        refuse("FINANCING_STATUS_INVALID", "INVALID_INPUT", `toStatus is one of ${exports.FINANCING_STATUSES.join(", ")}`);
    const evidenceId = to === "FUNDING_ENTITLED" ? text(input.evidenceId, "evidenceId") : null;
    if (to !== "FUNDING_ENTITLED" && input.evidenceId !== undefined)
        refuse("FIELD_NOT_ACCEPTED", "INVALID_INPUT", "approval evidence belongs only to FUNDING_ENTITLED");
    const reference = input.providerReference === undefined || input.providerReference === null ? null : text(input.providerReference, "providerReference");
    return tx(pool, async (c) => {
        const { rows: replay } = await c.query(`SELECT to_status FROM eos_commercial.financing_arrangement_events WHERE tenant_id = $1 AND idempotency_key = $2`, [actor.tenantId, key]);
        if (replay[0])
            return Object.freeze({ outcome: "replayed", arrangementId: id, status: String(replay[0].to_status), consequences: [] });
        const { rows } = await c.query(`SELECT * FROM eos_commercial.financing_arrangements WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [actor.tenantId, id]);
        const fa = rows[0] ?? refuse("FINANCING_ARRANGEMENT_NOT_FOUND", "NOT_FOUND", "no financing arrangement with that id");
        if (fa.restructure_id !== null)
            refuse("FINANCING_ARRANGEMENT_RESTRUCTURED", "CONFLICT", "the arrangement was replaced by a restructure");
        if (!exports.FINANCING_TRANSITIONS[fa.status].includes(to)) {
            refuse("FINANCING_TRANSITION_REFUSED", "CONFLICT", `${fa.status} -> ${to} is not a financing transition`);
        }
        // FUNDED means the provider's money was RECEIVED (#206): only once every FUNDING_RECEIVABLE of its package is fully settled
        // by applied provider funding. FUNDING_ENTITLED never meant money received.
        if (to === "FUNDED") {
            const { rows: fr } = await c.query(`SELECT b.outstanding_minor FROM eos_finance.billing_packages p JOIN eos_finance.obligations o ON o.tenant_id = p.tenant_id
            AND o.source_domain = 'BILLING_PACKAGE' AND o.source_record_id = p.id AND o.kind = 'FUNDING_RECEIVABLE' AND o.status <> 'VOID'
           JOIN eos_finance.obligation_balances b ON b.tenant_id = o.tenant_id AND b.obligation_id = o.id
          WHERE p.tenant_id = $1 AND p.financing_arrangement_id = $2`, [actor.tenantId, id]);
            if (fr.length === 0 || fr.some((x) => BigInt(x.outstanding_minor) !== 0n)) {
                refuse("FUNDING_NOT_RECEIVED", "PRECONDITION_FAILED", "FUNDED requires the provider's funding receivable to be fully settled by recorded, applied provider funding");
            }
        }
        if (evidenceId !== null) {
            const { rows: ev } = await c.query(`SELECT signed, approved FROM eos_commercial.financing_approval_evidence WHERE tenant_id = $1 AND id = $2 AND arrangement_id = $3`, [actor.tenantId, evidenceId, id]);
            if (!ev[0] || ev[0].signed !== true || ev[0].approved !== true) {
                refuse("FUNDING_EVIDENCE_INSUFFICIENT", "PRECONDITION_FAILED", "FUNDING_ENTITLED requires this arrangement's SIGNED and APPROVED provider documentation");
            }
        }
        if (reference !== null && fa.provider_reference !== null && reference !== fa.provider_reference) {
            refuse("PROVIDER_REFERENCE_ALREADY_RECORDED", "CONFLICT", "a provider reference is recorded once");
        }
        await c.query(`UPDATE eos_commercial.financing_arrangements SET status = $3, entitlement_evidence_id = COALESCE($4, entitlement_evidence_id),
          provider_reference = COALESCE(provider_reference, $5), updated_by = $6, updated_at = now() WHERE tenant_id = $1 AND id = $2`, [actor.tenantId, id, to, evidenceId, reference, actor.principalId]);
        await c.query(`INSERT INTO eos_commercial.financing_arrangement_events (id, tenant_id, arrangement_id, from_status, to_status, reason, provider_reference, evidence_id, recorded_by, idempotency_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [`fev_${(0, node_crypto_1.randomUUID)()}`, actor.tenantId, id, fa.status, to, reason, reference, evidenceId, actor.principalId, key]);
        const consequences = [];
        if (to === "DECLINED" || to === "CANCELLED") {
            // Before funding, a decline / cancellation HOLDS the sale (#200 §12): its READY package is re-evaluated, and the new
            // version is HELD with FINANCING_NOT_AVAILABLE. Nothing becomes customer A/R; an explicit restructure may follow.
            const { rows: so } = await c.query(`SELECT DISTINCT p.sales_order_id FROM eos_finance.billing_packages p WHERE p.tenant_id = $1 AND p.financing_arrangement_id = $2 AND p.status = 'READY'`, [actor.tenantId, id]);
            for (const r of so)
                consequences.push(await billingPackage.prepareBillingPackageOn(c, actor, { salesOrderId: String(r.sales_order_id) }));
        }
        if (to === "FUNDING_ENTITLED") {
            const { rows: pk } = await c.query(`SELECT id FROM eos_finance.billing_packages WHERE tenant_id = $1 AND financing_arrangement_id = $2 AND status = 'READY'`, [actor.tenantId, id]);
            for (const p of pk)
                consequences.push({ packageId: String(p.id), ...(await financedConsequenceOn(c, actor, String(p.id))) });
        }
        return Object.freeze({ outcome: "transitioned", arrangementId: id, status: to, consequences });
    });
}
/**
 * EXPLICIT COMMERCIAL RESTRUCTURE of an UNFUNDED financed sale (#201 §5): only after its current arrangement was DECLINED or
 * CANCELLED (so never once funding-entitled / funded). Either a new arrangement with another (or the same) provider, or a
 * conversion to DIRECT_SALE. Recorded, history-preserving, never silent; the Sales Orders' packages are re-evaluated.
 */
async function restructureFinancedSale(pool, actor, input) {
    const agreementId = text(input.salesAgreementId, "salesAgreementId");
    const reason = text(input.reason, "reason", 500);
    const key = text(input.idempotencyKey, "idempotencyKey");
    if (input.toKind !== "DIRECT_SALE" && input.toKind !== "FINANCING_ARRANGEMENT")
        refuse("RESTRUCTURE_KIND_INVALID", "INVALID_INPUT", "toKind is DIRECT_SALE or FINANCING_ARRANGEMENT");
    if ((input.toKind === "FINANCING_ARRANGEMENT") !== (input.newArrangement !== undefined && input.newArrangement !== null)) {
        refuse("RESTRUCTURE_TARGET_INVALID", "INVALID_INPUT", "a FINANCING_ARRANGEMENT restructure states its new arrangement; a DIRECT_SALE one does not");
    }
    const n = input.newArrangement;
    if (n) {
        if (n.arrangementKind !== "LEASE" && n.arrangementKind !== "FINANCING")
            refuse("ARRANGEMENT_KIND_INVALID", "INVALID_INPUT", "arrangementKind is LEASE or FINANCING");
        if (!Number.isSafeInteger(n.customerContributionMinor) || n.customerContributionMinor < 0) {
            refuse("CUSTOMER_CONTRIBUTION_INVALID", "INVALID_INPUT", "customerContributionMinor is stated in non-negative minor units (0 = none)");
        }
    }
    return tx(pool, async (c) => {
        const { rows: replay } = await c.query(`SELECT id, to_kind, to_arrangement_id FROM eos_commercial.financing_restructures WHERE tenant_id = $1 AND idempotency_key = $2`, [actor.tenantId, key]);
        if (replay[0])
            return Object.freeze({ outcome: "replayed", restructureId: String(replay[0].id), toKind: String(replay[0].to_kind), arrangementId: replay[0].to_arrangement_id, consequences: [] });
        const { rows } = await c.query(`SELECT fa.*, a.account_id, a.currency AS agreement_currency FROM eos_commercial.financing_arrangements fa
         JOIN eos_commercial.sales_agreements a ON a.tenant_id = fa.tenant_id AND a.id = fa.sales_agreement_id
        WHERE fa.tenant_id = $1 AND fa.sales_agreement_id = $2 AND fa.restructure_id IS NULL FOR UPDATE OF fa`, [actor.tenantId, agreementId]);
        const fa = rows[0] ?? refuse("FINANCING_ARRANGEMENT_NOT_FOUND", "NOT_FOUND", "the Agreement has no current financing arrangement");
        if (fa.status !== "DECLINED" && fa.status !== "CANCELLED") {
            refuse("FINANCING_RESTRUCTURE_REFUSED", "CONFLICT", `only a declined / cancelled, unfunded arrangement is restructured; this one is ${fa.status}`);
        }
        const restructureId = `frs_${(0, node_crypto_1.randomUUID)()}`;
        let newId = null;
        let providerId = null;
        let ref = null;
        if (n) {
            providerId = text(n.financingProviderAccountId, "financingProviderAccountId");
            if (providerId === fa.account_id)
                refuse("FINANCING_PROVIDER_IS_CUSTOMER", "PRECONDITION_FAILED", "the financing provider never replaces the commercial customer");
            ref = n.providerReference === undefined || n.providerReference === null ? null : text(n.providerReference, "providerReference");
            newId = `fin_${(0, node_crypto_1.randomUUID)()}`;
        }
        // 1. the restructure record; 2. the replaced arrangement retires (stays as history); 3. the new arrangement, if any.
        await c.query(`INSERT INTO eos_commercial.financing_restructures (id, tenant_id, sales_agreement_id, from_arrangement_id, to_kind, to_arrangement_id, reason, recorded_by, idempotency_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [restructureId, actor.tenantId, agreementId, fa.id, input.toKind, newId, reason, actor.principalId, key]);
        await c.query(`UPDATE eos_commercial.financing_arrangements SET restructure_id = $3, updated_by = $4, updated_at = now() WHERE tenant_id = $1 AND id = $2`, [actor.tenantId, fa.id, restructureId, actor.principalId]);
        if (n && newId) {
            await c.query(`INSERT INTO eos_commercial.financing_arrangements (id, tenant_id, sales_agreement_id, commercial_customer_account_id, financing_provider_account_id,
            arrangement_kind, currency, customer_contribution_minor, provider_reference, idempotency_key, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)`, [newId, actor.tenantId, agreementId, fa.account_id, providerId, n.arrangementKind, fa.agreement_currency ?? "USD", n.customerContributionMinor, ref, `${key}:arrangement`, actor.principalId])
                .catch((e) => {
                if (/FINANCING_PROVIDER_NOT_GOVERNED/.test(e.message ?? ""))
                    refuse("FINANCING_PROVIDER_NOT_GOVERNED", "PRECONDITION_FAILED", "the organization is not governed as a financing provider");
                throw e;
            });
            await c.query(`INSERT INTO eos_commercial.financing_arrangement_events (id, tenant_id, arrangement_id, from_status, to_status, reason, provider_reference, recorded_by, idempotency_key)
         VALUES ($1,$2,$3,NULL,'APPLIED',$4,$5,$6,$7)`, [`fev_${(0, node_crypto_1.randomUUID)()}`, actor.tenantId, newId, `restructured from ${fa.id}: ${reason}`, ref, actor.principalId, `${key}:applied`]);
        }
        // The sale's packages are re-evaluated from the new commercial structure (a direct sale, or the new arrangement).
        const consequences = [];
        const { rows: so } = await c.query(`SELECT id FROM eos_commercial.sales_orders WHERE tenant_id = $1 AND sales_agreement_id = $2 ORDER BY id`, [actor.tenantId, agreementId]);
        for (const r of so)
            consequences.push(await billingPackage.prepareBillingPackageOn(c, actor, { salesOrderId: String(r.id) }));
        return Object.freeze({ outcome: "restructured", restructureId, toKind: String(input.toKind), arrangementId: newId, consequences });
    });
}
/**
 * THE FINANCED CONSEQUENCE of ONE READY financed package, inside the caller's transaction (idempotent; amounts come from
 * the package). The CUSTOMER side -- a RECEIVABLE for a positive contribution -- follows the READY package at once (#201 §4).
 * The PROVIDER side -- exactly one FUNDING_RECEIVABLE for the financed amount, and the financed sale's accounting handoff
 * (carrying both parties) -- only once the arrangement is funding-entitled by signed + approved documentation.
 */
async function financedConsequenceOn(c, actor, packageId) {
    const { rows } = await c.query(`SELECT p.*, fa.status AS arrangement_status FROM eos_finance.billing_packages p
       JOIN eos_commercial.financing_arrangements fa ON fa.tenant_id = p.tenant_id AND fa.id = p.financing_arrangement_id
      WHERE p.tenant_id = $1 AND p.id = $2`, [actor.tenantId, packageId]);
    const p = rows[0] ?? refuse("FINANCED_PACKAGE_NOT_FOUND", "NOT_FOUND", "no financed billing package with that id");
    if (p.status !== "READY" || p.commercial_disposition !== "FINANCED_SALE" || p.obligor_basis !== "FINANCING_PROVIDER_FUNDED") {
        refuse("FINANCED_PACKAGE_NOT_READY", "PRECONDITION_FAILED", "only a READY financed package has a financed consequence");
    }
    if (p.tax_evidence_status !== "DETERMINED")
        refuse("TAX_NOT_DETERMINED", "PRECONDITION_FAILED", "the package's tax is not from DETERMINED evidence");
    const financed = BigInt(p.financed_amount_minor);
    const contribution = BigInt(p.customer_contribution_minor);
    // #203: total = cash contribution + trade-in credit + financed amount (the trade-in is consideration, never cash).
    if (financed + contribution + BigInt(p.trade_in_minor ?? 0) !== BigInt(p.total_minor)) {
        refuse("FINANCING_COMPOSITION_MISMATCH", "PRECONDITION_FAILED", "contribution + trade-in credit + financed must equal the total");
    }
    // CUSTOMER SIDE: independent of provider funding.
    let contributionReceivable = null;
    if (contribution > 0n) {
        const ar = await (0, financeFoundation_1.openObligationOn)(c, actor, {
            operatingCompanyId: p.operating_company_id, counterpartyId: p.counterparty_id, kind: "RECEIVABLE", currency: p.currency,
            sourceDomain: "BILLING_PACKAGE", sourceRecordId: packageId, originationAmountMinor: contribution, basis: "FINANCED_SALE_CUSTOMER_CONTRIBUTION",
            effectiveAt: p.prepared_at, idempotencyKey: `ar:bpk:${packageId}`, correlationId: p.sales_order_id,
        });
        contributionReceivable = Object.freeze({ outcome: ar.outcome, obligationId: ar.obligationId, amountMinor: contribution.toString() });
    }
    if (!exports.FUNDING_ENTITLED_STATES.includes(p.arrangement_status)) {
        return Object.freeze({ financing: "HELD_UNTIL_FUNDING_ENTITLEMENT", arrangementStatus: String(p.arrangement_status),
            fundingReceivable: null, contributionReceivable, handoff: null });
    }
    // PROVIDER SIDE: signed + approved documentation has entitled Taylor.
    const funding = await (0, financeFoundation_1.openObligationOn)(c, actor, {
        operatingCompanyId: p.operating_company_id, counterpartyId: p.financing_provider_counterparty_id, kind: "FUNDING_RECEIVABLE", currency: p.currency,
        sourceDomain: "BILLING_PACKAGE", sourceRecordId: packageId, originationAmountMinor: financed, basis: "FINANCED_SALE_FINANCED_AMOUNT",
        effectiveAt: p.prepared_at, idempotencyKey: `fr:bpk:${packageId}`, correlationId: p.sales_order_id,
    });
    const handoff = await billingPackage.ensurePackageHandoffOn(c, actor, p, funding.obligationId);
    return Object.freeze({
        financing: "ESTABLISHED", arrangementStatus: String(p.arrangement_status),
        fundingReceivable: Object.freeze({ outcome: funding.outcome, obligationId: funding.obligationId, amountMinor: financed.toString() }), contributionReceivable, handoff,
    });
}
/** Read an arrangement and its history. */
async function readFinancingArrangement(db, tenantId, arrangementId) {
    const { rows } = await db.query(`SELECT * FROM eos_commercial.financing_arrangements WHERE tenant_id = $1 AND id = $2`, [tenantId, arrangementId]);
    if (!rows[0])
        return null;
    const { rows: events } = await db.query(`SELECT from_status, to_status, reason, provider_reference, recorded_by, recorded_at FROM eos_commercial.financing_arrangement_events
      WHERE tenant_id = $1 AND arrangement_id = $2 ORDER BY recorded_at, id`, [tenantId, arrangementId]);
    return Object.freeze({ arrangement: rows[0], events });
}
/** Resolve the provider's counterparty for a package (the organization's single EXTERNAL_ORGANIZATION counterparty). */
async function providerCounterpartyOn(c, actor, providerAccountId) {
    return (await (0, financeFoundation_1.ensureExternalCounterparty)(c, actor, providerAccountId)).id;
}
//# sourceMappingURL=financedSale.js.map