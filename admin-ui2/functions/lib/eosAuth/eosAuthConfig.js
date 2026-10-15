"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EOS_AUTH_DISABLED = void 0;
exports.readEosAuthConfig = readEosAuthConfig;
// EOS AUTHENTICATION CONFIGURATION, read from the service environment (Render) -- never from a file.
//
// docs/architecture/eos-identity-session-foundation.md, section 3(b). Every variable is OPTIONAL: with none
// set, EOS token verification is off and the service is exactly the Firebase-only service it was. Setting
// them is an operator act on Render; this module only reads and validates them, and never prints a value.
//
//   EOS_AUTH_VERIFY_KEYS                  JSON { "<kid>": <Ed25519 public JWK> }   (public)
//   EOS_AUTH_ISSUER                       the issuer URL, e.g. https://eos-api-nonprod.onrender.com/auth
//   EOS_AUTH_AUDIENCE                     the API URL,    e.g. https://eos-api-nonprod.onrender.com
//   EOS_AUTH_SIGNING_KEY_NONPROD          Ed25519 private key, PKCS8 PEM or private JWK  (SECRET)
//   EOS_AUTH_SIGNING_KID                  the kid of that key; must be in EOS_AUTH_VERIFY_KEYS
//   EOS_PERSONA_ISSUER_CREDENTIAL_SHA256  64 hex: SHA-256 of the persona issuer credential (the raw
//                                         credential is NEVER in this environment)
//
// There is deliberately NO production signing variable. The only issuer in this foundation is the nonprod
// persona issuer, and it cannot be configured anywhere EOS_ENVIRONMENT is not exactly "nonprod".
const node_crypto_1 = require("node:crypto");
const eosAccessToken_1 = require("./eosAccessToken");
exports.EOS_AUTH_DISABLED = Object.freeze({ verify: null, issuer: null, audience: null, personaIssuer: null });
const present = (v) => typeof v === "string" && v.trim().length > 0;
const samePublicKey = (a, b) => a.export({ format: "der", type: "spki" }).equals(b.export({ format: "der", type: "spki" }));
/**
 * Read and validate. Throws EosAuthConfigError (the service refuses to start) on a PARTIAL or INCONSISTENT
 * configuration -- half a verifier is worse than none, because it looks configured.
 */
function readEosAuthConfig(env, serviceEnvironment) {
    const keysRaw = env.EOS_AUTH_VERIFY_KEYS;
    const signingRaw = env.EOS_AUTH_SIGNING_KEY_NONPROD;
    const kid = env.EOS_AUTH_SIGNING_KID;
    const credentialHash = env.EOS_PERSONA_ISSUER_CREDENTIAL_SHA256;
    if (!present(keysRaw)) {
        if (present(signingRaw) || present(kid) || present(credentialHash)) {
            throw new eosAccessToken_1.EosAuthConfigError("EOS signing/issuer variables are set but EOS_AUTH_VERIFY_KEYS is not");
        }
        return exports.EOS_AUTH_DISABLED;
    }
    // The token env claim is "nonprod" or "production"; this service refuses production outright, so the only
    // environment a verifier can be built for here is nonprod.
    if (serviceEnvironment !== "nonprod") {
        throw new eosAccessToken_1.EosAuthConfigError("EOS token verification requires EOS_ENVIRONMENT=nonprod");
    }
    if (!present(env.EOS_AUTH_ISSUER) || !present(env.EOS_AUTH_AUDIENCE)) {
        throw new eosAccessToken_1.EosAuthConfigError("EOS_AUTH_VERIFY_KEYS requires EOS_AUTH_ISSUER and EOS_AUTH_AUDIENCE");
    }
    const issuer = env.EOS_AUTH_ISSUER.trim();
    const audience = env.EOS_AUTH_AUDIENCE.trim();
    const keys = (0, eosAccessToken_1.parseEosVerifyKeyset)(keysRaw);
    const verify = (0, eosAccessToken_1.createEosTokenVerifier)({ environment: "nonprod", issuer, audience, keys });
    if (present(signingRaw) !== present(kid)) {
        throw new eosAccessToken_1.EosAuthConfigError("EOS_AUTH_SIGNING_KEY_NONPROD and EOS_AUTH_SIGNING_KID must be set together");
    }
    let personaIssuer = null;
    if (present(signingRaw) && present(kid)) {
        const signer = { kid: kid.trim(), privateKey: (0, eosAccessToken_1.parseEosSigningKey)(signingRaw) };
        if (!signer.kid.startsWith("nonprod-"))
            throw new eosAccessToken_1.EosAuthConfigError("EOS_AUTH_SIGNING_KID must be a nonprod- kid");
        const published = keys.get(signer.kid);
        if (!published)
            throw new eosAccessToken_1.EosAuthConfigError("EOS_AUTH_SIGNING_KID is not in EOS_AUTH_VERIFY_KEYS");
        if (!samePublicKey(published, (0, node_crypto_1.createPublicKey)(signer.privateKey))) {
            throw new eosAccessToken_1.EosAuthConfigError("EOS_AUTH_SIGNING_KEY_NONPROD does not match the public key published for its kid");
        }
        if (present(credentialHash)) {
            const h = credentialHash.trim().toLowerCase();
            if (!/^[0-9a-f]{64}$/.test(h))
                throw new eosAccessToken_1.EosAuthConfigError("EOS_PERSONA_ISSUER_CREDENTIAL_SHA256 must be 64 hex characters");
            personaIssuer = { signer, credentialSha256: h };
        }
        // Signing key without the credential hash: the issuer stays UNMOUNTED. Verification still works.
    }
    else if (present(credentialHash)) {
        throw new eosAccessToken_1.EosAuthConfigError("EOS_PERSONA_ISSUER_CREDENTIAL_SHA256 is set but no signing key is");
    }
    return Object.freeze({ verify, issuer, audience, personaIssuer });
}
//# sourceMappingURL=eosAuthConfig.js.map