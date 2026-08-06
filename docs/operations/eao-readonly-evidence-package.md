---
artifact_type: operations
gate: EAO read-only evidence package — resolves U-1…U-6
status: Prepared — awaiting a single Owner/operator run
date: 2026-08-06
owner: Claude Code (Executive Architecture & Company Office)
base_commit: c002b5ee0834998207f7966be40bbd718cbd0e28
scope: READ-ONLY. Every command below is non-mutating. No deploy, write, grant, or configuration change.
---

# EAO Read-Only Evidence Package

**One run, one sitting.** These are the only external facts the Executive Architecture Office currently needs. They are bundled deliberately so the Owner is interrupted once rather than six times.

**Every command is read-only.** None deploys, writes, grants, revokes, or changes configuration. No command output should be pasted back verbatim without the sanitization step in §3 — several outputs contain URIs and project metadata.

Authority and posture: `docs/governance/execution-environments.md`, `docs/governance/audit-artifact-standard.md`. The human operator executes all of it; no AI agent runs any of these.

---

## 1. Prerequisites

```bash
firebase --version          # any recent CLI
gcloud --version            # needed only for U-3
firebase login              # if not already authenticated
```

Confirm the active project is `taylor-parts` before starting:

```bash
firebase projects:list
```

## 2. The commands

Run from any directory. Capture stdout to the named file.

```bash
# ── U-5 · Complete live Function estate ───────────────────────────────
# Expectation from repository record: exactly 22 Functions (DECISIONS #63).
firebase functions:list --project taylor-parts --json  > u5-functions.json

# ── U-4 · Live Firestore indexes vs firestore.indexes.json ────────────
firebase firestore:indexes --project taylor-parts       > u4-indexes.json

# ── U-1 · Which frontend surface is real ──────────────────────────────
# (a) Hosting release history — most recent first.
firebase hosting:releases:list --project taylor-parts   > u1-hosting-releases.txt
# (b) Hosting sites configured on the project.
firebase hosting:sites:list --project taylor-parts      > u1-hosting-sites.txt
# (c) Fetch both surfaces' entry documents (public URLs, no credentials).
curl -sS -o u1-hosting-index.html  https://taylor-parts.web.app/
curl -sS -o u1-pages-index.html    https://taylorservice-spec.github.io/Taylor_Parts/field-ops/

# ── U-2 · Does the published Pages build match current main? ──────────
# The Vite build fingerprints assets; comparing referenced bundle names is sufficient.
grep -oE '(assets|field-ops/assets)/[A-Za-z0-9._-]+\.(js|css)' u1-pages-index.html    | sort -u > u2-pages-assets.txt
grep -oE '(assets|field-ops/assets)/[A-Za-z0-9._-]+\.(js|css)' u1-hosting-index.html  | sort -u > u2-hosting-assets.txt

# ── U-3 · Firestore backup / point-in-time-recovery posture ───────────
# The single most important unknown for C3 Operational Readiness.
gcloud firestore databases describe --database="(default)" --project=taylor-parts \
                                                        > u3-database.txt
gcloud firestore backups list --location=us-central1 --project=taylor-parts \
                                                        > u3-backups.txt 2>&1
gcloud firestore backups schedules list --database="(default)" --project=taylor-parts \
                                                        > u3-schedules.txt 2>&1

# ── U-6 · Audit immutability (ADR-005 §2.7 criterion 6) ───────────────
# Confirms the audit collection exists and is client-closed in the DEPLOYED rules.
# Rules text only — no document reads.
firebase firestore:rules:get --project taylor-parts 2>/dev/null > u6-live-rules.txt \
  || echo "CLI lacks rules:get — capture live rules from the Firebase Console instead" > u6-live-rules.txt
```

> **U-3 note:** if `gcloud firestore backups list` returns an empty list or an API-not-enabled error, that is itself the answer — **no backup posture exists** — and should be recorded, not retried. Do not enable any API to make the command succeed; enabling an API is a configuration change and outside this package.

> **U-6 note:** `firestore:rules:get` is not available on every CLI version. If it fails, the Firebase Console's Rules tab shows the live ruleset; save it as text. Do not deploy rules to "check" them.

## 3. Sanitization before the results enter the repository

Per `docs/governance/audit-artifact-standard.md`:

- Redact any bearer token, service-account identifier, or signed URL.
- Function `uri` values and project numbers may remain (they are already recorded in `DECISIONS.md` #63).
- Do **not** include any customer, employee, or user document content — none of these commands returns document data, and none should be added that does.
- Hash the set before import: `sha256sum u*.{json,txt,html} > SHA256SUMS.txt`.

## 4. Where the results go

Import as a governed evidence set under `docs/audits/eao-readonly-evidence-<YYYYMMDD>/`, with `SHA256SUMS.txt` and a short `README.md` naming the operator, the UTC run time, and the exact commands. Evidence files are never edited after generation.

## 5. What each answer unblocks

| Unknown | Unblocks |
|---|---|
| **U-1** | R-2 Option A/B/C selection — cannot choose safely without knowing whether the Pages URL is in real use. |
| **U-2** | R-2 migration step 2 — Hosting must be at parity before Pages is gated. |
| **U-3** | **C3 Operational Readiness.** Whether a backup/DR posture exists at all is the single largest operational unknown; every recovery objective depends on it. |
| **U-4** | Confirms no silent index drift behind live queries. |
| **U-5** | Confirms the repository's 22-Function record still matches production; baseline for R-1 Row 20. |
| **U-6** | ADR-005 §2.7 criterion 6 (immutable auditing production-verified) — an R-1 retirement gate. |

## 6. What this package deliberately does not ask for

- No credential, key, token, or service-account material — the standing prohibition holds.
- No document reads of any operational or customer collection.
- No write, deploy, grant, revoke, enable, or configuration command.
- No Rules deploy "to test" anything.

If a future question requires any of the above, it is a separate, individually-authorized action — not an addition to this package.
