// THE STRUCTURED PART LIST, ON SCREEN.
//
// Separate from test/partsStructuredList.test.jsx on purpose: that file remocks Firestore per case,
// and doing that alongside eight React renders accumulates eight full module graphs and exhausts the
// heap. Here the mocks are hoisted ONCE and driven through a mutable holder, so every case renders
// against the same graph.
//
// What is real: the component, the shared list controls, the Part field metadata, and the list-state
// module. Only the read and the write-readiness hook are faked — so the assertions below are about
// what the actual screen renders from actual metadata.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  page: { ok: true, parts: [], invalid: [], hasMore: false, nextCursor: null },
  params: new URLSearchParams(),
  setSearchParams: null,
  fetchPartMasterPage: null,
}));

vi.mock("../src/services/partMasterQueries", () => ({
  fetchPartMasterPage: (h.fetchPartMasterPage = vi.fn(() => Promise.resolve(h.page))),
  PARTS_PAGE_SIZE: 50,
}));
vi.mock("../src/hooks/usePartMasterWrite", () => ({
  usePartMasterWrite: () => ({
    writeReady: false, runCreate: vi.fn(), runUpdate: vi.fn(), runChangeStatus: vi.fn(),
  }),
}));
vi.mock("react-router-dom", async (orig) => {
  const actual = await orig();
  return {
    ...actual,
    useSearchParams: () => [h.params, (h.setSearchParams = h.setSearchParams ?? vi.fn())],
    Link: ({ children }) => children,
  };
});

import PartMasterList from "../src/modules/inventory/PartMasterList.jsx";

// Two REAL business part numbers in the shapes this catalogue actually mints. Both must survive every
// id check below untouched — a guard that rejects PRT-1001 is a guard nobody keeps.
const PART_ROWS = [
  {
    partId: "p1", version: 1, internalPartNumber: "PRT-1001", name: "Beater assembly",
    category: "Drive", status: "ACTIVE", stockingUnit: "EACH", controlType: "STANDARD",
    stockingClass: "STOCKED",
  },
  {
    partId: "p2", version: 1, internalPartNumber: "CW-P-0004", name: "Compressor",
    category: "Refrigeration", status: "SUPERSEDED", stockingUnit: "EACH",
    controlType: "SERIALIZED", stockingClass: "NON_STOCK",
  },
];

function setup({ page, search = "" } = {}) {
  h.page = page ?? { ok: true, parts: PART_ROWS, invalid: [], hasMore: false, nextCursor: null };
  h.params = new URLSearchParams(search);
  h.setSearchParams = vi.fn();
  h.fetchPartMasterPage.mockClear();
  h.fetchPartMasterPage.mockImplementation(() => Promise.resolve(h.page));
  return render(<PartMasterList />);
}

afterEach(cleanup);

describe("the Part list renders business words, not storage tokens", () => {
  it("shows the human label and keeps the canonical value on the cell", async () => {
    const { container } = setup();
    await screen.findByText("PRT-1001");

    expect(screen.getByText("Quantity")).toBeTruthy();   // STANDARD
    expect(screen.getByText("Serialized")).toBeTruthy();
    expect(screen.getByText("Non-stock")).toBeTruthy();  // NON_STOCK
    expect(screen.getByText("Superseded")).toBeTruthy();

    // Nobody is shown a raw enum token...
    expect(container.textContent).not.toMatch(/\bNON_STOCK\b/);
    expect(container.textContent).not.toMatch(/\bSTANDARD\b/);
    // ...and the canonical value is still on the element, so a filter, a sort or a test reaches the
    // enum rather than the phrasing. Losing that is how a label becomes the de facto data.
    expect(container.querySelector('[data-raw="NON_STOCK"]')).toBeTruthy();
    expect(container.querySelector('[data-raw="STANDARD"]')).toBeTruthy();
    expect(container.querySelector('[data-raw="SUPERSEDED"]')).toBeTruthy();
  });

  it("headings are the metadata's labels, not abbreviations of them", async () => {
    setup();
    await screen.findByText("PRT-1001");
    for (const label of ["Part Number", "Description", "Tracking", "Stocking Class", "Status"]) {
      expect(screen.getByRole("columnheader", { name: label }), label).toBeTruthy();
    }
    // "Control" and "Class" were the old headings. Neither names the concept.
    expect(screen.queryByRole("columnheader", { name: "Control" })).toBeNull();
  });

  it("business identifiers appear verbatim and DOCUMENT ids never appear at all", async () => {
    const { container } = setup();
    await screen.findByText("PRT-1001");
    expect(screen.getByText("CW-P-0004")).toBeTruthy();

    // The rendered VALUES, read individually: `container.textContent` would concatenate a heading
    // with a cell and destroy the word boundary these checks depend on.
    const cells = [...container.querySelectorAll("td")].map((td) => td.textContent).join(" | ");
    expect(cells).not.toMatch(/\bp1\b/);
    expect(cells).not.toMatch(/\bp2\b/);
    // And the identifiers that LOOK id-shaped but are business identity survive.
    expect(cells).toMatch(/PRT-1001/);
    expect(cells).toMatch(/CW-P-0004/);
  });
});

describe("the shared controls are mounted in the ACTUAL list", () => {
  it("offers Add Filter and Sort, built from the Part metadata", async () => {
    setup();
    await screen.findByText("PRT-1001");
    expect(screen.getByRole("button", { name: /add filter/i })).toBeTruthy();
    expect(screen.getByLabelText(/^sort$/i)).toBeTruthy();
  });

  it("a chosen filter goes to the URL — not to a client-side pass over the rows", async () => {
    setup();
    await screen.findByText("PRT-1001");
    fireEvent.click(screen.getByRole("button", { name: /add filter/i }));

    fireEvent.change(screen.getByLabelText(/^field$/i), { target: { value: "status" } });
    // The value control is a PICKER of human labels for an enum, so Apply stays disabled until a real
    // canonical value is chosen.
    fireEvent.change(await screen.findByLabelText(/^value$/i), { target: { value: "ACTIVE" } });
    fireEvent.click(screen.getByRole("button", { name: /^apply$/i }));
    await waitFor(() => expect(h.setSearchParams).toHaveBeenCalled());
    expect(h.setSearchParams.mock.calls[0][0].toString()).toMatch(/status/);
  });

  it("an active filter shows as a removable chip in business words", async () => {
    setup({ search: "f=status:IS:ACTIVE" });
    await screen.findByText("PRT-1001");
    const chips = [...document.querySelectorAll(".fo-listctl__chip")].map((c) => c.textContent).join(" ");
    expect(chips).toMatch(/Status/i);
    // From a URL there is no captured valueLabel, so the chip has to RE-RESOLVE the label from the
    // picker options. Without that this reads "Status: ACTIVE" -- a storage token, shown only to the
    // people who bookmarked or shared their view.
    expect(chips).toMatch(/Active/);
    expect(chips).not.toMatch(/ACTIVE/);
  });

  it("an unqueryable criterion is SAID, not silently dropped", async () => {
    // `name contains valve` is NEEDS_INDEX: Firestore has no substring search. A filter that looks
    // applied and is not makes the catalogue look smaller than it is.
    setup({ search: "f=name:CONTAINS:valve" });
    expect(await screen.findByText(/can’t be applied to this list/i)).toBeTruthy();
  });
});

describe("the list says which kind of empty it is", () => {
  it("filtered to nothing reads as filtered, not as an empty catalogue", async () => {
    setup({
      page: { ok: true, parts: [], invalid: [], hasMore: false, nextCursor: null },
      search: "f=status:IS:DISCONTINUED",
    });
    expect(await screen.findByText(/no .*match/i)).toBeTruthy();
    // Telling somebody the catalogue is empty when they filtered it empty sends them hunting a bug
    // that is not there.
    expect(screen.queryByText(/No canonical Part records exist yet/i)).toBeNull();
  });

  it("a genuinely empty catalogue says so", async () => {
    setup({ page: { ok: true, parts: [], invalid: [], hasMore: false, nextCursor: null } });
    expect(await screen.findByText(/No canonical Part records exist yet/i)).toBeTruthy();
  });

  it("a denied read says denied — never an empty Part Master", async () => {
    setup({ page: { ok: false, code: "permission-denied" } });
    expect(await screen.findByText(/do not have access to the Part Master/i)).toBeTruthy();
  });
});

describe("paging", () => {
  it("a complete page offers no pager", async () => {
    setup();
    await screen.findByText("PRT-1001");
    expect(screen.queryByRole("button", { name: /load more parts/i })).toBeNull();
  });

  it("more pages offer a pager that CARRIES the cursor", async () => {
    setup({ page: { ok: true, parts: PART_ROWS, invalid: [], hasMore: true, nextCursor: ["PRT-1001", "p1"] } });
    await screen.findByText("PRT-1001");

    // Page 2 comes back with different rows, so appending is visible rather than assumed.
    h.page = {
      ok: true, hasMore: false, nextCursor: null, invalid: [],
      parts: [{ ...PART_ROWS[0], partId: "p3", internalPartNumber: "PRT-1099", name: "Seal kit" }],
    };
    fireEvent.click(screen.getByRole("button", { name: /load more parts/i }));

    await waitFor(() => expect(h.fetchPartMasterPage).toHaveBeenCalledTimes(2));
    expect(h.fetchPartMasterPage.mock.calls[1][0].cursor).toEqual(["PRT-1001", "p1"]);
    // Appended, not replaced: the page already on screen stays on screen.
    expect(await screen.findByText("PRT-1099")).toBeTruthy();
    expect(screen.getByText("PRT-1001")).toBeTruthy();
  });

  it("the first read is bounded — a plan with a page size, every time", async () => {
    setup();
    await screen.findByText("PRT-1001");
    const { plan, cursor } = h.fetchPartMasterPage.mock.calls[0][0];
    expect(plan.pageSize).toBe(50);
    expect(cursor).toBeNull();
  });
});

// ═════════════════════════════════════════ on a phone
//
// jsdom does not lay out, so pixel geometry cannot be measured here. What CAN be asserted — and what
// actually regresses — is the STRUCTURE that produces the geometry: which classes carry the sizing
// rules, that the rules are in the stylesheet, and that a wide table is inside something that
// scrolls instead of pushing the page sideways. Live measurement is recorded separately in the
// migration doc.

import { readFileSync } from "node:fs";
import path from "node:path";

const css = readFileSync(path.resolve(process.cwd(), "src/index.css"), "utf8");

describe("the Part list on a 320px phone", () => {
  it("every control the list adds is at least 44px tall", () => {
    for (const rule of [
      ".fo-listctl__add { min-height: 44px; }",
      ".fo-listctl__clear { min-height: 44px; }",
      ".fo-pml__pager button { min-height: 44px; }",
      // Found by MEASURING, not by reading: the row actions were 47x31 and 62x31. They predate the
      // list controls, so no 44px rule covered them and no structural assertion knew to look.
      ".fo-pml__actions button { min-height: 44px; min-width: 44px; }",
    ]) {
      expect(css, rule).toContain(rule);
    }
    // The builder's own selects and the sort select, which are the controls somebody uses one-handed.
    expect(css).toMatch(/\.fo-listctl__step select[^}]*min-height: 44px/);
    expect(css).toMatch(/\.fo-listctl__sort select \{ min-height: 44px; \}/);
  });

  it("the filter builder STACKS below the phone breakpoint instead of clipping", () => {
    expect(css).toMatch(/\.fo-listctl__builder \{ flex-direction: column/);
    expect(css).toMatch(/\.fo-listctl__step select, \.fo-listctl__step input \{ width: 100%; \}/);
  });

  it("the eight-column table scrolls INSIDE its own container, so the page never scrolls sideways", async () => {
    setup();
    await screen.findByText("PRT-1001");
    expect(document.querySelector(".fo-table-scroll table.fo-table")).toBeTruthy();
    // And no hardcoded pixel width in the markup that a 320px screen would clip.
    const src = readFileSync(path.resolve(process.cwd(), "src/modules/inventory/PartMasterList.jsx"), "utf8");
    expect(src).not.toMatch(/width:\s*\d{3,}px/);
  });

  it("the controls wrap rather than overflow", () => {
    expect(css).toMatch(/\.fo-listctl \{ display: flex; flex-wrap: wrap/);
    expect(css).toMatch(/\.fo-listctl__active \{ display: flex; flex-wrap: wrap/);
  });
});
