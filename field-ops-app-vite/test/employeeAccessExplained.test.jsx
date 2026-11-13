// EMPLOYEE > ACCESS EXPLAINED (Option A piece 3) -- the panel draws the SERVER's gate-by-gate answer and decides nothing.
//
// Fixtures follow functions/src/eosOps/accessGatesExplanation.ts (AccessGatesExplanation): eleven gates in order, each
// { step, key, label, proposedLayer, status, summary, failure, settings: [{ id, label, value, authority }] }, a verdict, the
// server's `firstFailure.text`, and `layerNamesApproved`. The panel takes the control-plane seam as `api`; vi.fn stands in
// for the server, so what is proved is: the order, the status words, that the first failure is shown exactly as the server
// worded it, that nothing after it reads as passed, which question is sent, and that refusals are shown rather than hidden.
// The decisions themselves are proved against PostgreSQL in functions/test/accessGatesExplanationPostgres.test.mjs.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import EmployeeAccessExplained, { questionFromDraft } from "../src/modules/administration/EmployeeAccessExplained.jsx";

afterEach(cleanup);

const GATES = [
  ["signIn", "Sign-in", "Layer 0"], ["principal", "Principal and tenant", "Layer 0"], ["employment", "Employment eligibility", "Layer 0"],
  ["company", "Company", "Layer 3"], ["activation", "Activation", "Layer A"], ["door", "Door", "Experience"], ["object", "Object", "Layer 1"],
  ["field", "Field", "Layer 2"], ["record", "Record access", "Layer 3"], ["process", "Process", "Layer 4"], ["system", "System", "Layer 5"],
];
const SETTING = { id: "1.1", label: "Login account status", value: "active", authority: "eos_policy.login_accounts.status" };

/** A server-shaped answer. `fail` = { key, failure } puts the first refusal there; `base` sets every gate before it. */
function answer({ fail = null, passes = ["signIn", "principal", "employment", "company", "door"], question = null, approved = false } = {}) {
  const failIndex = fail ? GATES.findIndex(([k]) => k === fail.key) : -1;
  const gates = GATES.map(([key, label, proposedLayer], i) => {
    let status = "NOT_EVALUATED";
    if (failIndex >= 0) status = i < failIndex ? "PASS" : i === failIndex ? "FAIL" : "NOT_EVALUATED";
    else if (passes.includes(key)) status = "PASS";
    else if (question && key === "activation") status = "NOT_COVERED";
    return {
      step: i + 1, key, label, proposedLayer, status,
      summary: status === "FAIL" ? fail.summary : status === "NOT_EVALUATED" ? "Not evaluated." : `${label} summary.`,
      failure: status === "FAIL" ? fail.failure : null,
      settings: i === 0 ? [SETTING] : [],
    };
  });
  return {
    tenantId: "t-1", principalId: "pr-9",
    question: question ?? { kind: "PERSON", capabilityKey: null, surfaceKey: null, label: null, businessContext: {} },
    verdict: fail ? "BLOCKED" : question ? "ALLOWED_AS_CHECKED" : "OVERVIEW",
    notCoveredCount: gates.filter((g) => g.status === "NOT_COVERED").length,
    gates,
    firstFailure: fail ? { step: failIndex + 1, key: fail.key, label: GATES[failIndex][1], text: `Blocked at: ${GATES[failIndex][1]}. ${fail.failure}` } : null,
    layerNamesApproved: approved,
    ...(question ? {} : { options: {
      actions: [
        { objectKey: "workOrder", actionKey: "dispatch", capabilityKey: "workOrder.lifecycle.dispatch" },
        { objectKey: "workOrder", actionKey: "read", capabilityKey: "workOrder.record.read" },
        { objectKey: "opportunity", actionKey: "read", capabilityKey: "opportunity.read" },
      ],
      surfaces: [{ key: "service.dispatch", label: "Dispatch" }, { key: "administration.rolesPermissions", label: "Roles & Permissions" }],
    } }),
  };
}

const makeApi = (data = answer(), over = {}) => ({ explainAccessGates: vi.fn(async () => ({ ok: true, data })), ...over });
const mount = (api) => render(<EmployeeAccessExplained api={api} principalId="pr-9" />);
const ready = () => waitFor(() => expect(document.querySelector('[data-access-explained="READY"]')).toBeTruthy());
const gateEl = (key) => document.querySelector(`[data-gate="${key}"]`);

describe("Access explained -- a healthy overview", () => {
  it("shows all eleven gates in the server's order with pass / not evaluated words, and no failure", async () => {
    mount(makeApi());
    await ready();
    const order = [...document.querySelectorAll("[data-gate]")].map((n) => n.getAttribute("data-gate"));
    expect(order).toEqual(GATES.map(([k]) => k));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(document.querySelector("[data-access-verdict]").getAttribute("data-access-verdict")).toBe("OVERVIEW");
    expect(within(gateEl("signIn")).getByText("Pass")).toBeTruthy();
    expect(within(gateEl("object")).getByText("Not evaluated")).toBeTruthy();
    // The governing setting and its current value are on the gate that owns them.
    const row = within(gateEl("signIn")).getByRole("table").querySelector('[data-setting="1.1"]');
    expect(row.textContent).toContain("Login account status");
    expect(row.textContent).toContain("active");
    expect(row.textContent).toContain("eos_policy.login_accounts.status");
  });

  it("does NOT show the proposal's layer names until the server says the Owner approved them", async () => {
    mount(makeApi(answer()));
    await ready();
    expect(document.querySelector("[data-gate-layer]")).toBeNull();
    expect(document.body.textContent).not.toContain("Layer 0");
    cleanup();
    mount(makeApi(answer({ approved: true })));
    await ready();
    expect(gateEl("signIn").querySelector("[data-gate-layer]").textContent).toContain("Layer 0");
    expect(gateEl("record").querySelector("[data-gate-layer]").textContent).toContain("Layer 3");
  });
});

// A failure at SEVEN different gates. For each: the headline is the server's sentence verbatim, only that gate reads Fail,
// everything before it reads Pass, and everything after it reads Not evaluated -- nothing after a refusal looks passed.
const FAILURES = [
  { key: "signIn", summary: "The sign-in account is locked until 2099-01-01.", failure: "The sign-in account is locked until 2099-01-01 after too many failed attempts." },
  { key: "principal", summary: "The principal is disabled.", failure: "The principal is disabled. Nothing else is evaluated." },
  { key: "employment", summary: "The linked Employee is ON_LEAVE, which is not eligible for access.", failure: "The linked Employee's status is ON_LEAVE. Only Active and Contractor employees have access; roles stay assigned but give nothing." },
  { key: "company", summary: "The record's company ventana is outside this person's reach.", failure: "Their company reach is taylor; this record belongs to ventana." },
  { key: "object", summary: "Dispatch is not granted.", failure: "None of their Security Roles (fieldManager) or direct exceptions grants Dispatch." },
  { key: "record", summary: "The record is outside the scope this access is held in.", failure: "They are scoped to warehouse SC-WH-MAIN; this record is in SC-WH-SERVICE." },
];
describe("Access explained -- a refusal at each gate", () => {
  it.each(FAILURES)("blocks at $key with the server's own words and nothing after it reads as passed", async (fail) => {
    const idx = GATES.findIndex(([k]) => k === fail.key);
    mount(makeApi(answer({ fail })));
    await ready();
    const headline = screen.getByRole("alert");
    expect(headline.textContent).toBe(`Blocked at: ${GATES[idx][1]}. ${fail.failure}`);
    expect(headline.getAttribute("data-first-failure")).toBe(fail.key);
    GATES.forEach(([key], i) => {
      const status = gateEl(key).getAttribute("data-gate-status");
      expect(status, key).toBe(i < idx ? "PASS" : i === idx ? "FAIL" : "NOT_EVALUATED");
    });
    expect(within(gateEl(fail.key)).getByText("Fail")).toBeTruthy();
    expect(document.querySelectorAll('[data-gate-status="FAIL"]').length).toBe(1);
  });

  it("says Not covered, not Pass, for a gate the server could not check", async () => {
    const data = answer({ question: { kind: "ACTION", capabilityKey: "workOrder.lifecycle.dispatch", surfaceKey: null, label: "Dispatch", businessContext: {} } });
    mount(makeApi(data));
    await ready();
    expect(within(gateEl("activation")).getByText("Not covered")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    // Not a bare "Allowed": the headline admits what was not checked.
    expect(document.querySelector("[data-access-verdict]").getAttribute("data-access-verdict")).toBe("ALLOWED_AS_CHECKED");
    expect(screen.getByText("Allowed as far as EOS can check. 1 check is not covered yet.")).toBeTruthy();
  });

  it("says a bare Allowed only when the server says every gate passed or does not apply", async () => {
    mount(makeApi({ ...answer({ question: { kind: "ACTION", capabilityKey: "x.y", surfaceKey: null, label: "X", businessContext: {} } }), verdict: "ALLOWED", notCoveredCount: 0 }));
    await ready();
    expect(screen.getByText("Allowed. Every gate passed or does not apply.")).toBeTruthy();
  });
});

describe("Access explained -- asking a question", () => {
  it("sends the chosen object, action and record context to the server, and draws the answer for it", async () => {
    const asked = answer({ fail: FAILURES[5], question: { kind: "ACTION", capabilityKey: "workOrder.lifecycle.dispatch", surfaceKey: null, label: "Dispatch", businessContext: { warehouseId: "SC-WH-SERVICE" } } });
    const api = makeApi(answer(), {
      explainAccessGates: vi.fn(async (_p, q) => ({ ok: true, data: q ? asked : answer() })),
    });
    mount(api);
    await ready();
    expect(api.explainAccessGates).toHaveBeenCalledWith("pr-9");
    const form = screen.getByRole("form", { name: "Access question" });
    fireEvent.change(within(form).getByLabelText("Question"), { target: { value: "action" } });
    fireEvent.change(within(form).getByLabelText("Object"), { target: { value: "workOrder" } });
    // Only the chosen object's actions are offered.
    expect([...within(form).getByLabelText("Action").querySelectorAll("option")].map((o) => o.value)).toEqual(["", "dispatch", "read"]);
    fireEvent.change(within(form).getByLabelText("Action"), { target: { value: "dispatch" } });
    fireEvent.change(within(form).getByLabelText("Warehouse"), { target: { value: " SC-WH-SERVICE " } });
    fireEvent.click(within(form).getByRole("button", { name: "Explain" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("They are scoped to warehouse SC-WH-MAIN; this record is in SC-WH-SERVICE."));
    expect(api.explainAccessGates).toHaveBeenLastCalledWith("pr-9", { objectKey: "workOrder", actionKey: "dispatch", businessContext: { warehouseId: "SC-WH-SERVICE" } });
    expect(document.querySelector("[data-access-question]").textContent).toBe("Question: do Dispatch");
    // Clear returns to the overview.
    fireEvent.click(within(form).getByRole("button", { name: "Clear" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("asks about a page by its key", async () => {
    const api = makeApi();
    mount(api);
    await ready();
    const form = screen.getByRole("form", { name: "Access question" });
    fireEvent.change(within(form).getByLabelText("Question"), { target: { value: "page" } });
    fireEvent.change(within(form).getByLabelText("Page"), { target: { value: "administration.rolesPermissions" } });
    fireEvent.click(within(form).getByRole("button", { name: "Explain" }));
    await waitFor(() => expect(api.explainAccessGates).toHaveBeenLastCalledWith("pr-9", { surfaceKey: "administration.rolesPermissions" }));
  });

  it("will not send an incomplete question", async () => {
    mount(makeApi());
    await ready();
    const form = screen.getByRole("form", { name: "Access question" });
    fireEvent.change(within(form).getByLabelText("Question"), { target: { value: "action" } });
    expect(within(form).getByRole("button", { name: "Explain" }).disabled).toBe(true);
    expect(questionFromDraft({ kind: "action", objectKey: "workOrder", actionKey: "", surfaceKey: "", operatingCompanyId: "", warehouseId: "", salesChannel: "" })).toBeNull();
    expect(questionFromDraft({ kind: "person", objectKey: "", actionKey: "", surfaceKey: "", operatingCompanyId: "", warehouseId: "", salesChannel: "" })).toBeNull();
  });
});

describe("Access explained -- what the server refuses or cannot say", () => {
  it("shows a refusal as a refusal, never as an empty or passing page", async () => {
    mount(makeApi(null, { explainAccessGates: vi.fn(async () => ({ ok: false, code: "FORBIDDEN", message: "not authorized: \"admin.principalAccess.read\" is required" })) }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("admin.principalAccess.read");
    expect(document.querySelector("[data-gate]")).toBeNull();
  });

  it("says unavailable (and shows nothing) when this server does not serve it", async () => {
    mount(makeApi(null, { explainAccessGates: vi.fn(async () => ({ ok: false, code: "UNKNOWN_OPERATION", message: "unknown operation" })) }));
    await waitFor(() => expect(document.querySelector('[data-access-explained="UNAVAILABLE"]')).toBeTruthy());
    expect(screen.getByText(/Access explained is unavailable/)).toBeTruthy();
    expect(document.querySelector("[data-gate]")).toBeNull();
  });

  it("refuses to draw a payload it cannot read", async () => {
    mount(makeApi({ verdict: "ALLOWED" }));
    expect((await screen.findByRole("alert")).textContent).toContain("cannot read");
    expect(document.querySelector("[data-gate]")).toBeNull();
  });

  it("explains there is nothing to explain for an Employee with no linked Principal, and asks nothing", () => {
    const api = makeApi();
    render(<EmployeeAccessExplained api={api} principalId={null} />);
    expect(screen.getByText(/No governed Principal is linked/)).toBeTruthy();
    expect(api.explainAccessGates).not.toHaveBeenCalled();
  });
});
