from ed import edit
R = "D:/eos-fb-exit/"
def append(path, text):
    s = open(path, encoding="utf-8", newline="").read()
    nl = "\r\n" if "\r\n" in s else "\n"
    s = s.rstrip("\r\n") + nl + nl + text.strip("\n").replace("\n", nl) + nl
    open(path, "w", encoding="utf-8", newline="").write(s)

append(R + "docs/DECISIONS.md", """
## #243 — CRM activity / notes move to EOS Core — never wider than the Account read, current holders mirrored (Firebase exit F7b, 2026-10-17)

**Status: CONTROLLER DECIDED under the Owner's preserve-functionality-and-access rule (F7b, 2026-10-17).** Merge and deployment follow the normal gate.

**Why.** An Account's Activity & Notes timeline was two Firebase callables (`getCrmActivities` and `createCrmActivity`) over Firestore `crm_activities`. The read checked `crm.activity.read` alone, tenant-wide, with no Account predicate.

**Rule.**
- **The record.** `eos_crm.activities` (migration 1764590000000), served on the CRM route `/crm/customer` (`listAccountActivities`, `createAccountActivity`; `eosCrm/crmActivityAuthority.ts`). The Firestore behaviour is kept:
  - the five types (SALES_NOTE / CALL / MEETING / RELATIONSHIP / GENERAL);
  - a required Account, with Contact / Opportunity / Sales Order references by id only;
  - a non-blank body of at most 4,000 characters;
  - `occurred_at` (may be backdated, never materially future) distinct from `created_at`;
  - one idempotency key per actor = one activity;
  - most recent interaction first;
  - a list longer than its limit is `unavailable`, never a partial `ready`.
  - Every created activity writes one audit row; a replay writes nothing.
- **Read scope: never wider than the Account.** A read needs `crm.activity.read` **and** the Account's own read predicate: `customer.record.read`, with the Account in this tenant.
  - The EOS Account read is **tenant-scoped**. `eos_crm.accounts` carries no operating company (migration 1758758400000), so there is no company dimension to apply. The decision's "company-scoped per #235" therefore resolves to the Account's tenant-scoped predicate.
  - Create needs `crm.activity.create` and an Account in this tenant.
- **Access: parity, no new holder.** `crm.activity.read` and `.create` are registered and granted to exactly the Firebase catalog's current holders:
  - **admin** (Owner ruling 2026-08-19);
  - **owner** (`OWNER_COMMERCIAL_AUTHORITY`);
  - **crmActivityContributor**.
  - This is grant-bearing (Owner ruling E): the authority baseline goes 481 → 487 in the same change.
  - The read additionally requires `customer.record.read`. That narrows only a principal who could not open the Account at all, and admin and owner hold it.
- **Client.** `services/crmActivityClient.js` replaces the callable client, with no Firebase fallback; the hooks and the section are unchanged in contract. Actor names resolve by EOS Principal id.

**Existing data is NOT moved.** An empty `eos_crm.activities` is not a completed data transition. Prepared:
- `scripts/exportCrmActivitySnapshot.js`: read-only, migration-only.
- `scripts/crmActivityCopy.js`:
  - **census** is the default and read-only. It reports counts by type and Account and the Account gaps (`ACCOUNT_NOT_IN_EOS`), plus the checksum.
  - **copy** is insert-only and refuses without `--ownerAuthorization`. Rows keep their Firestore ids, are MIGRATED, and carry no Firebase uid in any column.
  - **verify** is read-only.
  - The copy runs only on the Owner's go-ahead.

**Proof.**
- `crmActivityPostgres`:
  - create, the audit row and replay;
  - refusals before any write: capability, another tenant's Account, type, future time, long body;
  - the read needs BOTH keys and the Account in this tenant;
  - most recent first, backdating kept, too-long = unavailable;
  - the table's CHECKs;
  - the copy CLI end to end.
- `roleCapabilityAuthorityBaselinePostgres`: 487.
- The migration test pins exactly the three holders.
""")

append(R + "docs/architecture/frontend-dormant-firebase-client-retirement-ledger.md", """
## F7b: CRM activity moves to EOS Core (2026-10-17, exit baseline 245 → 244)

| Removed | Replaced by |
| --- | --- |
| `services/crmActivityCallableClient.js` (`getCrmActivities`, `createCrmActivity`) | `services/crmActivityClient.js` → `/crm/customer` `listAccountActivities` / `createAccountActivity` (`eosCrm/crmActivityAuthority.ts`, `eos_crm.activities`), with the same `{ result } / { errorStatus }` contract for `useCrmActivities`, `useCrmActivityActions` and `ActivityAndNotesSection`. |

- **Decision (DECISIONS #243):** the read is never wider than the Account read, and the current holders (admin, owner, crmActivityContributor) are mirrored.
- **Existing Firestore activities are NOT copied.** The census and copy tools (`scripts/exportCrmActivitySnapshot.js`, `scripts/crmActivityCopy.js`) are prepared; the copy runs only on the Owner's go-ahead.
- **The server callables** stay deployed until an operator undeploy, which is reserved.
""")

