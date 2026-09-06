# Email Connections + Inbound Work

**Status:** SANDBOX BUILD — implemented, tested, and activated in non-production environments only.
Production is **not** authorized and not reachable (see [Environments and activation](#environments-and-activation)).

## The problem

Taylor receives a large share of its Service and Warranty work by email — from Taylor Corporate, from
vendors, from manufacturers. The work arrives, somebody reads it, decides to take it, and then **types the
same information into EOS a second time**. The duplicate entry is the cost, and every re-keying is a chance
to lose the authorization number or attach the job to the wrong unit.

```text
BEFORE                                   AFTER
vendor / corporate email                 vendor / corporate email
        ↓                                        ↓
employee reads it                        EOS email intake
        ↓                                        ↓
employee accepts the job                 Service → Inbound Work
        ↓                                        ↓
employee creates a Work Item             review · accept / decline / hold
        ↓                                    ↙        ↘
employee RE-TYPES the email          decline        accept
        ↓                                              ↓
service workflow                              Work Order created, prepopulated
                                                       ↓
                                                service workflow
```

**Accepting an inbound job creates the Work Order without anyone re-entering what the email already said.**

## Product boundary

This is **base EOS**. It works with no VDX, no Verenward Data Governance, and no other paid add-on:

| Base EOS (this capability) | Optional, and never required |
| --- | --- |
| Microsoft 365 / Outlook and Google Workspace / Gmail connections | VDX (Verenward's ETL / integration product) |
| Designated inbound/shared mailboxes | Verenward Data Governance |
| Message capture, original preservation, attachments, thread ids | A customer-selected iPaaS / ETL / MDM platform |
| Routing rules, Service Inbound Work queue, human review | |
| Customer / location / equipment suggestion | |
| Accept · Decline · Attach to existing work | |
| Governed Work Order creation, provenance, audit, duplicate protection | |

A customer who uses MuleSoft, Boomi, Workato, Azure integration tooling or their own middleware participates
through the same governed interface a Verenward add-on does. Nothing in the operational path names a vendor.

## How it is put together

```text
provider message (Microsoft Graph / Gmail)
        ↓  emailProvider.ts          adapter -> ONE normalized message
        ↓  inboundRouting.ts         ordered, first-match rules -> classification + queue
        ↓  inboundProcessing.ts      InboundProcessingResult (EOS_NATIVE | VDX | EXTERNAL)
        ↓  inboundCandidateResolution.ts   exact-key lookup -> suggested customer / site / unit
        ↓  inboundThreading.ts       duplicate + reply association
        ↓  inboundIntakeCommand.ts   ONE transaction -> inbound_work_requests
        ↓  Service → Inbound Work    a person reviews it
        ↓  inboundDecisionCommands.ts   accept -> createWorkOrderRecord (the SAME governed core)
        ↓  fieldops_wos
```

Everything above `inboundIntakeCommand.ts` is pure — no Firestore, no firebase import — which is why the
whole classification and extraction model is testable from fixtures without a database.

### The processing provider boundary

Every processing provider returns the same `InboundProcessingResult`: request type, customer/location/
equipment candidates, external reference, authorization number, problem description, priority, warnings and
opaque provider metadata. The operational workflow reads only that.

```text
Processing Provider
● EOS Native    ← the default and the only one this build ships
○ VDX           ← optional enhancement where licensed and configured
○ External      ← the customer's own integration platform
```

A provider returns **candidates and text**. It cannot choose the accepting user, the operating company, the
intake status or the Work Order, it cannot edit mastered data, and an id it claims is re-read and
re-validated server-side at acceptance. That is what keeps VDX optional rather than load-bearing.

### Data governance stays optional

Accepting a job **never** silently mutates a mastered Customer, Location, Contact or Equipment record
because an inbound email spelled something differently. The Work Order uses the reviewer's confirmed
operational values; proposing a master-data change belongs to whichever governance product the business
uses — Verenward Data Governance, an external MDM, or a person.

Base EOS does exactly the validation safe operation requires: the customer, site and unit must exist and
must belong together, and an INSTALL cannot name a unit that does not exist yet.

## Records

Four collections, all **Admin-SDK-only**: `firestore.rules` has no match block for any of them, so every
client read and write is denied by default and the trusted callables are the only way in or out. **This
feature required no Rules change.**

| Collection | What it holds |
| --- | --- |
| `email_connections` | the external provider authorization: provider, tenant/workspace, connected account, status, health. **No password, no token** — only the name of an externally-managed secret. |
| `email_mailboxes` | operational mailbox configuration (Service / Warranty / Parts): purpose, destination, default queue, operating company, processing mode, attachment and threading policy. |
| `email_routing_rules` | the ordered, first-match rule set. |
| `inbound_work_requests` | the intake record: source provenance, the original message, attachments, extraction, candidates, status, decision and the Work Order it became. |

### Lifecycle

```text
AWAITING_DECISION ─┬─→ ACCEPTED  → one Work Order
NEEDS_REVIEW ──────┤   DECLINED  → retained, never deleted
                   └─→ ATTACHED  → filed against existing work

DUPLICATE      the same provider message id, delivered again
FAILED         processing failed; the message is retained with the reason
QUARANTINED    an unknown or disabled mailbox; retained, not discarded
```

`NEW` and `PROCESSING` are deliberately absent: intake is a single transaction, so nothing could observe
them. They belong with the asynchronous provider poll (see [Deferred](#deferred-to-a-later-phase)).

## Accept — the governed transaction

One server-authoritative transaction does all of it: validate authority, validate the intake is still
undecided, prove the chosen customer/site/unit exist and belong together, create the Work Order through the
**same `createWorkOrderRecord` core** a dispatcher's own Work Order goes through, link the intake to it,
stamp the accepting user and a server timestamp, and write the audit evidence. Then the reviewer lands on
the Work Order.

**Two acceptances never make two Work Orders.** The intake's own status is the idempotency substrate: a
second call reads ACCEPTED, writes nothing, and returns the same `workItemId`. That holds for a double
click, a retry after a lost response, and two different clients.

The Work Order carries `inboundWorkRequestId`, `externalReference` and `authorizationNumber`, so "why does
this job exist" is answerable from the Work Order itself and not only from the audit trail.

## Threading and duplicates

A reply must not open a second job. Association uses, in order of strength: the same provider message id
(a duplicate), the provider's conversation/thread id, then RFC 5322 `In-Reply-To` / `References`. **Subject
text is not evidence and is not consulted.** One candidate associates; two or more is ambiguous and goes to
a person rather than being attached to the wrong job.

Duplicate protection does not rest on a query: the intake document id is a hash of (mailbox, provider
message id), so a racing redelivery collides structurally instead of unlikely.

## Attachments

Filename, MIME type, size, provider hash where the provider supplies one, the provider's attachment id, the
source message id and the receipt time are preserved on the intake and carried through acceptance.

**The bytes are not copied into EOS in this phase.** This repository has no document/storage architecture to
reuse — no Cloud Storage bucket is configured and no attachment model exists — and inventing one for this
feature would have created exactly the parallel document system the implementation principles forbid.
Attachments remain re-fetchable through the connection by their provider id. Byte custody is a separate,
Owner-gated piece of work (a bucket, its rules, retention and a document model), recorded in
[Deferred](#deferred-to-a-later-phase). Structured attachment *transformation* remains a VDX enhancement,
not a base requirement.

## Authority

Six capabilities across **two** authorities, because they belong to two different people:

| Capability | Held by |
| --- | --- |
| `administration.emailIntake.read` · `administration.emailIntake.manage` | `emailIntakeAdministrator` |
| `service.inboundWork.read` · `.accept` · `.decline` · `.attachExisting` | `serviceInboundWorkReviewer` |

A Service coordinator can work the queue all day without any administration authority; an administrator who
configures mailboxes cannot accept, decline or attach anything. Neither Role is privileged, and **declaring
a Role grants nothing** — a principal holds one only through a governed, audited roleAssignment.

All six ids are registered `active: false`, which is an unconditional deny ahead of any Role grant.

## Environments and activation

Activation is per-environment (`config/environments.json` + `environmentCapabilityOverrides.ts`), and
production is blocked four times over: the resolver returns empty for any `role: "production"` environment
regardless of registry data; no production entry declares these ids; the eligible allow-list bounds what any
environment can activate at all; and the non-production delivery seam additionally refuses the production
project by name from the runtime's own identity.

`eos-platform-sandbox` activates all six. `taylor-parts` activates none, and cannot.

## Security posture

- Inbound email is untrusted external input. Content is stripped to plain text before it is stored, bounded
  in length, and the governed read **never projects the stored markup** — a browser is handed text only.
  Neither screen contains `dangerouslySetInnerHTML`, and a test asserts it.
- No credential is ever stored. A configuration write carrying a field that looks like a password, token or
  client secret is **refused**, not silently stripped.
- Every callable resolves the caller from `request.auth`, never from the payload. A client cannot supply the
  accepting user, the decision time, the operating company, or a provider's authority.
- A provider's claimed match confidence is not trusted: only an id-bearing candidate is recorded as EXACT,
  and the id is re-validated inside the acceptance transaction anyway.
- The delivery seam requires **administration** authority (injecting a message is a configuration act, not
  an operational one) and is refused outright in any production-role environment.

## Audit

Nine actions extend the existing immutable Audit Event path — no parallel audit system:
`createInboundWorkRequest`, `quarantineInboundWorkRequest`, `linkInboundWorkThreadMessage`,
`acceptInboundWorkRequest`, `declineInboundWorkRequest`, `attachInboundWorkRequest`,
`configureEmailConnection`, `configureEmailMailbox`, `configureEmailRoutingRule`.

Acceptance writes two events in its one transaction: the decision, filed against the inbound request, and
the create, filed against the Work Order — so the trail reads correctly in both directions.

## Reporting

The Administration overview counts intake by status from the intake records themselves. Nothing is seeded,
sampled or estimated: an environment with no inbound mail shows zeroes. Richer metrics (time to acceptance,
acceptance rate, decline reasons by vendor, volume by mailbox) are governed facts already present on the
intake record; exposing them through the existing reporting architecture is a later, separate step and no
new reporting platform was built here.

## P1 limitations, stated

- **Real provider delivery is not connected.** No non-production Microsoft 365 or Google Workspace tenant
  or OAuth client registration is available to this repository. What is implemented is everything that does
  not require one: the provider model, the configuration contract and its validation, the authorization-
  request and callback seams, both message mappings, and a non-production delivery seam that runs a
  provider-shaped message through the identical path a poll would use. Binding a tenant is external
  configuration, not missing code.
- Attachment bytes are referenced, not stored (above).
- The overview counts a bounded page of intake records rather than a server-side aggregate.
- Operating company comes from the mailbox or a routing rule; there is no per-company scoping of the queue
  itself yet, because no operating-company scope is enforced on Work Orders either.

## Deferred to a later phase

- **Outbound / reply from a Work Order.** Designed for, not built: a connection already carries
  `outboundEnabled`, and a reply would go out through the connected mailbox and return on the same thread,
  where the existing association logic would file it against the same work with no change. There is no
  existing send-email architecture to extend, so adding one would have inflated P1.
- **Asynchronous provider polling / webhooks** (and with them the observable `NEW` and `PROCESSING` states).
- **Attachment byte custody** — needs a storage bucket, its rules, and a retention decision.
- **Entitlement gating for the optional providers.** This repository has no licensing/entitlement framework;
  the architecture is ready (a stored processing provider per environment, one provider-neutral contract)
  and the Administration screen states plainly that provider selection is not available in this build,
  rather than showing a fake paid feature flag.

## Where the code lives

| Concern | File |
| --- | --- |
| Model, sanitization, bounds | `functions/src/inboundWork/inboundWorkModel.ts` |
| Provider abstraction + both mappings | `functions/src/inboundWork/emailProvider.ts` |
| Routing rules | `functions/src/inboundWork/inboundRouting.ts` |
| Processing contract + native extraction | `functions/src/inboundWork/inboundProcessing.ts` |
| Candidate resolution | `functions/src/inboundWork/inboundCandidateResolution.ts` |
| Threading / duplicates | `functions/src/inboundWork/inboundThreading.ts` |
| Intake | `functions/src/inboundWork/inboundIntakeCommand.ts` |
| Accept / decline / attach | `functions/src/inboundWork/inboundDecisionCommands.ts` |
| Administration writes | `functions/src/inboundWork/emailAdminCommands.ts` |
| Trusted reads | `functions/src/inboundWork/inboundWorkReadService.ts` |
| Callables | `functions/src/inboundWork/inboundWorkCallables.ts` |
| Service surface | `field-ops-app-vite/src/modules/service/InboundWorkWorkspace.jsx` |
| Administration surface | `field-ops-app-vite/src/modules/administration/AdminEmailCommunications.jsx` |
| Sandbox fixtures + seed | `functions/scripts/fixtures/inboundWorkFixtures.mjs` · `functions/scripts/seedSandboxInboundWork.mjs` |
| Tests | `functions/test/inboundWorkDomain.test.mjs` · `functions/test/inboundWorkEmulator.test.mjs` · `field-ops-app-vite/test/inboundWorkNav.test.mjs` · `field-ops-app-vite/test/inboundWorkWorkspace.test.jsx` |
| CI | `.github/workflows/inbound-work-tests.yml` |

User guides: [Set up email connections](../user-guide/administration/set-up-email-connections.md) ·
[Review inbound work](../user-guide/work-orders/review-inbound-work.md).
