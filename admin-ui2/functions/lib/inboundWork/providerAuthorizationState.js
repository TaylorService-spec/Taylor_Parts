"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OAuthStateError = exports.AUTHORIZATION_STATE_TTL_MS = void 0;
exports.hashAuthorizationState = hashAuthorizationState;
exports.issueAuthorizationState = issueAuthorizationState;
exports.assertAuthorizationStateUsable = assertAuthorizationStateUsable;
// Email Connections -- OAUTH STATE. Pure: no Firestore, no network, no clock of its own (time and
// randomness are arguments), so every rule below is testable directly.
//
// WHAT THE STATE PARAMETER IS FOR. The provider sends the administrator's browser back to EOS with an
// authorization code. Nothing in that redirect proves who started it, which connection it was for, or that
// it happened at all -- the browser is simply carrying whatever the redirect said. The state parameter is
// the only thing tying the returning code to a request EOS actually made, so it is generated server-side,
// stored server-side, and checked against every fact it was issued for before a single token is exchanged.
//
// THE FIVE FAILURES THIS CLOSES, and each is a rule below rather than a hope:
//   CSRF                  -- an attacker who can make the administrator's browser hit our callback cannot
//                            produce a state value we issued.
//   REPLAY                -- a state is single-use; the second presentation is refused even if the first
//                            succeeded seconds earlier.
//   CONNECTION SWAPPING   -- a code obtained for connection A cannot be redeemed against connection B: the
//                            connection id is bound INTO the stored state, not read from the callback.
//   PROVIDER MISMATCH     -- a Google code cannot be exchanged against a Microsoft connection.
//   REDIRECT INJECTION    -- the redirect URI is fixed at issue time and re-asserted at exchange; a
//                            callback naming a different one is refused rather than followed.
//
// PKCE IS INCLUDED even though this is a confidential client. The verifier never leaves the server, so an
// authorization code intercepted in the browser is worthless without it -- which is the one attack the
// client secret alone does not cover.
const node_crypto_1 = require("node:crypto");
/** How long an authorization may sit unfinished. Long enough to sign in and consent, no longer. */
exports.AUTHORIZATION_STATE_TTL_MS = 10 * 60 * 1000;
class OAuthStateError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.name = "OAuthStateError";
        this.code = code;
    }
}
exports.OAuthStateError = OAuthStateError;
const BASE64URL = (buffer) => buffer.toString("base64url");
function hashAuthorizationState(state) {
    return (0, node_crypto_1.createHash)("sha256").update(String(state ?? "")).digest("hex");
}
/**
 * Issue one state. `randomBytes` is an argument so a test can make the value deterministic without the
 * module ever choosing a weaker source: production passes node's crypto.randomBytes.
 */
function issueAuthorizationState(input, deps) {
    const connectionId = String(input?.connectionId ?? "").trim();
    const provider = String(input?.provider ?? "").trim();
    const redirectUri = String(input?.redirectUri ?? "").trim();
    const initiatedByUid = String(input?.initiatedByUid ?? "").trim();
    if (!connectionId || !provider || !initiatedByUid) {
        throw new OAuthStateError("STATE_MALFORMED", "connectionId, provider and initiatedByUid are all required.");
    }
    // HTTPS ONLY, with one exception: a local development redirect. Anything else is refused here rather
    // than sent to the provider, because the redirect is where the code lands.
    if (!/^https:\/\//.test(redirectUri) && !/^http:\/\/localhost(:\d+)?\//.test(redirectUri)) {
        throw new OAuthStateError("STATE_MALFORMED", "redirectUri must be https (or a localhost development URL).");
    }
    // 32 bytes each: the state is an unguessable identifier, and the verifier is the PKCE secret.
    const state = BASE64URL(deps.randomBytes(32));
    const codeVerifier = BASE64URL(deps.randomBytes(32));
    return {
        state,
        stateKey: hashAuthorizationState(state),
        codeChallenge: BASE64URL((0, node_crypto_1.createHash)("sha256").update(codeVerifier).digest()),
        record: {
            connectionId,
            provider,
            redirectUri,
            initiatedByUid,
            codeVerifier,
            createdAt: deps.now,
            expiresAt: deps.now + exports.AUTHORIZATION_STATE_TTL_MS,
            consumedAt: null,
        },
    };
}
/**
 * Everything that must be true before an authorization code is exchanged. Throws the specific refusal --
 * a caller that cannot say WHY it refused cannot be tested for refusing the right thing.
 *
 * The actor check is deliberate: the administrator who finishes an authorization must be the one who
 * started it. Two administrators mid-flight at once is not an error state anybody needs, and allowing it
 * would mean one person's browser could complete a connection another person initiated.
 */
function assertAuthorizationStateUsable(record, presented) {
    if (!record)
        throw new OAuthStateError("STATE_UNKNOWN", "That authorization request is not recognised.");
    if (record.consumedAt !== null)
        throw new OAuthStateError("STATE_ALREADY_USED", "That authorization request was already completed.");
    if (presented.now > record.expiresAt)
        throw new OAuthStateError("STATE_EXPIRED", "That authorization request has expired. Start again.");
    if (record.connectionId !== presented.connectionId) {
        throw new OAuthStateError("STATE_CONNECTION_MISMATCH", "That authorization was started for a different connection.");
    }
    if (record.provider !== presented.provider) {
        throw new OAuthStateError("STATE_PROVIDER_MISMATCH", "That authorization was started for a different provider.");
    }
    if (record.redirectUri !== presented.redirectUri) {
        throw new OAuthStateError("STATE_REDIRECT_MISMATCH", "That authorization used a different redirect address.");
    }
    if (record.initiatedByUid !== presented.actorUid) {
        throw new OAuthStateError("STATE_ACTOR_MISMATCH", "That authorization was started by a different administrator.");
    }
    return record;
}
//# sourceMappingURL=providerAuthorizationState.js.map