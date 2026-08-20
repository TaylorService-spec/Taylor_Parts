# Parts Scanner access — decision package

**Status:** DECISION REQUIRED (Owner). Nothing has been changed.
**Prepared:** 2026-08-20
**Question put to this package:** should Parts Scanner eligibility become
`admin, dispatcher, partsManager, partsAssociate, warehouseManager`?

---

## Recommendation in one line

**Do not adopt the proposed list as stated.** It would give the Scanner to five roles for whom
every action on it is disabled, while removing it from the only role that can currently do
anything with it. The underlying want is real; the surface it points at is not the one that
does that job today. Options below.

---

## 1. What the Scanner actually is, today

The Parts Scanner (`src/modules/mobile/PartsScanner.jsx`, reached through Technician Workspace /
Field Mode) was **rebuilt** on the entity-resolution boundary. Its own header records what it
replaced: a scanner that "offered a literal five-item action menu (receive / use on work order /
load truck / cycle count / add to PO) to everyone, always" against an in-memory demo parts array.

That menu is gone. The rebuilt Scanner exposes **exactly one action**:

| Action | Enabled when |
|---|---|
| `RECORD_PART_USAGE` | the caller's role is `technician`, **and** they hold the technician identity, **and** the Work Order is assigned to them, **and** the part is planned on that job |

Those four conditions are not a UI preference. `deriveScanActions` mirrors, in order, what
`updateWorkOrderExecutionData` enforces server-side. The server rejects independently.

### Consequence

For a non-technician, the Scanner today resolves a scanned identity and offers **nothing**. It is
a lookup surface. That is a legitimate thing to want — but it is not what the proposal's roles
would be being given.

---

## 2. What the proposal would actually do

Current nav visibility (`ROLE_NAV_ACCESS`, `src/domain/constants.js`):

| Role | Sees `fieldMode` |
|---|---|
| admin | yes |
| dispatcher | **no** |
| technician | yes |

The proposed list is `admin, dispatcher, partsManager, partsAssociate, warehouseManager`. Read
against the table above, adopting it literally would:

1. **Remove technician access** — the only role for which the Scanner's single action can ever be
   enabled. This is almost certainly not intended, but it is what the list says.
2. **Add dispatcher** — who would see the Scanner with every action disabled.
3. **Add three roles the authorization layer cannot express** — see §3.

---

## 3. The blocker: three of the five roles cannot be expressed here

`ROLE_NAV_ACCESS` has **exactly three keys**: `admin`, `dispatcher`, `technician`. It is keyed by
the legacy `users/{uid}.role` field, not by the governed capability model.

`partsManager`, `partsAssociate` and `warehouseManager` are **governed business roles**
(`src/access/governedBusinessRoles.ts`). They have no legacy role value, so there is no key to add
them under. A person holding one of them authenticates with some legacy role — in practice one of
the same three — and the nav map cannot tell them apart.

This is the same structural fact recorded earlier: **the legacy layer collapses every persona onto
three identities.** It is not specific to the Scanner, and it cannot be worked around by editing
the map: writing `partsManager: [...]` into `ROLE_NAV_ACCESS` would add a key nothing ever reads.

So the proposal is not merely debatable — as stated, three-fifths of it is **not implementable**
in the layer it targets.

---

## 4. Options

### Option A — Do nothing (leave as-is)

Scanner stays admin + technician. Costs nothing, changes nothing, and leaves the underlying want
unaddressed.

**Choose this if** the real need is being met elsewhere and the proposal was aimed at a
remembered version of the Scanner (the pre-rebuild five-action menu) rather than the current one.

### Option B — Add the roles the layer *can* express (admin, dispatcher, technician)

A one-line change to `ROLE_NAV_ACCESS`: give `dispatcher` `fieldMode`, keep technician.

- **Gets:** dispatchers can scan to look up a part's governed identity.
- **Does not get:** any action. Dispatchers see a resolve-only surface.
- **Risk:** low, reversible, no capability grant, no Rules change.
- **Honest caveat:** a surface whose every button is disabled reads as broken. If this is chosen,
  the Scanner should say *why* there are no actions for this role rather than showing an empty
  action area.

### Option C — Move the Scanner's nav gate to the capability layer

Stop keying Scanner visibility off `users/{uid}.role` and key it off a capability, the way
Opportunity and Sales Order surfaces already resolve access.

- **Gets:** all five proposed roles become expressible, and correctly — including any future role.
- **Cost:** a new capability id, a grant decision per role, and activation. This is a governed
  change, not a repo edit.
- **This is the only option that actually delivers the proposal.**

### Option D — Build what the roles were probably wanted *for*

If the intent behind naming partsManager / partsAssociate / warehouseManager is **warehouse
scanning** — receiving, cycle counts, transfers — then the Scanner is the wrong surface and Option
C would deliver access to a screen that still does none of those things.

The governed receiving workflow already exists and is reached from **Inventory > Receiving**
(`inventory.stock.receive`, granted to admin/dispatcher/owner). Extending *that* to warehouse roles
is a different, better-scoped decision than Scanner nav visibility.

**Choose this if** the answer to "what should they be able to *do* once they get in?" is anything
other than "look up a part."

---

## 5. The question that decides it

> When a Warehouse Associate opens the Parts Scanner, what should they be able to **do**?

- *"Look up a part"* → Option C (or B, if dispatcher-only is enough).
- *"Receive stock / count / transfer"* → Option D. Those actions do not exist on this surface, and
  granting access will not create them.
- *"I thought it already did those things"* → the pre-rebuild Scanner did, as a demo against
  in-memory data. It was removed deliberately. See §6.

---

## 6. A stale-documentation defect found while preparing this

Four `docs/user-guide/` entries told users the Parts Scanner has a **"Receive a purchase order"**
action and describe it as one of two launch points for the governed receipt.

**It does not.** `PartsScanner.jsx` and `FieldMode.jsx` contain no receiving path at all; the F2
rebuild removed it. The Receiving workspace remains, and is now the only launch point.

This is corrected in the same change that adds this package — it is a plain documentation defect,
not part of the decision. It is recorded here because it is a plausible source of the belief that
the Scanner does more than it does.

---

## 7. What was NOT done, and why

No role was granted anything. No capability was created or activated. `ROLE_NAV_ACCESS` is
unchanged. Every option above except A requires either a governed grant, a capability activation,
or a build — all of which are Owner decisions rather than repo edits.

---

## Evidence

| Claim | Where to check |
|---|---|
| One action only, technician-gated | `src/domain/scanActions.js` — `SCAN_ACTIONS`, `deriveScanActions` |
| Server enforces the same four conditions | `updateWorkOrderExecutionData` |
| Nav map has three keys | `src/domain/constants.js` — `ROLE_NAV_ACCESS` |
| Scanner is admin + technician | same, `fieldMode` entries |
| The three roles are governed, not legacy | `src/access/governedBusinessRoles.ts` |
| Receiving is a separate workspace | `src/modules/inventory/Receiving.jsx`, `inventory.stock.receive` |
| The old five-action menu was removed | `PartsScanner.jsx` header comment |
