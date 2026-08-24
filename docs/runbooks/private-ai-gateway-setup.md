# Runbook — Private AI Gateway setup (operator)

**This runbook contains no key and must never contain one.** If you find a credential in this file
or anywhere else in the repository, treat it as compromised and rotate it before doing anything else.

**No key is required to build, test, or merge.** The provider is injected, the tests use spies, and
an unconfigured gateway fails loudly with `AUTH` rather than silently returning nothing. Set the
credential only when you want EOS to actually reach the gateway.

Architecture: [`../architecture/eos-ai-provider-policy.md`](../architecture/eos-ai-provider-policy.md).

---

## Who runs this

The operator. Claude does not perform this step — entering credentials is outside what an agent
session may do, and the value must never pass through a transcript.

---

## What EOS talks to

EOS talks to the **Private AI Gateway** and to nothing else. It does **not** talk to Ollama or to
any model runtime directly, and there is a CI check that fails the build if it starts to.

The gateway — not EOS — owns authentication, the tenant boundary, model routing, rate limiting,
backpressure, token metering, latency metering and audit metadata. Pointing EOS at a model port
would drop every one of those in a single step while still looking, from EOS, exactly like a working
integration.

**The gateway must not be exposed publicly.** `127.0.0.1:8080` is a loopback address and is expected
to stay one. Nothing in this runbook asks you to open a port.

---

## Where the configuration lives

Trusted backend configuration for the **sandbox** project only.

| Surface | Permitted |
|---|---|
| Firebase Functions secret manager / trusted server env (sandbox) | ✅ |
| Browser / client bundle | ❌ never |
| Vite env (`VITE_*`) | ❌ never — `VITE_` variables are compiled into the client bundle and are public |
| Firestore document | ❌ never |
| Repository, committed `.env`, seed data | ❌ never |
| Logs, error messages, health output | ❌ never |

A test walks `field-ops-app-vite/src` and fails if any of these names or the gateway address appears
there.

---

## The variables

```
AI_SELF_HOSTED_ENABLED=true            # exact match; "TRUE" / "1" / "yes" do NOT enable it
AI_SELF_HOSTED_BASE_URL=http://127.0.0.1:8080
AI_SELF_HOSTED_API_KEY=<secret>
AI_SELF_HOSTED_TENANT_ID=<explicit tenant for this environment>

AI_ROUTING_POLICY=PRIVATE_ONLY         # unset or unrecognised ⇒ PRIVATE_ONLY
```

**There is no default tenant.** An unset `AI_SELF_HOSTED_TENANT_ID` makes the provider unavailable
rather than falling back to a shared value — a tenant boundary that defaults is not a boundary.

**Everything is off until all four are set.** Enabled-but-uncredentialed is *not* available: that
would turn a configuration mistake into a runtime `AUTH` failure after the policy had already
committed, and by design there is no second choice to fall back to.

---

## Verify

From `functions/`:

```bash
npm run build && node scripts/aiProviderSelfCheck.mjs --health
```

Then the full path:

```bash
npm run build && node scripts/aiProviderSelfCheck.mjs
```

Expect `status: "OK"` with a provider, a model the *gateway* chose, token counts, a queue wait and a
latency. The script performs **no EOS read and no EOS write**, and prints no prompt and no model
text — only whether text arrived.

`--deep` runs the same check as `REASONING` work, which the gateway routes to its deep model.

---

## What a failure means

| Result | Meaning |
|---|---|
| `PROVIDER_UNAVAILABLE`, reason `PRIVATE_PROVIDER_UNAVAILABLE` | the gateway is not enabled/credentialed here, or has no tenant. Correct, governed behaviour — not a bug |
| `errorClass: AUTH` | wrong key, or this tenant may not use that mode |
| `errorClass: RATE_LIMITED` | the gateway is shedding load. Wait; do not route elsewhere |
| `errorClass: UNAVAILABLE` | gateway busy (503) or unreachable |
| `errorClass: TIMEOUT` | the queue held the request past the ceiling |
| `errorClass: UNKNOWN` | the gateway returned a body EOS could not read. A malformed success is a failure, never an empty answer |

**A private outage never routes EOS data to an external provider.** Under `PRIVATE_ONLY` that is
structurally impossible, not merely unconfigured.

---

## What this runbook does not authorize

- No deployment. This work is merged-but-not-deployed and is tracked for the next pooled sandbox
  deployment.
- No callable and no HTTP route. Adding one is a separate authorization and deployment decision.
- No production configuration.
- No public exposure of the gateway or of any model runtime.
