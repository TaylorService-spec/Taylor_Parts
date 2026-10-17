Issued: 2026-10-17 (America/Phoenix) · head `7d456271` on main `a947a3bb` · Firebase-exit lane, slice **F7b** · Controller decision under the Owner's preserve-functionality-and-access rule · DECISIONS #243

**Do not merge without the controller's exact-head decision.** Lane D reviews after the lane is idle. Authorization-touching: two capabilities and six parity grants.

## ⚠ Existing data is NOT moved, so this is not a completed data transition
`eos_crm.activities` starts **empty**, and Firestore `crm_activities` are **not copied** by this PR. Prepared:
- `scripts/exportCrmActivitySnapshot.js`: a read-only Firestore export (migration-only).
- `scripts/crmActivityCopy.js`:
  - **census** is the default and read-only. It reports counts by type and Account, the **Account gaps** (activities whose Account the PostgreSQL CRM does not hold), and the checksum.
  - **copy** is insert-only and **refuses without `--ownerAuthorization`**. Rows keep their Firestore ids, are MIGRATED, and carry no Firebase uid in any column.
  - **verify** is read-only.

The copy runs only on the Owner's go-ahead.

## The decision, and where it is
| Decision | Implementation |
|---|---|
| Reads follow the Account's read predicate, never wider | `listAccountActivities` requires `crm.activity.read` **and** `customer.record.read`, with the Account in this tenant (another tenant's Account reads as absent). **Note:** the EOS Account read is **tenant-scoped**. `eos_crm.accounts` carries no operating company (migration 1758758400000 explains why), so "company-scoped per #235" has no company dimension to apply here. The read is exactly as wide as reading the Account, and no wider. |
| Mirror the current holders, no new holders | `crm.activity.read` and `.create` are registered and granted to exactly **admin** (Owner ruling 2026-08-19), **owner** (`OWNER_COMMERCIAL_AUTHORITY`) and **crmActivityContributor**, the Firebase catalog's holders. Grant-bearing (Owner ruling E): baseline **481 → 487** in this change. |
| **Explicit API restriction (Owner review)** | Not parity. A principal holding `crmActivityContributor` **alone** (no `customer.record.read`) can no longer **read or create** activity through the API; it could call the Firestore callables directly. That it could not open the Account page does not establish API parity. Admin and owner hold `customer.record.read`. **No customer-read grant is added** to compensate. |
| Create: Account visibility and linked records (Owner review) | Create needs `crm.activity.create` **and** `customer.record.read`, with the Account in this tenant. Every linked Contact, Opportunity and Sales Order must exist **in this tenant and on that Account**; otherwise `CONTACT_NOT_FOUND` / `OPPORTUNITY_NOT_FOUND` / `SALES_ORDER_NOT_FOUND`, the same answer as an unknown id, before any write. |
| Census and copy scripts, copy Owner-gated | As above. |

## Behaviour kept (`eosCrm/crmActivityAuthority.ts`)
- **Content:** the five types; a required Account; Contact / Opportunity / Sales Order by id only; a body of at most 4,000 characters.
- **Two times:** `occurredAt` (may be backdated, never materially future) is kept distinct from `createdAt`.
- **Idempotency:** one key per actor = one activity.
- **The list:** most recent interaction first. A list longer than its limit is `unavailable`, never a partial `ready`.
- **Audit:** one audit row per create; a replay writes nothing.

## Client
- `services/crmActivityClient.js` replaces `crmActivityCallableClient.js`, with the same `{ result } / { errorStatus }` contract. `useCrmActivities`, `useCrmActivityActions` and `ActivityAndNotesSection` are unchanged in behaviour.
- Actor names now resolve by EOS Principal id.
- New user guide: `accounts-customers/record-customer-activity-and-notes.md`.

## Ratchets and docs
- Exit baseline **245 → 244** (functions client 17 → 16).
- Migration pins 99 → 100 (the six pin files, including the activation-vehicle peel).
- Vocabulary 139 → 141; Owner contract 41 → 43 in vocabulary (owner already declares both keys); governed replay +6 per stage; `crmAuthority` capability set.
- `capability-graph.json` and `precedence-sweep.json` regenerated.
- DECISIONS #243 and the ledger's F7b section.
- **Merge note:** #2132 (F5) and #2133 (F7a) move the same exit-guard pin and the migration-count pins. Each later merge needs a one-line lap per pin.

## Verification (local; WSL LF clone; bounded workers; DB stopped after)
- **`crmActivityPostgres`:** 9/9 at `7d456271`, covering:
  - contributor-only refused for read and create; linked records on another Account or in another tenant, or unknown, refused; same-Account links accepted;
  - create, audit and replay;
  - refusals before any write: capability, other-tenant Account, type, future time, long body;
  - the read needs BOTH keys and the Account in this tenant;
  - most recent first, backdating kept, too-long = unavailable;
  - the table's CHECKs;
  - the copy CLI end to end: census Account gaps, the Owner go-ahead required, MIGRATED rows with NULL `created_by`, a no-op rerun, verify;
  - static checks.
- Postgres: baseline 14/14, governed replay 1/1, sample company 43/43, activation vehicle 10/10.
- `test:adminPolicy` (crmAuthority and Owner contract included) and `test:governance` (generators clean) pass.
- Fence and migration ledger 268/268; exit guards 99/99.
- **Client:** vitest for the activity section, actions, account page, shared UI and CRM client mirror (63 + 9); node CI coverage and account page 20/20; lint 0 errors; tsc OK.
- **Not done:** a live browser check against nonprod, which is left for the controller's nonprod verification after deploy.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
