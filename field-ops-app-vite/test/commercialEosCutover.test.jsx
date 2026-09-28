// PASS 11 RETAIL SALES -- the Opportunity, Sales Agreement and Sales Order clients speak to the governed PostgreSQL
// Commercial transport (POST /commercial/sales), never to a Firebase callable.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const httpsCallableMock = vi.fn();
vi.mock("firebase/functions", () => ({ httpsCallable: (...a) => httpsCallableMock(...a) }));
vi.mock("../src/firebase/firebase.js", () => ({ functions: {} }));

const { fetchOpportunityContext } = await import("../src/services/opportunityReadCallableClient.js");
const { fetchSalesOrderContext } = await import("../src/services/salesOrderReadCallableClient.js");
const opp = await import("../src/services/opportunityCommandClient.js");
const so = await import("../src/services/salesOrderCommandClient.js");
const sa = await import("../src/services/salesAgreementCommandClient.js");
const { fetchAccountOpportunities } = await import("../src/services/accountOpportunitiesReadCallableClient.js");
const { COMMERCIAL_READ_OPERATIONS, COMMERCIAL_MUTATION_OPERATIONS } = await import("../src/services/commercialApiClient.js");

function client(reply) {
  const calls = [];
  return { calls, call: async (operation, options) => { calls.push({ operation, input: options?.input }); return reply(operation, options?.input); } };
}
const ok = (result) => ({ ok: true, result });
const refusal = (code, reason = null) => ({ ok: false, code, reason, message: code, status: null });

const OPP = {
  id: "opp_1", opportunityNumber: "OPP-2026-000001", accountId: "acct_1", accountName: "Mesquite",
  owner: { employeeId: "e-retail", displayName: null, resolved: true }, accountablePerson: null, creditedSalesperson: null,
  operatingCompanyId: "taylor", operatingCompanyKey: "taylor", salesChannel: "RETAIL", stage: "QUOTING", outcome: null,
  need: "Freezer", expectedValue: 1000, expectedCloseAt: "2026-11-01T00:00:00.000Z", nextAction: "Call", closedAt: null,
  editVersion: 4, createdAt: "2026-09-28T00:00:00.000Z", updatedAt: "2026-09-28T01:00:00.000Z", lines: [{ lineNumber: 1, kind: "SERVICE", ref: "svc", qty: 1 }],
  salesAgreement: { id: "sag_1", number: "SA-1", state: "DRAFT" }, salesOrder: null,
};

beforeEach(() => httpsCallableMock.mockReset());

describe("reads", () => {
  it("Opportunity detail reads getOpportunityDetail and projects the page's context, editVersion included", async () => {
    const c = client(() => ok(OPP));
    const { result } = await fetchOpportunityContext("opp_1", { client: c });
    expect(c.calls).toEqual([{ operation: "getOpportunityDetail", input: { opportunityId: "opp_1" } }]);
    expect(result.status).toBe("ready");
    expect(result.opportunity).toMatchObject({ id: "opp_1", ownerEmployeeId: "e-retail", salesAgreementId: "sag_1", editVersion: 4, operatingCompanyId: "taylor" });
    expect(result.accountName).toBe("Mesquite");
    expect(httpsCallableMock).not.toHaveBeenCalled();
  });

  it("not found is a result, denied and unavailable are statuses -- never an empty success", async () => {
    expect((await fetchOpportunityContext("x", { client: client(() => refusal("NOT_FOUND")) })).result.status).toBe("not-found");
    expect(await fetchOpportunityContext("x", { client: client(() => refusal("FORBIDDEN")) })).toEqual({ errorStatus: "denied" });
    expect(await fetchOpportunityContext("x", { client: client(() => refusal("UNREACHABLE")) })).toEqual({ errorStatus: "unavailable" });
  });

  it("Sales Order detail carries no downstream execution facts (held boundary) and says so", async () => {
    const c = client(() => ok({ id: "sor_1", salesOrderNumber: "SO-1", state: "CONFIRMED", lines: [{ lineNumber: 1, kind: "SERVICE", ref: "s", businessUnit: "SERVICE", orderedQty: 1, unitPriceMinor: 100, extendedMinor: 100 }] }));
    const { result } = await fetchSalesOrderContext("sor_1", { client: c });
    expect(c.calls[0]).toEqual({ operation: "getSalesOrderDetail", input: { salesOrderId: "sor_1" } });
    expect(result.salesOrder.downstreamTracked).toBe(false);
    expect(result.salesOrder.lines[0]).toMatchObject({ orderedQty: 1, allocatedQty: null, fulfilledQty: null, billedQty: null });
  });

  it("account-scoped Opportunities read listOpportunities with the accountId", async () => {
    const c = client(() => ok({ items: [OPP], truncated: false, nextCursor: null }));
    const { result } = await fetchAccountOpportunities("acct_1", { client: c });
    expect(c.calls[0]).toEqual({ operation: "listOpportunities", input: { limit: 200, accountId: "acct_1" } });
    expect(result.opportunities[0].id).toBe("opp_1");
  });
});

describe("commands", () => {
  it("updateOpportunity sends expectedEditVersion; a stale version is 'aborted', distinct from other refusals", async () => {
    const c = client(() => refusal("CONFLICT", "VERSION_CONFLICT"));
    const out = await opp.updateOpportunity({ opportunityId: "opp_1", expectedEditVersion: 4, idempotencyKey: "k", need: "x" }, { client: c });
    expect(c.calls[0]).toEqual({ operation: "updateOpportunity", input: { opportunityId: "opp_1", expectedEditVersion: 4, idempotencyKey: "k", need: "x" } });
    expect(out.errorStatus).toBe("aborted");
    const denied = await opp.updateOpportunity({ opportunityId: "opp_1", expectedEditVersion: 4, idempotencyKey: "k" }, { client: client(() => refusal("FORBIDDEN")) });
    expect(denied.errorStatus).toBe("permission-denied");
  });

  it("create / transition / close-as-won go to the EOS commands with the caller's idempotency key", async () => {
    const c = client((op) => ok({ op }));
    await opp.createOpportunity({ accountId: "acct_1", idempotencyKey: "k1" }, { client: c });
    await opp.transitionOpportunity({ opportunityId: "opp_1", toStage: "DECISION", idempotencyKey: "k2" }, { client: c });
    await opp.closeOpportunityAsWon({ opportunityId: "opp_1", ownerEmployeeId: "e", salesChannel: "RETAIL", idempotencyKey: "k3" }, { client: c });
    await so.transitionSalesOrder({ salesOrderId: "sor_1", transition: "CANCEL", idempotencyKey: "k4" }, { client: c });
    expect(c.calls.map((x) => x.operation)).toEqual(["createOpportunity", "transitionOpportunity", "closeOpportunityAsWon", "transitionSalesOrder"]);
    expect(c.calls.map((x) => x.input.idempotencyKey)).toEqual(["k1", "k2", "k3", "k4"]);
    expect(httpsCallableMock).not.toHaveBeenCalled();
  });

  it("allocate and create-service are the held boundary: refused without calling anything", async () => {
    expect(await so.allocateSalesOrder({ salesOrderId: "sor_1" })).toEqual({ errorStatus: "failed-precondition" });
    expect(await so.createServiceForSalesOrder({ salesOrderId: "sor_1" })).toEqual({ errorStatus: "failed-precondition" });
    expect(httpsCallableMock).not.toHaveBeenCalled();
  });

  it("the Agreement for an Opportunity is reached through the Opportunity's DERIVED lineage", async () => {
    const c = client((op) => (op === "getOpportunityDetail" ? ok(OPP) : ok({ id: "sag_1", salesAgreementNumber: "SA-1", state: "DRAFT", totals: {}, lines: [] })));
    const { result } = await sa.getSalesAgreementForOpportunity({ opportunityId: "opp_1" }, { client: c });
    expect(c.calls.map((x) => x.operation)).toEqual(["getOpportunityDetail", "getSalesAgreementDetail"]);
    expect(result).toMatchObject({ status: "ready", salesAgreement: { id: "sag_1", salesAgreementNumber: "SA-1" } });
    const none = await sa.getSalesAgreementForOpportunity({ opportunityId: "opp_1" }, { client: client(() => ok({ ...OPP, salesAgreement: null })) });
    expect(none.result.status).toBe("not-found");
  });

  it("Agreement create / update / accept are EOS commands", async () => {
    const c = client(() => ok({}));
    await sa.createSalesAgreement({ opportunityId: "opp_1", idempotencyKey: "a" }, { client: c });
    await sa.updateSalesAgreementDraft({ salesAgreementId: "sag_1", idempotencyKey: "b" }, { client: c });
    await sa.acceptSalesAgreement({ salesAgreementId: "sag_1", idempotencyKey: "c" }, { client: c });
    expect(c.calls.map((x) => x.operation)).toEqual(["createSalesAgreement", "updateSalesAgreementDraft", "acceptSalesAgreement"]);
  });
});

describe("the client's Commercial operation lists mirror the server's closed lists", () => {
  it("equals functions/src/eosCommercial/commercialHttp.ts READ_RUNNERS and MUTATION_RUNNERS", () => {
    const server = readFileSync(resolve(process.cwd(), "..", "functions", "src", "eosCommercial", "commercialHttp.ts"), "utf8");
    const keysOf = (name) => {
      const body = server.slice(server.indexOf(`const ${name} = Object.freeze({`), server.indexOf("} as const);", server.indexOf(`const ${name} = Object.freeze({`)));
      return [...body.matchAll(/^\s+([a-zA-Z]+):/gm)].map((m) => m[1]).sort();
    };
    expect([...COMMERCIAL_READ_OPERATIONS].sort()).toEqual(keysOf("READ_RUNNERS"));
    expect([...COMMERCIAL_MUTATION_OPERATIONS].sort()).toEqual(keysOf("MUTATION_RUNNERS"));
  });
});
