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
//     not read any collection at all. It is a static informational panel plus one
//     unconditionally-disabled form (a `<select>` of assignable Role ids sourced from the
//     pure, dependency-free COMPATIBILITY_ROLES catalog, and a disabled "Assign Role"
//     button). There is no list of principals/roleAssignments being rendered here to
//     migrate -- the surface's own copy states plainly that "no trusted read exists yet to
//     list real principals to act on." A_ENTITY_LIST migration has no read to attach to.
//   - This is recorded independently in the ledger (docs/orchestration/metadata-program/
//     ledger.json, id S-ADM-ROLES): "No trusted READ exists to list real principals" /
//     "Inventory only; form is unconditionally disabled."
//
// Migrating this surface is therefore impossible today, not merely undesirable: there is no
// definition to migrate onto and no data read to route through one. This file locks the
// facts the decline depends on (no definition exists, the form stays disabled, the
// assignable-Role list still excludes privileged Roles, no id-as-content anywhere) so that a
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
import { COMPATIBILITY_ROLES } from "../src/access/compatibilityRoles";

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
  // Only the copy moved. The old sentence promised a trusted read path; the current copy states
  // the same fact where it actually bites, on the Assign form. Asserting on the substance rather
  // than the old wording keeps this locking the DECLINE instead of locking a paragraph.
  it("still states that no trusted read of principals exists, and keeps Assign Role unconditionally disabled", () => {
    render(<AdminRolesPermissions />);
    expect(screen.getByText(/Roles & Permissions/i)).toBeTruthy();
    expect(
      screen.getByText(/no trusted read exists yet to list real principals/i),
    ).toBeTruthy();

    // Queried by its accessible name. It previously had none, and `{ name: "" }` was how this
    // reached it; the control is labelled now, which is a fix rather than a regression -- an
    // unlabelled select is unusable to a screen reader whether or not it is disabled.
    const select = screen.getByRole("combobox", { name: /select a role/i });
    expect(select.disabled).toBe(true);

    const button = screen.getByRole("button", { name: /Assign Role/i });
    expect(button.disabled).toBe(true);
  });

  it("the assignable-Role options exclude every privileged compatibility Role (admin)", () => {
    render(<AdminRolesPermissions />);
    const options = Array.from(document.querySelectorAll("option")).map((o) => o.value);
    expect(options).not.toContain("admin");
    expect(options).toContain("dispatcher");
    expect(options).toContain("technician");

    const privilegedIds = Object.values(COMPATIBILITY_ROLES)
      .filter((role) => role.privileged)
      .map((role) => role.id);
    for (const id of privilegedIds) {
      expect(options).not.toContain(id);
    }
  });

  it("never renders a Role's raw id as unlabeled visible content beyond its own option value (no id-as-content fallback)", () => {
    render(<AdminRolesPermissions />);
    // Every option's visible text is exactly its id (role.id is the only label source --
    // there is no separate display name being discarded in favor of a raw id fallback).
    const options = Array.from(document.querySelectorAll("option[value]:not([value=''])"));
    for (const option of options) {
      expect(option.textContent.trim()).toBe(option.value);
    }
  });
});
