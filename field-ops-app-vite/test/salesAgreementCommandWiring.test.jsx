// THE SALES AGREEMENT COMMAND WIRING — PR 4.
//
// PRs 1–3 built the derivation, the by-id read seam and the routed page. This suite asserts the
// only thing PR 4 adds: that the page's two controls reach the EXISTING governed commands, that a
// success re-reads authoritative state rather than synthesising it, and that a refusal is reported
// as the kind of refusal it actually was.
//
// The assertions that carry the most weight are about what must NOT happen: a second mutation path,
// a locally-invented accepted state, a state refusal re-worded as a permission problem, a duplicate
// submission, or any acceptance language EOS cannot prove.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import SalesAgreementDetail from "../src/modules/sales/SalesAgreementDetail.jsx";
import { useSalesAgreementById } from "../src/hooks/useSalesAgreementById.js";
import { salesAgreementView } from "../src/domain/salesAgreementView.js";

vi.mock("../src/hooks/useSalesAgreementById.js", () => ({ useSalesAgreementById: vi.fn() }));
vi.mock("../src/hooks/useEmployeeDirectory", () => ({
  useEmployeeDirectory: () => ({
    loading: false, error: null,
    byEmployeeId: new Map([["emp_1", { displayName: "R. Amado" }]]),
    byUserId: new Map([["uid_actor", { displayName: "R. Amado" }]]),
  }),
}));
vi.mock("../src/hooks/useAccountNames.js", () => ({
  useAccountNamesWithStatus: () => ({ names: new Map([["acct_1", "Desert Sun Beverage Co."]]), status: "READY" }),
  ACCOUNT_NAMES_STATUS: { READY: "READY", DENIED: "DENIED", ERROR: "ERROR", LOADING: "LOADING" },
}));

const AGREEMENT_ID = "MHc7xk2QpLbR9vTn4sYe";
const PRICED = { lineId: "ln-1", kind: "PART", ref: "X49463-3", quantity: 12, unitPriceMinor: 17500, extendedMinor: 210000, condition: "NEW", warranty: null, estimatedArrivalMillis: null };
const UNPRICED = { ...PRICED, unitPriceMinor: null, extendedMinor: null };

function projection(overrides = {}) {
  const lines = overrides.lines ?? [PRICED];
  const priced = lines.every((l) => l.unitPriceMinor !== null);
  const subtotalMinor = priced ? lines.reduce((n, l) => n + l.extendedMinor, 0) : null;
  return {
    status: "ready",
    salesAgreement: {
      id: AGREEMENT_ID, salesAgreementNumber: "SA-2026-000003", state: "DRAFT",
      accountId: "acct_1", ownerEmployeeId: "emp_1", locationId: "loc_1", currency: "USD",
      customerPO: "PO-88231", isLease: false, fulfillmentIntent: "BOTH",
      shippingInstructions: "Rear dock", shipVia: "Taylor truck", specialInstructions: "One visit",
      sourceOpportunityId: "opp_1", salesOrderId: null, acceptedAtMillis: null, acceptedByUid: null,
      ...overrides,
      lines,
      subtotalMinor, shippingMinor: 0, installChargeMinor: 0, taxMinor: 0,
      totalMinor: subtotalMinor, downPaymentMinor: 0, tradeInMinor: 0, balanceMinor: subtotalMinor,
    },
  };
}

let seam;
function mount({ overrides = {}, grant = () => true, wiring = {}, errorStatus = null } = {}) {
  const view = salesAgreementView({ result: errorStatus ? null : projection(overrides), loading: false, errorStatus });
  seam = {
    updateDraft: vi.fn().mockResolvedValue({ ok: true }),
    accept: vi.fn().mockResolvedValue({ ok: true }),
    pending: null, commandError: null, clearCommandError: vi.fn(), refresh: vi.fn(),
    ...wiring,
  };
  useSalesAgreementById.mockReturnValue({ view, absence: null, readMode: "BY_ID", STATE: {}, ...seam });
  return render(
    <MemoryRouter initialEntries={[`/a/${AGREEMENT_ID}`]}>
      <Routes><Route path="/a/:salesAgreementId" element={<SalesAgreementDetail hasCapability={grant} />} /></Routes>
    </MemoryRouter>,
  );
}

const btn = (name) => screen.queryByRole("button", { name });
const ACCEPTED = { state: "ACCEPTED", acceptedAtMillis: 1_755_542_460_000, acceptedByUid: "uid_actor" };

beforeEach(() => { vi.clearAllMocks(); });

// ═════════════════════════════════════════ ELIGIBILITY IS NOT OVERRIDDEN

describe("eligibility still decides, wiring only decides what a live control does", () => {
  it("an eligible draft receives a live Edit action", () => {
    mount();
    expect(btn("Edit draft").disabled).toBe(false);
  });

  it("an eligible agreement receives a live Record acceptance action", () => {
    mount();
    expect(btn("Record acceptance").disabled).toBe(false);
  });

  it("an ineligible draft is not bypassed by the wiring", () => {
    mount({ overrides: { lines: [UNPRICED] } });
    const accept = btn("Record acceptance");
    expect(accept.disabled).toBe(true);
    expect(accept.dataset.restriction).toBe("state");
    fireEvent.click(accept);
    expect(seam.accept).not.toHaveBeenCalled();
  });

  it("a terminal agreement has no Edit action at all", () => {
    for (const state of [ACCEPTED, { state: "DECLINED" }]) {
      const { unmount } = mount({ overrides: state });
      expect(btn("Edit draft")).toBeNull();
      expect(btn("Record acceptance")).toBeNull();
      unmount();
    }
  });

  it("blocked acceptance keeps the governed reason, naming the unpriced line", () => {
    mount({ overrides: { lines: [UNPRICED] } });
    expect(document.body.textContent).toContain("Every line needs a price");
    expect(document.body.textContent).toContain("X49463-3");
    expect(document.body.textContent).not.toMatch(/do not have permission/i);
  });

  it("permission denial stays a different restriction from a state block", () => {
    mount({ grant: () => false });
    const accept = btn("Record acceptance");
    expect(accept.dataset.restriction).toBe("permission");
    expect(document.body.textContent).toMatch(/do not have permission to accept/i);
    expect(document.body.textContent).not.toMatch(/Every line needs a price/);
    fireEvent.click(accept);
    expect(seam.accept).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════ THE COMMANDS, AND ONLY THEM

describe("the governed commands", () => {
  it("Record acceptance calls acceptSalesAgreement and nothing else", async () => {
    mount();
    fireEvent.click(btn("Record acceptance"));
    await waitFor(() => expect(seam.accept).toHaveBeenCalledTimes(1));
    expect(seam.updateDraft).not.toHaveBeenCalled();
    // The command takes no commercial payload — the id comes from the route, inside the hook.
    expect(seam.accept).toHaveBeenCalledWith();
  });

  it("Edit draft opens in-place editing and saves through updateSalesAgreementDraft only", async () => {
    mount();
    fireEvent.click(btn("Edit draft"));
    expect(seam.updateDraft).not.toHaveBeenCalled(); // opening a form is not a write
    fireEvent.change(screen.getByLabelText("Customer PO"), { target: { value: "PO-99001" } });
    fireEvent.click(btn("Save terms"));
    await waitFor(() => expect(seam.updateDraft).toHaveBeenCalledTimes(1));
    expect(seam.accept).not.toHaveBeenCalled();
    const [patch] = seam.updateDraft.mock.calls[0];
    expect(patch.customerPO).toBe("PO-99001");
  });

  it("sends only fields the server's own allowlist permits", async () => {
    mount();
    fireEvent.click(btn("Edit draft"));
    fireEvent.click(btn("Save terms"));
    await waitFor(() => expect(seam.updateDraft).toHaveBeenCalled());
    const [patch] = seam.updateDraft.mock.calls[0];
    const ALLOWED = ["locationId", "customerPO", "isLease", "fulfillmentIntent",
      "shippingInstructions", "shipVia", "specialInstructions", "lines",
      "shippingMinor", "installChargeMinor", "taxMinor", "downPaymentMinor", "tradeInMinor"];
    for (const key of Object.keys(patch)) expect(ALLOWED).toContain(key);
    // Identity, currency, acceptance and totals are server-owned and are never offered.
    for (const forbidden of ["id", "salesAgreementNumber", "state", "currency", "accountId",
      "acceptedAtMillis", "acceptedByUid", "totalMinor", "subtotalMinor", "balanceMinor", "salesOrderId"]) {
      expect(patch).not.toHaveProperty(forbidden);
    }
  });
});

// ═════════════════════════════════════════ AUTHORITATIVE REFRESH, NOT SYNTHESIS

describe("a success re-reads; nothing is invented locally", () => {
  it("accepted state, timestamp and actor come from the refreshed record", async () => {
    // Before: a DRAFT with no acceptance facts at all.
    const first = mount();
    expect(screen.queryByText("Action executed by")).toBeNull();
    fireEvent.click(btn("Record acceptance"));
    await waitFor(() => expect(seam.accept).toHaveBeenCalled());
    // The page still shows DRAFT: the command returned, but the record has not been re-read yet,
    // and the page must not paint an accepted record it has not been told about.
    expect(screen.queryByText("Action executed by")).toBeNull();
    first.unmount();

    // After the governed re-read the hook yields the authoritative record, and only then does the
    // evidence appear — sourced entirely from the projection.
    mount({ overrides: ACCEPTED });
    expect(screen.getByText("Action executed by")).toBeTruthy();
    expect(screen.getAllByText("R. Amado").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Accepted").length).toBeGreaterThan(0);
  });

  it("the page holds no local copy of state, totals, acceptance or downstream", () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../src/modules/sales/SalesAgreementDetail.jsx"), "utf8");
    // The only useState on this page is the editor's own open/closed flag and its form draft.
    const states = source.match(/useState\(/g) ?? [];
    expect(states.length).toBeLessThanOrEqual(2);
    for (const banned of [/setAccepted/, /setState\(/, /setTotal/, /optimistic/i, /acceptedAtMillis\s*=/, /state:\s*"ACCEPTED"/]) {
      expect(source).not.toMatch(banned);
    }
  });

  it("a failed command fabricates no new state and keeps the record as authority left it", async () => {
    mount({ wiring: { accept: vi.fn().mockResolvedValue({ ok: false, errorStatus: "failed-precondition" }) } });
    fireEvent.click(btn("Record acceptance"));
    await waitFor(() => expect(seam.accept).toHaveBeenCalled());
    expect(screen.getAllByText("Draft").length).toBeGreaterThan(0);
    expect(screen.queryByText("Action executed by")).toBeNull();
    expect(document.body.textContent).not.toMatch(/\bAccepted\b/);
  });

  it("a refused edit keeps the form open rather than reading as saved", async () => {
    mount({ wiring: { updateDraft: vi.fn().mockResolvedValue({ ok: false, errorStatus: "failed-precondition" }) } });
    fireEvent.click(btn("Edit draft"));
    fireEvent.click(btn("Save terms"));
    await waitFor(() => expect(seam.updateDraft).toHaveBeenCalled());
    expect(btn("Save terms")).toBeTruthy();
  });
});

// ═════════════════════════════════════════ IN-FLIGHT

describe("double submission", () => {
  it("a command in flight disables its own control and states what is happening", () => {
    mount({ wiring: { pending: "accept" } });
    const accept = btn("Record acceptance…");
    expect(accept).toBeTruthy();
    expect(accept.disabled).toBe(true);
    // It must not imply the acceptance has already happened.
    expect(document.body.textContent).not.toMatch(/Action executed by/);
  });

  it("a second click while pending issues no second command", () => {
    mount({ wiring: { pending: "accept" } });
    fireEvent.click(btn("Record acceptance…"));
    fireEvent.click(btn("Record acceptance…"));
    expect(seam.accept).not.toHaveBeenCalled();
  });

  it("only the running command's control goes busy", () => {
    mount({ wiring: { pending: "updateDraft" } });
    expect(btn("Record acceptance").disabled).toBe(false);
  });
});

// ═════════════════════════════════════════ ERROR VOCABULARY

describe("a refusal is reported as the kind of refusal it was", () => {
  it("a command refusal is its own fact, not a state or permission sentence", () => {
    mount({ wiring: { commandError: "failed-precondition" } });
    const shown = document.querySelector('[data-restriction="command"]');
    expect(shown).toBeTruthy();
    expect(shown.textContent).toContain("failed-precondition");
  });

  it("a transport failure is never re-worded as a permission problem", () => {
    mount({ wiring: { commandError: "That did not go through. Try again." } });
    expect(document.body.textContent).toContain("That did not go through");
    expect(document.body.textContent).not.toMatch(/do not have permission/i);
  });

  it("the three refusal kinds carry three different data-restriction values", () => {
    const state = mount({ overrides: { lines: [UNPRICED] } });
    expect(btn("Record acceptance").dataset.restriction).toBe("state");
    state.unmount();
    const permission = mount({ grant: () => false });
    expect(btn("Record acceptance").dataset.restriction).toBe("permission");
    permission.unmount();
    mount({ wiring: { commandError: "unavailable" } });
    expect(document.querySelector('[data-restriction="command"]')).toBeTruthy();
  });
});

// ═════════════════════════════════════════ THE FENCES

describe("nothing new was granted", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const page = readFileSync(join(here, "../src/modules/sales/SalesAgreementDetail.jsx"), "utf8");
  const hook = readFileSync(join(here, "../src/hooks/useSalesAgreementById.js"), "utf8");
  const runner = readFileSync(join(here, "../src/hooks/useAgreementCommandRunner.js"), "utf8");

  it("reaches the two governed commands through the existing transport, and no other", () => {
    expect(hook).toMatch(/updateSalesAgreementDraft/);
    expect(hook).toMatch(/acceptSalesAgreement/);
    // createSalesAgreement belongs to the Opportunity surface — the only place that knows which
    // Opportunity an agreement would be created from. Targets the IMPORT and the CALL, not prose:
    // the hook explains its own absence, and forbidding the word would forbid the explanation.
    expect(hook).not.toMatch(/^\s*createSalesAgreement,\s*$/m);
    expect(hook).not.toMatch(/createSalesAgreement\(/);
    for (const file of [page, hook, runner]) {
      expect(file).not.toMatch(/firebase\/firestore/);
      expect(file).not.toMatch(/httpsCallable|setDoc|updateDoc|addDoc|deleteDoc|runTransaction/);
    }
  });

  it("adds no banned action anywhere on the page", () => {
    mount();
    for (const banned of ["Decline", "Revise", "Supersede", "Reopen", "Replace", "Duplicate",
      "Sign", "Send", "Present", "Convert", "Approve"]) {
      expect(screen.queryByRole("button", { name: new RegExp(banned, "i") })).toBeNull();
    }
    for (const banned of [/\bdecline\b/i, /\brevise\b/i, /\bsupersede\b/i, /\breopen\b/i]) {
      expect(page).not.toMatch(new RegExp(`label: *"[^"]*${banned.source}`, "i"));
    }
  });

  it("keeps the acceptance-evidence boundary after a successful acceptance", () => {
    mount({ overrides: ACCEPTED });
    const body = document.body.textContent;
    for (const banned of [/\bbinding\b/i, /\bsigned\b/i, /\belectronic/i, /customer accepted/i, /customer'?s commitment/i, /\blegally\b/i]) {
      expect(body).not.toMatch(banned);
    }
    expect(body).toContain("No customer-signature evidence is stored");
    expect(body).toContain("EOS records the governed acceptance event.");
  });

  it("one command runner serves both hooks — there is no second discipline", () => {
    const byOpportunity = readFileSync(join(here, "../src/hooks/useSalesAgreement.js"), "utf8");
    expect(byOpportunity).toMatch(/useAgreementCommandRunner/);
    expect(hook).toMatch(/useAgreementCommandRunner/);
    // The idempotency key is minted in exactly one place.
    expect(runner).toMatch(/mintKey/);
    expect(byOpportunity).not.toMatch(/mintKey/);
    expect(hook).not.toMatch(/mintKey/);
  });

  it("leaves route, shared grammar and SA-G2–SA-G6 untouched", () => {
    expect(page).not.toMatch(/grid-template-columns|--rail-width/);
    for (const banned of [/signature/i, /sendToCustomer/i, /agreementList/i, /displayName:\s*ref/]) {
      expect(page.replace(/No customer-signature evidence[^"]*/g, "")).not.toMatch(banned);
    }
  });
});
