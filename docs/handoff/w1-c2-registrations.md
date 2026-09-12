# W1-C2 — required shared registrations

Lane: **C2 — Part + the Administration → Objects object-administration framework**
Branch: `impl/w1-part-admin-objects`

This lane owns the reference implementation of the **Object Administration Profile** layer and
Part's profile. It deliberately did **not** edit the serialized shared files. Everything the
integration writer must apply is listed here, exactly, with the reason each one is or is not needed.

---

## 1. `field-ops-app-vite/src/metadata/entityRegistry.js` — **NO CHANGE REQUIRED**

Verified mechanically on this branch: `partEntity` is already imported and already present in
`ENTITY_REGISTRY` (`entityRegistry.js:38` import, `:70` array entry), and
`test/entityRegistry.test.mjs`'s coverage test passes unchanged.

This lane added **no new EntityDefinition**. The administration profile is a separate layer that
references `part` by id; it declares no fields of its own, and
`validateAdministrationProfileRegistry()` resolves every field it names against the entity registry.
So there is nothing to register here, and adding anything would be the second-registry defect the
layer was built to avoid.

## 2. `field-ops-app-vite/src/access/objectPermissionMap.js` — **NO CHANGE REQUIRED**

`Parts Catalog` already maps to entity `part` through
`policyObjectRegistry.js` (`ENTITY_BY_MATRIX_OBJECT`), and this lane declares **no new capability
id**. The two capabilities Part's profile names — `inventory.catalog.manage` and
`inventory.catalog.activate` — are copied from `functions/src/partMaster/partMasterCommands.ts`
(`CAP_CATALOG_MANAGE`, `CAP_CATALOG_ACTIVATE`); they are *declarations handed to the resolver*, not
new grants, and nothing in this lane evaluates one.

## 3. `functions/src/access/permissionCatalog.ts` — **NO CHANGE REQUIRED**

No new capability. Part reads remain gated by role in `firestore.rules` (`parts/{partId}`:
`isAdminOrDispatcher()` or `isActiveOperationalRole("PARTS_MANAGER"/"WAREHOUSE_MANAGER")`) and the
profile records that as a *role* gate with `gateIsCapability: false` rather than inventing a
`part.read` that nothing enforces.

## 4. `firestore.rules` — **NO CHANGE REQUIRED, AND NONE PERMITTED**

Unchanged. No authorization, workflow, ownership or visibility logic was added anywhere in Rules.

## 5. `.github/workflows/**` — **ONE OPTIONAL ADDITION (integration writer's call)**

The new suite is registered in `field-ops-app-vite/test/suites.json`
(`test/objectAdministrationProfile.test.mjs`, runner `node --test`), which satisfies
`ciSuiteCoverage.test.mjs` — a node:test suite must be in `suites.json` **or** named by a workflow.

Optional, and the better home if the integration writer wants it running in the admin-policy lane
specifically: append the file to the existing `node --test` invocation in
`.github/workflows/eos-admin-policy-tests.yml` (the step that already runs
`test/entityRegistry.test.mjs test/policyObjectRegistry.test.mjs …`), and to that workflow's `paths:`
trigger list. Nothing breaks if this is skipped.

## 6. `field-ops-app-vite/test/suites.json` — **ALREADY DONE IN THIS BRANCH**

One entry added, immediately before `test/objectListMetadataAuthority.test.mjs`. Flagged here
because it is a file every lane touches and the integration writer will be resolving it:

```json
{
  "file": "test/objectAdministrationProfile.test.mjs",
  "runner": "node --test"
},
```

## 7. `field-ops-app-vite/src/metadata/entityDefinition.js` — **ONE-LINE CHANGE IN THIS BRANCH**

`function findExecutable` became `export function findExecutable` (plus a comment saying why).
No behaviour change. It is exported so the administration-profile contract shares the **one** §8
"metadata is never executable" check instead of carrying a second implementation of it. If a
sibling lane also touched this file, this hunk is additive and safe to take.

---

## What a later lane must add (nothing shared)

Adding an object to the administration layer touches **only files that lane owns**:

1. `field-ops-app-vite/src/metadata/administration/profiles/<entityId>.js`
2. one import + one array entry in
   `field-ops-app-vite/src/metadata/administration/administrationProfileRegistry.js`

`ADMINISTRATION_PROFILES` is the only shared line, it is one entry per object, and
`test/objectAdministrationProfile.test.mjs` fails if a profile file exists and nobody registered it.
No workflow change, no new test file, no `entityRegistry.js` edit, and no capability catalog entry
are required for a profile.
