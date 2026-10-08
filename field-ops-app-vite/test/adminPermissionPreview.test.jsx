// UI corrections §15 (2026-10-08): Administration → Permission Preview is RETIRED from normal navigation. Its business
// function is Users → Employee → Roles & Access; what only it could do -- inspect a Principal with no linked Employee, pick a
// sample persona -- is NONPROD QA tooling (PrincipalQaInspection). These tests keep the old page's guarantees (no external
// subject, no internal id as a label) and add the new ones (runtime evaluator only, production refusal, unlinked Principals).
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../src/modules/administration/usePolicyStore.js", () => ({
  usePolicyStore: vi.fn((operation) => {
    if (operation === "listTenantPrincipals") {
      return {
        status: "ready",
        data: [
          { id: "principal-admin-12345678", displayName: "Avery Admin", externalSubject: "firebase-subject-must-not-render", identityProvider: "firebase", status: "active" },
          { id: "87654321-no-name-principal", displayName: null, externalSubject: "another-subject-must-not-render", identityProvider: "firebase", status: "active" },
          { id: "pr-sample-orphan", displayName: "Sample Orphan Persona", externalSubject: "x", identityProvider: "eos", status: "active" },
        ],
        error: null,
      };
    }
    // The retired projection must never be asked for.
    if (operation === "getPrincipalEffectiveAccess") throw new Error("getPrincipalEffectiveAccess must not be used");
    return { status: "unconfigured", data: null, error: null };
  }),
}));

import PrincipalQaInspection from "../src/modules/administration/PrincipalQaInspection.jsx";

const EXPLAIN = {
  principalId: "pr-sample-orphan",
  securityRoleKeys: ["partsManager"],
  accessVersion: 3,
  assignments: { excluded: [] },
  employeeId: null,
  workEligibility: [],
  operationalScopes: [],
  capabilities: ["inventory.catalog.read"],
  surfaces: [],
  actions: [
    { objectKey: "part", actionKey: "read", actionKind: "READ", capabilityKey: "inventory.catalog.read", result: "ALLOWED", reasonCode: "ALLOWED",
      sourceRoles: [{ roleKey: "partsManager", condition: null }], scopedSources: [], directGrant: null, provenance: "ROLE",
      withheldFromFlatSetKernels: false, surfaces: [], workflowSource: null },
  ],
};

const makeApi = () => ({ explainEffectiveAccess: vi.fn(async () => ({ ok: true, data: EXPLAIN })) });
// Avery is linked to an Employee the caller can see; the two others are not.
const makeWorkforce = () => ({
  call: vi.fn(async () => ({ ok: true, result: { items: [{ employeeId: "emp-avery", displayName: "Avery Admin", principalId: "principal-admin-12345678" }], total: 1 } })),
});

const renderQa = (props = {}) =>
  render(
    <MemoryRouter>
      <PrincipalQaInspection nonprod api={makeApi()} workforce={makeWorkforce()} {...props} />
    </MemoryRouter>,
  );

afterEach(cleanup);

describe("Principal Inspection (nonprod QA) -- the retired Permission Preview's unique functions", () => {
  it("is NOT rendered in a production bundle -- it points to Users → Roles & Access instead", () => {
    render(<MemoryRouter><PrincipalQaInspection nonprod={false} api={makeApi()} workforce={makeWorkforce()} /></MemoryRouter>);
    expect(document.querySelector('[data-principal-qa="PRODUCTION"]')).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Avery Admin" })).toBeNull();
    expect(screen.getByText(/not available in this environment/)).toBeTruthy();
  });

  it("lists, by default, only Principals WITHOUT a visible linked Employee (the function no Employee record can reach)", async () => {
    renderQa();
    await waitFor(() => expect(document.querySelector('[data-principal-list="UNLINKED"]')).toBeTruthy());
    const list = document.querySelector('[data-principal-list="UNLINKED"]');
    expect(within(list).getByRole("button", { name: "Sample Orphan Persona" })).toBeTruthy();
    expect(within(list).queryByRole("button", { name: "Avery Admin" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Show All 3 Principals/ }));
    expect(within(document.querySelector('[data-principal-list="ALL"]')).getByRole("button", { name: "Avery Admin" })).toBeTruthy();
  });

  it("inspects a selected Principal through the RUNTIME EVALUATOR (explainEffectiveAccess) with provenance -- never the retired projection", async () => {
    const api = makeApi();
    render(<MemoryRouter><PrincipalQaInspection nonprod api={api} workforce={makeWorkforce()} /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: "Sample Orphan Persona" }));
    await waitFor(() => expect(document.querySelector('[data-effective-access="READY"]')).toBeTruthy());
    expect(api.explainEffectiveAccess).toHaveBeenCalledWith("pr-sample-orphan");
    expect(screen.getByText("No Employee you can see is linked to this Principal.")).toBeTruthy();
    expect(document.querySelector('[data-capability="inventory.catalog.read"] [data-provenance]').getAttribute("data-provenance")).toBe("ROLE");
  });

  it("never falls back to displaying the external authentication subject", async () => {
    renderQa();
    fireEvent.click(await screen.findByRole("button", { name: /Show All/ }));
    expect(screen.queryByText("firebase-subject-must-not-render")).toBeNull();
    expect(screen.queryByText("another-subject-must-not-render")).toBeNull();
  });

  it("an unnamed Principal is labelled 'Unnamed Principal', never by its internal id (Pass 10 D4)", async () => {
    renderQa();
    fireEvent.click(await screen.findByRole("button", { name: /Show All/ }));
    expect(screen.getByRole("button", { name: "Unnamed Principal" })).toBeTruthy();
    for (const button of screen.getAllByRole("button")) {
      expect(button.textContent).not.toMatch(/87654321|principal-admin-12345678|Principal [0-9a-f]{8}/i);
    }
  });
});
