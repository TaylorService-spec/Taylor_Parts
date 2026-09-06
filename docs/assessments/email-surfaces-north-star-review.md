# Email & Communications + Inbound Work — North Star review

**Status: `NORTH_STAR_IMPLEMENTED` / `AWAITING_OWNER_VISUAL_ACCEPTANCE`.**

Date: 2026-09-05 · Surfaces: `Administration ▸ Email & Communications`, `Service ▸ Inbound Work` ·
Code: PR #1811 (`c051af0c`), PR #1813 (`32bd8270`), PR #1814 (this review's corrections).

Acceptance belongs to the Owner looking at the running application. This document records what was
reviewed, what was found, what was corrected and what remains — it does not grant acceptance, and the
Owner has not seen either surface running.

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
- **No deployment.** Neither surface has been deployed to any environment in this workstream.
- **No real mailbox.** No non-production Microsoft 365 or Google Workspace tenant, client id or
  secret was available, so no real inbound message has travelled this path. Binding one is an
  external configuration dependency.
- **No outbound email.** Work Order correspondence is not built and was explicitly out of scope.
- **Production is untouched and unauthorized.**
