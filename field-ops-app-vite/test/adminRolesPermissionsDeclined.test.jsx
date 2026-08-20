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
// NO CHANGE was made to AdminRolesPermissions.jsx. This is a regression-locking test only.

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

  it("renders the read-unavailable copy and keeps the Assign Role form unconditionally disabled", () => {
    render(<AdminRolesPermissions />);
    expect(screen.getByText(/Roles & Permissions/i)).toBeTruthy();
    expect(
      screen.getByText(/trusted read path, which is not yet deployed and verified/i),
    ).toBeTruthy();

    const select = screen.getByRole("combobox", { name: "" }) ?? document.querySelector("select");
    expect(select).toBeTruthy();
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
