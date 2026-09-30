# Inbound Work + Email provider — Firebase retirement ledger

Controller ruling: **SERVICE EXPERIENCE COMPLETION** (2026-09-30), increment A — *real mailbox ingestion → EOS / PostgreSQL*.

**Objective.** The active provider runtime must stop depending on Firebase. It is now:

```text
M365 / Google provider → EOS (Render) → PostgreSQL Inbound Work → existing governed review → Accept / Attach / Decline → EOS Work Order
```

There is no Firestore staging, no Firebase callable, no Firebase bridge and no dual write.

This PR deploys and undeploys nothing. Firebase functions already deployed to a project stay there until the final Firebase retirement. No client calls them, and the EOS runtime does not import them.

## Dependency count (`docs/architecture/firebase-exit-baseline.json`)

| Point | Frontend Firestore | Frontend Functions | Server Firestore | Server Functions | Auth / app | Total |
|---|---|---|---|---|---|---|
| Deployed baseline 4e77ac42 | 26 | 35 | 183 | 72 | 7 | **323** |
| This package | 26 | 34 | 171 | 69 | 7 | **307** |

The ratchet only shrinks. The guard reports exact match, 0 violations and 0 stale entries.

## Retired dependencies

| Firebase dependency | Responsibility | EOS / PostgreSQL replacement | Proof | State |
|---|---|---|---|---|
| `emailDeliverySchedule.ts` → `pollEmailMailboxes` (onSchedule, every 5 min) | **Provider polling** | `runInboundDeliveryCycle` (`eosOps/inboundProviderRuntime.ts`). Runs as the Render job `scripts/pollInboundMailboxes.mjs`, or in process when `EOS_INBOUND_POLLING=enabled`. A cluster-wide advisory lock prevents overlapping cycles. | `inboundProviderRuntimePostgres` (THE CYCLE) | RETIRED from source |
| `emailDeliveryService.ts` (poll one mailbox, failures, cursor) | **Polling / delivery** | `pollMailboxOnce`, `recordDeliveryFailure` over `eos_ops.inbound_delivery_failures` and `inbound_mailboxes.delivery_cursor` | INGEST, RETRY, TRANSPORT FAILURE | RETIRED |
| `inboundIntakeCommand.ts` (Firestore `inbound_work_requests` writes) | **Firestore intake staging** | `ingestInboundMessage` (`eosOps/inboundWorkIntake.ts`, `eos_ops.inbound_work_requests` / `inbound_work_messages`). Malformed and unsafe messages are QUARANTINED. | `inboundWorkPostgres`, INGEST | RETIRED |
| `inboundCandidateResolution.ts` (Firestore suggestions) | Intake suggestions | `resolveInboundCandidates` (PostgreSQL CRM / equipment) | `inboundWorkPostgres` | RETIRED |
| `inboundWorkReadService.ts` (mailbox / rules / request reads) | **Mailbox / intake reads** | `readInboundIntakeConfiguration`, `listInboundWork`, `readInboundWorkRequest` | both suites | RETIRED |
| `inboundDecisionCommands.ts` | Accept / Decline / Attach | `inboundWorkDecisions.ts`. Accept goes through the EOS `createWorkOrder`. | `inboundWorkPostgres`, REVIEW | RETIRED (no client caller since W9) |
| `inboundWorkCallables.ts` (10 callables) | Queue, decisions, intake configuration, delivery seam | `POST /operations/inbound-work` | both suites | RETIRED |
| `emailConnectionCommands.ts` | OAuth connection lifecycle | `saveInboundConnection`, `start/completeInboundConnectionAuthorization`, `testInboundConnection`, `disconnectInboundConnection` over `eos_ops.inbound_provider_connections` / `inbound_oauth_states` | CONNECT, CONSENT IS NOT CONNECTED, DISCONNECT | RETIRED |
| `emailTransportCallables.ts` (8 callables) | Connect, test, disconnect, readiness, poll now, retry, attachment read | the same operations on `/operations/inbound-work`, including `readInboundAttachment` | all suites | RETIRED |
| `emailAdminCommands.ts` | Mailbox / rule writes | `saveInboundMailbox`, `saveInboundRoutingRule` | `inboundWorkPostgres` | RETIRED |
| `attachmentCustody.ts` (Firebase Storage bytes, Firestore refs) | Attachment custody | `eos_ops.inbound_work_attachments`: append-only, sha256, 25 MiB bound. Pure rules live in `inboundWork/attachmentCustodyRules.ts`. | INGEST, REVIEW | RETIRED |
| `providerCredentialVault.ts` (Firestore import) | Credential custody | The same module with Firestore removed. The refresh token stays in Secret Manager and the access token in memory; the caller records the refresh. | CONNECT | FIRESTORE-FREE (kept) |
| `access/inboundWorkSource.js` (`firebase/functions`) | Email & Communications administration client | `createEosEmailIntakeSource` → `POST /operations/inbound-work`. Authority comes from `readInboundWorkAccess.canManageIntake`, not the Firebase feed. | client suites | RETIRED from client |

Kept because they are pure (no Firebase): `emailProvider.ts`, `inboundWorkModel.ts`, `inboundRouting.ts`, `inboundThreading.ts`, `inboundProcessing.ts`, `providerTransport.ts`, `providerAuthorizationState.ts`, `microsoftGraphTransport.ts`, `gmailTransport.ts`, `providerTransportFactory.ts`.

Also retired: the Firestore-emulator suites `inboundWorkEmulator` and `emailTransportEmulator`, the emulator CI job, and the Firestore seeder `scripts/seedSandboxInboundWork.mjs`.

## Accepted provider architecture, preserved

- **Microsoft 365.**
  - Uses authorization code + PKCE (S256).
  - Scopes are `offline_access`, `Mail.Read` and `Mail.Read.Shared` only; none of `Mail.Send`, `Mail.ReadWrite` or `Mail.ReadBasic.All`.
- **Google.** Uses authorization code + PKCE, with `gmail.readonly` only.
- **Refresh token.** Stored in Secret Manager (`EOS_CREDENTIAL_VAULT_PROJECT`).
  - The connection row stores only a reference. A CHECK refuses anything that is not a vault reference.
  - No token column exists.
- **Access token.** Held in process memory only.
- **OAuth state.** Stored by sha256. It is single-use, actor-bound, connection-bound and redirect-bound, and expires after 10 minutes.
- **Consent is not CONNECTED.**
  - `oauth_status CONNECTED` only records that a credential is held.
  - `connection_status CONNECTED` is set only after the configured mailboxes are actually read.
- **Mailbox purposes.** Service, Warranty, Parts and Other are preserved.
  - A mailbox confers no disposition authority; the Inbound Work capabilities decide that.

## Activation prerequisites (operator / Owner — NOT done by this PR)

1. **Render environment:**
   - `EMAIL_MICROSOFT_CLIENT_ID` / `_SECRET` (and/or the Google pair);
   - `EOS_CREDENTIAL_VAULT_PROJECT`;
   - a Secret Manager service identity that the EOS API can use.
   The credential is operator custody.
2. **Polling.**
   - Choose either a Render cron job running `node scripts/pollInboundMailboxes.mjs`, or `EOS_INBOUND_POLLING=enabled` on the API service.
   - Nothing polls until one of these is set.
3. **No dual intake.**
   - A Firestore `email_connections` document must not remain CONNECTED while the still-deployed `pollEmailMailboxes` runs.
   - That Firebase schedule is removed at the Firebase retirement.
