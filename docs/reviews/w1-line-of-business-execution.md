---
artifact_type: review
gate: W1 — Operating-company / Line-of-business (execution record)
wave: W1
status: Complete — awaiting Codex review + Owner approval at section boundary
date: 2026-08-05
owner: Claude Code
base_commit: ae1a516 (origin/main)
branch: feature/w1-operating-company
design_input: docs/design/inventory-sales-templates-and-lines-of-business-wireframe.md (§3.3, §3.8)
---

# W1 — Line of Business (Taylor / Ventana): execution record

## Material Blueprint correction (Owner-approved 2026-08-05)

The Blueprint's W1 line read: *"Immutable `operatingCompanyId` at Account creation
(separate from `isNationalAccount`); company scope switcher + badges. 🔒 rules touch
→ Tier 2."* **That is a modeling error** per the settled design:

- **LOB wireframe §3.3** (Owner-confirmed 2026-07-31): `operatingCompanyId` is a
  **transaction** field ("whose books *this transaction* lands in," stamped per-transaction
  by the origination rule). Putting it **on the Account** is named "the single highest-risk
  modeling error here" — it conflates three distinct fields (`operatingCompanyId` /
  `salesChannel` / line-of-business).
- **LOB wireframe §3.8:** the correct **Account-level** concept is `lineOfBusiness[]` — an
  optional, additive, multi-valued, informational-only array (`["TAYLOR"] | ["VENTANA"] |
  both`) mirroring the existing `relationshipTypes[]` idiom, with **no Firestore Rules
  change** and **no migration**. §3.8 calls it "the single lowest-cost, lowest-risk item…
  a reasonable first deliverable."

The Owner approved correcting W1 to the `lineOfBusiness[]` model. `operatingCompanyId`
(transaction-level) is out of W1 scope and deferred to Sales Order / Invoice work.
**Follow-up:** reconcile the Blueprint's W1 line to match (separate docs change — not
bundled here, to keep this a Tier-1 feature PR).

## What was built (mirrors `relationshipTypes[]` faithfully)

- `domain/constants.js` — new `ACCOUNT_LINE_OF_BUSINESS = { TAYLOR, VENTANA }` with the
  same optional/additive/informational-only posture and "no badge when unset" rule.
- `modules/accounts/AccountForm.jsx` — `lineOfBusiness` state, `toggleLineOfBusiness`,
  a **Line of Business** checkbox fieldset (Taylor / Ventana), and canonical-ordered
  `lineOfBusiness` in the saved payload (Taylor before Ventana).
- `modules/accounts/AccountDetail.jsx` — `LineOfBusinessBadges` (mirrors
  `RelationshipBadges`), rendered next to the relationship/status badges; renders nothing
  when unset.
- `test/accountLineOfBusiness.test.mjs` — pins the constant + ordering/additive contract
  (wired into `npm test`).
- `docs/user-guide/accounts-customers/set-a-customers-line-of-business.md` — user how-to.

## Boundaries / acceptance

- **NO Firestore Rules change** (the `accounts` block has no field-level validation;
  additive informational field). **NO migration** (absent on every existing Account).
- **Gates no authorization** — informational only, like `relationshipTypes[]`.
- `index.css` deliberately **not** touched (parallel-session WIP) — badges use the base
  `fo-badge` class; distinct LOB badge colors are a minor later follow-up.
- Verified in the W1 worktree: `npm run lint` 0 errors · `typecheck` 0 · `build` 0 ·
  node tests 0 fail (incl. the new test) · component tests 485 passed / 33 files.
- No deploy, no production, no identity, no parallel-owned files touched.
