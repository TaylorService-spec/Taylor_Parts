// WORKFORCE - synthetic employees on the EXISTING Employee model. No parallel workforce model.
//
// Fields are the ones employee.js already declares: employeeId, firstName, lastName, displayName,
// securityRole, operationalRoles, employmentStatus, active, userId. Certification-only facts are
// namespaced under cert* so they can never be mistaken for governed fields.
//
// ============================ EMPLOYEE IS NOT AUTHORITY ============================
//
// Five separate things, and the certification traces all five rather than assuming one implies
// another:
//
//   EMPLOYEE        the workforce record. Confers nothing.
//   BUSINESS ROLE   org-chart position. partsManager and warehouseManager carry ZERO permissions
//                   by design -- they say who someone IS, not what they may DO.
//   FUNCTIONAL ROLE the authority-bearing grant (inventoryCycleCountCounter, inventoryTransferOperator).
//   CAPABILITY      what the server actually checks.
//   PERSONA         a login used to test. There are far fewer personas than employees, deliberately.
//
// ALL IDENTITIES ARE SYNTHETIC. No real Taylor, Ventana, Phoenix-business or public-directory PII.
// Names are drawn from fixed lists by index so the workforce is deterministic.
import { PROVENANCE } from "../manifest.mjs";

const FIRST = ["Marisol", "Devon", "Priya", "Tomas", "Ingrid", "Rafael", "Naomi", "Curtis", "Yusuf", "Bianca",
               "Hollis", "Selma", "Arturo", "Freya", "Desmond", "Lena", "Omar", "Rosalind", "Gideon", "Anika",
               "Malik", "Corinne", "Terrance", "Sunniva", "Emilio", "Harriet", "Kwame", "Delphine", "Rune", "Ivy",
               "Barnaby", "Solveig", "Cormac", "Adaeze", "Lucian", "Petra", "Tavish", "Marguerite"];
const LAST = ["Vance", "Okonkwo", "Halloran", "Brightwater", "Sandoval", "Ferreira", "Lindqvist", "Achterberg",
              "Moreau", "Castellanos", "Whitlock", "Nakagawa", "Ibarra", "Thorsen", "Ellery", "Prakash",
              "Ravenscroft", "Delacroix", "Amundsen", "Featherstone"];

// WORKSTREAM keys are the units coverage is measured in. Named here so the workforce and the
// authority matrix cannot drift apart into two different vocabularies.
export const WORKSTREAM = Object.freeze({
  CRM_SALES: "CRM_SALES", DISPATCH: "DISPATCH", SERVICE: "SERVICE", PARTS_LOOKUP: "PARTS_LOOKUP",
  PUT_AWAY: "PUT_AWAY", PICK_STAGE: "PICK_STAGE", TRANSFERS: "TRANSFERS", CYCLE_COUNT: "CYCLE_COUNT",
  CYCLE_COUNT_RECONCILE: "CYCLE_COUNT_RECONCILE", RECEIVING: "RECEIVING", RETURNS: "RETURNS",
  PROCUREMENT: "PROCUREMENT", ACCOUNTING: "ACCOUNTING", ADMINISTRATION: "ADMINISTRATION",
  REPORTING: "REPORTING",
  // AUDIT added 2026-08-21. Audit read is oversight of what the other workstreams did, so it is a
  // workstream in its own right rather than a property of holding a management title.
  AUDIT: "AUDIT",
});

// Roster shape. securityRole is the legacy compatibility role on the user; governedRoles are the
// functional/positional grants; assignments are the workstreams this person is given responsibility
// for. workload is a deterministic fixture state, not a computed value.
//
// [ count, securityRole, governedRoles, assignments, workloadPattern ]
const ROSTER = [
  [1, "admin", ["owner"], ["ADMINISTRATION", "REPORTING", "ACCOUNTING"], "normal"],
  // GENERAL MANAGER CARRIES THE dispatcher COMPATIBILITY ROLE, NOT admin.
  //
  // This row said "admin", and the capacity report caught what that meant. The Owner decided on
  // 2026-08-21 (Option 2) that General Manager is the highest BUSINESS role and is NOT security
  // administration: generalManager holds zero admin.* capabilities, and a guard enforces it.
  //
  // Giving the EMPLOYEE the legacy admin role handed both General Managers all four admin.* ids
  // straight back -- userStatus.write, roleAssignment.write, accessRequest.decide,
  // credentialReset.initiate. The governed model said no and the fixture said yes, and the fixture
  // would have won, because the server resolves the UNION of the legacy role and the governed
  // grants. A decision enforced on the Role and defeated on the person is not enforced.
  //
  // dispatcher is the widest compatibility role carrying NO admin.* (38 capabilities, verified),
  // so it models a broad business operator without reversing the ruling. The compatibility roles
  // themselves are untouched -- this is a fixture correction, not a change to legacy authority.
  [2, "dispatcher", ["generalManager", "reportViewer", "reportAuthor"], ["ADMINISTRATION", "REPORTING", "AUDIT"], "normal"],
  [2, "dispatcher", ["operationsManager", "reportViewer", "reportAuthor"], ["DISPATCH", "SERVICE", "REPORTING", "AUDIT"], "heavy"],
  [2, "dispatcher", ["officeManager"], ["CRM_SALES", "ADMINISTRATION"], "normal"],
  [3, "dispatcher", [], ["DISPATCH"], "mixed"],
  [2, "dispatcher", ["fieldManager"], ["SERVICE", "DISPATCH"], "normal"],
  [11, "technician", [], ["SERVICE"], "mixed"],
  [2, "dispatcher", ["partsManager", "inventoryCycleCountReconciler", "inventoryCatalogAdministrator"], ["CYCLE_COUNT_RECONCILE", "PARTS_LOOKUP"], "normal"],
  [4, "dispatcher", ["partsAssociate", "inventoryLookupReader", "inventoryPutAwayOperator", "inventoryCycleCountCounter"], ["PARTS_LOOKUP", "PUT_AWAY", "CYCLE_COUNT"], "mixed"],
  [1, "dispatcher", ["warehouseManager", "inventoryTransferOperator", "inventoryReturnsIntakeClerk", "inventoryBinAdministrator"], ["TRANSFERS", "RETURNS"], "heavy"],
  [3, "dispatcher", ["warehouseAssociate", "inventoryLookupReader", "inventoryPutAwayOperator"], ["PUT_AWAY", "PARTS_LOOKUP", "PICK_STAGE"], "mixed"],
  [1, "dispatcher", ["salesManager"], ["CRM_SALES"], "normal"],
  [4, "dispatcher", ["salesperson", "crmActivityContributor"], ["CRM_SALES"], "mixed"],
  [1, "dispatcher", ["purchasingManager"], ["PROCUREMENT"], "normal"],
  [2, "dispatcher", ["accountingManager", "reportViewer", "reportFinanceViewer"], ["ACCOUNTING", "AUDIT"], "normal"],
  [1, "dispatcher", ["financeManager", "reportViewer", "reportFinanceViewer"], ["ACCOUNTING", "REPORTING", "AUDIT"], "normal"],
  [1, "dispatcher", ["supportStaff"], [], "idle"],

  // ══════════════════ ADDED 2026-08-21 -- Owner decision, four backup employees ══════════════════
  //
  // The capacity report found four workstreams depending on ONE person, and Receiving depending on
  // nobody at all while 32 employees could perform it through legacy authority. These rows close
  // both, and the shape of each is a decision rather than a headcount.
  //
  // RECEIVING IS A NAMED STATION. inventoryReceivingClerk is granted to exactly two people, not
  // composed into warehouseAssociate. Business intent does not say every warehouse worker receives
  // stock, and composing it would recreate at the governed level the very problem the coverage
  // finding exposed -- everyone able to receive, nobody accountable. It also leaves untouched the
  // deferral compatibilityRoles.ts records for PARTS_ASSOCIATE on inventory.stock.receive.
  //
  // THE PURCHASING BACKUP DELIBERATELY DOES NOT RECEIVE. A buyer who also accepts the goods they
  // ordered closes the loop on their own purchase with nobody else in it. That is the same
  // separation the existing model already applies by withholding approve/reject from the Role that
  // raises orders, extended to the physical side. Recorded as an SoD constraint, not an oversight.
  [1, "dispatcher", ["warehouseAssociate", "inventoryLookupReader", "inventoryTransferOperator"], ["TRANSFERS", "PARTS_LOOKUP"], "normal"],
  // Returns and Receiving together: both are intake stations at the same dock, and no control
  // separates accepting a customer return from accepting a purchase. Carries NO transfer authority,
  // so "a transfer operator cannot receive" stays provable on the employee above.
  [1, "dispatcher", ["warehouseAssociate", "inventoryLookupReader", "inventoryReturnsIntakeClerk", "inventoryReceivingClerk"], ["RETURNS", "RECEIVING"], "normal"],
  // Bin administration backup as a MANAGER, not an associate: the exclusive pair forbids the person
  // defining where stock may live from also filling those locations, so this employee holds no
  // put-away. Receiving is added here for the second receiver; the separation that matters survives,
  // because they cannot PLACE what they accept -- put-away remains someone else's authority.
  [1, "dispatcher", ["warehouseManager", "inventoryBinAdministrator", "inventoryReceivingClerk"], ["PUT_AWAY", "RECEIVING"], "normal"],
  // Procurement backup. No approve/reject and no purchaseOrder.void -- the Role withholds both --
  // and no receiving, per the buyer-is-not-receiver separation above.
  [1, "dispatcher", ["purchasingManager"], ["PROCUREMENT"], "normal"],
];

const WORKLOAD_CYCLE = ["none", "normal", "heavy", "conflicting"];

export function buildWorkforce() {
  const employees = [];
  let i = 0;
  for (const [count, securityRole, governedRoles, assignments, pattern] of ROSTER) {
    for (let k = 0; k < count; k += 1) {
      const first = FIRST[i % FIRST.length];
      const last = LAST[(i * 3 + 1) % LAST.length];
      const employeeId = "cw-emp-" + String(i).padStart(3, "0");
      // Deterministic workload spread. "mixed" walks the cycle so a group contains an idle worker,
      // a normal one, a heavy one and one with conflicting demand -- which is what makes dispatch
      // and capacity questions have more than one plausible answer.
      const workload = pattern === "mixed" ? WORKLOAD_CYCLE[k % WORKLOAD_CYCLE.length]
        : pattern === "idle" ? "none" : pattern;
      // Operational roles are the EXISTING enum (PARTS_MANAGER / WAREHOUSE_MANAGER / PARTS_ASSOCIATE),
      // set only where the business role genuinely corresponds. Not invented per employee.
      const operationalRoles = governedRoles.includes("partsManager") ? ["PARTS_MANAGER"]
        : governedRoles.includes("partsAssociate") ? ["PARTS_ASSOCIATE"]
        : governedRoles.includes("warehouseManager") ? ["WAREHOUSE_MANAGER"] : [];
      employees.push({
        employeeId, firstName: first, lastName: last, displayName: first + " " + last,
        securityRole, operationalRoles,
        employmentStatus: workload === "none" && pattern === "idle" ? "ACTIVE" : "ACTIVE",
        active: true,
        certGovernedRoles: governedRoles,
        certAssignments: assignments,
        certWorkload: workload,
        // Availability is a fixture fact, so "who has capacity today" has a knowable answer.
        certAvailable: !(pattern === "mixed" && k % 7 === 3),
        certEmployeeNumber: "EMP-" + String(1000 + i),
        certEmail: first.toLowerCase() + "." + last.toLowerCase() + "@certification.invalid",
        certPhone: "602-555-" + String(2000 + i).padStart(4, "0"),
        dataProvenance: PROVENANCE.SYNTHETIC,
      });
      i += 1;
    }
  }
  return employees;
}
