// CUSTOMERS — the /customers list on the canonical structured object-list experience.
//
// The first migration after the object-list metadata convergence (ADR-013), and the one where the
// query layer has something genuinely hard to be honest about: `relationshipTypes` and
// `lineOfBusiness` are BOTH arrays, Firestore serves one array filter per query, and "customers on
// the Taylor line" is the first thing anybody would ask of them together.
//
// What is real here: the component, the canonical controls, the Account definition, the query
// descriptor builder and the URL-state parser. The Firestore read, the portfolio-summary callable,
// the employee directory and the search are faked — so a failure means the metadata and the screen
// actually disagree.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";

const h = vi.hoisted(() => ({
  rows: [],
  hasMore: false,
  params: new URLSearchParams(),
  setSearchParams: null,
  lastRequest: null,
  summary: { total: 103, byStatus: { ACTIVE: 80, PROSPECT: 12, INACTIVE: 8, ARCHIVED: 3 }, unclassified: 0 },
  summaryState: "READY",
  directory: null,
}));

// The REAL runtime is used for the descriptor, so an unservable request is refused here exactly as
// it would be in production. Only the fetch is faked.
vi.mock("../src/hooks/useMetadataList", async () => {
  const { buildQueryDescriptor } = await import("../src/metadata/listRuntime.js");
  const { buildListPresentation } = await import("../src/metadata/listPresentation.js");
  return {
    useMetadataList: (def, entity, { filters = [], sort = [], resolveReference = null } = {}) => {
      const { descriptor, errors } = buildQueryDescriptor(def, entity, { filters, sort });
      h.lastRequest = { descriptor, errors, filters, sort };
      return {
        presentation: buildListPresentation({
          def, entity,
          page: descriptor ? { rows: h.rows, hasMore: h.hasMore } : null,
          loading: false,
          errorStatus: null,
          filtersActive: filters.length > 0,
          resolveReference,
        }),
        loadMore: vi.fn(),
        retry: vi.fn(),
        descriptorErrors: errors,
      };
    },
  };
});
vi.mock("../src/hooks/useAccountPortfolioSummary", () => ({
  useAccountPortfolioSummary: () => ({ summary: h.summary, state: h.summaryState, retry: vi.fn() }),
}));
vi.mock("../src/hooks/useAccountSearch", () => ({
  useAccountSearch: () => ({ state: "IDLE", results: [], message: "", truncated: false }),
}));
vi.mock("../src/hooks/useEmployeeDirectory", () => ({
  useEmployeeDirectory: () => h.directory,
}));
vi.mock("../src/domain/accounts", () => ({ createAccount: vi.fn() }));
vi.mock("react-router-dom", async (orig) => {
  const actual = await orig();
  return {
    ...actual,
    useNavigate: () => vi.fn(),
    useSearchParams: () => [h.params, (h.setSearchParams = h.setSearchParams ?? vi.fn())],
  };
});

import AccountsList from "../src/modules/accounts/AccountsList.jsx";
import { accountEntity, accountIndexList } from "../src/metadata/definitions/account.js";

const ROWS = [
  {
    id: "acct-harbor", name: "Harbor Grill Restaurant Group", status: "ACTIVE",
    relationshipTypes: ["CUSTOMER"], lineOfBusiness: ["TAYLOR", "VENTANA"],
    accountOwnerEmployeeId: "cw-emp-013", tags: ["key"],
    createdAt: 1755000000000, updatedAt: 1756000000000,
  },
  {
    id: "acct-mesquite", name: "Mesquite Soda Works", status: "PROSPECT",
    relationshipTypes: ["CUSTOMER", "VENDOR"], lineOfBusiness: ["VENTANA"],
    accountOwnerEmployeeId: "cw-emp-999", tags: [],
    createdAt: 1754000000000, updatedAt: 1755500000000,
  },
];

function setup({ rows = ROWS, search = "", hasMore = false, directory } = {}) {
  h.rows = rows;
  h.hasMore = hasMore;
  h.params = new URLSearchParams(search);
  h.setSearchParams = vi.fn();
  h.lastRequest = null;
  h.directory = directory ?? {
    loading: false,
    byEmployeeId: new Map([["cw-emp-013", { displayName: "Freya Vance" }]]),
    byUserId: new Map(),
  };
  return render(<AccountsList />);
}

afterEach(cleanup);

// ═════════════════════════════════════════ identity and fields

describe("Account identity and fields", () => {
  it("shows the customer NAME, and no document id anywhere in the rows", async () => {
    const { container } = setup();
    await screen.findByText("Harbor Grill Restaurant Group");

    const cells = [...container.querySelectorAll("td")].map((td) => td.textContent).join(" | ");
    // ACCOUNT NUMBER NOT AUTHORITATIVE, and the document id is never an identity.
    expect(cells).not.toMatch(/\bacct-/);
    expect(cells).not.toMatch(/\bcw-emp-/);
    expect(cells).toContain("Harbor Grill Restaurant Group");
  });

  it("renders arrays as human labels, not as machine tokens joined together", async () => {
    const { container } = setup();
    await screen.findByText("Harbor Grill Restaurant Group");
    // An ENUM_SET rendered as-is prints "TAYLORVENTANA". Both members resolve.
    expect(container.textContent).toContain("Taylor, Ventana");
    expect(container.textContent).toContain("Customer, Vendor");
    expect(container.textContent).not.toMatch(/\bTAYLOR\b/);
    expect(container.textContent).not.toMatch(/\bVENDOR\b/);
  });

  it("Prospect is a STATUS, shown in the status column like any other", async () => {
    setup();
    await screen.findByText("Mesquite Soda Works");
    // Not a type, not a separate collection, not a badge somewhere else.
    expect(screen.getAllByText("Prospect").length).toBeGreaterThan(0);
  });

  it("the OWNER resolves to a current employee name", async () => {
    const { container } = setup();
    await screen.findByText("Harbor Grill Restaurant Group");
    expect(container.textContent).toContain("Freya Vance");
  });

  it("an owner who no longer resolves reads as gone — never as an employee id", async () => {
    const { container } = setup();
    await screen.findByText("Mesquite Soda Works");
    // cw-emp-999 is not in the directory. The row must say something true and show no key.
    expect(container.textContent).not.toContain("cw-emp-999");
    expect(container.textContent).toMatch(/no longer exists/i);
  });

  it("a directory still loading says LOADING rather than claiming the owner is missing", async () => {
    const { container } = setup({ directory: { loading: true, byEmployeeId: new Map(), byUserId: new Map() } });
    await screen.findByText("Harbor Grill Restaurant Group");
    // "Not yet arrived" and "does not exist" are different facts about an owner.
    expect(container.textContent).toMatch(/Loading/);
    expect(container.textContent).not.toMatch(/no longer exists/i);
  });
});

// ═════════════════════════════════════════ the controls

describe("the controls come from Account metadata", () => {
  it("offers exactly the filters the list declares, and no screen-local extras", async () => {
    setup();
    await screen.findByText("Harbor Grill Restaurant Group");
    fireEvent.click(screen.getByRole("button", { name: /add filter/i }));

    const offered = [...screen.getByLabelText(/^field$/i).querySelectorAll("option")]
      .map((o) => o.value).filter(Boolean);
    expect(offered.slice().sort()).toEqual(accountIndexList.filters.map((f) => f.fieldId).sort());
    expect(offered).toContain("lineOfBusiness");
  });

  it("the value picker shows human labels, never enum tokens", async () => {
    setup();
    await screen.findByText("Harbor Grill Restaurant Group");
    fireEvent.click(screen.getByRole("button", { name: /add filter/i }));
    fireEvent.change(screen.getByLabelText(/^field$/i), { target: { value: "lineOfBusiness" } });

    const values = [...(await screen.findByLabelText(/^value$/i)).querySelectorAll("option")]
      .map((o) => o.textContent).filter((t) => t !== "Choose a value…");
    expect(values).toEqual(["Taylor", "Ventana"]);
  });

  it("offers no sort on an array field — an array has no order to sort by", async () => {
    setup();
    await screen.findByText("Harbor Grill Restaurant Group");
    const sortFields = [...screen.getByLabelText(/^sort$/i).querySelectorAll("option")]
      .map((o) => o.value).filter(Boolean).map((v) => v.split(":")[0]);
    expect(sortFields).not.toContain("relationshipTypes");
    expect(sortFields).not.toContain("lineOfBusiness");
    // And no sort by a name that lives on another document.
    expect(sortFields).not.toContain("accountOwnerEmployeeId");
  });

  it("status sorting says GROUPED, because the lifecycle order is not executable", async () => {
    setup();
    await screen.findByText("Harbor Grill Restaurant Group");
    const labels = [...screen.getByLabelText(/^sort$/i).querySelectorAll("option")].map((o) => o.textContent);
    const statusLabels = labels.filter((l) => l.startsWith("Status"));
    expect(statusLabels.length).toBeGreaterThan(0);
    // Firestore orders by the stored string. "First to last" would read as the lifecycle and
    // deliver the alphabet.
    expect(statusLabels.join(" ")).not.toMatch(/first to last/i);
    expect(statusLabels.join(" ")).toMatch(/grouped/i);
  });

  it("a chosen filter goes to the URL", async () => {
    setup();
    await screen.findByText("Harbor Grill Restaurant Group");
    fireEvent.click(screen.getByRole("button", { name: /add filter/i }));
    fireEvent.change(screen.getByLabelText(/^field$/i), { target: { value: "status" } });
    fireEvent.change(await screen.findByLabelText(/^value$/i), { target: { value: "ACTIVE" } });
    fireEvent.click(screen.getByRole("button", { name: /^apply$/i }));

    await waitFor(() => expect(h.setSearchParams).toHaveBeenCalled());
    expect(h.setSearchParams.mock.calls[0][0].toString()).toMatch(/status/);
  });

  it("an active filter is a visible, individually removable chip", async () => {
    setup({ search: "f=lineOfBusiness:ARRAY_CONTAINS:VENTANA" });
    await screen.findByText("Harbor Grill Restaurant Group");
    const chips = [...document.querySelectorAll(".fo-listctl__chip")];
    expect(chips).toHaveLength(1);
    expect(chips[0].textContent).toContain("Line of Business: Ventana");
    // Removable on its own, not only via a "clear everything".
    expect(screen.getByRole("button", { name: /Remove filter Line of Business/i })).toBeTruthy();
  });
});

// ═════════════════════════════════════════ THE ARRAY LIMIT

describe("two array filters — the honest refusal", () => {
  it("Relationship ALONE is executed", async () => {
    setup({ search: "f=relationshipTypes:ARRAY_CONTAINS:CUSTOMER" });
    await screen.findByText("Harbor Grill Restaurant Group");
    expect(h.lastRequest.descriptor.filters).toEqual([
      { fieldId: "relationshipTypes", operator: "ARRAY_CONTAINS", value: "CUSTOMER" },
    ]);
  });

  it("Line of Business ALONE is executed", async () => {
    setup({ search: "f=lineOfBusiness:ARRAY_CONTAINS:TAYLOR" });
    await screen.findByText("Harbor Grill Restaurant Group");
    expect(h.lastRequest.descriptor.filters).toEqual([
      { fieldId: "lineOfBusiness", operator: "ARRAY_CONTAINS", value: "TAYLOR" },
    ]);
  });

  it("BOTH TOGETHER is refused whole, and said out loud", async () => {
    setup({ search: "f=relationshipTypes:ARRAY_CONTAINS:CUSTOMER&f=lineOfBusiness:ARRAY_CONTAINS:TAYLOR" });
    const notice = await screen.findByRole("status", { name: /criteria not applied/i });

    // NO DESCRIPTOR AT ALL. Firestore permits one array filter per query and no index changes
    // that, so the request is rejected rather than half-applied.
    expect(h.lastRequest.descriptor).toBeNull();
    expect(h.lastRequest.errors.some((e) => e.kind === "MULTIPLE_ARRAY_FILTERS")).toBe(true);

    // BUSINESS LANGUAGE. The runtime's own message names the database, the field ids and an index
    // concept — all true, none of it for a person choosing customers.
    expect(notice.textContent).toMatch(/only one of these can be used at a time/i);
    expect(notice.textContent).not.toMatch(/firestore/i);
    expect(notice.textContent).not.toMatch(/index/i);
    expect(notice.textContent).not.toMatch(/lineOfBusiness/);
    // A REFUSAL and a DROP get different words. Nothing runs, so nothing is shown -- calling an
    // empty screen "broader than requested" would describe the opposite of what is on it.
    expect(notice.textContent).toMatch(/no customers are shown/i);
    expect(notice.textContent).toMatch(/Remove one of them/i);
    expect(notice.textContent).not.toMatch(/broader than requested/i);
    // And no doubled full stop where the runtime message already ended in one.
    expect(notice.textContent).not.toContain("..");
  });

  it("neither array filter is silently preferred over the other", async () => {
    setup({ search: "f=lineOfBusiness:ARRAY_CONTAINS:TAYLOR&f=relationshipTypes:ARRAY_CONTAINS:VENDOR" });
    await screen.findByRole("status", { name: /criteria not applied/i });
    // Applying whichever came first would return a set that does not match what was asked for,
    // while looking as though it did — the worst available outcome.
    expect(h.lastRequest.descriptor).toBeNull();
  });

  it("status + ONE array filter is fine — the limit is on arrays, not on filters", async () => {
    setup({ search: "f=status:EQUALS:ACTIVE&f=lineOfBusiness:ARRAY_CONTAINS:TAYLOR" });
    await screen.findByText("Harbor Grill Restaurant Group");
    expect(h.lastRequest.errors).toEqual([]);
    expect(h.lastRequest.descriptor.filters).toHaveLength(2);
  });
});

// ═════════════════════════════════════════ preserved behaviour

describe("what the existing Customers page already did well", () => {
  it("the portfolio cards remain WHOLE-BOOK claims, not page counts", async () => {
    setup({ rows: [ROWS[0]] });
    await screen.findByText("Harbor Grill Restaurant Group");
    // One row on the page; the cards still report the book. Deriving them from the page would
    // produce numbers smaller than the truth while still labelled "Total".
    expect(screen.getByText("103")).toBeTruthy();
    expect(screen.getByText("80")).toBeTruthy();
  });

  it("an unavailable summary shows a dash, never a zero", async () => {
    h.summaryState = "DENIED";
    try {
      setup();
      await screen.findByText("Harbor Grill Restaurant Group");
      // "0 Active" is a claim about the business; "—" is a claim about the read.
      expect(screen.getAllByText("—").length).toBeGreaterThan(0);
      expect(screen.getByText(/Portfolio totals are not available to you/i)).toBeTruthy();
    } finally {
      h.summaryState = "READY";
    }
  });

  it("a portfolio card applies a real status criterion, through the same path as Add Filter", async () => {
    setup();
    await screen.findByText("Harbor Grill Restaurant Group");
    fireEvent.click(screen.getByRole("button", { name: /Prospect/i }));
    await waitFor(() => expect(h.setSearchParams).toHaveBeenCalled());
    // The cards and the chips cannot disagree about what is applied, because there is one source.
    expect(h.setSearchParams.mock.calls[0][0].toString()).toMatch(/status.*PROSPECT/);
  });

  it("the silent-truncation warning still fires, and only when nothing is filtered", async () => {
    setup({ rows: [ROWS[0]] });
    await screen.findByText("Harbor Grill Restaurant Group");
    // The default sort is updatedAt DESC, and Firestore's orderBy EXCLUDES documents missing the
    // ordered field. 1 row against a book of 103 is not an empty business.
    expect(screen.getByText(/Showing 1 of 103 customers/i)).toBeTruthy();

    cleanup();
    setup({ rows: [ROWS[0]], search: "f=status:EQUALS:ACTIVE" });
    await screen.findByText("Harbor Grill Restaurant Group");
    // Filtered, a short list is expected — the warning would be noise.
    expect(screen.queryByText(/Showing 1 of 103 customers/i)).toBeNull();
  });

  it("prefix search on the name is still offered, and still says what it matches", async () => {
    setup();
    await screen.findByText("Harbor Grill Restaurant Group");
    const box = screen.getByRole("searchbox");
    // The copy says "starts with" because that is what nameLower can actually serve. Promising
    // substring search would be promising a scan of the collection.
    expect(box.getAttribute("aria-label")).toMatch(/starting with/i);
  });
});

// ═════════════════════════════════════════ empty states and paging

describe("which kind of empty", () => {
  it("filtered to nothing reads as filtered", async () => {
    setup({ rows: [], search: "f=status:EQUALS:ARCHIVED" });
    expect(await screen.findByText(/no records match these filters/i)).toBeTruthy();
    expect(screen.queryByText(/A customer is the account everything else hangs off/i)).toBeNull();
  });

  it("a genuinely empty book of business shows the guidance instead", async () => {
    setup({ rows: [] });
    expect(await screen.findByText(/A customer is the account everything else hangs off/i)).toBeTruthy();
  });
});

describe("the read stays bounded", () => {
  it("every request carries a limit and the declared page size", async () => {
    setup();
    await screen.findByText("Harbor Grill Restaurant Group");
    expect(h.lastRequest.descriptor.pageSize).toBe(accountIndexList.pageSize);
    expect(h.lastRequest.descriptor.limit).toBe(accountIndexList.pageSize + 1);
  });

  it("the default sort is PRESERVED — most recently touched first", async () => {
    setup();
    await screen.findByText("Harbor Grill Restaurant Group");
    expect(h.lastRequest.descriptor.sort[0]).toEqual({ fieldId: "updatedAt", direction: "DESC" });
    // And the tiebreaker follows its direction, which is what keeps the query on the index
    // Firestore maintains for free.
    expect(h.lastRequest.descriptor.sort[1]).toEqual({ fieldId: "__name__", direction: "DESC" });
  });

  it("a URL sort overrides the default", async () => {
    setup({ search: "sort=nameLower:ASC" });
    await screen.findByText("Harbor Grill Restaurant Group");
    // Name ordering runs on nameLower: Firestore cannot compare case-insensitively, so sorting the
    // display name would put "apex" after "Zephyr".
    expect(h.lastRequest.descriptor.sort[0]).toEqual({ fieldId: "nameLower", direction: "ASC" });
  });
});

// ═════════════════════════════════════════ on a phone

describe("Customers on a 320px phone", () => {
  const css = readFileSync(path.resolve(process.cwd(), "src/index.css"), "utf8");

  it("rows become LABELLED CARDS, not a table you drag sideways", async () => {
    setup();
    await screen.findByText("Harbor Grill Restaurant Group");
    // The shared grid carries fo-table--stack, which recomposes each row into a card below the
    // phone breakpoint. This is the thing the Parts list does NOT do, and why its 8-column table
    // compressed to an unreadable 226px row.
    expect(document.querySelector("table.fo-table--stack")).toBeTruthy();
    expect(css).toMatch(/\.fo-table--stack, \.fo-table--stack tbody, \.fo-table--stack tr, \.fo-table--stack td \{ display: block; \}/);
  });

  it("every card cell carries its column heading, so a value is never orphaned", async () => {
    const { container } = setup();
    await screen.findByText("Harbor Grill Restaurant Group");
    const labels = [...container.querySelectorAll("td[data-label]")].map((td) => td.getAttribute("data-label"));
    // Field semantics survive the rearrangement: a card is the same fields, stacked, never
    // "Harbor Grill · Active · Customer · Taylor · Freya".
    for (const heading of ["Customer", "Status", "Relationship", "Line of Business", "Owner"]) {
      expect(labels, heading).toContain(heading);
    }
  });

  it("the list's own controls are all at least 44px", () => {
    for (const rule of [
      ".fo-listctl__add { min-height: 44px; }",
      ".fo-listctl__clear { min-height: 44px; }",
    ]) {
      expect(css, rule).toContain(rule);
    }
    expect(css).toMatch(/\.fo-listctl__step select[^}]*min-height: 44px/);
  });
});

// ═════════════════════════════════════════ Lists P2 conformance (Phase 4)

describe("Lists P2 — Customers on the shared collection grammar", () => {
  const SCREEN = readFileSync(path.resolve(process.cwd(), "src/modules/accounts/AccountsList.jsx"), "utf8");

  it("wears the COLLECTION header, not the workspace shell", () => {
    // The first page to cross the line the third membership list was added to make crossable.
    // WorkspaceShell and WorkspaceIdentity are mutually exclusive: run together they double the
    // chrome and both claim the h1 (ND-4).
    expect(SCREEN).toMatch(/import WorkspaceIdentity from/);
    expect(SCREEN).not.toMatch(/^import WorkspaceShell from/m);
    expect(SCREEN).not.toMatch(/^import ActionRail from/m);
    expect(SCREEN).toMatch(/<WorkspaceIdentity/);
  });

  it("the header count is the FILTERED aggregate, and the portfolio total stays with its cards", () => {
    // Two governed counts exist on this page and they answer different questions. The aggregate
    // follows the current filters, so it describes the rows below it; the portfolio total describes
    // the whole book of business. Printing the portfolio total above a filtered list would be a
    // collection-wide number sitting directly over a subset — true, and read as a lie.
    expect(SCREEN).toMatch(/count=\{typeof total === "number" \? total : null\}/);
    expect(SCREEN).not.toMatch(/count=\{summary/);
  });

  it("the summary line is EMPTY, because the portfolio cards already are the summary", () => {
    // Repeating four governed counts as a summary line is the duplicated lifecycle state the
    // density rule names — in a smaller font.
    expect(SCREEN).toMatch(/summaryItems=\{\[\]\}/);
  });

  it("an unavailable portfolio count is a dash, never a zero", () => {
    // Unchanged, and re-asserted because a shared header is exactly when somebody normalises a
    // dash into a 0 "for consistency". "0 Active" is a claim about the business; "—" is a claim
    // about the read.
    //
    // THE RENDERING MOVED; THE INVARIANT DID NOT. The portfolio counts are chips on the shared
    // FilterBar now, so the dash is produced there. That splits the guarantee across two files,
    // and asserting only one half would leave the other free to break: this page could start
    // reporting 0 for an unread summary, or the primitive could start printing that 0. Both
    // halves are named. The behavioural proof is the DENIED render test above — this pair is
    // here so the failure says WHICH half moved.
    expect(SCREEN).toMatch(/if \(summaryState !== "READY" \|\| !summary\) return null;/);
    const primitive = readFileSync(path.resolve(process.cwd(), "src/shared/ui/FilterBar.jsx"), "utf8");
    expect(primitive).toMatch(/count === null \? "—" : /);
  });

  it("the row destination comes from the definition", () => {
    expect(SCREEN).toMatch(/buildRowHref\(accountIndexList\.rowNavigationTo, id\)/);
    expect(SCREEN).not.toMatch(/navigate\(`\/customers\/\$\{id\}`\)/);
  });

  it("DEGRADED covers a failed owner-name read, and only on a populated one", () => {
    expect(SCREEN).toMatch(/directory\.error/);
    expect(SCREEN).toMatch(/HONEST_STATE\.DEGRADED/);
    expect(SCREEN).toMatch(/degraded && presentation\?\.state === "READY"/);
  });

  it("PROSPECT is still a status card, not a family", () => {
    // A-D4: a prospect is an Account with a status, composed on the same page. A Lists migration is
    // exactly where somebody might promote it to its own collection because the design board shows
    // families as tabs.
    expect(SCREEN).toMatch(/ACCOUNT_STATUS\.PROSPECT/);
    expect(SCREEN).not.toMatch(/prospectIndexList|prospectEntity/);
  });

  it("the silent-truncation guard survives the header change", () => {
    // The defect it exists for: the default sort is `updatedAt DESC`, Firestore's orderBy silently
    // excludes documents missing the field, and 101 of 103 customers vanished while the header
    // still read "103 Total". Re-checked because this migration moved the header that printed it.
    expect(SCREEN).toMatch(/cannot appear here/);
    expect(SCREEN).toMatch(/presentation\.rows\.length < summary\.total/);
  });
});
