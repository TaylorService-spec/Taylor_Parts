## EOS identity/session foundation (additive, inert on merge) + Reporting Analyst registry correction

This is the smallest EOS-owned identity/session foundation that can eventually replace Firebase Authentication (Controller ruling 2026-09-29, "EOS IDENTITY BOUNDARY", Option A). The nonprod persona harness is a controlled issuer and user of this same session architecture. **Authorization is unchanged:** PostgreSQL stays authoritative, and tokens carry identity only.

### Architecture
Persona or human → EOS session issuer → short-lived EdDSA token (15 minutes at most) → a composite verifier serving all six transports (EOS or Firebase) → one resolution function → existing Principal → the existing employment gate (DQ-007) → the existing PostgreSQL authorization.

- **Token:** a compact JWS using Ed25519 from Node's built-in `crypto`, with no new dependency.
  - Strict alg allow-list, kid and environment prefix, signature, iss, aud, env, expiry and lifetime cap.
  - Any authority-bearing claim is refused.
- **Identity binding:** migration `1764200000000_eos-principal-identities` adds `eos_policy.principal_identities`.
  - Provider `eos` only, bound to an EXISTING Principal, so there is no new Principal or Employee.
  - Append-only; revoke-once; one active binding per Principal.
  - The down migration refuses while any binding exists.
  - Governed, audited bind and revoke commands; self-binding is refused.
- **Nonprod persona issuer:** `POST /auth/nonprod/persona-session`.
  - It serves only the 16 registry personas and requires a caller credential, compared by SHA-256 in constant time.
  - It answers 404 unless the service is nonprod and fully configured.
  - Issuance is audited with the persona Principal as actor.
- **Production refusal:** a production-mode verifier rejects nonprod tokens and nonprod issuer or audience, even when they are signed by a trusted key. Issuance refuses outside nonprod.
- **Client:** it uses an EOS session when one is present and otherwise Firebase, unchanged. A production-role build ignores EOS sessions.
- **Firebase Auth:** unchanged. It is now classified TRANSITIONAL_ACTIVE_PENDING_RETIREMENT (FX-AUTH-001), with a usage count of 7 that cannot increase.

### Reporting Analyst registry correction (known defect D1)
`config/sandboxRoleIdentityRegistry.json` now records the Reporting Analyst account created by Persona Foundation Phase 1:
- `uid` set, `accountExists: true`, `credentialDisposition: PRESERVE` (never recreate, never rotate).

All 16 canonical personas are now addressable and bindable from the registry alone. No Employee, Principal, authority or Job Role changed.

### Secret / config inventory (names only; NONE set by this PR)
Render `eos-api-nonprod` only:
- `EOS_AUTH_SIGNING_KEY_NONPROD` (secret: the private Ed25519 key)
- `EOS_AUTH_SIGNING_KID`
- `EOS_AUTH_VERIFY_KEYS` (public keys; rotation)
- `EOS_AUTH_ISSUER`
- `EOS_AUTH_AUDIENCE`
- `EOS_PERSONA_ISSUER_CREDENTIAL_SHA256` (the hash only)

The raw persona issuer credential stays in explicit operator custody. **No GitHub Actions secret is added.**

### Inert on merge
The migration creates an empty table, EOS verification stays off until the Render variables exist, and the persona route answers 404. No bindings are applied, nothing is set on Render, and Firebase sign-in is unchanged.

### Proposed cutover (each step separately authorized)
1. Merge.
2. The operator sets the Render nonprod secrets, with keys generated offline.
3. Check `/health`: the migration count rises by 1, and the persona route returns 401 without a credential.
4. Binding packet for the 16 personas (dry run, then apply).
5. Nonprod parity proof: EOS and Firebase give the same context for every persona.
6. CI harness switch, which needs separate authorization for the CI secret.
7. Later: human EOS sign-in, then retire Firebase Auth (FX-AUTH-001).

### Local proof
- `eosAccessToken` + `eosAuthNoFirebase`: 20/20. `eosIdentitySessionPostgres`: 17/17, covering 16/16 personas and EOS/Firebase authorization parity (82 allowed / 30 refused on both paths).
- Registry and credential suites: 152/152 + 47/47 + 29/29.
- `test:governance`: 683/683.
- Firebase exit guard: no new dependencies.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01PYzEKHk6jaAPdNurw8pyn4
