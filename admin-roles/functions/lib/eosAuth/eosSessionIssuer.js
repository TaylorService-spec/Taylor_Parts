"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PersonaIssuanceError = void 0;
exports.issueNonprodPersonaSession = issueNonprodPersonaSession;
// THE NONPROD PERSONA SESSION ISSUER -- a controlled issuer of the SAME EOS access token a future human
// front door will issue. docs/architecture/eos-identity-session-foundation.md, section 3(d).
//
// ════════════════════ WHAT IT CAN MINT ════════════════════
//
// A token for ONE of the 16 governed persona keys (nonprodPersonas.ts), IN NONPROD, and nothing else. There
// is no subject parameter: the subject is the pure derivation `nonprod-persona.<key>`, and the ONLY mapping
// from that subject to a Principal is an ACTIVE eos_policy.principal_identities row, written by the governed
// bindPrincipalEosIdentity command. So this cannot impersonate a human, cannot mint for an unbound persona,
// and cannot be pointed at production:
//
//   code      refuses unless environment === "nonprod"
//   key       refuses unless the signer's kid is a nonprod- kid (and no production signing variable exists)
//   registry  refuses any key outside the 16
//
// ════════════════════ NO CREDENTIAL DISCOVERY ════════════════════
//
// No password file, no Firebase Auth, no ADC. Nothing here imports firebase or google packages
// (test/eosAuthNoFirebase.test.mjs). The caller of the HTTP route is authenticated separately
// (eosAuthHttp.ts) by the persona issuer credential, compared by hash.
//
// ════════════════════ AUDIT ════════════════════
//
// One audit_events row per session, in the persona's tenant, with actor_uid = THE PERSONA PRINCIPAL. The
// token itself is never written anywhere.
const principalContext_1 = require("../adminPolicy/principalContext");
const eosAccessToken_1 = require("./eosAccessToken");
const nonprodPersonas_1 = require("./nonprodPersonas");
class PersonaIssuanceError extends Error {
    refusal;
    detail;
    constructor(refusal, detail = null) {
        super(detail ? `${refusal}: ${detail}` : refusal);
        this.refusal = refusal;
        this.detail = detail;
        this.name = "PersonaIssuanceError";
    }
}
exports.PersonaIssuanceError = PersonaIssuanceError;
async function issueNonprodPersonaSession(deps, personaKey) {
    // STRUCTURAL REFUSALS FIRST -- before any database read.
    if (deps.environment !== "nonprod")
        throw new PersonaIssuanceError("ISSUER_DISABLED_OUTSIDE_NONPROD");
    if (!deps.signer.kid.startsWith("nonprod-"))
        throw new PersonaIssuanceError("ISSUER_KEY_NOT_NONPROD");
    if (!(0, nonprodPersonas_1.isNonprodPersonaKey)(personaKey))
        throw new PersonaIssuanceError("UNKNOWN_PERSONA");
    const subject = (0, nonprodPersonas_1.nonprodPersonaSubject)(personaKey);
    // THE SAME resolution every request uses -- binding, Principal status, membership, tenant, DQ-007
    // employment gate. A persona that could not make a request gets no session to make it with.
    let ctx;
    try {
        ctx = await (0, principalContext_1.resolvePrincipalContext)(deps.repo, { identityProvider: principalContext_1.EOS_IDENTITY_PROVIDER, externalSubject: subject });
    }
    catch (err) {
        if (err instanceof principalContext_1.PrincipalContextError)
            throw new PersonaIssuanceError("PERSONA_NOT_ELIGIBLE", err.refusal);
        throw err;
    }
    const lifetime = Math.min(deps.lifetimeSeconds ?? eosAccessToken_1.EOS_TOKEN_MAX_LIFETIME_SECONDS, eosAccessToken_1.EOS_TOKEN_MAX_LIFETIME_SECONDS);
    const iat = (deps.nowSeconds ?? (() => Math.floor(Date.now() / 1000)))();
    const exp = iat + lifetime;
    const jti = (0, eosAccessToken_1.newTokenId)();
    const token = (0, eosAccessToken_1.signEosAccessToken)(deps.signer, {
        iss: deps.issuer, aud: deps.audience, sub: subject, iat, exp, jti, env: "nonprod",
    });
    const expiresAt = new Date(exp * 1000).toISOString();
    await deps.repo.transact({ tenantId: ctx.tenantId, uid: ctx.uid }, async (tx) => {
        await tx.appendAudit({
            action: "issueNonprodPersonaSession",
            // THE PERSONA PRINCIPAL is the actor: it is the identity this session will act as.
            actorUid: ctx.uid,
            targetKind: "eosSession",
            targetId: jti,
            before: null,
            after: { personaKey, subject, identityProvider: principalContext_1.EOS_IDENTITY_PROVIDER, kid: deps.signer.kid, expiresAt },
            occurredAt: new Date(iat * 1000).toISOString(),
            reason: "nonprod persona session issued by the EOS persona issuer",
        });
    });
    return Object.freeze({ token, tokenType: "Bearer", expiresAt, personaKey, principalId: ctx.uid, jti });
}
//# sourceMappingURL=eosSessionIssuer.js.map