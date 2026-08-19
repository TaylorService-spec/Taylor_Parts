// S-ADM-EMPLOYEES -- ATTEMPTED and DECLINED for cause.
//
// REGISTRATION_PENDING: this file is new and is not yet named in any
// .github/workflows/*.yml vitest invocation -- the metadata program's CI runs vitest
// files by explicit name, not by glob, so this suite will not run in CI until the
// integration lane adds it to a workflow.
//
// WHY THIS FILE EXISTS INSTEAD OF A MIGRATED Technicians.jsx. The admin nav item labelled
// "Employees" (navConfig.js, domain "administration", legacyKey "technicians") renders
// modules/technicians/Technicians.jsx, which reads TECHNICIANS_COLLECTION
// ("fieldops_technicians") -- NOT the `employees` collection employeeEntity/
// employeeIndexList (src/metadata/definitions/employee.js) describe. These are two
// distinct, live Firestore collections with no equivalence guarantee:
//
//   - Different fields: fieldops_technicians stores { id, name, phone, status } (available
//     | on_job | off_shift, a live job-assignment state). employee.js describes
//     { displayName, employmentStatus, operationalRoles, securityRole, ... } -- a
//     completely different vocabulary, including two authority-shaped columns
//     (operationalRoles, securityRole) fieldops_technicians has no equivalent of at all.
//   - Different write path: the "New Technician" create action (NewTechnicianModal.jsx ->
//     domain/jobActions.js's createTechnician) writes fieldops_technicians. There is no
//     wired create path onto `employees` from this surface, and provisionEmployeeAccess.js
//     (the only writer of `employees`) is an Admin-SDK script, not a client write.
//   - Different lifecycle semantics: fieldops_technicians.status participates in an atomic
//     job-completion transaction (fieldops_jobs + fieldops_technicians, domain/jobActions.js)
//     that has nothing to do with employmentStatus.
//   - Governance already names this split and marks it unimplemented, not merely
//     unmigrated: docs/assessments/r1-permission-coverage-design.md -- "the Employee/User/
//     Technician split is governance-approved but unimplemented"; docs/assessments/
//     employee-foundation.md's own "legacy-adjacent concern" note on fieldops_technicians.
//
// Migrating this surface onto employeeIndexList/employeeEntity would not be a rendering
// change -- it would silently swap what data an admin sees under a label that currently
// means "the live technician roster" for a different, disjoint dataset with no working
// create action, discarding operational status entirely. That is a material product/data-
// model decision (which entity the "Employees" admin page is actually FOR), not something
// a metadata-consumption migration may decide on its own -- the same class of blocker
// S-CRM-OPPORTUNITIES (PR #1226) declined for cause. No functional change was made to
// Technicians.jsx; this file locks the facts the decline depends on so a future change
// that narrows or closes the divergence (e.g. a real Employee/Technician convergence) fails
// this suite loudly and prompts re-evaluation, instead of the decline going stale silently.
//
// SEPARATELY, WHAT WAS CHECKED AND FOUND CLEAN: the hand-written surface itself has no live
// DECISIONS #106 violation. tech.name and tech.phone are rendered directly with no
// `?? tech.id` (or similar) fallback to the document id anywhere in Technicians.jsx --
// verified below by rendering the surface and asserting the id string never appears as
// visible content.

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { EMPLOYEES_COLLECTION, TECHNICIANS_COLLECTION } from "../src/domain/constants";
import { employeeEntity } from "../src/metadata/definitions/employee.js";

vi.mock("../src/hooks/useFirestoreCollection", () => ({
  useFirestoreCollection: vi.fn(),
}));
vi.mock("../src/domain/jobActions", () => ({
  createTechnician: vi.fn(),
}));

const { useFirestoreCollection } = await import("../src/hooks/useFirestoreCollection");
const { default: Technicians } = await import("../src/modules/technicians/Technicians.jsx");

const renderPage = () => render(<MemoryRouter><Technicians /></MemoryRouter>);

describe("S-ADM-EMPLOYEES divergence -- Technicians.jsx reads a different collection than employee.js describes", () => {
  it("Technicians.jsx reads TECHNICIANS_COLLECTION, distinct from the `employees` collection employee.js describes", () => {
    expect(TECHNICIANS_COLLECTION).toBe("fieldops_technicians");
    expect(employeeEntity.collection).toBe(EMPLOYEES_COLLECTION);
    expect(EMPLOYEES_COLLECTION).toBe("employees");
    expect(TECHNICIANS_COLLECTION).not.toBe(EMPLOYEES_COLLECTION);
    expect(TECHNICIANS_COLLECTION).not.toBe(employeeEntity.collection);
  });

  it("Technicians.jsx does not import the employee metadata definition or the metadata list runtime", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const filePath = path.join(process.cwd(), "src/modules/technicians/Technicians.jsx");
    const src = fs.readFileSync(filePath, "utf8");
    // Only the actual import statements matter here -- the module's own header comment
    // (added by this decline) names employeeEntity/employeeIndexList/useMetadataList in
    // prose, which a naive whole-file regex would also match. Restrict the check to real
    // `import ... from "..."` lines so the assertion cannot pass or fail on comment prose.
    const importLines = src
      .split("\n")
      .filter((line) => /^\s*import\b/.test(line))
      .join("\n");
    expect(importLines).not.toMatch(/employeeEntity|employeeIndexList/);
    expect(importLines).not.toMatch(/useMetadataList/);
  });

  it("renders the technician roster from useFirestoreCollection(TECHNICIANS_COLLECTION), unchanged", () => {
    useFirestoreCollection.mockReturnValue({
      data: [{ id: "tech-doc-id-1", name: "Jordan Alvarez", phone: "555-0100", status: "available" }],
      loading: false,
    });
    renderPage();
    expect(useFirestoreCollection).toHaveBeenCalledWith(TECHNICIANS_COLLECTION);
    expect(screen.getByText("Jordan Alvarez")).toBeTruthy();
    expect(screen.getByText("555-0100")).toBeTruthy();
  });

  it("never renders the technician's document id as visible content (no DECISIONS #106 fallback)", () => {
    useFirestoreCollection.mockReturnValue({
      data: [{ id: "tech-doc-id-only-no-name-fallback", name: "", phone: "", status: "off_shift" }],
      loading: false,
    });
    renderPage();
    expect(screen.queryByText("tech-doc-id-only-no-name-fallback")).not.toBeTruthy();
  });

  it("distinguishes loading, empty, and populated states -- three renderings, not collapsed into one", () => {
    useFirestoreCollection.mockReturnValue({ data: [], loading: true });
    const { unmount } = renderPage();
    expect(screen.getByText(/Loading technicians/i)).toBeTruthy();
    unmount();

    useFirestoreCollection.mockReturnValue({ data: [], loading: false });
    const { unmount: unmount2 } = renderPage();
    expect(screen.getByText(/No technicians yet/i)).toBeTruthy();
    unmount2();

    useFirestoreCollection.mockReturnValue({
      data: [{ id: "t1", name: "Sam Rivera", phone: "555-0101", status: "on_job" }],
      loading: false,
    });
    renderPage();
    expect(screen.getByText("Sam Rivera")).toBeTruthy();
  });
});
