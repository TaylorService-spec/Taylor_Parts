# Protected Change Proposal — `crm.activity.read` through canonical admin authority

**Status:** PROPOSAL — NOT APPLIED. Awaiting Owner authorization.
**Raised:** 2026-08-17, from the Account record page investigation.
**Governance:** `metadata-architecture-ip-boundary.md` §12 stop-report format · `../DelegationCharter.md` (capability grants / role changes are protected) · Owner disposition 2026-08-17 §3.

---

## Current conclusion

> **Runtime enforcement matches the current role matrix, but the current role matrix appears
> inconsistent with the established admin-access invariant.**

Nothing is broken in the enforcement path. The capability system is doing exactly what it was
built to do. The question is whether the role matrix says what the Owner intends it to say.

## Evidence

The Account record page renders, for the **admin** persona (`admin@sandbox.invalid`) on both
sandbox accounts:

> Activity & Notes unavailable — You are not authorized to view CRM activity for this account.

Tracing the authority chain:

| Layer | State | Source |
|---|---|---|
| Capability registered | `crm.activity.read`, `active: false` (fail-closed by design) | `functions/src/access/permissionCatalog.ts:997` |
| Sandbox eligibility | **eligible** | `functions/src/access/environmentCapabilityOverrides.ts:65` |
| Sandbox activation | **activated** | same file, sandbox activation snapshot, line 171 |
| Roles carrying it | **exactly one** — `CRM_ACTIVITY_CONTRIBUTOR_ROLE` (`crmActivityContributor`) | `functions/src/access/governedBusinessRoles.ts:366-374` |
| Business roles carrying it | **none**, admin included | audited across all `*_ROLE` declarations |

So per-environment activation is **not** the blocker; it is already done. The blocker is that no
business role carries the capability, and `crmActivityContributor` is held only via a governed,
audited `roleAssignment` that has not been made.

This is fail-closed behaving correctly. It is not a defect in the enforcement model.

## The inconsistency

The standing invariant is that **admin has no barriers** — admin is the demo and full-operational-access
persona. The role matrix does not currently express that for `crm.activity.read`.

Note the scope of the divergence: `ADMIN_ROLE` (`functions/src/access/compatibilityRoles.ts:127`) is
also the derivation source for the Owner grant (`OWNER_PERMISSIONS`,
`governedBusinessRoles.ts:69`), so the same gap explains why the **owner** persona is equally denied.
Two personas that should both see everything cannot, from a single cause.

---

## Stop report (boundary §12 required format)

### 1. Exact proposed action

Make `crm.activity.read` reachable through the **canonical admin authority path** — adding it to the
admin business role's grant set within the existing governed capability system, so admin holds it by
virtue of being admin.

Whether `crm.activity.create` accompanies the read is a **separate** Owner decision. The capability
catalog deliberately registers create and read as distinct ids so a read-only grant remains possible
(`environmentCapabilityOverrides.ts:62`). Read alone restores visibility; create adds write authority.

### 2. Why it crosses the boundary

It is a capability grant / role-matrix change. Under the Delegation Charter these are protected
regardless of how well-evidenced the inconsistency is, and the metadata boundary (§12 G) additionally
prohibits changing the authorization model without escalation. Correct runtime behavior traced to an
intentional fail-closed design is not a bug I may repair autonomously.

### 3. Files / components affected

| Path | Change |
|---|---|
| `functions/src/access/compatibilityRoles.ts` | `ADMIN_ROLE.permissions` gains the capability id |
| `field-ops-app-vite/src/access/compatibilityRoles.ts` | **mirror** — this repo has no shared-module tooling; both copies must change together or parity tests fail |
| `functions/src/access/permissionCatalog.ts` | possibly `active` posture, if the catalog default rather than per-environment activation is judged the right home |
| `functions/test/governedBusinessRoles.test.mjs`, `permissionCatalog.test.mjs`, `environmentCapabilityOverrides.test.mjs` | expectation updates |

Owner authority follows automatically via `OWNER_PERMISSIONS`; no separate owner change is needed.

Production posture is unchanged by this proposal: production remains triple-blocked (role-keyed
resolution, no override key on any production environment, and a test asserting it).

### 4. Safer independent alternative

**Assigning `crmActivityContributor` to the admin persona.** It is narrower, reversible, needs no code
change, and would restore the demo immediately.

Per Owner disposition §3 this is **explicitly rejected as the durable fix** — it turns canonical admin
authority into accumulated operational-role workarounds, which is not the intended architecture. It
may be used **only** as an explicitly authorized temporary sandbox testing/unblock mechanism, and if so
used must be recorded as temporary with a removal condition, not left to become the resolution by
default.

No admin bypass, no trusted-command bypass, and no weakening of auditing or capability enforcement is
proposed under either option.

### 5. Decision required from Owner

1. Authorize `crm.activity.read` through the canonical admin authority path? (yes / no)
2. Does `crm.activity.create` accompany it, or read only?
3. Is the correct home the admin role grant set, or a change to the capability's `active` posture?
4. Separately: authorize a temporary `crmActivityContributor` sandbox assignment to unblock demo
   walkthroughs before the durable change lands? (yes / no)

---

## Not blocking

Per Owner disposition §4, Entity List Metadata v1 and the rest of the metadata/list work proceed
independently of this decision. This proposal gates only the CRM activity surface.
