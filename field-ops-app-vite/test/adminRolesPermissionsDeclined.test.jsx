// S-ADM-ROLES -- ATTEMPTED and DECLINED for cause.
//
// REGISTRATION_PENDING: this file is new and is not yet named in any
// .github/workflows/*.yml vitest invocation -- the metadata program's CI runs vitest
// files by explicit name, not by glob, so this suite will not run in CI until the
// integration lane adds it to a workflow.
//
// WHY THIS SURFACE WAS NOT MIGRATED. Migrating a surface onto the metadata list runtime
// requires a merged EntityDefinition for the entity it reads (the pattern proven by
// S-INV-WAREHOUSES / S-INV-SUPPLIERS, src/modules/inventory/Warehouses.jsx). Roles &
// Permissions has neither:
//
//   - No `role.js` or `user.js` exists under src/metadata/definitions/ (verified below by
//     directory listing) -- there is no EntityDefinition for a Role, a RoleAssignment, or a
//     principal/User to bind a metadata list to.
//   - AdminRolesPermissions.jsx (src/modules/administration/AdminRolesPermissions.jsx) does
//     not read any collection at all. It renders the static access contracts, plus the
//     Approval Requests queue. There is no list of principals/roleAssignments being rendered
//     here to migrate, and since the dead Assign form was removed there is not even a control
//     that implies one. A_ENTITY_LIST migration has no read to attach to.
//   - This is recorded independently in the ledger (docs/orchestration/metadata-program/
//     ledger.json, id S-ADM-ROLES): "No trusted READ exists to list real principals" /
//     "Inventory only; form is unconditionally disabled."
//
// Migrating this surface is therefore impossible today, not merely undesirable: there is no
// definition to migrate onto and no data read to route through one. This file locks the
// facts the decline depends on (no definition exists, and no principal-facing control) so that a
// future change -- a new role.js/user.js definition, or a live read path landing -- fails
// this suite loudly and prompts re-evaluation instead of the decline going stale silently.
//
// This surface reads NO Firestore collection today (RoleAssignment/principal directory is
// listed as the eventual entity in the ledger, but no live read exists to name a collection
// for). Firestore Rules deny all client-direct access to governed Role/Permission/Audit data
// by design (Spec sec12) -- unrelated to this surface's own copy, checked directly below.
//
// UPDATE (Roles & Permissions gained a read-only Role inspector). This suite fired, which is
// what it exists for, and the decline was re-evaluated rather than the assertion being relaxed
// away. It STILL HOLDS: the decline is about migrating a list of PRINCIPALS onto the metadata
// runtime, and both blockers are unchanged -- no EntityDefinition for a Role/RoleAssignment/
// principal, and no trusted read to attach one to. The inspector reads the static access
// CONTRACTS (role definitions, permission catalog, object mapping), which are repo data rather
// than a collection, so it creates no list to migrate. The first two assertions below still pass
// unmodified and are what actually pin the decline; only the copy assertion moved, from the old
// wording to the same fact where the current surface states it.
//
// This suite was written as REGISTRATION_PENDING and remains so: it runs under a full `vitest
// run` but is not named in any workflow's vitest invocation, so CI would not have caught the
// break. Recorded here rather than silently relied upon.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";

const { default: AdminRolesPermissions } = await import(
  "../src/modules/administration/AdminRolesPermissions.jsx"
);

const definitionsDir = path.join(process.cwd(), "src/metadata/definitions");

describe("S-ADM-ROLES decline -- no EntityDefinition exists, and the surface has no read to migrate", () => {
  it("no role.js or user.js EntityDefinition exists under src/metadata/definitions", () => {
    const files = fs.readdirSync(definitionsDir);
    expect(files).not.toContain("role.js");
    expect(files).not.toContain("user.js");
  });

  it("AdminRolesPermissions.jsx imports no metadata list runtime, no EntityDefinition, and no Firestore read hook", () => {
    const filePath = path.join(
      process.cwd(),
      "src/modules/administration/AdminRolesPermissions.jsx",
    );
    const src = fs.readFileSync(filePath, "utf8");
    const importLines = src
      .split("\n")
      .filter((line) => /^\s*import\b/.test(line))
      .join("\n");
    expect(importLines).not.toMatch(/useMetadataList/);
    expect(importLines).not.toMatch(/entityDefinition|EntityDefinition/);
    expect(importLines).not.toMatch(/useFirestoreCollection|onSnapshot|getDocs/);
  });

  // RE-EVALUATED, and the decline still holds. This assertion fired when the surface gained a
  // read-only Role inspector, which is exactly what it was built to do -- so the question it
  // forces got asked rather than skipped.
  //
  // The answer: the decline is about migrating a LIST OF PRINCIPALS onto the metadata runtime,
  // and that is still impossible for the same two reasons (no EntityDefinition, no trusted
  // read). What the surface gained reads the static access CONTRACTS -- role definitions, the
  // permission catalog, the object mapping -- which are repo data, not a collection. Nothing
  // about that creates a list to migrate.
  //
  // The Assign form is now GONE rather than disabled, which does not weaken this decline -- it
  // removes the last thing on the surface that pretended to act on a list of principals. The
  // assertion is therefore the absence of any principal-facing control. The non-privileged-only
  // invariant the old options test guarded is covered where it belongs, against the data:
  // test/adminMutationAssignableRoles.test.mjs. Two tests that only inspected the dead select's
  // <option> elements went with it rather than passing vacuously over an empty list.
  it("offers no principal-facing control at all -- there is still no list of principals to act on", () => {
    render(<AdminRolesPermissions />);
    expect(screen.getByText(/Roles & Permissions/i)).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: /select a role/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Assign Role/i })).toBeNull();
  });
});
