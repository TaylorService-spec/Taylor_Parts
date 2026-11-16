// SEC-ROSTER-01: when the server withholds a colleague's personal fields (personalFieldsWithheld), the Employee record
// says "Not available to you" for each of them -- never "Not recorded", which would claim the value does not exist.
import { describe, it, expect } from "vitest";
import { recordEmploymentFields, recordIdentityFields } from "../src/domain/employeeOperatingProfile.js";
import { ABSENCE } from "../src/domain/structuredFields.js";

const base = {
  name: { firstName: "Casey", lastName: "Colleague" }, employeeNumber: "E-100", jobTitle: "Technician",
  contact: { workEmail: "casey@example.test", workPhone: "555-0100", mobilePhone: null },
  address: { street: null, unit: null, city: null, state: null, postalCode: null }, hireDate: null, separationDate: null,
};
const PERSONAL = ["Mobile Phone", "Street", "Unit / Suite", "City", "State", "ZIP", "Hire Date", "Separation Date"];
const valueOf = (record) => Object.fromEntries([...recordIdentityFields(record), ...recordEmploymentFields(record)].map((f) => [f.label, f.value]));

describe("SEC-ROSTER-01 withheld personal fields", () => {
it("withheld personal fields read 'Not available to you'; work contact is unaffected", () => {
  const v = valueOf({ ...base, personalFieldsWithheld: "Personal fields ... admin.employeeProfile.write" });
  for (const label of PERSONAL) expect(v[label], label).toBe(ABSENCE.NOT_AUTHORIZED);
  expect(v["Work Email"]).toBe("casey@example.test");
  expect(v["Work Phone"]).toBe("555-0100");
});

it("without the withheld marker an empty personal field still reads 'Not recorded'", () => {
  const v = valueOf({ ...base, personalFieldsWithheld: null });
  for (const label of PERSONAL) expect(v[label], label).toBe(ABSENCE.NOT_RECORDED);
});
});
