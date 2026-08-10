# Owner Control Center — Publication Runbook (Model A, operator-executed)

**Status:** repo-safe. Every step below is executed **by the Owner or an authorized
operator with credentials**, not autonomously. Nothing in this runbook is deployed
by the build agent. `Register ≠ grant · Export ≠ deploy · Merge ≠ live · Readiness ≠ authorization.`

**Decision of record (2026-08-09):** Owner ratified **security-gating Model A**
(Firestore-gated envelope) and **authorized** the Hosting site creation + deploy and
the Tier-2 Firestore Rules change + deploy, to be executed by the Owner/operator.
See `roadmapModel.mjs` → `owner-control-center` → `occ-delivery.ownerDecision`.

Architecture and rationale live in
[`owner-control-center-hosting-design.md`](owner-control-center-hosting-design.md).
This runbook is only the operator sequence.

---

## What Model A publishes

- **Shell (public, safe):** the keystone `apps/control-center` static build. It
  contains **no data** — it renders nothing without the envelope.
- **Data (gated):** one Firestore document per project,
  `control_center_envelopes/{projectId}` (e.g. `taylor-parts`), holding
  `{ envelope, publish }`. Readable **only** by the authorized Owner uid(s).

The envelope is exactly what `buildControlCenterPayload()` emits. **Never published:**
credentials, secrets, raw local network/telemetry logs, household traffic, agent
scratchpads, or unnecessary local filesystem paths (the envelope already excludes
these — §19 of the design).

---

## One-time setup (operator, with credentials)

1. **Create the static Hosting site** for the Control Center shell. Keep it
   **separate** from the existing Field Ops Hosting site (that one serves
   `field-ops-app-vite/dist`; do not repurpose it). Build the shell with the
   keystone `apps/control-center` build, deploy its static output to the new site.
2. **Auth:** ensure the authorized Owner has a Firebase Auth account in the
   `taylor-parts` project. Record the **uid** — it is the gated input the Rule needs.
3. **Deploy the Firestore Rule (Tier-2):**
   - Open [`proposals/control-center-envelope.rules.proposed`](proposals/control-center-envelope.rules.proposed).
   - Replace `<OWNER_UID_1>` with the real uid (add a second only if a second Owner
     is authorized). Paste the `match /control_center_envelopes/{projectId}` block
     into `firestore.rules`.
   - Review as a Tier-2 change; deploy using the **verify-rules-deploy** skill
     (firestore.rules is **not** auto-deployed — merged ≠ live).

---

## Each publish (operator, or a scheduled operator job)

The governed publish is: **build the envelope → write it + a publish record to the
gated Firestore doc.**

1. Build the envelope from the project's adapter (the same
   `buildControlCenterPayload()` the launcher's local path uses).
2. Write it with the injected Admin SDK using
   [`lib/publishControlCenterEnvelope.mjs`](lib/publishControlCenterEnvelope.mjs).
   It is **dry-run by default** and only writes when `execute:true` **and** an Admin
   Firestore handle is injected. Sketch of the operator runner (credential + admin
   init supplied by the operator, never committed):

   ```js
   import { getFirestore } from "firebase-admin/firestore";
   import { initializeApp, applicationDefault } from "firebase-admin/app";
   import { publishEnvelope } from "./docs/orchestration/lib/publishControlCenterEnvelope.mjs";

   initializeApp({ credential: applicationDefault() }); // operator-provided creds
   const now = new Date().toISOString();
   const commit = process.env.GOVERNED_COMMIT;           // the commit being published
   const res = await publishEnvelope({
     projectId: "taylor-parts",
     commit,
     generatedAt: now,
     publishedAt: now,
     firestore: getFirestore(),
     execute: true,
   });
   console.log(res.wrote ? `published ${res.docId} @ ${commit}` : "dry-run only");
   ```

3. The Admin SDK bypasses Rules by design, so `allow write: if false` blocks every
   **client** while the operator job still publishes. No client — not even the
   Owner's browser — can forge or overwrite the board.

---

## Freshness (what the hosted board must announce)

The hosted shell computes `freshnessState(envelope, nowMs, publishRecord)`
(`lib/controlCenterContract.mjs`) and must **show STALE / UNKNOWN / INCOMPATIBLE
explicitly** — it must never infer CURRENT merely because the site loaded. A board
older than the freshness window, or built from an older commit than the latest
governed publish, announces itself as stale.

---

## Still Owner/operator-gated (never autonomous)

- Creating the Firebase Hosting site; any Hosting deploy.
- The Firestore Rules change + deploy (Tier-2) and the authorized-Owner uid(s).
- Any credential/billing action; any scheduled publish job installation.

The build agent prepares the reviewable diffs and tooling above; the operator runs
the deploys.
