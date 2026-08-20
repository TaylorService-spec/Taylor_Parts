# Contextual help layer — design + staged delivery

Status: **IN DELIVERY.** Stage 1 implemented (this document ships with it). Stages 2 and 3 specified here,
not yet built.

Owner-approved 2026-08-16 ("all three, staged") after a review of `usedynamics.com/business-central`.

---

## 1. Why this exists

Field Ops has a substantial user-guide corpus (48 documents across 9 domains under `docs/user-guide/`) and a
canonical, domain-aligned navigation tree (`src/navigation/navConfig.js`). It had **no connection between
them, and no in-app help affordance of any kind**. Measured across the 464 source files in
`field-ops-app-vite/src` at the time of writing:

| Pattern | Files |
|---|---|
| `Tooltip` | 0 |
| `Onboard` | 0 |
| `Help` (UI usage) | 0 |
| `EmptyState` | 30 |

A new user who lands on an empty screen is told *that* it is empty and nothing about *why the screen exists*.

### The reference

Abakion (a Danish Microsoft Dynamics partner) runs `usedynamics.com` — a free Business Central learning
portal whose actual product is an AppSource app that injects contextual help links into Business Central at
the screen where the user is standing. Two structural ideas there are worth adopting, and one is not:

- **Adopt — help anchored to the screen, not to a separate docs site.** They had to build this as a
  third-party bolt-on into someone else's ERP. We own both the app and the guides.
- **Adopt — a two-axis content taxonomy.** Their *Content Type* (Whys / Overview / Basics / Commonly Used /
  Details / Configurations) × *User Level* (Beginner / Intermediate / Advanced) is better documentation IA
  than a flat how-to list, and it gives a help surface something to filter on.
- **Reject — video-first delivery.** Videos rot on every UI change and this app ships weekly. Text guides
  can be diffed and CI-verified; videos cannot.

One thing we can do that the reference cannot: **the app knows the signed-in user's role**. Role-aware help
is a differentiator, not a copy.

---

## 2. Stage 1 — guidance at the empty state (implemented)

The highest-leverage, lowest-cost half. `EmptyState` already separated the two empties that matter:

- `variant="database"` — nothing exists yet;
- `variant="filtered"` — records exist but the current filters hide them all.

The `database` variant is precisely the moment a user is guaranteed not to know what the screen is for. It
now takes an optional `guidance` prop: one or two plain sentences on **why this collection exists and what
causes a record to appear in it** — the "Whys" layer of the reference taxonomy. Not how to click.

### The variant scope rule

`guidance` renders for `variant="database"` **only**, and that decision lives in the component, not at the
call sites. A `filtered` empty means the user already has records and merely over-filtered; re-explaining
what a work order is at that moment is noise, and it would reappear on every filter change. Callers may pass
`guidance` unconditionally. Enforced by `test/emptyStateGuidance.test.jsx` so a refactor cannot quietly push
the decision back out to callers.

### Visual treatment

A bronze left rule (`--color-brand-accent`, whose documented token intent is "premium accent / guidance /
emphasis"), text on `--color-text-secondary` (6.3:1 on page), measure capped at `68ch`. Guidance is
deliberately **not** `fo-muted` — it is the one line a first-run user is meant to read, so it must not be
de-emphasised below the message above it. Bronze is a 4.75:1 accent and is used as a rule, never as body
text.

### Copy provenance

Every guidance string is derived from the matching `docs/user-guide/` document, not invented. Where a guide
says a screen is read-only and records originate elsewhere, the guidance says so — it must never imply an
action the app cannot perform. Eight surfaces carry it: Customers, Customer Locations, Work Orders,
Transfers, Warehouses, Purchase Orders, Receipts, Suppliers.

### Two delivery routes, because the app grew one while this sat open

Stage 1 was designed as eight hand-written call sites. Between its authoring and its landing, four of those
screens — Customers, Warehouses, Suppliers, and the Account's Locations section — were migrated to the
**metadata list runtime**, and their hand-written `EmptyState` call sites ceased to exist. Re-adding them
would have resurrected deleted code.

So guidance reaches a surface by whichever route that surface uses, and the two are the same idea at
different altitudes:

| Route | Surfaces | Where the text lives |
|---|---|---|
| Direct prop | Work Orders, Transfers, Purchase Orders, Receipts | The `EmptyState` call site |
| List definition | Customers, Warehouses, Suppliers, Account Locations | `emptyGuidance` on the `ListViewDefinition` |

The definition route is the better one and is where new surfaces should declare guidance. It travels
`definition → buildListPresentation → MetadataListGrid → EmptyState`, so **every** metadata-driven list
gains the affordance at once rather than one call site at a time, and the text sits next to what the entity
*means* instead of next to one screen that happens to show it — which is the drift the per-call-site
approach invites.

`emptyGuidanceFor` restricts the definition route to state `EMPTY`. `FILTERED` is excluded for the same
reason the variant rule excludes it; `DENIED` and `UNAVAILABLE` are excluded because describing the
collection there would imply the read succeeded and found nothing, which is the exact wrong conclusion those
states exist to prevent. The component's own variant rule still applies underneath — two independent guards,
because a "what is this screen for" paragraph on a filtered list is what both exist to stop.

As the remaining four surfaces migrate to the list runtime, their guidance should move to their definitions
and the prop should be passed only by surfaces that are not metadata-driven.

---

## 3. Stage 2 — route-anchored help (specified, not built)

Add an optional `helpKey` to `navConfig.js` entries resolving to a `docs/user-guide/` path, a `HelpLink`
primitive in `shared/ui/`, and a help affordance in `WorkspaceHeader`. Because `navConfig.js` is already the
canonical navigation authority (`docs/architecture/SYSTEM_AUTHORITIES.md`), the mapping lives in one file
and CI can assert every `helpKey` resolves to a real document — so guides cannot silently rot away from the
screens they describe.

**Open problem that gates this stage: the guides are not reachable at runtime.** `docs/user-guide/` is
markdown in the repo; it is not in the app build, and the app has no markdown renderer and no dependency
that provides one. A help link shipped today would dead-end. Stage 2 must therefore resolve delivery first.
Candidates, in rough order of preference:

1. A prebuild step copying `docs/user-guide/` into `field-ops-app-vite/public/`, fetched at runtime and
   rendered by a small in-repo renderer that returns React elements (never `dangerouslySetInnerHTML`).
2. Build-time `?raw` imports, bundling the guides into the app.
3. External links to a published docs site (rejected for now — no such site exists, and repo blob URLs
   require repo access the end user does not have).

Option 1 is the working assumption. The renderer is a security surface and must not inject HTML.

---

## 4. Stage 3 — content taxonomy (specified, not built)

Adopt Content Type × User Level as front-matter on every `docs/user-guide/` document, giving the Stage 2
help surface something to filter on, and letting help respond to the signed-in role: a technician on a phone
gets Basics; an admin configuring posting rules gets Configurations. Docs-only; no code.

---

## 5. Scope boundaries

Additive and reversible at every stage. No schema, no Firestore Rules, no capability, no authorization
effect. Guidance is presentational copy — it must never be the place a permission, a governed status, or an
availability rule is explained, because it is not read from any of those authorities.
