# Secret scanning & leak prevention

Two belts, one policy. The policy deliberately **distinguishes the Firebase Web API key (public by
design) from genuinely sensitive credentials** — so we stop real leaks without drowning in false
alarms on a key that is meant to ship in the client bundle.

## Why Firebase web keys are treated as public

A Firebase **Web API key** (`AIza…`) identifies the project; it is embedded in the client bundle and is
**not a secret**. Access is controlled by **Firestore Security Rules** and **Google Cloud API-key
restrictions**, not by hiding the key. Google documents this explicitly. So a web key in the client
config is expected; the real controls are (a) Rules and (b) key **restrictions** in Google Cloud.

This is **not** a blanket exemption for `AIza…` strings. The exemption is **contextual** — see the
allowlist below.

## The policy (`.gitleaks.toml`)

- Keeps the **high-signal default rules** (`useDefault = true`): PEM/RSA private keys, `service_account`
  JSON, AWS/GCP keys, OpenAI `sk-…` tokens, GitHub/Slack/Stripe tokens, etc. **None of these is ever
  allowlisted.**
- **Disables `generic-api-key`** — gitleaks' entropy heuristic, which is very noisy (it flags test
  fixtures, doc examples, and high-entropy config strings that aren't secrets; a full-tree run flagged
  ~18 such strings across `functions/test/*`, `docs/*`, and config JSONs). Generic-token detection is
  delegated to **GitHub's provider-aware native secret scanning + push protection** (which found the
  original alerts), keeping this gate high-signal and usable. All **structured-credential** rules stay on.
- Exempts the Google API-key **pattern only** (`AIza[0-9A-Za-z_-]{35}`), and **only** inside:
  - `field-ops-app-vite/src/firebase/firebase.js` and `index.html` — the client Firebase config
    (public web key, shipped in the bundle), and
  - the known **historical** exposure paths (`config/environments.json`, `parts-control-center-sha*`),
    which are out of HEAD and remediated by restrict/rotate (not scrubbed — Owner decision).
- The same `AIza…` pattern **anywhere else fails**, and any *sensitive* credential in the exempted paths
  still fails (the exemption is AND-scoped to the web-key pattern).

## The two belts

1. **CI gate** — `.github/workflows/gitleaks.yml` runs on every PR and push to `main`, scans the working
   tree (`--no-git`, so removed-from-HEAD history isn't re-flagged), and **redacts** any finding so no
   secret value ever reaches the logs. A genuinely sensitive credential fails the check.
2. **Local pre-commit (opt-in)** — `.pre-commit-config.yaml` runs the same gitleaks policy on staged
   changes. Enable per clone: `pip install pre-commit && pre-commit install`.

## Recommended: enable GitHub **Push Protection** (Owner, repo settings)

The strongest prevention blocks a push *before* the secret lands: **Settings → Code security → Secret
scanning → Push protection**. GitHub's native scanner catches provider tokens at push time; gitleaks is
the repo-side belt that adds the Firebase-web-key-vs-sensitive distinction and the custom allowlist.

## Historical exposure (the two open alerts)

Two Google API keys were detected in history (`config/environments.json`, `parts-control-center-sha*`) —
both removed from HEAD. Believed Firebase web keys. Remediation is **restrict/rotate in Google Cloud**,
not a history rewrite (skipped per Owner decision for web keys). Owner verification checklist, per key:

- **Key name / type** (confirm it is a browser/API key, not a server or service-account key).
- **API restrictions** — limited to only the APIs actually used.
- **Application restrictions** — HTTP referrers locked to our domains.
- **Billable/non-Firebase API access** — confirm the key cannot call billable Google APIs unrestricted.

If any key turns out to be a **sensitive/server** credential rather than a web key, escalate: rotate
immediately and reconsider a scoped history scrub.

## Rule: never reproduce a secret value

Do not paste real key values into chat, logs, issues, commits, or this repo. Pattern strings (as in
`.gitleaks.toml`) are fine; actual values are not.
