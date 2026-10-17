from ed import edit
edit("docs/user-guide/inventory/scan-workspace.md", [
("""**Returns** are listed, but not as something you can start. **Take a return in** appears under
**Not Available to You** with the words "Taking a return in is not yet available in EOS. This is not
a permission you are missing: no one can be granted it until it moves to EOS." Asking an administrator
for access will not change that. Deciding what happens to a returned item is a separate step that does
not exist yet.""",
"""**Returns: taking one in needs its own access.** **Take a return in** is offered only if your access
includes taking returns in (the returns-intake role). Otherwise it appears under **Not Available to You**
with the words "You are not authorized to take returns in. An administrator can grant it." When you take
a return in you choose the operating company receiving it (it is chosen for you when you have only one)
and, if you like, the receiving warehouse. Deciding what happens to a returned item is a separate step
that does not exist yet: taking a return in never puts anything back into stock."""),
("""| Taking a return in is not yet available in EOS | This is not a permission you are missing: returns have not moved to EOS yet | Nothing yet. No one can be granted it until it moves to EOS |""",
"""| You are not authorized to take returns in | Your access does not include taking returns in | An administrator can assign you the returns-intake role |
| You have no operating company to take returns in for | Your account is not linked to an operating company | An administrator links your account to your employee record |"""),
])

def append(path, text):
    s = open(path, encoding="utf-8", newline="").read()
    nl = "\r\n" if "\r\n" in s else "\n"
    s = s.rstrip("\r\n") + nl + nl + text.strip("\n").replace("\n", nl) + nl
    open(path, "w", encoding="utf-8", newline="").write(s)

append("docs/DECISIONS.md", """
## #242 — OWNER: Returns intake moves to EOS Core — operating company required, no ledger movement, a memberless clerk Role (Firebase exit F7a, 2026-10-17)

**Status: OWNER RULED (F7a, 2026-10-17).** Supersedes the premise of #231 (returns intake was "not yet available in EOS"). Merge and deployment follow the normal gate.

**Why.** Taking a return in was a Firebase callable over Firestore `inventory_returns`. The Scan workspace refused it to everyone as "not yet in EOS", because the capability had no PostgreSQL registration and nobody could be granted it.

**Rule.**
- **The model** (Owner ruling 1). The record is `eos_ops.inventory_returns` (migration 1764580000000), and the Firestore behaviour is kept:
  - **Intake only (#118).** One state, AWAITING_DISPOSITION, enforced by a CHECK. **No ledger movement**: intake never restores sellable stock.
  - The same closed vocabularies: sources WORK_ORDER / CUSTOMER / TRUCK / SUPPLIER / UNKNOWN, and conditions UNOPENED / OPENED / DAMAGED / UNKNOWN. An unknown value is refused, never coerced.
  - Quantity XOR serials.
  - One idempotency key = one return, with id `ret_<key>`. A replay answers from the stored row; a different return under a used key is refused (IDEMPOTENCY_CONFLICT).
  - Every recorded return writes one `eos_policy.audit_events` row; a replay writes nothing.
- **Company scope** (Owner ruling 2). The operating company is REQUIRED; the receiving warehouse is optional.
  - Authority is resolved server-side with `resolveCompanyAuthority`, the #237 check:
    - no authority at all is COMPANY_AUTHORITY_REQUIRED;
    - a company outside the caller's ≡ an unknown company (OPERATING_COMPANY_NOT_GOVERNED).
  - A stated warehouse must belong to that company AND be in the caller's warehouse reach. Otherwise it answers exactly like an unknown warehouse (WAREHOUSE_NOT_FOUND).
  - Every refusal precedes any write.
- **Transport.** `/operations/inventory` serves `recordReturnIntake` and `listReturnIntakeOptions` (the caller's companies, and the warehouses in reach for each). Neither sits behind the Reorder activation boundary.
- **Access** (Owner ruling 3). `inventory.returns.intake` is registered (object `inventoryReturn`, BUSINESS_ACTION) and granted to ONE Role, `inventoryReturnsIntakeClerk`, which has **no members**.
  - This is a grant-bearing migration (Owner ruling E); the authority baseline goes 481 → 482 in the same change.
  - Nobody is assigned anything by this change. Rudy Admin's nonprod ability is restored after deploy by the Controller through the governed previewAuthorityChange → assignRole path, audited. There is no production access change.
- **Client.** `services/returnCommandClient.js` calls EOS, with no Firebase fallback. The Scan › Take a return in screen asks for the company (chosen automatically when there is only one) and an optional warehouse.
  - Offline intake keeps working from the last options the server gave the device. The server re-checks on replay, and a refusal is never answered from the cache.
  - A non-holder is now refused as a grantable permission ("An administrator can grant it").

**Existing data is NOT moved** (Owner ruling 4). An empty `eos_ops.inventory_returns` is not a completed data transition. Two tools are prepared, and neither blocks this merge:
- `scripts/exportReturnIntakeSnapshot.js`: the read-only Firestore export, a migration-only exception authorized by this ruling.
- `scripts/returnIntakeCopy.js`:
  - **census** is the default and is read-only. It reports counts, the company/warehouse mapping gaps, and the copy checksum.
  - **copy** is insert-only and refuses without `--ownerAuthorization`. Every record's company is named by a person in `--mapping` and never guessed. Rows are MIGRATED with no Firebase uid in any column. Firestore is never touched.
  - **verify** is read-only and states the reconciliation criteria.

**Proof.**
- `returnIntakePostgres`:
  - the vocabulary and validation parity;
  - every refusal before any write, by snapshot;
  - out-of-company ≡ unknown, for both company and warehouse;
  - one row plus one audit row and NO ledger movement;
  - replay and idempotency conflict;
  - the table's own CHECKs;
  - the options read;
  - the copy CLI end to end: census gaps, Owner go-ahead required, drift refused, MIGRATED rows with NULL `received_by`, a no-op rerun, verify.
- `roleCapabilityAuthorityBaselinePostgres`: 482, rebuilt exactly.
- `operatorScriptEnvironmentFence`: the copy refuses before any client loads.
- `returnIntakeScan` and `warehouseOfflineScreens`: the company choice, nobody guesses, the cached offline options.
- `inventoryScanPersonaWorkflows`: refused as grantable, and offered to a holder.
""")

append("docs/architecture/frontend-dormant-firebase-client-retirement-ledger.md", """
## F7a: Returns intake moves to EOS Core (2026-10-17, exit baseline 245 → 244)

| Changed | Now |
| --- | --- |
| `services/returnCommandClient.js` (the `recordReturnIntake` callable) | It calls EOS `recordReturnIntake` and `listReturnIntakeOptions` on `/operations/inventory` (`eosOps/returnIntake.ts`, `eos_ops.inventory_returns`). Its consumers (`ReturnIntakeScan.jsx`, `offline/warehouseCommandBindings.js`) are unchanged in shape. |

- **Owner ruling (DECISIONS #242):** operating company required, warehouse optional, no ledger movement, and a memberless `inventoryReturnsIntakeClerk` Role.
- **Existing Firestore returns are NOT copied.** The census and copy tools (`scripts/exportReturnIntakeSnapshot.js`, `scripts/returnIntakeCopy.js`) are prepared. The copy runs only with the Owner's go-ahead and a person's company mapping.
- **The server callable** `recordReturnIntake` stays deployed until an operator undeploy, which is reserved.
""")
