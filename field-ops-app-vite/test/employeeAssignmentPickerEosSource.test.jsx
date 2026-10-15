// THE ASSIGNMENT PICKER READS ONLY THE EMPLOYEE SOURCE IT IS GIVEN -- NEVER FIRESTORE.
//
// Firebase exit (O-1, DECISIONS #234): the picker's Firestore default (hooks/useAssignableEmployees.js, a direct
// onSnapshot over the Firestore `employees` collection) is deleted. Both live callers (PartDetail, ManagerQueuePanel)
// already inject the governed EOS read hooks/useReorderAssignmentTargets.js. These tests pin the two halves:
// an injected source is rendered as given, and a caller that forgets to inject one gets an honest, empty,
// fail-closed picker -- not a silent Firestore read.
import { afterEach, describe, it, expect } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import EmployeeAssignmentPicker, { NO_EMPLOYEE_SOURCE_ERROR } from "../src/shared/assignment/EmployeeAssignmentPicker.jsx";

afterEach(cleanup);

const here = path.dirname(fileURLToPath(import.meta.url));
const src = (rel) => readFileSync(path.resolve(here, "../src", rel), "utf8");

describe("EmployeeAssignmentPicker employee source", () => {
  it("renders exactly the employees the injected governed source returns", () => {
    const useEos = () => ({
      employees: [{ employeeId: "emp-1", userId: "u-1", displayName: "Ana Ruiz", operationalRoles: ["PARTS_ASSOCIATE"] }],
      loading: false, error: null, securityRoleWarningCount: 0,
    });
    render(<EmployeeAssignmentPicker useEmployees={useEos} onSelect={() => {}} label="Assign" />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "Ana" } });
    expect(screen.getByText("Ana Ruiz")).toBeTruthy();
  });

  it("FAILS CLOSED without an injected source: empty, and says why", () => {
    render(<EmployeeAssignmentPicker onSelect={() => {}} label="Assign" />);
    // The picker renders its existing generic failure copy for any source error (the reason is in NO_EMPLOYEE_SOURCE_ERROR).
    expect(NO_EMPLOYEE_SOURCE_ERROR).toMatch(/no governed employee source/i);
    fireEvent.focus(screen.getByRole("combobox"));
    expect(screen.getByText(/unable to load employees/i)).toBeTruthy();
    expect(screen.queryByRole("option")).toBeNull();
  });

  it("the picker and both live callers carry no Firebase or Firestore employee read", () => {
    const picker = src("shared/assignment/EmployeeAssignmentPicker.jsx");
    expect(picker).not.toMatch(/from\s+["']firebase\//);
    expect(picker).not.toMatch(/useAssignableEmployees/);
    for (const rel of ["modules/inventory/PartDetail.jsx", "shared/reorder/ManagerQueuePanel.jsx"]) {
      expect(src(rel), rel).toMatch(/useEmployees=\{useReorderAssignmentTargets\}/);
    }
  });
});
