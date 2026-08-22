# Runbook — OpenAI credential setup (operator)

**This runbook contains no key and must never contain one.** If you find a credential in this file
or anywhere else in the repository, treat it as compromised and rotate it before doing anything else.

**No key is required to build, test, or merge the assistant foundation.** The provider is injected,
the security tests use a spy, and an unconfigured provider fails loudly with `AUTH` rather than
silently returning nothing. Set the credential only when you want the assistant to actually answer.

---

## Who runs this

The operator. Claude does not perform this step — entering credentials is outside what an agent
session may do, and the value must never pass through a transcript.

---

## Where the key lives

Trusted backend secret configuration for the **sandbox** project only.

| Surface | Permitted |
|---|---|
| Firebase Functions secret manager (sandbox) | ✅ |
| Browser / client bundle | ❌ never |
| Vite env (`VITE_*`) | ❌ never — `VITE_` variables are compiled into the client bundle and are public |
| Firestore document | ❌ never |
| Repository, `.env` committed, seed data | ❌ never |
| Logs, error messages, health output | ❌ never |
| Production | ❌ not in this phase |

`VITE_` is called out specifically because it is the plausible mistake: it looks like ordinary
configuration and it ships the key to every visitor.

---

## Steps

1. Create a **project-scoped** API key in the OpenAI dashboard, restricted to the intended project.
   Do not reuse a personal or organization-wide key.

2. Set it as a Functions secret in the **sandbox** project:

```bash
firebase functions:secrets:set OPENAI_API_KEY --project eos-platform-sandbox
```

3. Paste the value at the prompt. It is not echoed and does not enter shell history.

4. Confirm the secret exists **without printing it**:

```bash
firebase functions:secrets:access OPENAI_API_KEY --project eos-platform-sandbox > /dev/null && echo "secret present"
```

5. Grant the assistant function access to the secret at deploy time (`runWith({ secrets: [...] })`
   in the function definition — a code change, reviewed like any other).

6. Verify through the application's health path, which reports **configured / not configured** and
   never echoes any part of the value.

---

## Rotation

1. Set the new value with the same `secrets:set` command — it creates a new version.
2. Redeploy the assistant function so it picks up the new version.
3. Revoke the old key in the OpenAI dashboard.

Revoke **after** the redeploy, not before, or the assistant reports unavailable in the gap. That is
a graceful failure rather than an outage — EOS keeps working — but it is avoidable.

---

## If a key is exposed

1. Revoke it in the OpenAI dashboard **first**. Everything else is secondary.
2. Issue a replacement and redeploy.
3. Check usage telemetry for calls you cannot account for.
4. If it was committed, rotating is mandatory — git history keeps the value even after a later commit
   removes it.

---

## What the operator does not need to do

- No key is needed to run `npm run test:assistant` — the tests use an injected spy provider.
- No key is needed to merge the foundation.
- Nothing here activates a capability, grants a Role, or changes Firestore Rules.
