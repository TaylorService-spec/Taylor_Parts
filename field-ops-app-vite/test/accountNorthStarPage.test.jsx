// THE ACCOUNT PAGE, AGAINST THE NORTH STAR GRAMMAR AND ITS APPROVED P1 COMPOSITION.
//
// Family 3. The derivation layer is asserted offline in test/accountNorthStar.test.mjs; the
// attention surface's own two-section / per-source / intelligence rules in
// test/accountAttentionSection.test.jsx. This suite asserts the COMPOSITION.
//
// It defends RULES, not markup. Every assertion is a claim about what the page may and may not
// SAY — an order that answers questions in the right sequence, a denial that is not a zero, a
// primary contact that is never guessed, an explanation that never becomes a recommendation.
// Where a rule is load-bearing enough that getting it wrong would mislead someone, it is
// MUTATION-PROVEN: the test states what the wrong answer would look like and asserts its absence,
// so a change that reintroduces it fails here rather than shipping.
//
// ONE FILE ON PURPOSE. The Account P1 reconciliation first added a second suite beside this one,
// and registering that suite needed an edit to composition-conformance-tests.yml — which turned
// out to suppress every pull_request workflow run for the PR (DECISIONS #128, defect E). The
// assertions belong together in any case: they are about one page, and one mock block is one
// place for a future reader to look.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import AccountDetail from "../src/modules/accounts/AccountDetail.jsx";
import AccountHealthStrip from "../src/modules/accounts/AccountHealthStrip.jsx";
import ServiceActivitySection from "../src/modules/accounts/ServiceActivitySection.jsx";
import { useAccount } from "../src/hooks/useAccount";
import { useContactsForAccount } from "../src/hooks/useContactsForAccount";
import { ACCOUNT_AR_STATE } from "../src/domain/accountArView.js";
import { opportunityRelatedList } from "../src/metadata/definitions/opportunity.js";

vi.mock("../src/hooks/useAccount", () => ({ useAccount: vi.fn() }));
vi.mock("../src/hooks/useLocationsForAccount", () => ({
  useLocationsForAccount: () => ({ data: [], loading: false, error: null, retry: vi.fn() }),
}));
vi.mock("../src/hooks/useContactsForAccount", () => ({ useContactsForAccount: vi.fn() }));
vi.mock("../src/hooks/useAccountAr", () => ({
  useAccountAr: () => ({ loading: false, errorStatus: null, result: null }),
}));
vi.mock("../src/hooks/useAccountAttentionWorkOrders", () => ({
  useAccountAttentionWorkOrders: () => ({ loading: false, error: null, workOrders: [], truncated: false }),
}));
vi.mock("../src/hooks/useAccountServiceActivity", async (importOriginal) => ({
  ...(await importOriginal()),
  useAccountWorkOrderCount: () => ({ value: null, loading: false, error: null }),
  useAccountWorkOrderTimeline: () => ({ items: [], loading: false, error: null, hasMore: false }),
}));
vi.mock("../src/hooks/useFirestoreCollection", () => ({
  useFirestoreCollection: () => ({ data: [], loading: false, error: null }),
}));
vi.mock("../src/hooks/useEmployeeDirectory", () => ({
  useEmployeeDirectory: () => ({ byUserId: new Map(), byEmployeeId: new Map(), loading: false, error: null }),
}));
vi.mock("../src/auth/AuthContext", () => ({ useAuth: () => ({ user: { uid: "u1" }, role: "admin" }) }));
// Every capability DENIED — the fail-closed default a real signed-in viewer has until
// resolveEffectiveAccessCallable grants otherwise. This is the state most personas are actually
// in, which makes it the right default for a composition suite.
vi.mock("../src/metadata/definitions/accountPageComponents.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useAccountPageCapabilityDecisions: () => ({}) };
});

const DOC_ID = "acct_doc_secret";

function account(overrides = {}) {
  return {
    id: DOC_ID,
    name: "Harbor Grill Restaurant Group",
    status: "ACTIVE",
    relationshipTypes: ["CUSTOMER"],
    lineOfBusiness: ["TAYLOR"],
    customerNumber: "C-1042",
    tags: [],
    billingAddress: null,
    notes: null,
    ...overrides,
  };
}

// One primary, with a phone. The number below is the ONLY number the page may ever dial.
const PRIMARY = { id: "c1", name: "Maria Delgado", role: "Ops manager", phone: "(602) 555-0144", isPrimary: true };
// A second, reachable contact who is NOT primary — the substitution trap. If the page ever falls
// back to "someone we can reach", this number is what it would reach for.
const OTHER_REACHABLE = { id: "c2", name: "Sam Whitfield", role: "AP", phone: "(602) 555-0171", isPrimary: false };

function setPhoneWidth(isPhone) {
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: isPhone && query.includes("max-width"),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

function mount({ contacts = [], isPhone = false, ...overrides } = {}) {
  setPhoneWidth(isPhone);
  useAccount.mockReturnValue({
    account: account(overrides),
    loading: false,
    error: null,
    retry: vi.fn(),
    checkedAt: Date.UTC(2026, 5, 10, 16, 12),
  });
  useContactsForAccount.mockReturnValue({ data: contacts, loading: false, error: null, retry: vi.fn() });
  return render(
    <MemoryRouter initialEntries={[`/customers/${DOC_ID}`]}>
      <Routes>
        <Route path="/customers/:accountId" element={<AccountDetail />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => setPhoneWidth(false));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// Index of the first element matching a selector, for DOM-ORDER claims — "attention comes before
// the work it warns about" is an order claim, so it is asserted as one.
const at = (container, selector) =>
  Array.from(container.querySelectorAll("*")).findIndex((n) => n.matches?.(selector));

// ═════════════════════════════════════════ THE RAIL, AND WHAT LEADS IT

describe("Account North Star P1 — the rail", () => {
  it("CONTACTS LEAD THE RAIL, before locations and before every other rail section", () => {
    // The load-bearing change from the merged composition, where contacts sat at the BOTTOM of
    // the main column — a reader reached "who do I call" after everything else on the page.
    const { container } = mount({ contacts: [PRIMARY] });
    const titles = Array.from(container.querySelectorAll(".ns-rail .ns-rail__title")).map((n) => n.textContent);
    expect(titles[0]).toMatch(/^Contacts/);
    expect(titles[1]).toMatch(/^Locations/);
    expect(titles.indexOf("Commercial profile")).toBeGreaterThan(1);
    expect(titles).toContain("Notes & identifiers");
  });

  it("notes & identifiers stay secondary — collapsed, never promoted into the hierarchy", () => {
    const { container } = mount();
    const details = container.querySelector(".ns-rail__details");
    expect(details).toBeTruthy();
    expect(details.hasAttribute("open"), "collapsed by default").toBe(false);
  });

  it("an absent tax status resolves to Unknown and NEVER silently to Taxable", () => {
    // The mutation this proves: a resolver that defaulted to TAXABLE would put a tax claim on a
    // customer nobody made a tax decision about — and invoices would be built on it.
    const { container } = mount({ taxStatus: undefined, paymentTerms: "NET_30" });
    const profile = container.querySelector(".ns-rail__dl").textContent;
    expect(profile).toMatch(/Tax status/);
    expect(profile).toMatch(/UNKNOWN|Unknown/);
    expect(container.textContent).not.toMatch(/Taxable/);
  });
});

// ═════════════════════════════════════════ THE HEADER

describe("Account North Star P1 — the header", () => {
  it("the terms digest joins the header facts, and states tax status even when absent", () => {
    const { container } = mount({ paymentTerms: "NET_30", taxStatus: "TAXABLE", purchaseOrderRequired: true });
    expect(container.querySelector(".ns-identity").textContent).toMatch(/Net 30 · Taxable · PO required/);
  });

  it("a malformed purchaseOrderRequired is omitted, never shown as a confident Yes or No", () => {
    const { container } = mount({ purchaseOrderRequired: "yes" });
    const identity = container.querySelector(".ns-identity").textContent;
    expect(identity).not.toMatch(/PO required/);
    expect(identity).not.toMatch(/No PO required/);
  });

  it("the freshness wording is honest and there is NO live badge", () => {
    const { container } = mount();
    expect(container.querySelector(".ns-page__freshness").textContent).toMatch(/Read-checked .* · $|Read-checked/);
    expect(screen.getByRole("button", { name: "Refresh" })).toBeTruthy();
    // A live dot would claim a liveness this page does not present as a claim.
    expect(container.querySelector(".ns-live")).toBeNull();
  });

  it("no document id reaches the page at any width", () => {
    for (const isPhone of [false, true]) {
      const { container, unmount } = mount({ isPhone, contacts: [PRIMARY] });
      expect(container.textContent, `id leaked at ${isPhone ? "phone" : "desktop"}`).not.toContain(DOC_ID);
      unmount();
    }
  });
});

// ═════════════════════════════════════════ DENIED IS NOT ZERO

describe("Account North Star P1 — denied is not zero, and is not absent", () => {
  it("a denied metric says so in place, and never renders a number", () => {
    const { container } = render(
      <MemoryRouter>
        <AccountHealthStrip
          workOrderCount={{ value: null, loading: false, error: null }}
          arView={{ kind: ACCOUNT_AR_STATE.DENIED }}
        />
      </MemoryRouter>,
    );
    const strip = container.querySelector(".ns-standing").textContent;
    expect(strip).toMatch(/Outstanding AR/);
    expect(strip).toMatch(/Not available to you/);
    // The mutation this proves: collapsing DENIED into "0" or "None" tells a salesperson this
    // customer owes nothing, which is a different fact from "not yours to see".
    expect(strip).not.toMatch(/\bNone\b/);
    expect(container.querySelector(".ns-standing__metric-value").textContent).not.toMatch(/^\s*0\s*$/);
  });

  it("an unavailable metric is worded differently from a denied one", () => {
    const { container } = render(
      <MemoryRouter>
        <AccountHealthStrip
          workOrderCount={{ value: null, loading: false, error: true }}
          arView={{ kind: ACCOUNT_AR_STATE.UNAVAILABLE }}
        />
      </MemoryRouter>,
    );
    expect(container.textContent).toMatch(/Couldn’t be read/);
    expect(container.textContent).not.toMatch(/Not available to you/);
  });

  it("a real zero renders as a zero — it is an answer", () => {
    const { container } = render(
      <MemoryRouter>
        <AccountHealthStrip
          workOrderCount={{ value: 0, loading: false, error: null }}
          arView={{ kind: ACCOUNT_AR_STATE.EMPTY }}
        />
      </MemoryRouter>,
    );
    expect(container.textContent).toMatch(/Open work orders/);
    expect(container.textContent).toMatch(/0/);
    expect(container.textContent).not.toMatch(/Not available to you|Couldn’t be read/);
  });

  it("MULTI-CURRENCY IS NEVER SUMMED — each currency keeps its own line", () => {
    const { container } = render(
      <MemoryRouter>
        <AccountHealthStrip
          workOrderCount={{ value: 1, loading: false, error: null }}
          arView={{
            kind: ACCOUNT_AR_STATE.READY,
            overdueCount: 0,
            outstandingLines: [
              { currency: "USD", text: "$100.00" },
              { currency: "EUR", text: "€250.00" },
            ],
          }}
        />
      </MemoryRouter>,
    );
    const strip = container.querySelector(".ns-standing").textContent;
    expect(strip).toMatch(/\$100\.00 · €250\.00/);
    // The mutation this proves: 100 + 250 = 350 is not an amount of anything. A summed
    // multi-currency total is a number nobody could ever collect.
    expect(strip).not.toMatch(/350/);
  });

  it("the standing strip states WHY it carries three metrics and not six", () => {
    const { container } = render(
      <MemoryRouter>
        <AccountHealthStrip
          workOrderCount={{ value: 2, loading: false, error: null }}
          arView={{ kind: ACCOUNT_AR_STATE.EMPTY }}
        />
      </MemoryRouter>,
    );
    expect(container.querySelector(".ns-standing__note").textContent)
      .toMatch(/pipeline, order backlog and equipment counts have no per-account read/);
    // No fabricated tiles beside the three real ones. Counted, not word-matched: the sentence
    // above NAMES pipeline and backlog in order to say they are absent.
    expect(container.querySelectorAll(".ns-standing__metric")).toHaveLength(3);
    const labels = Array.from(container.querySelectorAll(".ns-standing__metric-label")).map((n) => n.textContent);
    expect(labels).toEqual(["Open work orders", "Outstanding AR", "Past due"]);
  });

  it("a denied AR read keeps the financial geography on the page (A-D2)", () => {
    // Capability decisions are empty (fail-closed), so finance.read is denied.
    const { container } = mount();
    const ar = Array.from(container.querySelectorAll(".ns-section__title"))
      .find((h) => /Accounts receivable/i.test(h.textContent));
    expect(ar, "the financial section keeps its place").toBeTruthy();
    expect(ar.closest(".ns-section").textContent).toMatch(/Not available to you/);
    // The mutation this proves: removing the section entirely leaves a customer page with no
    // financial region at all, which reads as a customer who owes nothing.
    expect(ar.closest(".ns-section").textContent).not.toMatch(/\$0\.00/);
  });
});

// ═════════════════════════════════════════ THE PRIMARY CONTACT, AND THE CALL AFFORDANCE

describe("Account North Star P1 — primary contact and the phone Call affordance", () => {
  it("phone: ONE primary with a stored phone renders Primary contact / name / Call", () => {
    const { container } = mount({ isPhone: true, contacts: [PRIMARY] });
    const panel = container.querySelector(".ns-primary");
    expect(panel.textContent).toMatch(/Primary contact/);
    expect(panel.textContent).toMatch(/Maria Delgado/);
    const call = screen.getByRole("link", { name: "Call" });
    expect(call.getAttribute("href")).toBe("tel:6025550144");
  });

  it("the Call target is derived from THAT contact's stored number and no other", () => {
    // Both contacts are reachable; only one is primary. This is the substitution trap.
    const { container } = mount({ isPhone: true, contacts: [PRIMARY, OTHER_REACHABLE] });
    const call = screen.getByRole("link", { name: "Call" });
    expect(call.getAttribute("href")).toBe("tel:6025550144");
    // The mutation this proves: dialling the other reachable contact would look like a working
    // Call button and would put a person through to the wrong human.
    expect(container.innerHTML).not.toContain("tel:6025550171");
  });

  it("Call is a plain tel: link — no write, no callable, no command", () => {
    mount({ isPhone: true, contacts: [PRIMARY] });
    const call = screen.getByRole("link", { name: "Call" });
    // An anchor with a tel: href. Not a button, not a form, not a submit — nothing that could
    // reach a write path. EOS hands the number to the device; the device owns the call.
    expect(call.tagName).toBe("A");
    expect(call.getAttribute("href").startsWith("tel:")).toBe(true);
    expect(call.getAttribute("onclick")).toBeNull();
    expect(call.closest("form")).toBeNull();
  });

  it("the Call control meets the handheld touch floor", () => {
    mount({ isPhone: true, contacts: [PRIMARY] });
    const call = screen.getByRole("link", { name: "Call" });
    // The floor is enforced in the class, not on the page — assert the class is the one that
    // carries it, so a control rebuilt without it fails here.
    expect(call.className).toContain("ns-primary__call");
  });

  it("ONE primary with NO stored phone renders no active Call link", () => {
    const { container } = mount({ isPhone: true, contacts: [{ ...PRIMARY, phone: undefined }, OTHER_REACHABLE] });
    expect(screen.queryByRole("link", { name: "Call" })).toBeNull();
    expect(container.querySelector(".ns-primary__nocall").textContent).toMatch(/No phone number recorded/);
    // An account-level or unrelated contact's number may NEVER stand in for a missing one.
    expect(container.innerHTML).not.toContain("tel:");
  });

  it("MULTIPLE primaries keep the ambiguity — no contact is silently selected, and no Call is offered", () => {
    const { container } = mount({
      isPhone: true,
      contacts: [PRIMARY, { ...OTHER_REACHABLE, isPrimary: true }],
    });
    expect(container.querySelector(".ns-primary__ambiguous").textContent)
      .toMatch(/2 contacts are marked primary/);
    expect(screen.queryByRole("link", { name: "Call" })).toBeNull();
    // The mutation this proves: picking the first primary merely to have something to dial is
    // the page inventing an answer the data does not hold.
    expect(container.innerHTML).not.toContain("tel:");
  });

  it("NO primary fabricates neither a contact nor a Call target", () => {
    const { container } = mount({ isPhone: true, contacts: [OTHER_REACHABLE] });
    expect(container.querySelector(".ns-primary").textContent)
      .toMatch(/No contact on this customer is marked primary/);
    expect(screen.queryByRole("link", { name: "Call" })).toBeNull();
    expect(container.innerHTML).not.toContain("tel:");
  });

  it("the displayed number is the STORED string — display formatting never rewrites the record", () => {
    const contacts = [PRIMARY];
    const { container } = mount({ isPhone: true, contacts });
    expect(container.querySelector(".ns-primary__phone").textContent).toBe("(602) 555-0144");
    // The contact object the page was handed is untouched: nothing normalised, nothing persisted.
    expect(contacts[0].phone).toBe("(602) 555-0144");
  });

  it("desktop states the primary-contact fact without introducing a second calling surface", () => {
    const { container } = mount({ contacts: [PRIMARY] });
    expect(container.querySelector(".ns-primary").textContent).toMatch(/Maria Delgado/);
    expect(screen.queryByRole("link", { name: "Call" })).toBeNull();
  });
});

// ═════════════════════════════════════════ RESPONSIVE COMPOSITIONS

describe("Account North Star P1 — real responsive compositions", () => {
  it("the phone renders an ANSWER STACK: identity → attention → standing → primary contact → activity", () => {
    const { container } = mount({ isPhone: true, contacts: [PRIMARY] });
    expect(at(container, ".ns-identity")).toBeLessThan(at(container, ".ns-attn"));
    expect(at(container, ".ns-attn")).toBeLessThan(at(container, ".ns-standing"));
    expect(at(container, ".ns-standing")).toBeLessThan(at(container, ".ns-primary"));
    expect(at(container, ".ns-primary")).toBeLessThan(at(container, ".ns-record-body"));
  });

  it("the phone puts profile, receivables and notes behind More — and the desktop does not", () => {
    const phone = mount({ isPhone: true, contacts: [PRIMARY] });
    const more = phone.container.querySelector(".ns-more");
    expect(more, "the phone composition has a More disclosure").toBeTruthy();
    expect(more.textContent).toMatch(/Commercial profile/);
    expect(more.textContent).toMatch(/Accounts receivable/);
    expect(more.textContent).toMatch(/Notes & identifiers/);
    phone.unmount();

    const desktop = mount({ contacts: [PRIMARY] });
    expect(desktop.container.querySelector(".ns-more"), "the desktop shows everything in place").toBeNull();
  });

  it("the desktop orders standing before attention before the body", () => {
    const { container } = mount();
    expect(at(container, ".ns-standing")).toBeLessThan(at(container, ".ns-attn"));
    expect(at(container, ".ns-attn")).toBeLessThan(at(container, ".ns-record-body"));
  });

  it("width changes the composition and NEVER the authority", () => {
    // The same fail-closed denial renders at both widths. A phone must not see more (or less)
    // than a desktop; only the shape of the answer changes.
    const phone = mount({ isPhone: true, contacts: [PRIMARY] });
    const phoneText = phone.container.textContent;
    phone.unmount();
    const desktop = mount({ contacts: [PRIMARY] });
    for (const claim of ["Not available to you", "Harbor Grill Restaurant Group"]) {
      expect(phoneText).toContain(claim);
      expect(desktop.container.textContent).toContain(claim);
    }
  });
});

// ═════════════════════════════════════════ WHAT THE PAGE MAY NOT DO

describe("Account North Star P1 — what the page may never do", () => {
  it("offers NO AI recommendation, action, or chat anywhere", () => {
    const { container } = mount({ contacts: [PRIMARY] });
    expect(container.textContent).not.toMatch(/Recommend|Suggested action|Ask (Keystone|Claude|AI)|Chat with/i);
    expect(container.querySelector(".ns-suggest")).toBeNull();
  });

  it("keeps the existing write affordances exactly as they were", () => {
    // The reconciliation moved these; it did not add, remove or re-authorize one.
    mount({ contacts: [PRIMARY] });
    expect(screen.getByRole("button", { name: "Edit customer" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "+ Add contact" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Import" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "+ Add location" })).toBeTruthy();
    // No status-transition control exists, because no transition command does.
    expect(screen.queryByRole("button", { name: /Activate|Archive|Mark prospect|Advance/i })).toBeNull();
  });

  it("an archived account keeps the same composition and keeps Edit offered (A-D3)", () => {
    const { container } = mount({ status: "ARCHIVED", contacts: [PRIMARY] });
    expect(container.querySelector(".ns-identity").textContent).toMatch(/Archived — closed/);
    expect(screen.getByRole("button", { name: "Edit customer" })).toBeTruthy();
    // No lock is invented: enforcement would be a behavioral change, not a presentation one.
    expect(container.textContent).not.toMatch(/read-only mode|locked/i);
  });

  it("a prospect uses the same composition and renders honest empties, not a separate page", () => {
    const { container } = mount({ status: "PROSPECT" });
    expect(container.querySelector(".ns-identity").textContent).toMatch(/Prospect — not yet a customer/);
    expect(container.querySelector(".ns-record-body")).toBeTruthy();
    expect(container.querySelector(".ns-rail")).toBeTruthy();
  });

  it("an Opportunity row stays non-navigable because no opportunity record route exists", () => {
    // Asserted at the definition, which is where the rule lives: DefaultRelatedList builds row
    // navigation from rowNavigationTo, so an absent one is what makes the rows honestly
    // non-focusable. The mutation this proves: restoring a rowNavigationTo here would make every
    // opportunity row look clickable and land on a 404.
    expect(opportunityRelatedList.rowNavigationTo ?? null).toBeNull();
  });
});

// ═════════════════════════════════════════ SERVICE ACTIVITY

describe("Account North Star P1 — service activity", () => {
  const renderService = () =>
    render(<MemoryRouter><ServiceActivitySection accountId="acct-1" /></MemoryRouter>);

  it("states the equipment absence honestly and routes to the workspace that can answer", () => {
    const { container } = renderService();
    expect(container.textContent).toMatch(/no account-scoped equipment read exists yet/);
    expect(screen.getByRole("link", { name: /Equipment workspace/ })).toBeTruthy();
    // The mutation this proves: a count here would describe whatever happened to be loaded, not
    // the account — a number that looks authoritative and is not.
    expect(container.textContent).not.toMatch(/\d+\s+equipment/i);
  });

  it("renders no fabricated rows when the account has no service activity", () => {
    const { container } = renderService();
    expect(container.textContent).toMatch(/No service activity yet for this customer/);
    expect(container.querySelectorAll(".ns-svc__row")).toHaveLength(0);
  });
});

describe("Account — North Star composition", () => {
  // ─────────────── NS-P2: attention comes BEFORE the work

  it("the attention section renders BEFORE the record body, not after it", () => {
    const { container } = mount();
    const attentionAt = at(container, ".ns-attn");
    const bodyAt = at(container, ".ns-record-body");
    expect(attentionAt, "the attention section must be present").toBeGreaterThan(-1);
    expect(bodyAt, "the record body must be present").toBeGreaterThan(-1);
    expect(
      attentionAt,
      "attention renders after the work — this is the NS-P2 ordering defect the migration fixed",
    ).toBeLessThan(bodyAt);
  });

  it("the attention section renders exactly once", () => {
    // It was MOVED, not copied. Two mounts would double every account-scoped read behind it.
    const { container } = mount();
    expect(container.querySelectorAll(".ns-attn")).toHaveLength(1);
  });

  it("the record identity renders before the attention section", () => {
    const { container } = mount();
    expect(at(container, ".ns-identity")).toBeGreaterThan(-1);
    expect(at(container, ".ns-identity")).toBeLessThan(at(container, ".ns-attn"));
  });

  it("standing comes before attention, and attention before the work it warns about", () => {
    // The approved composition order: the three real numbers, then what needs a person, then the
    // sections those warnings point at.
    const { container } = mount();
    expect(at(container, ".ns-standing")).toBeGreaterThan(-1);
    expect(at(container, ".ns-standing")).toBeLessThan(at(container, ".ns-attn"));
    expect(at(container, ".ns-attn")).toBeLessThan(at(container, ".ns-record-body"));
  });

  // ─────────────── ND-11: no lifecycle may be drawn

  it("NO lifecycle band is rendered, and the page says why in words", () => {
    const { container } = mount();
    expect(container.querySelector(".ns-lifecycle"), "an Account has no lifecycle to draw").toBeNull();
    expect(container.textContent).toMatch(/status is a field someone sets, not a stage it moves through/i);
  });

  it("no status value is ever drawn as a reached or future stage", () => {
    for (const status of ["ACTIVE", "INACTIVE", "PROSPECT", "ARCHIVED"]) {
      const { container, unmount } = mount({ status });
      expect(container.querySelectorAll(".ns-chip")).toHaveLength(0);
      unmount();
    }
  });

  // ─────────────── R02 / R03 / R04

  it("the account's NAME is the page's one h1", () => {
    const { container } = mount();
    const headings = container.querySelectorAll("h1");
    expect(headings).toHaveLength(1);
    expect(headings[0].textContent).toBe("Harbor Grill Restaurant Group");
  });

  it("a nameless account states the absence and never falls back to the document id", () => {
    const { container } = mount({ name: null });
    const h1 = container.querySelector("h1");
    expect(h1.textContent).toMatch(/no name recorded/i);
    expect(container.textContent).not.toContain(DOC_ID);
  });

  it("no document id appears anywhere on the page", () => {
    for (const overrides of [{}, { name: null }, { status: "ARCHIVED" }, { relationshipTypes: [], lineOfBusiness: [] }]) {
      const { container, unmount } = mount(overrides);
      expect(container.textContent, `id leaked with ${JSON.stringify(overrides)}`).not.toContain(DOC_ID);
      unmount();
    }
  });

  it("the status renders as a sentence and its machine value never appears", () => {
    for (const [status, sentence] of [
      ["ACTIVE", /Active — trading normally/],
      ["INACTIVE", /Inactive — no longer trading/],
      ["PROSPECT", /Prospect — not yet a customer/],
      ["ARCHIVED", /Archived — closed/],
    ]) {
      const { container, unmount } = mount({ status });
      expect(container.querySelector(".ns-identity").textContent).toMatch(sentence);
      expect(container.textContent, `${status} leaked as an enum`).not.toContain(status);
      unmount();
    }
  });

  it("the status is stated ONCE — the header sentence, and not as a pill beside it", () => {
    const { container } = mount();
    expect(container.textContent.split("Active — trading normally").length - 1).toBe(1);
    // The old composition put a StatusPill row above the ContextBand. Nothing may restore it.
    expect(container.querySelector(".fo-pill-row")).toBeNull();
  });

  // ─────────────── classification

  it("the classification renders as words IN THE KICKER, and an account with none renders nothing", () => {
    const withBoth = mount({ relationshipTypes: ["CUSTOMER", "VENDOR"], lineOfBusiness: ["TAYLOR", "VENTANA"] });
    // Account North Star P1 moves the classification out of the fact row and into the kicker:
    // it is identity ("what kind of account is this"), not a detail about the record.
    expect(withBoth.container.querySelector(".ns-identity__kicker").textContent)
      .toBe("Customer · Vendor · Taylor · Ventana");
    withBoth.unmount();

    const withNone = mount({ relationshipTypes: [], lineOfBusiness: [] });
    expect(withNone.container.textContent).not.toMatch(/Vendor|Ventana/);
    // Never a silent default to the first value of either vocabulary. The record-family word
    // stands alone; no line of business is invented for an account that declares none.
    expect(withNone.container.querySelector(".ns-identity__kicker").textContent).toBe("Customer");
    expect(withNone.container.querySelector(".ns-identity").textContent).not.toMatch(/\bTaylor\b/);
  });

  it("the record-family word is never printed twice when it is also the relationship", () => {
    const { container } = mount({ relationshipTypes: ["CUSTOMER"], lineOfBusiness: ["TAYLOR"] });
    expect(container.querySelector(".ns-identity__kicker").textContent).toBe("Customer · Taylor");
  });

  // ─────────────── the shell obligation

  it("the page composes ns-page and does not also host the workspace shell", () => {
    const { container } = mount();
    expect(container.querySelector(".ns-page")).toBeTruthy();
    expect(container.querySelector(".ns-record-body")).toBeTruthy();
    expect(container.querySelector(".ns-rail")).toBeTruthy();
    // Two shells would double the chrome and give the page two competing h1 claims (ND-4).
    expect(container.querySelectorAll("h1")).toHaveLength(1);
  });
});
