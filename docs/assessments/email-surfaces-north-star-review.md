# Email & Communications + Inbound Work — North Star review

**Status: `NORTH_STAR_IMPLEMENTED` / `OWNER ACCEPTED` (2026-09-06, against `platform-sandbox` build
`de90d6b0`).** The capability is not `CLOSED`: the training rule still applies, and no real mailbox is
bound. See *Owner acceptance* at the foot of this document.

Date: 2026-09-05 · Surfaces: `Administration ▸ Email & Communications`, `Service ▸ Inbound Work` ·
Code: PR #1811 (`c051af0c`), PR #1813 (`32bd8270`), PR #1814 (this review's corrections).

Acceptance belongs to the Owner looking at the running application. This document records what was
reviewed, what was found, what was corrected and what remains. It did not grant acceptance; the Owner
did, on 2026-09-06, after looking at both surfaces on the sandbox and finding one further defect there.

## How the review was conducted

The running application, not a storybook and not a screenshot of a mock: a Playwright sweep drove the
real client (vite) against the local Firestore/Auth emulators as `eos-platform-sandbox`, signed in as
a principal holding the two governed Roles (`serviceInboundWorkReviewer`, `emailIntakeAdministrator`),
at **1440 × 900**, **1024 × 800** and **375 × 812**, through:

- all seven Administration tabs — Overview, Connections, Mailboxes, Routing Rules, Processing,
  Processing History, Exceptions;
- the Inbound Work queue and the review screen for a real seeded intake, including a threaded reply,
  two attachments (one held, one unretrievable) and a routed warranty classification.

At each stop it recorded the structural facts a screenshot will not tell you — horizontal overflow of
the page and of any element, controls under 32px, controls with no accessible name, skipped heading
levels, tables without headers — and captured a full-page screenshot for a person to look at.

**Both halves mattered.** The audit found the overflow and the heading structure; the screenshots
found stored tokens, serialized objects and document ids being shown to people, which no structural
check can see.

The connection states a review must look at (`CONNECTED/HEALTHY`, `EXPIRED/FAILED`, an unreadable
mailbox, a retrying delivery failure, an exhausted one) were seeded directly into the emulator,
because those states are reached through a real provider and this review is about **how EOS renders
them**. No authority was seeded: every capability decision still came from the trusted feed.

## What was found, and corrected

| # | Finding | Correction |
|---|---|---|
| 1 | Horizontal **page** overflow at 375px on Connections, Mailboxes, Routing Rules and Exceptions — reading a table pushed the navigation off screen | Every table is inside `.fo-sales-pipeline-wrap`, the existing scroll container |
| 2 | Heading levels jumped `h1 → h4` (administration) and `h1 → h5` (review pane) | Contiguous levels under the shell's `h1` |
| 3 | A Service reviewer deciding a warranty job was shown `rule sbx-rule-corporate-warranty` | The rule's **name** is recorded with the routing decision at intake, and rendered. DECISIONS #106 |
| 4 | The same screen showed `mailbox sbx-mb-warranty` | The mailbox's display name, likewise recorded at intake |
| 5 | Routing rules rendered as `JSON.stringify(when)` / `JSON.stringify(then)` | Sentences: `mailbox is Warranty and sender domain is corporate.example` → `classify as Warranty, hold for review` |
| 6 | `GOOGLE_WORKSPACE`, `PENDING_AUTHORIZATION`, `NEEDS_REVIEW`, `WARRANTY` shown as stored | A dictionary per surface, with sentence case as the fallback so an unmapped value degrades quietly instead of shouting |
| 7 | A delivery failure led with its error code; its mailbox was a document id | Leads with `Needs attention` / `Retrying on its own` and the sentence about what to do; names the mailbox |
| 8 | The connection table split `service@sandbox.example` across two lines at 1440px and stacked every timestamp three deep | A connection is an object with a state, so it is a **card**: name and account whole, both status answers together, actions beneath |
| 9 | Raw locale timestamps (`9/5/2026, 11:01:21 PM`) where the question is "how long ago" | Relative phrasing, with the exact instant on the `<time>` element for a support ticket |
| 10 | "Add a connection" and "Add a mailbox" sat permanently open above the state of what already exists | Native `<details>` disclosures with a visible affordance |
| 11 | Attachment sizes in raw bytes | `20 KB`, `2.4 MB` |
| 12 | The decided state printed a Work Order document id in a sentence | A status pill and a control that opens the work order |

## Verification after the corrections

- **Re-swept**, same three viewports and same stops: no page or element overflow, no skipped heading
  levels, no unnamed controls, no undersized targets. (The sweep's own audit was corrected twice
  during the review — it counted a deliberately clipped `thead` as overflow and every wrapped-label
  input as unnamed. A review tool that reports defects that are not there is worse than no tool.)
- **Functional regression**, after all visual work, on a clean Firestore emulator, suites run
  separately as CI runs them: `inboundWorkEmulator` 31/31, `emailTransportEmulator` 23/23,
  `emailTransport` + `inboundWorkDomain` 70/70, `inboundWorkWorkspace` 13/13, `inboundWorkNav` 1/1,
  and the new `adminEmailCommunications` 3/3. Connection configuration, OAuth, polling, attachment
  access, the queue, Accept, Decline, Attach Existing, threading, duplicate protection, capability
  enforcement and audit are unchanged.
- **Visual system guards**: `cssClassCoverage` 3/3 and `visualSystem` 15/15 — no new palette, no
  hardcoded colour, no class referenced without a rule.

## What this does not claim

- **No Owner visual acceptance.** Only the Owner moves that.
- **Deployment: see the dated section below.** Both surfaces were deployed to `platform-sandbox` on
  2026-09-06, by the Owner, after this review was written. The rule that kept this build from doing it
  itself still stands: `scripts/_sandboxRefresh.run.sh` states at its head that it is
  *"intentionally NOT run by any agent session — deploy is a human-triggered action."* That rule was
  followed. The Owner runs, from the repository root in PowerShell:

  ```
  .scriptsInvoke-SandboxRefresh.ps1
  ```

  The email **transport** Functions remain governed exclusions from the derived sandbox deploy set
  (`scripts/sandboxDeployableFunctions.mjs`) until a non-production tenant is bound; each carries the
  instruction to remove its entry at that moment. The configuration and Inbound Work callables are
  not excluded and deploy normally.
- **No real mailbox.** No non-production Microsoft 365 or Google Workspace tenant, client id or
  secret was available, so no real inbound message has travelled this path. Binding one is an
  external configuration dependency.
- **No outbound email.** Work Order correspondence is not built and was explicitly out of scope.
- **Production is untouched and unauthorized.**

## Deployed to platform-sandbox — 2026-09-06

The Owner triggered `.scriptsInvoke-SandboxRefresh.ps1`. Recorded here because a claim about a
running environment is worth exactly what its evidence is:

| | |
|---|---|
| **Deployed commit** | `35ce3741` — read from `https://eos-platform-sandbox.web.app/version.json`, not inferred from a merge |
| **Manifest identity** | `environmentId: platform-sandbox`, `environmentRole: sandbox`, built 2026-09-06T07:04:52Z |
| **Guards passed** | The target resolved to `eos-platform-sandbox` (≠ `taylor-parts`) at three separate points; release provenance confirmed the commit is contained in `origin/main`; the built artifact's own `version.json` was re-read and asserted against the target *before* Hosting |
| **Functions** | 170 create/update operations succeeded, 0 failed. Eleven belong to this capability, including `getEmailIntakeConfiguration`, `getInboundWorkRequest`, `acceptInboundWork`, `declineInboundWork`, `attachInboundWorkToWorkOrder`, `getInboundWorkAttachment` and `deliverInboundEmailMessage` |
| **Rules / indexes** | Unchanged at `35ce3741`; no deploy required |

**The first release attempt was REFUSED, correctly.** It ran from the feature branch, and the provenance
guard stopped it before anything was built: *"HEAD b43790fe is not contained in origin/main. A tree
identical to main is NOT provenance: merge first, then release what merged."* The release was then run
from the merged commit. That refusal belongs in the record — it is the guard doing precisely the job it
was written for.

### What is deployed, and what is deliberately not

The eight **provider transport** Functions remain governed exclusions from the derived deploy set, each
naming its own reason in `scripts/sandboxDeployableFunctions.mjs`: they bind the four `EMAIL_*` OAuth
secrets, and `platform-sandbox` has no Microsoft 365 or Google Workspace application registered against
it, so those secrets are intentionally absent. Deploying them in a general refresh would demand provider
credentials for a capability the environment has not activated.

The practical consequence, stated plainly rather than discovered by someone clicking: in the sandbox
today, `Administration ▸ Email & Communications` reads configuration and shows state, and **Connect,
Test connection, Check now and Retry are not operable** — their Functions are not deployed there, and the
screen reports that honestly rather than offering a live-looking button. `Service ▸ Inbound Work` is
fully operable against intake records, including Accept, Decline, Attach Existing and attachment access.
Removing those eight exclusions is the same act as binding a tenant; the runbook is
[`docs/deployment/email-provider-setup.md`](../deployment/email-provider-setup.md).

### Still not claimed

Owner visual acceptance (not given), a real mailbox (no non-production tenant credentials exist, so no
real inbound message has travelled this path), outbound email (not built), and production (untouched and
unauthorized).

## Owner acceptance — 2026-09-06

The Owner accepted both surfaces against `platform-sandbox` build `de90d6b0` — the build carrying the
North Star pass (#1814) and the corrective below, not the `35ce3741` first deployed.

**One defect was found by the Owner during acceptance**, and it is the most useful line in this
document. On the deployed sandbox, where no connection exists, `Mailboxes ▸ Add a mailbox` offered an
enabled `<select>` containing nothing but "Select a connection…", with no explanation. The list was
correct — a mailbox belongs to a connection — and the screen read as broken. Fixed in #1816 and
deployed before acceptance.

It escaped this review for a reason worth carrying into the next one: **the review harness had seeded
two connections** so that the CONNECTED / EXPIRED / failure states could be looked at, and in doing so
it never rendered the zero state. A seeded review sees the states it seeded. The suite now asserts the
empty state directly.

### What the acceptance does not carry

Training is still required — no `docs/training/**` guide covers this capability, so the release is
`DEPLOYED / OWNER-ACCEPTED` and must not be reported as `CLOSED`. No real mailbox is bound. Outbound
email is not built. Production is untouched and unauthorized.
