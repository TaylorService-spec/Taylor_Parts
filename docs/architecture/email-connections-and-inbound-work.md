# Email Connections + Inbound Work

**Status:** SANDBOX BUILD — implemented, tested, and activated in non-production environments only.
Phase 2 (real Microsoft 365 / Google Workspace delivery and attachment byte custody) is implemented and
proven against scripted providers and the Firestore emulator; binding a real tenant is an external
configuration step documented in [Email provider setup](../deployment/email-provider-setup.md).
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


## Real provider delivery

```text
provider mailbox
      |  scheduled poll, every 5 minutes (or Check now)
      v
EmailTransportAdapter        <- Microsoft Graph delta - Gmail history
      |  raw provider message
      v
normalizeProviderMessage()   <- unchanged from phase 1
      v
ingestInboundMessage()       <- unchanged from phase 1
      v
attachment bytes fetched and stored
      v
Service -> Inbound Work
```

**Delivery adds no intake path.** The poller fetches a message and hands it to the same normalizer and
the same `ingestInboundMessage` the phase 1 delivery seam used. Routing, extraction, candidate
resolution, threading and duplicate protection are the ones already built; nothing about Accept,
Decline, Attach or Work Order creation changed.

### Why polling, not change notifications

Microsoft Graph mail subscriptions expire in under three days and Gmail's `users.watch` in seven, so a
notification design needs a renewal job, a publicly reachable endpoint that answers a validation
handshake and verifies a clientState while unauthenticated, and Pub/Sub for Gmail — **and it still needs
a poll underneath it**, because a missed notification is silent data loss. `messages/delta` and
`users.history.list` give the same property (everything since the last look, exactly once) with a stored
cursor, no public endpoint and no renewal. If notification latency is ever required, it becomes an extra
trigger for this same poll rather than a second delivery path.

### The first poll ingests nothing

Microsoft is asked for `$deltatoken=latest` and Gmail for its current `historyId`: connecting a mailbox
establishes a resume point and takes in no mail. **Connecting is not importing** — a mailbox with ten
years of history does not enqueue ten years of Inbound Work.

### The cursor is the safety property

A message the poll could not take in leaves the cursor where it was, so the next poll sees it again.
Reprocessing is safe — intake's deterministic document id (mailbox + provider message id) collapses it
to one record — and skipping is not. Gmail's history id can age out; recovery re-lists a bounded recent
window rather than failing, for the same reason.

### Failure, classified into what a person should do

| Disposition | Examples | Behaviour |
| --- | --- | --- |
| RETRYABLE | rate limit, provider outage, one message fetch | bounded exponential backoff, honouring the provider's own `Retry-After`, up to 5 attempts |
| REFRESH_THEN_RETRY | expired access token | refreshed from the stored credential, transparently |
| REQUIRES_ADMIN_ACTION | revoked grant, mailbox missing, access denied | no retry loop; it appears in Exceptions with what to fix |

Failures are records in `email_delivery_failures`, keyed per (mailbox, subject) so a repeating failure
increments one row rather than filling the list. Nothing is discarded: a retry-exhausted delivery is
retained and retryable from Administration once the cause is fixed.

## Credential custody

**A connection document still contains no secret.** It carries the name of where the credential lives, a
version, and timestamps.

- The **refresh token** is held in Google Secret Manager, one secret per connection, readable only by the
  Functions runtime service account. This repository writes no cryptography of its own — no key material,
  no cipher choice, no rotation scheme invented here.
- The **access token is never persisted anywhere**. It lives in process memory for its own short life and
  is re-minted from the refresh token. There is no field for one, so no later change can start storing it.
- A **rotated** refresh token is written to the vault before the access token is handed out, so a rotation
  we then failed to persist cannot leave us holding a credential the provider has already invalidated.
- No secret value is ever logged, returned to a client, or put in an error message. Provider error
  messages carry the status and the operation and never the response body — which is where a token would
  otherwise leak from.

## OAuth security

The authorization state is generated server-side, stored **by its hash**, single-use (consumed inside a
transaction, so two simultaneous callbacks cannot both pass), time-bounded to ten minutes, and bound to
the connection, the provider, the redirect URI and the administrator who started it. PKCE is used even
though this is a confidential client: the verifier never leaves the server, so an intercepted code is
worthless. The redirect must be https (or a localhost development URL) and must match at exchange time.

**There is no public callback endpoint.** The provider redirects to the application's own Administration
screen, which calls an authenticated callable; the exchange happens behind the same capability check as
every other administration write.

**A connection is not CONNECTED because a token was issued.** Completion reads each configured mailbox
with the granted authority; a connection that consents but cannot read its mailbox is recorded as
authorized-and-failing with the reason, which is the state an operator can act on.

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

Six collections, all **Admin-SDK-only**: `firestore.rules` has no match block for any of them, so every
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

Filename, MIME type, size, content hash, the provider's attachment id, the source message id and the
receipt time are preserved on the intake record — **and the bytes are now held by EOS**, fetched from the
provider as each message is taken in.

| Concern | How |
| --- | --- |
| Where | Cloud Storage, in the environment's own bucket, under a key derived from EOS ids and a hash — never from the sender's filename |
| Who can read | nobody, directly: `storage.rules` denies every client read and write. The only route is a governed callable that authorizes against the INBOUND REQUEST the attachment belongs to |
| Content type | stored as `application/octet-stream`, always. The sender's declared type travels beside the bytes as data, so the bucket can never serve an active type |
| Size | bounded before a byte is written (25MB); a larger file is refused, not truncated |
| Filename | sanitized for display only — path separators, traversal sequences and control characters removed |
| Retry | the storage key is deterministic, so retrying a partial failure fetches only what is missing and cannot produce a second copy |
| Honesty | an intake reads NONE / PENDING / PARTIAL / COMPLETE / FAILED. A message whose attachment failed says so on the review screen instead of looking complete |

**Nothing scans attachments for malware.** No scanning architecture exists in this repository, and
claiming files are scanned when they are not is worse than the absence. Recorded as a security follow-up.

**Production retention is UNRESOLVED and nothing expires anything.** Every stored attachment carries
`retentionPolicy: "UNRESOLVED"`; a retention period is a business and legal decision, not one to infer
from a codebase.

Structured attachment *transformation* remains a VDX enhancement, not a base requirement.
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

## Limitations, stated

- **No real tenant is bound in this repository.** The provider model, OAuth flow, credential custody,
  polling, attachment custody, health and retry are implemented and tested; connecting an actual
  Microsoft 365 or Google Workspace tenant requires an external administrator and is documented in
  [Email provider setup](../deployment/email-provider-setup.md). Nothing here fabricates a tenant id, a
  client id or a secret.
- **Attachment bytes are returned inline, bounded at 6MB.** A larger file needs a streaming download,
  which is a later capability; the record says so rather than failing obscurely.
- **Polling is every five minutes**, so a message can wait that long. Change notifications would reduce
  it and are additive when needed (see above).
- Gmail reads the authorized account's own mailbox; a Google shared mailbox via domain-wide delegation is
  not implemented.
- The overview counts a bounded page of intake records rather than a server-side aggregate.

## Deferred to a later phase

- **Outbound / reply from a Work Order.** Designed for, not built: a connection already carries
  `outboundEnabled`, and a reply would return on the same thread where the existing association logic
  would file it against the same work. No send scope is requested and no send architecture exists.
- **Change notifications / push delivery**, and with them the observable `NEW` and `PROCESSING` states.
- **Malware scanning** of stored attachments.
- **Attachment retention policy** — a business and legal decision, not a code one.
- **Entitlement gating for the optional providers.** This repository has no licensing framework; the
  architecture is ready and the Administration screen says plainly that provider selection is not
  available in this build, rather than showing a fake paid feature flag.
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
| OAuth state | `functions/src/inboundWork/providerAuthorizationState.ts` |
| Transport contract + failure model | `functions/src/inboundWork/providerTransport.ts` |
| Microsoft / Gmail adapters | `functions/src/inboundWork/microsoftGraphTransport.ts` · `gmailTransport.ts` |
| Credential custody | `functions/src/inboundWork/providerCredentialVault.ts` |
| Connection lifecycle | `functions/src/inboundWork/emailConnectionCommands.ts` |
| Delivery + retry | `functions/src/inboundWork/emailDeliveryService.ts` · `emailDeliverySchedule.ts` |
| Attachment custody | `functions/src/inboundWork/attachmentCustody.ts` · `storage.rules` |
| Transport callables | `functions/src/inboundWork/emailTransportCallables.ts` |
| Service surface | `field-ops-app-vite/src/modules/service/InboundWorkWorkspace.jsx` |
| Administration surface | `field-ops-app-vite/src/modules/administration/AdminEmailCommunications.jsx` |
| Sandbox fixtures + seed | `functions/scripts/fixtures/inboundWorkFixtures.mjs` · `functions/scripts/seedSandboxInboundWork.mjs` |
| Tests | `functions/test/inboundWorkDomain.test.mjs` · `emailTransport.test.mjs` · `inboundWorkEmulator.test.mjs` · `emailTransportEmulator.test.mjs` · `field-ops-app-vite/test/inboundWorkNav.test.mjs` · `field-ops-app-vite/test/inboundWorkWorkspace.test.jsx` |
| CI | `.github/workflows/inbound-work-tests.yml` |

Operator runbook: [Email provider setup](../deployment/email-provider-setup.md).

User guides: [Set up email connections](../user-guide/administration/set-up-email-connections.md) ·
[Review inbound work](../user-guide/work-orders/review-inbound-work.md).
