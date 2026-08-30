# The view chip rollout — every list, one grammar, and the gaps by name

**Governance:** Owner directive, 2026-08-30 — *"all lists should show it like this"*, then
*"Roll out now — chips everywhere, counts where an authority exists, gaps named per list."*
The reference the Owner pointed at is the Opportunity workspace's views row, accepted at P1.

**Companion to** [`LISTS-P2-COLLECTION-DISPOSITION.md`](LISTS-P2-COLLECTION-DISPOSITION.md),
which classifies *whether a surface is a collection*. This file records something narrower:
**of the surfaces that are collections, which now state their views in the shared grammar, and
what each one can honestly say about counts.**

---

## 1. Why the primitive moved, not fourteen pages

`shared/ui/FilterBar.jsx` was already shared by six lists. Converting the **primitive** converts
its consumers together and — more importantly — keeps them converted. Fourteen separate page
edits would have drifted apart at the first change; this cannot, because there is one row.

The chips are `.ns-collection__views` / `.ns-view`, the same classes `OpportunityList` and
`metadata/ListViewHeader` render. Three sources, one visual language, by class not by copy.

---

## 2. Where a list's chips come from

| Source | Lists |
| --- | --- |
| `FilterBar` (the converted primitive) | Accounts, Transfers, Warehouses, PurchaseOrders, Suppliers, WorkOrders |
| Its own markup | Opportunity — the accepted reference implementation |
| `metadata/ListViewHeader` (saved views) | Accounts, CustomerEquipment, EquipmentWorkspace, PartMaster, SalesOrders, WorkOrders |

A page may appear twice: saved views and status views answer different questions, and a page
entitled to both states both.

---

## 3. Counts — three states, and why two would lie

The chip distinguishes **three** things, and collapsing any pair of them tells a lie:

| value | what it means | renders |
| --- | --- | --- |
| `undefined` | this list has no counting dimension at all | nothing |
| `null` | a count was attempted and is unavailable | `—` |
| number | the governed count, **including a real `0`** | the number |

> `0 Active` is a claim about the **business**.
> `—` is a claim about the **read**.
> A bare label says the question was never asked.

An earlier cut of this work rendered `null` as nothing, which quietly demoted *"we could not
count"* into *"there is nothing to count"*. Three existing suites failed on it. They were right;
the rule above is the correction, and it lives in the primitive so no caller can re-collapse it.

### 3.1 What each counted list is entitled to claim

Checked against each list's own read, not assumed from the presence of a number:

| List | Count authority | Honest because |
| --- | --- | --- |
| **Accounts** | server-side governed portfolio summary | passes `null` whenever `summaryState !== "READY"` |
| **Suppliers** | client aggregate over the loaded set | passes `undefined` unless `state === READY && !hasMore` — an incomplete read states no number at all |
| **Warehouses** | client aggregate over the loaded set | same completeness guard as Suppliers |
| **PurchaseOrders** | client aggregate over `view.rows` | counts only past a fail-closed load ladder, over an **unbounded** live query — the loaded set *is* the set |
| **Transfers** | client aggregate over `rows` | same: load ladder first, unbounded read behind it |

---

## 4. The gaps, by name

Naming a gap is the deliverable. None of these were dressed to look converted.

### 4.1 A views row with no counting authority

**Work Orders.** Has views; has **no count**. The list is bounded and cursor-paged, and its
status counts were deliberately removed earlier for exactly that reason — a count over one page
presented as a view total is the `0 Active` lie in a different costume. The chips render labels
only (`undefined`, per §3).

**What would close it:** a server-side aggregate per status. That authority does not exist today.
Until it does, no number here is honest, and the absence is the correct rendering.

### 4.2 Collections whose page has not had the collection pass

**PartsList** (`Inventory → Parts`). A pre-North-Star `WorkspaceShell` holding several panels,
with **two** chip rows: one filtering the Inventory Health panel, one filtering the catalog
table. Neither is "a view of this page's collection", and the page carries no collection
identity above them. Both pass `variant="chips"`.

**What would close it:** a collection pass on the page — identity, header, one collection — not
a chip swap. Two views rows on one page would also state two collections where there is one page.

### 4.3 Surfaces that are legitimately not collections

**WarehouseManagerHome.** A role Home — the Overview archetype. Filtering a panel is not the
same act as choosing which slice of a collection to read. `variant="chips"`, and the composition
gate is what caught the first attempt to give it a views row. The gate was right.

### 4.4 Collections with no view dimension defined

**Manufacturers · EmployeesList · TruckInventory · Jobs.** No view dimension exists to state, so
there is nothing to render. This is **not** a rendering gap and no chip row is owed. If a view
dimension is later defined for any of them, it arrives through `ListViewHeader` or `FilterBar`
and is in the grammar automatically.

---

## 5. The hole this rollout opened, and where it is closed

`variant` defaults to `"views"`. That default is deliberate — collections are the common case —
but it means **a related section could acquire collection chrome by adding a plain
`<FilterBar>`**: no class name in its own source, nothing for the existing text-search check in
`test/listsP2Compose.test.jsx` to see.

The rule did not change. The way to break it did.

Three checks now stand where one did:

1. no non-collection surface **contains** the collection classes (unchanged, with the primitive
   that implements them named as the one exception);
2. every non-collection surface **calling** `FilterBar` passes `variant="chips"` — stated as the
   caller's obligation, which is why the prop is not a boolean with a safe default;
3. **the default really is the views row** — because if it ever flipped, check 2 would pass for
   every caller including a genuine offender, and would be guarding nothing.

Check 3 exists because *a check incapable of failing is not evidence*. Check 2 caught `PartsList`
on its first run.

---

## 6. Also retired

`fo-portfolio-card*` — the five dark filled tiles that stated the customer portfolio on Accounts
in a visual language no other list used. The rules are **deleted**, not left dormant: a dark-tile
ruleset sitting in the stylesheet is an invitation to rebuild the control it replaced. Zero
remaining references in JSX or CSS.

The counts those tiles carried were never the problem and did not change. They are chip counts
now, and an unavailable one is still an em dash.

---

## 7. What did not change

No authority, capability, Firestore Rule, read scope, or query changed anywhere in this work.
It is presentation and the guards that hold the presentation honest.
