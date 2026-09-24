// THE CANONICAL SECURITY READ MODEL -- the shape the later Object security screen assembles from.
//
// Three projections of ONE PostgreSQL authority, normalised into one row shape, plus the proof that
// an administrator reads "Read Coordinated Visits" and never `fulfillment.coordinatedVisit.read`.
//
// WHAT IS DELIBERATELY NOT HERE: any assertion that a production screen renders this. None does.
// Permission Preview still answers from the Firebase effectiveAccessFeed, the Objects grid is
// untouched, and the last test in this file is the guard that keeps that true.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";

import {
  ACCESS_SOURCE_LABEL,
  UNKNOWN_OBJECT,
  UNLABELLED_ACTION,
  actionDisplay,
  buildObjectSecurityReadModel,
  buildPrincipalAccessReadModel,
  buildRoleSecurityReadModel,
  indexInventory,
} from "../src/modules/administration/objectSecurityReadModel.js";
import {
  ObjectSecurityActionList,
  ObjectSecurityActionRow,
} from "../src/modules/administration/ObjectSecurityActionList.jsx";

// ════════════════════ THE SERVER'S OWN PAYLOADS ════════════════════
//
// Shapes copied from functions/src/adminPolicy/adminPolicyApi.ts -- the dispatcher's four security
// reads -- not invented here. The capability metadata is the real canonical example: capability
// `fulfillment.coordinatedVisit.read` governs Object `salesOrder`, action `readCoordinatedVisits`,
// kind BUSINESS_ACTION, label "Read Coordinated Visits".

const INVENTORY = [
  {
    key: "salesOrder",
    label: "Sales Order",
    supportsDelete: false,
    actions: [
      { actionKey: "read", actionKind: "READ", displayLabel: "View Sales Orders", capabilityKey: "salesOrder.read" },
      {
        actionKey: "readCoordinatedVisits",
        actionKind: "BUSINESS_ACTION",
        displayLabel: "Read Coordinated Visits",
        capabilityKey: "fulfillment.coordinatedVisit.read",
      },
    ],
  },
  { key: "workOrder", label: "Work Order", supportsDelete: false, actions: [
    { actionKey: "dispatch", actionKind: "BUSINESS_ACTION", displayLabel: "Dispatch Work Order", capabilityKey: "workOrder.lifecycle.dispatch" },
  ] },
  { key: "workflowInstance", label: "Workflow Instance", supportsDelete: false, actions: [] },
];

const MATRIX = {
  objectKey: "salesOrder",
  label: "Sales Order",
  supportsDelete: false,
  actions: [
    {
      actionKey: "read", capabilityKey: "salesOrder.read", actionKind: "READ", displayLabel: "View Sales Orders",
      roleKeys: ["dispatcher", "salesManager"], principalIds: ["prn-7"],
    },
    {
      actionKey: "readCoordinatedVisits", capabilityKey: "fulfillment.coordinatedVisit.read",
      actionKind: "BUSINESS_ACTION", displayLabel: "Read Coordinated Visits",
      roleKeys: ["dispatcher"], principalIds: [],
    },
    {
      // The case the Object view exists for: an action the catalog declares and NOBODY holds.
      actionKey: "delete", capabilityKey: "salesOrder.delete", actionKind: "DELETE", displayLabel: "Delete Sales Order",
      roleKeys: [], principalIds: [],
    },
  ],
};

const ROLE_SECURITY = {
  roleKey: "dispatcher",
  name: "Dispatcher",
  objects: { salesOrder: ["read", "readCoordinatedVisits"], workOrder: ["dispatch"] },
};

const PRINCIPAL_ACCESS = {
  principalId: "prn-7",
  roles: ["dispatcher"],
  directGrants: ["cap_salesOrder_read"],
  effective: [
    {
      capabilityKey: "salesOrder.read", objectKey: "salesOrder", actionKey: "read",
      actionKind: "READ", displayLabel: "View Sales Orders", source: "ROLE_AND_DIRECT",
    },
    {
      capabilityKey: "fulfillment.coordinatedVisit.read", objectKey: "salesOrder",
      actionKey: "readCoordinatedVisits", actionKind: "BUSINESS_ACTION",
      displayLabel: "Read Coordinated Visits", source: "ROLE",
    },
    {
      capabilityKey: "workOrder.lifecycle.dispatch", objectKey: "workOrder", actionKey: "dispatch",
      actionKind: "BUSINESS_ACTION", displayLabel: "Dispatch Work Order", source: "DIRECT",
    },
  ],
  objects: { salesOrder: ["read", "readCoordinatedVisits"], workOrder: ["dispatch"] },
};

// ════════════════════ OBJECT VIEW ════════════════════

describe("OBJECT view: Object -> actions -> Role grants AND Principal grants", () => {
  it("keeps every action the server sent, in the server's order, with both grantee kinds", () => {
    const model = buildObjectSecurityReadModel(MATRIX);
    expect(model.view).toBe("OBJECT");
    expect(model.objectKey).toBe("salesOrder");
    expect(model.label).toBe("Sales Order");
    // The server orders CRUD first, then business, then admin. Re-sorting here would be a second
    // answer to a question the authority already answered.
    expect(model.actions.map((a) => a.actionKey)).toEqual(["read", "readCoordinatedVisits", "delete"]);
    expect(model.actions[0].roleKeys).toEqual(["dispatcher", "salesManager"]);
    expect(model.actions[0].principalIds).toEqual(["prn-7"]);
    expect(model.actions[0].granteeCount).toBe(3);
  });

  it("an action nobody holds is a row that says so, never an omitted row", () => {
    const model = buildObjectSecurityReadModel(MATRIX);
    const del = model.actions.find((a) => a.actionKey === "delete");
    expect(del).toBeDefined();
    expect(del.granted).toBe(false);
    expect(del.roleKeys).toEqual([]);
    expect(model.summary.ungrantedActionKeys).toEqual(["delete"]);
    expect(model.summary.grantedActionCount).toBe(2);
  });

  it("summarises everyone who reaches the Object, de-duplicated across its actions", () => {
    const model = buildObjectSecurityReadModel(MATRIX);
    expect(model.summary.roleKeys).toEqual(["dispatcher", "salesManager"]);
    expect(model.summary.principalIds).toEqual(["prn-7"]);
    expect(model.summary.actionCount).toBe(3);
  });

  it("an Object that governs nothing yet is a model with no actions, not a null", () => {
    const model = buildObjectSecurityReadModel({ objectKey: "workflowInstance", label: "Workflow Instance", supportsDelete: false, actions: [] });
    expect(model.summary.actionCount).toBe(0);
    expect(model.actions).toEqual([]);
  });
});

// ════════════════════ ROLE VIEW ════════════════════

describe("ROLE view: the grant facts joined to the vocabulary they are missing", () => {
  it("turns { objectKey: [actionKey] } into labelled Objects and labelled actions", () => {
    const model = buildRoleSecurityReadModel(ROLE_SECURITY, INVENTORY);
    expect(model.view).toBe("ROLE");
    expect(model.roleKey).toBe("dispatcher");
    expect(model.name).toBe("Dispatcher");
    expect(model.objects.map((o) => o.objectKey)).toEqual(["salesOrder", "workOrder"]);
    expect(model.objects[0].label).toBe("Sales Order");
    const visits = model.objects[0].actions.find((a) => a.actionKey === "readCoordinatedVisits");
    // The join's whole purpose: the payload carried "readCoordinatedVisits" and nothing else.
    expect(visits.displayLabel).toBe("Read Coordinated Visits");
    expect(visits.capabilityKey).toBe("fulfillment.coordinatedVisit.read");
    expect(visits.actionKind).toBe("BUSINESS_ACTION");
    expect(model.summary.actionCount).toBe(3);
  });

  it("an action the catalog cannot explain is REPORTED, never dropped from the Role's access", () => {
    const model = buildRoleSecurityReadModel(
      { roleKey: "dispatcher", name: "Dispatcher", objects: { salesOrder: ["read", "frobnicate"], ghostObject: ["read"] } },
      INVENTORY,
    );
    const salesOrder = model.objects.find((o) => o.objectKey === "salesOrder");
    expect(salesOrder.actions.map((a) => a.actionKey)).toContain("frobnicate");
    expect(salesOrder.unknownActionKeys).toEqual(["frobnicate"]);
    // Dropping it would show an administrator a Role with LESS access than it has.
    const ghost = model.objects.find((o) => o.objectKey === "ghostObject");
    expect(ghost.known).toBe(false);
    expect(ghost.label).toBe(UNKNOWN_OBJECT);
    expect(model.summary.unknownObjectKeys).toEqual(["ghostObject"]);
  });

  it("without the inventory there is no model at all -- not a model of unlabelled rows", () => {
    expect(buildRoleSecurityReadModel(ROLE_SECURITY, null)).toBeNull();
    expect(buildRoleSecurityReadModel(ROLE_SECURITY, undefined)).toBeNull();
  });
});

// ════════════════════ PRINCIPAL VIEW ════════════════════

describe("PRINCIPAL view: Roles + direct grants -> effective access, with provenance kept", () => {
  it("groups the server's own rows by Object and keeps each capability's source", () => {
    const model = buildPrincipalAccessReadModel(PRINCIPAL_ACCESS, INVENTORY);
    expect(model.view).toBe("PRINCIPAL");
    expect(model.principalId).toBe("prn-7");
    expect(model.roleKeys).toEqual(["dispatcher"]);
    expect(model.objects.map((o) => o.objectKey)).toEqual(["salesOrder", "workOrder"]);
    expect(model.objects[0].label).toBe("Sales Order");
    const read = model.objects[0].actions.find((a) => a.actionKey === "read");
    expect(read.source).toBe("ROLE_AND_DIRECT");
    expect(read.sourceLabel).toBe(ACCESS_SOURCE_LABEL.ROLE_AND_DIRECT);
    expect(model.summary.bySource).toEqual({ ROLE: 1, DIRECT: 1, ROLE_AND_DIRECT: 1 });
    expect(model.summary.capabilityCount).toBe(3);
    expect(model.directGrantCount).toBe(1);
  });

  it("agrees with the grouping the server itself sent, and says so when it does not", () => {
    expect(buildPrincipalAccessReadModel(PRINCIPAL_ACCESS, INVENTORY).groupingMatchesServer).toBe(true);
    const disagreeing = {
      ...PRINCIPAL_ACCESS,
      objects: { salesOrder: ["read", "readCoordinatedVisits"], workOrder: ["dispatch", "cancel"] },
    };
    // Two answers to "what does this person hold" is the condition this subsystem exists to end:
    // the model reports the disagreement rather than silently choosing one of them.
    expect(buildPrincipalAccessReadModel(disagreeing, INVENTORY).groupingMatchesServer).toBe(false);
  });

  it("carries no Employee, no Work Eligibility and no Operational Scope", () => {
    const model = buildPrincipalAccessReadModel(PRINCIPAL_ACCESS, INVENTORY);
    for (const forbidden of ["employeeId", "workEligibility", "operationalScope", "employmentStatus", "jobRole"]) {
      expect(model, forbidden).not.toHaveProperty(forbidden);
    }
    const json = JSON.stringify(model);
    expect(json.includes("eligibility")).toBe(false);
    expect(json.includes("employee")).toBe(false);
  });
});

// ════════════════════ A REFUSAL IS NOT AN EMPTY MODEL ════════════════════

describe("null in, null out", () => {
  it("no payload never becomes a grid reading 'nobody holds anything'", () => {
    for (const empty of [null, undefined, "", 0, []]) {
      expect(buildObjectSecurityReadModel(empty), String(empty)).toBeNull();
      expect(buildRoleSecurityReadModel(empty, INVENTORY), String(empty)).toBeNull();
      expect(buildPrincipalAccessReadModel(empty, INVENTORY), String(empty)).toBeNull();
    }
  });

  it("a payload missing the contract's own keys is unreadable, not empty", () => {
    expect(buildObjectSecurityReadModel({ objectKey: "salesOrder" })).toBeNull();
    expect(buildObjectSecurityReadModel({ actions: [] })).toBeNull();
    expect(buildRoleSecurityReadModel({ roleKey: "dispatcher" }, INVENTORY)).toBeNull();
    expect(buildPrincipalAccessReadModel({ principalId: "prn-7" }, INVENTORY)).toBeNull();
  });

  it("indexInventory refuses anything that is not the server's array", () => {
    expect(indexInventory(null)).toBeNull();
    expect(indexInventory({ salesOrder: [] })).toBeNull();
    expect(indexInventory([]).size).toBe(0);
  });
});

// ════════════════════ THE FRIENDLY LABEL, RENDERED ════════════════════

describe("an administrator reads the action's name, and the capability key stays for audit", () => {
  it("renders the display label as the row's name, with the key beside it and not as it", () => {
    const model = buildObjectSecurityReadModel(MATRIX);
    render(<ObjectSecurityActionList actions={model.actions} />);

    // The canonical example, end to end: capability key in, administrator's words out.
    const names = screen.getAllByTestId("action-name").map((n) => n.textContent);
    expect(names).toEqual(["View Sales Orders", "Read Coordinated Visits", "Delete Sales Order"]);

    // Not one of those names is a capability key, and no name contains a dotted key at all.
    for (const name of names) {
      expect(name.includes(".")).toBe(false);
      expect(name).not.toMatch(/^[a-z]+\.[a-zA-Z.]+$/);
    }

    // The key is still THERE -- "which capability is that exactly" is a real audit question.
    const keys = screen.getAllByTestId("action-capability-key").map((n) => n.textContent);
    expect(keys.some((k) => k.includes("fulfillment.coordinatedVisit.read"))).toBe(true);
    expect(keys.some((k) => k.includes("salesOrder.read"))).toBe(true);

    // And the two are different elements: the key never stands in for the name.
    const visitRow = screen.getByText("Read Coordinated Visits").closest("li");
    expect(visitRow.querySelector("[data-testid='action-name']").textContent).toBe("Read Coordinated Visits");
    expect(visitRow.querySelector("[data-testid='action-capability-key']").textContent)
      .toContain("fulfillment.coordinatedVisit.read");
  });

  it("an action the payload did not label says so, and still does not show the key as its name", () => {
    const unlabelled = actionDisplay({ actionKey: "readCoordinatedVisits", capabilityKey: "fulfillment.coordinatedVisit.read", displayLabel: "" });
    expect(unlabelled.labelMissing).toBe(true);
    expect(unlabelled.name).toBe(UNLABELLED_ACTION);

    render(<ul>{<ObjectSecurityActionRow action={{
      actionKey: "readCoordinatedVisits", capabilityKey: "fulfillment.coordinatedVisit.read",
      displayLabel: unlabelled.name, labelMissing: true, granted: true, roleKeys: ["dispatcher"], principalIds: [],
    }} />}</ul>);

    expect(screen.getByTestId("action-name").textContent).toBe(UNLABELLED_ACTION);
    // No humanised action key either: a second label vocabulary is how the deleted titleCase() in
    // WorkOrderDetailPage.jsx came to disagree with the governed one on two of five values.
    expect(screen.queryByText("Read Coordinated Visits")).toBeNull();
    expect(screen.getByTestId("action-capability-key").textContent).toContain("fulfillment.coordinatedVisit.read");
  });

  it("names the provenance of a Principal's capability in words, not as a code", () => {
    const model = buildPrincipalAccessReadModel(PRINCIPAL_ACCESS, INVENTORY);
    render(<ObjectSecurityActionList actions={model.objects[0].actions} />);
    expect(screen.getByText(ACCESS_SOURCE_LABEL.ROLE_AND_DIRECT)).toBeTruthy();
    expect(screen.queryByText("ROLE_AND_DIRECT")).toBeNull();
  });

  it("says nobody holds an action rather than drawing an empty cell", () => {
    const model = buildObjectSecurityReadModel(MATRIX);
    render(<ObjectSecurityActionList actions={model.actions} />);
    expect(screen.getByText("Nobody holds this action")).toBeTruthy();
    expect(screen.getByText("2 Roles · 1 Principal")).toBeTruthy();
  });

  it("renders NOTHING for a read that did not arrive -- an absent list is not an empty one", () => {
    const { container } = render(<ObjectSecurityActionList actions={null} />);
    expect(container.textContent).toBe("");
  });
});

// ════════════════════ THE HOOKS THAT ASSEMBLE IT ════════════════════

const callPolicyApi = vi.fn();
vi.mock("../src/services/adminPolicyApiClient.js", () => ({
  callPolicyApi: (...args) => callPolicyApi(...args),
  isPolicyApiConfigured: () => true,
  describePolicyFailure: (r) => (r?.ok ? null : r?.message ?? null),
}));

const {
  useObjectSecurityReadModel,
  usePrincipalAccessReadModel,
  useRoleSecurityReadModel,
} = await import("../src/modules/administration/useObjectSecurity.js");

function mount(useHook, ...args) {
  const seen = { current: null };
  function Probe() {
    seen.current = useHook(...args);
    return null;
  }
  render(<Probe />);
  return seen;
}

const answerWith = (byOperation) => {
  callPolicyApi.mockImplementation(async (operation) => {
    if (!(operation in byOperation)) throw new Error(`unexpected operation ${operation}`);
    const answer = byOperation[operation];
    return answer.ok === false ? answer : { ok: true, data: answer, tenantId: "taylor-az" };
  });
};

// A BLOCK BODY, deliberately. `() => callPolicyApi.mockReset()` returns the mock, vitest treats a
// value returned from beforeEach as the test's teardown, and the teardown then CALLS the mock with
// no arguments -- an invisible extra invocation that a call-count assertion reads as a real one.
beforeEach(() => { callPolicyApi.mockReset(); });
afterEach(() => { vi.clearAllMocks(); });

describe("the composed hooks ask the same server, and assemble what comes back", () => {
  it("useObjectSecurityReadModel is one read and produces the Object model", async () => {
    answerWith({ getObjectSecurityMatrix: MATRIX });
    const seen = mount(useObjectSecurityReadModel, "salesOrder");
    await waitFor(() => expect(seen.current.status).toBe("ready"));
    expect(callPolicyApi).toHaveBeenCalledWith("getObjectSecurityMatrix", { objectKey: "salesOrder" }, expect.anything());
    expect(callPolicyApi).toHaveBeenCalledTimes(1);
    expect(seen.current.model.summary.ungrantedActionKeys).toEqual(["delete"]);
  });

  it("useRoleSecurityReadModel reads the grants AND the inventory, and joins them", async () => {
    answerWith({ getRoleSecurity: ROLE_SECURITY, listObjectsWithActions: INVENTORY });
    const seen = mount(useRoleSecurityReadModel, "dispatcher");
    await waitFor(() => expect(seen.current.status).toBe("ready"));
    const asked = callPolicyApi.mock.calls.map((c) => c[0]).sort();
    expect(asked).toEqual(["getRoleSecurity", "listObjectsWithActions"]);
    expect(seen.current.model.objects[0].actions[1].displayLabel).toBe("Read Coordinated Visits");
  });

  it("usePrincipalAccessReadModel reads both and keeps the provenance", async () => {
    answerWith({ getPrincipalEffectiveAccess: PRINCIPAL_ACCESS, listObjectsWithActions: INVENTORY });
    const seen = mount(usePrincipalAccessReadModel, "prn-7");
    await waitFor(() => expect(seen.current.status).toBe("ready"));
    expect(seen.current.model.summary.bySource.ROLE_AND_DIRECT).toBe(1);
    expect(seen.current.model.groupingMatchesServer).toBe(true);
  });

  it("no key means NO request -- including the inventory read the join needs", async () => {
    for (const [useHook, key] of [[useRoleSecurityReadModel, null], [usePrincipalAccessReadModel, ""], [useObjectSecurityReadModel, undefined]]) {
      callPolicyApi.mockReset();
      const seen = mount(useHook, key);
      await waitFor(() => expect(seen.current.status).toBe("unconfigured"));
      expect(callPolicyApi).not.toHaveBeenCalled();
      expect(seen.current.model).toBeNull();
    }
  });

  it("a refused HALF is a refused whole -- never a half-labelled security grid", async () => {
    answerWith({ getRoleSecurity: ROLE_SECURITY, listObjectsWithActions: { ok: false, code: "FORBIDDEN", message: "not yours" } });
    const seen = mount(useRoleSecurityReadModel, "dispatcher");
    await waitFor(() => expect(seen.current.status).toBe("failed"));
    expect(seen.current.error.code).toBe("FORBIDDEN");
    expect(seen.current.model).toBeNull();
  });

  it("a payload the model cannot read fails closed rather than rendering as empty", async () => {
    answerWith({ getObjectSecurityMatrix: { objectKey: "salesOrder" } });
    const seen = mount(useObjectSecurityReadModel, "salesOrder");
    await waitFor(() => expect(seen.current.status).toBe("failed"));
    expect(seen.current.error.code).toBe("UNREADABLE_PAYLOAD");
    expect(seen.current.model).toBeNull();
  });
});

// ════════════════════ STILL WIRED TO NOTHING ════════════════════

describe("this tranche changes no source of truth", () => {
  it("no Administration screen imports the read model, the hooks or the list component", () => {
    for (const screenFile of [
      "AdminObjects.jsx", "AdminRolesPermissions.jsx", "AdminPolicySurfaces.jsx", "UserDetail.jsx",
      "UserAccessActions.jsx", "AdministrationOverview.jsx", "ObjectAdministrationPanel.jsx",
      "RolePolicyGrid.jsx", "PolicyStorePanels.jsx",
    ]) {
      const code = readFileSync(`src/modules/administration/${screenFile}`, "utf8");
      for (const banned of ["objectSecurityReadModel", "useObjectSecurity", "ObjectSecurityActionList"]) {
        expect(code.includes(banned), `${screenFile} imports ${banned}`).toBe(false);
      }
    }
  });

  it("Permission Preview is on the path it was on, and the effectiveAccessFeed is untouched", () => {
    // Permission Preview renders AdministrationUnavailable today (App.jsx, Issue #226 Row 11). This
    // tranche does NOT give it the new Principal read: that switch is a source-of-truth change and
    // is not in this lane.
    const app = readFileSync("src/App.jsx", "utf8");
    expect(app.includes('item.key === "permissionPreview"')).toBe(true);
    expect(app.includes("AdministrationUnavailable")).toBe(true);
    for (const banned of ["usePrincipalAccessReadModel", "useObjectSecurity", "objectSecurityReadModel"]) {
      expect(app.includes(banned), banned).toBe(false);
    }
    // The Firebase capability feed is still the client's runtime access answer, and nothing here
    // replaces or reads around it.
    const feed = readFileSync("src/access/reportCapabilityAccess.js", "utf8");
    expect(feed.includes("resolveEffectiveAccess")).toBe(true);
    expect(feed.includes("getPrincipalEffectiveAccess")).toBe(false);
  });

  it("the read model is pure: no transport, no Firebase, no authorization decision", () => {
    const src = readFileSync("src/modules/administration/objectSecurityReadModel.js", "utf8");
    for (const banned of ["firebase", "firestore", "fetch(", "callPolicyApi", "grantObjectAction", "revokeObjectAction"]) {
      expect(src.includes(banned), banned).toBe(false);
    }
    // An "is this allowed" helper here would be a client-side permission check, which is never
    // sufficient for access and is dangerous precisely because it looks sufficient.
    expect(src.includes("export function can")).toBe(false);
    expect(src.includes("isAllowed")).toBe(false);
  });
});
