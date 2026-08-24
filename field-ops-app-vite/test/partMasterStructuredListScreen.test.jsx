// THE PART MASTER LIST, ON THE CANONICAL METADATA RUNTIME.
//
// After the object-list metadata convergence (ADR-013), this screen is a CONSUMER: its filters, its
// sort vocabulary, its labels and the bound on its read all come from `partEntity` / `partIndexList`
// and `metadata/listRuntime`. Nothing here is a screen-local registry, and that is what these
// assertions are really protecting.
//
// What is real: the component, the canonical controls, the canonical definitions, the query
// descriptor builder, and the URL-state parser. Only the Firestore read and the write-readiness hook
// are faked — so a failure here means the metadata and the screen actually disagree.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";

const h = vi.hoisted(() => ({
  page: { ok: true, parts: [], invalid: [], hasMore: false, nextCursor: null },
  params: new URLSearchParams(),
  setSearchParams: null,
  fetchPartMasterPage: null,
}));

vi.mock("../src/services/partMasterPageQuery", () => ({
  fetchPartMasterPage: (h.fetchPartMasterPage = vi.fn(() => Promise.resolve(h.page))),
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
import { partEntity, partIndexList } from "../src/metadata/definitions/part.js";

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

describe("the list renders business words, not storage tokens", () => {
  it("shows the human label and keeps the canonical value on the cell", async () => {
    const { container } = setup();
    await screen.findByText("PRT-1001");

    // Labels come from domain/partVocabulary.js — the ONE Part label authority. The retired pilot
    // kept a second map reading "Quantity" where this one reads "Standard", which is the
    // two-maps-for-one-enum split that put "0 Active" beside a table of ACTIVE rows in #1093.
    expect(screen.getByText("Standard")).toBeTruthy();
    expect(screen.getByText("Serialized")).toBeTruthy();
    expect(screen.getByText("Non-Stock")).toBeTruthy();
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

  it("column headings come from the metadata, so Sort and the table agree", async () => {
    setup();
    await screen.findByText("PRT-1001");
    const headings = [...document.querySelectorAll("th")].map((t) => t.textContent);
    for (const id of ["internalPartNumber", "name", "status", "controlType", "stockingClass"]) {
      const field = partEntity.fields.find((f) => f.id === id);
      expect(headings, id).toContain(field.label);
    }
    // The old hand-typed heading said "Description" over the `name` column while Sort offered
    // "Name — A to Z" for the same field, so a person sorting could not tell which column moved.
    expect(headings).toContain("Name");
  });

  it("business identifiers appear verbatim and DOCUMENT ids never appear at all", async () => {
    const { container } = setup();
    await screen.findByText("PRT-1001");
    expect(screen.getByText("CW-P-0004")).toBeTruthy();

    // The rendered CELLS, read individually: `container.textContent` would concatenate a heading with
    // a cell and destroy the word boundary these checks depend on.
    const cells = [...container.querySelectorAll("td")].map((td) => td.textContent).join(" | ");
    expect(cells).not.toMatch(/\bp1\b/);
    expect(cells).not.toMatch(/\bp2\b/);
    expect(cells).toMatch(/PRT-1001/);
    expect(cells).toMatch(/CW-P-0004/);
  });
});

describe("the controls come from metadata, not from this screen", () => {
  it("offers Add Filter and Sort", async () => {
    setup();
    await screen.findByText("PRT-1001");
    expect(screen.getByRole("button", { name: /add filter/i })).toBeTruthy();
    expect(screen.getByLabelText(/^sort$/i)).toBeTruthy();
  });

  it("offers EXACTLY the filters the list definition declares — no more", async () => {
    setup();
    await screen.findByText("PRT-1001");
    fireEvent.click(screen.getByRole("button", { name: /add filter/i }));

    const options = [...screen.getByLabelText(/^field$/i).querySelectorAll("option")]
      .map((o) => o.value).filter(Boolean);
    // The load-bearing assertion of the whole convergence. The declared set is what
    // scripts/listIndexCoverage.mjs proved a composite index for; the retired pilot ALSO offered
    // part number, tracking, unit and category, none of which had one — each would have failed at
    // read time with "index required" while CI stayed green.
    expect(options.slice().sort()).toEqual(partIndexList.filters.map((f) => f.fieldId).sort());
    expect(options).not.toContain("controlType");
    expect(options).not.toContain("category");
  });

  it("offers EXACTLY the sorts the entity declares sortable", async () => {
    setup();
    await screen.findByText("PRT-1001");
    const sortValues = [...screen.getByLabelText(/^sort$/i).querySelectorAll("option")]
      .map((o) => o.value).filter(Boolean).map((v) => v.split(":")[0]);
    const declared = partEntity.fields
      .filter((f) => f.sortable && f.displayable !== false).map((f) => f.id);
    expect([...new Set(sortValues)].sort()).toEqual([...new Set(declared)].sort());
  });

  it("explains a field a person can see but cannot filter", async () => {
    setup();
    await screen.findByText("PRT-1001");
    fireEvent.click(screen.getByRole("button", { name: /add filter/i }));
    // A disabled capability with no explanation is a dead end: nobody can tell whether to wait, ask,
    // or work around it. Category is NEEDS_INDEX and says so.
    expect(document.querySelector(".fo-listctl__why").textContent).toMatch(/index that has not been set up/i);
  });

  it("a chosen filter goes to the URL — not to a client-side pass over the rows", async () => {
    setup();
    await screen.findByText("PRT-1001");
    fireEvent.click(screen.getByRole("button", { name: /add filter/i }));

    fireEvent.change(screen.getByLabelText(/^field$/i), { target: { value: "status" } });
    fireEvent.change(await screen.findByLabelText(/^value$/i), { target: { value: "ACTIVE" } });
    fireEvent.click(screen.getByRole("button", { name: /^apply$/i }));

    await waitFor(() => expect(h.setSearchParams).toHaveBeenCalled());
    expect(h.setSearchParams.mock.calls[0][0].toString()).toMatch(/status/);
  });

  it("an active filter shows as a removable chip in business words", async () => {
    setup({ search: "f=status:EQUALS:ACTIVE" });
    await screen.findByText("PRT-1001");
    const chips = [...document.querySelectorAll(".fo-listctl__chip")].map((c) => c.textContent).join(" ");
    expect(chips).toMatch(/Status/i);
    // From a URL there is no captured valueLabel, so the chip re-resolves from the field's own
    // enumLabels. Without that this reads "Status: ACTIVE" — a storage token, shown only to the
    // people who bookmarked or shared their view.
    expect(chips).toMatch(/Active/);
    expect(chips).not.toMatch(/ACTIVE/);
  });
});

describe("a link that asks for something this build cannot do", () => {
  it("says the list is BROADER than requested rather than silently widening it", async () => {
    // `description` is declared NEEDS_INDEX: Firestore has no substring search.
    setup({ search: "f=description:EQUALS:valve" });
    const notice = await screen.findByRole("status", { name: /criteria not applied/i });
    expect(notice.textContent).toMatch(/broader than requested/i);
    expect(notice.textContent).toMatch(/Description/);
    // And it says WHY, not just that something was dropped.
    expect(notice.textContent).toMatch(/index that has not been set up/i);
  });

  it("a field this build no longer has is reported too, not ignored", async () => {
    setup({ search: "f=retiredField:EQUALS:x" });
    const notice = await screen.findByRole("status", { name: /criteria not applied/i });
    expect(notice.textContent).toMatch(/no longer available/i);
  });

  it("a clean link produces no notice — the report is not noise on the normal path", async () => {
    setup({ search: "f=status:EQUALS:ACTIVE" });
    await screen.findByText("PRT-1001");
    expect(screen.queryByRole("status", { name: /criteria not applied/i })).toBeNull();
  });
});

describe("the list says which kind of empty it is", () => {
  it("filtered to nothing reads as filtered, not as an empty catalogue", async () => {
    setup({
      page: { ok: true, parts: [], invalid: [], hasMore: false, nextCursor: null },
      search: "f=status:EQUALS:DISCONTINUED",
    });
    expect(await screen.findByText(/no records match these filters/i)).toBeTruthy();
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

describe("the read is bounded by the canonical runtime", () => {
  it("the first read carries a descriptor with a limit and no cursor", async () => {
    setup();
    await screen.findByText("PRT-1001");
    const { descriptor, cursor } = h.fetchPartMasterPage.mock.calls[0][0];
    // The descriptor ALWAYS carries a limit — the runtime has no argument that removes one. It is
    // pageSize + 1 on purpose: the extra row is how truncation is DETECTED rather than assumed, and
    // interpretPage is what keeps that probe row out of the rendered page.
    expect(descriptor.pageSize).toBe(partIndexList.pageSize);
    expect(descriptor.limit).toBe(partIndexList.pageSize + 1);
    expect(cursor).toBeNull();
  });

  it("a URL filter reaches the descriptor as a real query constraint", async () => {
    setup({ search: "f=status:EQUALS:ACTIVE" });
    await screen.findByText("PRT-1001");
    const { descriptor } = h.fetchPartMasterPage.mock.calls[0][0];
    expect(descriptor.filters).toEqual([{ fieldId: "status", operator: "EQUALS", value: "ACTIVE" }]);
  });

  it("an undeclared filter NEVER reaches the descriptor", async () => {
    setup({ search: "f=category:EQUALS:Drive" });
    await screen.findByText("PRT-1001");
    const { descriptor } = h.fetchPartMasterPage.mock.calls[0][0];
    // Parsed out at the URL, and refused again by buildQueryDescriptor if it ever got past. Two
    // gates, because this is the one that would otherwise fail in production.
    expect(descriptor.filters).toEqual([]);
  });

  it("a complete page offers no pager", async () => {
    setup();
    await screen.findByText("PRT-1001");
    expect(screen.queryByRole("button", { name: /load more parts/i })).toBeNull();
  });

  it("more pages offer a pager that CARRIES the cursor", async () => {
    setup({ page: { ok: true, parts: PART_ROWS, invalid: [], hasMore: true, nextCursor: ["PRT-1001"] } });
    await screen.findByText("PRT-1001");

    h.page = {
      ok: true, hasMore: false, nextCursor: null, invalid: [],
      parts: [{ ...PART_ROWS[0], partId: "p3", internalPartNumber: "PRT-1099", name: "Seal kit" }],
    };
    fireEvent.click(screen.getByRole("button", { name: /load more parts/i }));

    await waitFor(() => expect(h.fetchPartMasterPage).toHaveBeenCalledTimes(2));
    expect(h.fetchPartMasterPage.mock.calls[1][0].cursor).toEqual(["PRT-1001"]);
    // Appended, not replaced: the page already on screen stays on screen.
    expect(await screen.findByText("PRT-1099")).toBeTruthy();
    expect(screen.getByText("PRT-1001")).toBeTruthy();
  });
});

// ═════════════════════════════════════════ on a phone
//
// jsdom does not lay out, so pixel geometry cannot be measured here. What CAN be asserted — and what
// actually regresses — is the STRUCTURE that produces the geometry. The live four-width measurement
// is recorded in docs/architecture/parts-structured-list.md.

const css = readFileSync(path.resolve(process.cwd(), "src/index.css"), "utf8");

describe("the Part list on a 320px phone", () => {
  it("every control on the list is at least 44px tall", () => {
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
    expect(css).toMatch(/\.fo-listctl__step select[^}]*min-height: 44px/);
    expect(css).toMatch(/\.fo-listctl__sort select \{ min-height: 44px; \}/);
  });

  it("the filter builder STACKS below the phone breakpoint instead of clipping", () => {
    expect(css).toMatch(/\.fo-listctl__builder \{ flex-direction: column/);
    expect(css).toMatch(/\.fo-listctl__step select, \.fo-listctl__step input \{ width: 100%; \}/);
  });

  it("the table scrolls INSIDE its own container, so the page never scrolls sideways", async () => {
    setup();
    await screen.findByText("PRT-1001");
    expect(document.querySelector(".fo-table-scroll table.fo-table")).toBeTruthy();
    const src = readFileSync(path.resolve(process.cwd(), "src/modules/inventory/PartMasterList.jsx"), "utf8");
    expect(src).not.toMatch(/width:\s*\d{3,}px/);
  });

  it("the controls wrap rather than overflow", () => {
    expect(css).toMatch(/\.fo-listctl \{ display: flex; flex-wrap: wrap/);
    expect(css).toMatch(/\.fo-listctl__active \{ display: flex; flex-wrap: wrap/);
  });
});
