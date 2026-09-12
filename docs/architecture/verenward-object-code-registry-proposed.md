# The Verenward Object Code Registry (PROPOSED)

**Status:** PROPOSED. No code in this registry is allocated, minted, or in use.
**Governs:** the 4-character object code that opens every EOS Record ID under
`verenward-global-record-identity-standard.md`.
**Companion:** `record-id-migration-impact-census.md`.

---

## 1. The rules of the registry

1. **Globally registered by Verenward.** A code exists when it appears in this registry and nowhere
   else. There is no local, per-tenant, or per-deployment allocation.
2. **One object meaning per code, forever.** A code names exactly one object class across every
   tenant, every customer, every operating company, every environment, and every Verenward product
   that shares the platform namespace.
3. **Never reassigned. Retired codes are reserved forever.** A retired code is not free. It is a
   permanent gravestone: every historical ID, export, document and crosswalk row still carries it,
   and reissuing it to a different object would silently re-point that history at the wrong thing.
4. **Tenants and customers cannot mint codes.** They may *request* one (§4). The allocation is
   Verenward's.
5. **Human-readable where possible**, machine-decided where not. A code is four uppercase letters
   that suggest the object to someone who already knows the domain. It is not an abbreviation
   algorithm and it is not required to be guessable.
6. **Collision-free by construction, not by review.** The uniqueness of a code is a property of this
   file, and a test asserts it.
7. **Codes are `[A-Z]{4}` only.** No digits, no lowercase, no separators. This keeps the first
   character of every Record ID a letter, which is what makes the spreadsheet-safety guarantee in
   the standard structural rather than probabilistic.

---

## 2. The namespace partition

The **first letter** partitions the code space. This is the mechanism that guarantees a
customer-defined object can never collide with a Verenward object that does not exist yet.

| First letter | Partition | Who allocates | Capacity |
|---|---|---|---|
| `A`–`W`, `Y` | **Verenward platform objects** | Verenward, in §3 of this file | 24 × 26³ = 421,824 |
| `X` | **Customer/tenant-defined objects** | Verenward, on customer request, in §4 | 17,576 |
| `Z` | **Reserved** — internal, experimental, test fixtures, never production | Verenward, unrecorded | 17,576 |

A code in the `X` partition is still centrally registered, still globally unique, and still never
reassigned. The partition does not delegate authority; it guarantees that Verenward's future
allocations cannot walk into a customer's existing one.

---

## 3. The proposed platform registry

### 3.1 Column meanings

- **Class** — `CORE` (a first-class business record), `LINE` (a child line whose first-class status
  is unsettled — see the standard, §14.4), `PLATFORM` (durable administrative record),
  `RETIRED` (reserved forever, never allocated to anything else).
- **Ordering** — `TIME` (`TIME_ORDERED`, UUIDv7) or `SCAT` (`SCATTERED`) per the standard §5.3.
  Every object is proposed as `TIME`; the column exists so a change is a registry edit.
- **Today** — the identity shape in the integrated tree right now, summarised. `auto` = Firestore
  auto-ID, `derived` = server-derived hash, `natural` = caller-supplied natural key,
  `typed` = operator-typed free text, `uuid` = `prefix_randomUUID()`, `shared` = shares another
  object's key.

### 3.2 CRM and commercial

| Code | Object | EntityDefinition | Class | Ord. | Today |
|---|---|---|---|---|---|
| `ACCT` | Account (Customer) | `account` | CORE | TIME | auto **+** `IMP-<slug>-<digest>` |
| `CNTC` | Contact | `contact` | CORE | TIME | auto |
| `LOCN` | Location (customer site) | `location` | CORE | TIME | auto |
| `OPPT` | Opportunity | `opportunity` | CORE | TIME | auto |
| `SAGR` | Sales Agreement | `salesAgreement` | CORE | TIME | auto |
| `SORD` | Sales Order | `salesOrder` | CORE | TIME | auto |
| `SOLN` | Sales Order Line | — | LINE | TIME | embedded |
| `STER` | Sales Territory | `salesTerritory` | CORE | TIME | auto |
| `CCAS` | Commercial Coverage Assignment | **none** | CORE | TIME | auto |
| `CACT` | CRM Activity | **none** | CORE | TIME | auto |
| `OWHF` | Ownership Handoff | **none** | CORE | TIME | `hof_<uuid>` |

### 3.3 Finance

| Code | Object | EntityDefinition | Class | Ord. | Today |
|---|---|---|---|---|---|
| `INVC` | Invoice | `invoice` | CORE | TIME | auto / `inv_<uuid>` |
| `INLN` | Invoice Line | — | LINE | TIME | `invl_<uuid>` |
| `IADJ` | Invoice Adjustment | **none** | CORE | TIME | auto |
| `PMNT` | Payment (cash receipt) | `payment` | CORE | TIME | auto |
| `PAPP` | Payment Application | **none** | CORE | TIME | auto |
| `RFND` | Refund | **none** | CORE | TIME | auto |
| `FPOL` | Financial Policy Profile | **none** | PLATFORM | TIME | — |

### 3.4 Purchasing and supply

| Code | Object | EntityDefinition | Class | Ord. | Today |
|---|---|---|---|---|---|
| `SUPL` | Supplier | `supplier` | CORE | TIME | **natural** (caller-supplied) |
| `SCAT` | Supplier Catalog Item | `supplierCatalogItem` | CORE | TIME | opaque, **no writer** |
| `PSUP` | Part Supplier Item | **none** | CORE | TIME | **derived** `partId__supplierId` |
| `MANF` | Manufacturer | `manufacturer` | CORE | TIME | **natural** (caller-supplied) |
| `RORQ` | Reorder Request | `reorderRequest` | CORE | TIME | auto / `rr_<uuid>` |
| `PORD` | Purchase Order | `purchaseOrder` | CORE | TIME | **shared** — *is* the Reorder Request id |
| `PVOD` | Purchase Order Void | `purchaseOrderVoid` | CORE | TIME | **shared** — same id again |
| `RCVO` | Receiving Order | `receivingOrder` | CORE | TIME | derived `rcv_`/`rcvc_` / `rcv_<uuid>` |
| `RCVL` | Receiving Order Line | — | LINE | TIME | `rcvl_<uuid>` |

### 3.5 Inventory, warehouse, logistics

| Code | Object | EntityDefinition | Class | Ord. | Today |
|---|---|---|---|---|---|
| `PART` | Part | `part` | CORE | TIME | `partId` **is** the doc id |
| `PALS` | Part Alias | `partAlias` | CORE | TIME | derived |
| `IVTX` | Inventory Transaction / Movement | `inventoryTransaction` | CORE | TIME | auto **+** derived `imv_` |
| `IVCM` | Inventory Commitment | **none** | CORE | TIME | `cmt_<uuid>` |
| `WHSE` | Warehouse | `warehouse` | CORE | TIME | **typed** (`wh-main`) |
| `BINL` | Bin | **none** | CORE | TIME | derived `bin_<sha256[0:40]>` |
| `BCLM` | Bin Code Claim | **none** | PLATFORM | TIME | natural `binclaim_<wh>__<code>` |
| `BPLC` | Bin Placement | **none** | CORE | TIME | derived `plc_…` |
| `RLOC` | Stock Relocation | **none** | CORE | TIME | derived `srl_…` |
| `MLOC` | Mobile Location | `mobileLocation` | CORE | TIME | **typed** (`MOBILE-101`) |
| `TRCK` | Truck | `truck` | CORE | TIME | **typed** (`TRK-101`) |
| `TORD` | Transfer Order | `transferOrder` | CORE | TIME | derived `trf_` / `trf_<uuid>` |
| `CCSH` | Cycle Count Sheet | **none** | CORE | TIME | derived `ccs_` / `ccs_<uuid>` |
| `CCLN` | Cycle Count Line | **none** | LINE | TIME | derived from `partId` alone |
| `SRLA` | Serialized Asset | **none** | CORE | TIME | derived `sa_<sha256([partId,serialNo])>` |

### 3.6 Service operations, equipment, people

| Code | Object | EntityDefinition | Class | Ord. | Today |
|---|---|---|---|---|---|
| `WKOR` | Work Order | `workOrder` | CORE | TIME | auto (+ `woNumber`) |
| `EQIP` | Equipment (installed asset) | `equipment` | CORE | TIME | auto (client-direct) |
| `EQMD` | Equipment Model | `equipmentModel` | CORE | TIME | natural / `(tenant_id, id)` |
| `ECMP` | Equipment Compatibility | **none** | CORE | TIME | derived |
| `EQIN` | Equipment Installation | **none** | CORE | TIME | derived |
| `ISVH` | Imported Service History | **none** | CORE | TIME | import-only |
| `EMPL` | Employee | `employee` | CORE | TIME | auto / auth uid |
| `EPLK` | Employee–Principal Link | **none** | PLATFORM | TIME | `epl_<uuid>` |
| `PGOL` | Performance Goal | **none** | CORE | TIME | — |

### 3.7 Email intake

| Code | Object | EntityDefinition | Class | Ord. | Today |
|---|---|---|---|---|---|
| `EMCN` | Email Connection | **none** | PLATFORM | TIME | — |
| `EMBX` | Email Mailbox | **none** | PLATFORM | TIME | — |
| `EMRR` | Email Routing Rule | **none** | PLATFORM | TIME | — |
| `IWRQ` | Inbound Work Request | **none** | CORE | TIME | — |
| `EMDF` | Email Delivery Failure | **none** | PLATFORM | TIME | — |

`email_oauth_states` gets **no code**: it is a short-lived, single-use, hash-keyed token, not a
durable record. Ephemeral state is out of scope for record identity.

### 3.8 Platform administration

| Code | Object | Class | Ord. | Today |
|---|---|---|---|---|
| `TNNT` | Tenant | PLATFORM | TIME | `tenant-<uuid v4>` |
| `OPCO` | Operating Company | PLATFORM | TIME | key/natural |
| `PRIN` | Principal (identity subject) | PLATFORM | TIME | `<uuid v4>` |
| `TMEM` | Tenant Membership | PLATFORM | TIME | `<uuid v4>` |
| `ROLE` | Role | PLATFORM | TIME | `<uuid v4>` |
| `RASG` | Role Assignment | PLATFORM | TIME | `<uuid v4>` |
| `PSET` | Permission Set | PLATFORM | TIME | `<uuid v4>` |
| `OBJD` | Object Definition (admin policy) | PLATFORM | TIME | `<uuid v4>` |
| `FLDD` | Field Definition (admin policy) | PLATFORM | TIME | `<uuid v4>` |
| `WKFL` | Workflow | PLATFORM | TIME | `<uuid v4>` |
| `WFVR` | Workflow Version | PLATFORM | TIME | `<uuid v4>` |
| `WFIN` | Workflow Instance | PLATFORM | TIME | `<uuid v4>` |
| `AUDT` | Audit Event | PLATFORM | TIME | auto **or** content-derived |
| `IMPJ` | Data Import Job | PLATFORM | TIME | `IMP-<stamp>-<rand>` |
| `RPTD` | Report Definition (saved) | PLATFORM | TIME | natural / ad-hoc |
| `RPTX` | Report Execution | PLATFORM | TIME | ad-hoc |
| `XWLK` | Record Identity Crosswalk entry | PLATFORM | TIME | **new** |
| `TOMB` | Record ID Tombstone | PLATFORM | TIME | **new** |

### 3.9 Retired — reserved forever, never reissued

| Code | Object | Retired because |
|---|---|---|
| `SLOC` | Stock Location | Retired by BIN-P2 / Decision #160 / ADR-014. Rows removed by migration 008. The EntityDefinition is still registered — see the census. |
| `IVAC` | Inventory Action | Sole writer retired by Owner ruling 2026-08-30 and now throws. Historical documents remain. |

These two codes are allocated on the day the registry is created and are allocated to **nothing**.
That is the point.

### 3.10 Uniqueness

All codes above are distinct, all are `[A-Z]{4}`, none begins with `X` or `Z`. A registry test must
assert exactly this, so the property is checked rather than remembered.

---

## 4. Allocating a code for a future or customer-defined object

### 4.1 What a requester supplies

1. **What the object IS** — one paragraph, in domain language, that a person outside the requesting
   team can read.
2. **Why it is first-class** — specifically: is it ever referenced from outside its parent? An
   object that is only ever reached through its parent is a line, not a record, and lines are
   deferred (standard §14.4).
3. **Its persistence authority** — which store owns it.
4. **Its human identity** — `nameField`, `referenceField`, or an explicit `SYSTEM_ONLY`, per the
   existing `IDENTITY_MODE` contract (DECISIONS #106). A request that cannot answer this is not
   ready.
5. **Whether it needs a business number**, and if so who allocates it. This is a *separate* decision
   from the Record ID and must be made separately, or the object will end up with a Record ID doing
   a business number's job — the failure this whole standard exists to prevent.
6. **Three or four candidate codes**, in preference order.

### 4.2 What the registrar checks

| Check | Rejects |
|---|---|
| Is this genuinely a new object? | a renamed view of an existing one, a status variant, a per-tenant flavour |
| Is it first-class? | a line, an embedded value, an ephemeral token, a projection, a cache |
| Is the code free? | anything in §3, including §3.9's retired codes |
| Is the code in the right partition? | a Verenward object claiming `X`; a customer object outside `X` |
| Is the code legible to someone who knows the domain? | initialisms that collide with an existing code's meaning |
| Does it read as a *different thing* from every near neighbour? | `SORD`/`SOLN` is fine; a new `SODR` is not |
| Does the object encode nothing business-mutable? | anything whose identity would need to change |

### 4.3 The customer-defined case specifically

A customer asking for a custom object gets a code in the `X` partition, allocated by Verenward,
recorded in §4.4 of this file, and globally unique across **all** customers — not per-tenant. Two
customers who both define "Rental Agreement" get **two different codes**, because they are two
different objects with two different field sets that will diverge, and giving them one code would
make the object model a lie the first time one of them changed.

The customer never sees an unallocated code, cannot propose a code outside `X`, and cannot reuse a
code another customer holds.

### 4.4 Allocated customer codes

*(none allocated)*

### 4.5 What a new code does not do

Registering a code does not create a table, a capability, a Rules block, a screen, or an
EntityDefinition. It reserves four characters. Everything else is that object's own work.

---

## 5. Candidate codes deliberately not used

Recorded so a future allocation does not re-litigate them.

| Not used | Instead | Why |
|---|---|---|
| `CUST` for Account | `ACCT` | the object is `account` in every definition, collection and command; `CUST` would name a concept the model does not have |
| `USER` for Employee/Principal | `EMPL` / `PRIN` | "user" conflates the human (Employee), the identity subject (Principal), and the session. The tree already separates all three |
| `ITEM` for Part | `PART` | `part` is the object; `item` is what `supplierCatalogItem` and `partSupplierItem` are, and the collision would be immediate |
| `ORDR` for anything | `SORD`/`PORD`/`TORD`/`RCVO` | four different objects are "an order"; a generic code would make the most common mis-wiring undetectable |
| `TXN` / `TRAN` | `IVTX` | "transaction" is also a database transaction and a payment transaction |
| `BIN` (3 chars) | `BINL` | codes are fixed at four |
| `SA`, `SN` for Serialized Asset | `SRLA` | two characters is not the format |
| `STCK` for Stock Location | `SLOC` | retired; reserved under the name it actually had |
