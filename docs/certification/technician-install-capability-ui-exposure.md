# `TECHNICIAN HOLDS INSTALL CAPABILITY / EQUIPMENT DOMAIN UI NOT EXPOSED`

**Status: RECORDED, NOT CLASSIFIED.** Owner direction 2026-08-23: do not call this a defect until it
is decided whether technicians should install equipment through their own application.

---

## 1. The observation

Two certification technicians hold the `equipmentInstaller` role and therefore `equipment.install`:

| employee | securityRole | governed role | `equipment.install` |
|---|---|---|---|
| cw-emp-013 Freya Vance | technician | equipmentInstaller | **ALLOW** |
| cw-emp-017 Rosalind Ibarra | technician | equipmentInstaller | **ALLOW** |

Neither can reach the screen that offers the action:

- The Equipment nav domain carries **no `legacyKey`**, so by `navConfig.js`'s own stated rule it
  defaults to `PLACEHOLDER_DEFAULT_ROLES = ["admin", "dispatcher"]` and never technician. The nav item
  does not render, so the route never mounts.
- Firestore Rules deny a technician every Equipment read (E3 / #289). Confirmed live: a client-path
  query on `equipment` as a technician-role persona returns `PERMISSION_DENIED`.

So the capability is real, correctly granted, correctly enforced server-side — and the holder has no
route to it in this application.

## 2. Why this is not automatically a defect

Both facts are deliberate and documented where they are made:

- `navConfig.js` states the admin/dispatcher default is "a judgment call, not a product decision from
  the brief", and that the Equipment domain's lack of a `legacyKey` "mirrors E3's Rules, where
  admin/dispatcher are the only principals with any Equipment authority and a technician is denied
  outright".
- A technician's self-scoped Equipment view is recorded there as a separate piece of work (E17).

Nothing was broken by granting the installer role to technicians. What the grant did was make an
existing split visible: **who may install** and **who can reach the install screen** are answered by
two different systems that have never been reconciled, because until now nobody held install
authority at all.

The same shape is already recorded elsewhere in this repo — a technician granted `PARTS_MANAGER`
operational authority passes every eligibility check and still cannot reach the Inventory screen,
because nav access is keyed on the security role.

## 3. The actual question

**Should a technician install and commission equipment from their own application?**

If yes, this needs a field-app surface and a Rules decision — a technician would need scoped Equipment
reads, which E3 deliberately denies today. That is a security decision, not a nav tweak.

If no, then the `equipmentInstaller` role belongs on service/field **management** rather than on
technicians, and the certification staffing should follow. The two technicians would keep the
capability only as a modelled fact, or lose it.

Neither answer is obvious from the platform. It depends on how installation actually happens in the
field — whether the person holding the wrench records the install, or a coordinator does.

## 4. What was done instead, and deliberately not done

For the live UI proof the Owner chose to grant `equipmentInstaller` to a principal that already has
legitimate Equipment navigation and read access (Option A) — the holder of the governed `fieldManager`
role, `sbx-acctmgr`. That is an operational grant, not a test bypass.

**Not done, on explicit instruction:**

- technician Equipment reads not widened
- technician Equipment nav not widened
- Rules not touched
- the two technicians' `equipmentInstaller` grants **not removed** — removing them would erase the
  evidence of this question rather than answer it

## 5. For the field-app design review

The narrow version of the question: *does the person who physically installs the machine record the
installation, or does someone else record it on their behalf?* Every other part of this — nav, Rules,
which role carries the capability — follows from that one answer.
