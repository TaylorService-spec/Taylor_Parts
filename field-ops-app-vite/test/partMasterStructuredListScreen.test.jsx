// THE PART MASTER LIST, ON THE CANONICAL METADATA RUNTIME.
//
// After the object-list metadata convergence (ADR-013), this screen is a CONSUMER: its filters, its
// sort vocabulary, its labels and the bound on its read all come from `partEntity` / `partIndexList`
// and `metadata/listRuntime`. Nothing here is a screen-local registry, and that is what these
// assertions are really protecting.
//
// What is real: the component, the canonical controls, the canonical definitions, the query
// descriptor builder, the URL-state parser, AND the Part Master read path itself
// (services/partMasterPageQuery -> services/partMasterQueries -> the view mapping). Only the Catalog
// API transport (services/catalogApiClient -- the Render call) and the write-readiness hook are faked,
// so a failure here means the metadata, the translation to the governed query and the screen actually
// disagree. There is NO Firestore mock in this file, because nothing on this screen's read path may
// reach Firestore: if it did, the real module would load and these tests would show it.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import path from "node:path";

const h = vi.hoisted(() => ({
  page: { ok: true, result: { parts: [], nextCursor: null, limit: 50 } },
  count: { ok: true, result: 0 },
  params: new URLSearchParams(),
  setSearchParams: null,
  call: null,
  firebaseLoaded: [],
}));

// TRIPWIRES, not fakes. The shared list chrome (hooks/useListViewChrome.js) still IMPORTS Firestore statically,
// because it counts every Firestore-backed list and a dependency is not hidden by loading it lazily. What this
// screen must never do is USE it: every Firestore function the chrome imports records its call here, and the
// Firestore list source records being loaded at all -- the suite fails below on either. The screen must render every
// state (rows, empty, denied, unavailable, count) without one Firestore call.
vi.mock("firebase/firestore", () => {
  const trip = (name) => (...args) => { h.firebaseLoaded.push(`firebase/firestore.${name}`); throw new Error(`Firestore ${name} called`); };
  return { collection: trip("collection"), getCountFromServer: trip("getCountFromServer"), query: trip("query"), where: trip("where"), limit: trip("limit") };
});
vi.mock("../src/firebase/firebase", () => ({ db: {} }));
vi.mock("../src/metadata/firestoreListSource.js", () => { h.firebaseLoaded.push("firestoreListSource"); return {}; });

// THE RENDER CATALOG TRANSPORT, and nothing else. `call(operation, input)` is the exact seam every
// Part read takes; recording it is how these tests see the governed query the screen asked.
vi.mock("../src/services/catalogApiClient.js", () => ({
  catalogApiClient: {
    call: (h.call = vi.fn((operation) => Promise.resolve(operation === "countParts" ? h.count : h.page))),
  },
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
import { fetchPartMasterPage, countPartMaster } from "../src/services/partMasterPageQuery.js";
import { buildQueryDescriptor } from "../src/metadata/listRuntime.js";
import { partEntity, partIndexList } from "../src/metadata/definitions/part.js";

/** The page reads the Catalog was asked for, in order. */
const searchCalls = () => h.call.mock.calls.filter(([op]) => op === "searchParts").map(([, input]) => input);
const countCalls = () => h.call.mock.calls.filter(([op]) => op === "countParts").map(([, input]) => input);

// Two REAL business part numbers in the shapes this catalogue actually mints. Both must survive every
// id check below untouched — a guard that rejects PRT-1001 is a guard nobody keeps.
// Shaped exactly as the Render Catalog API returns them (functions/src/catalogMaster/catalogRows.ts
// CanonicalPart): the identity is `id`, and there is no `partId` key at all.
const PART_ROWS = [
  {
    id: "p1", version: 1, internalPartNumber: "PRT-1001", name: "Beater assembly",
    category: "Drive", status: "ACTIVE", stockingUnit: "EACH", controlType: "STANDARD",
    stockingClass: "STOCKED",
  },
  {
    id: "p2", version: 1, internalPartNumber: "CW-P-0004", name: "Compressor",
    category: "Refrigeration", status: "SUPERSEDED", stockingUnit: "EACH",
    controlType: "SERIALIZED", stockingClass: "NON_STOCK",
  },
];

/** A Render searchParts answer: the rows, and a next cursor only when the server read one more. */
const pageOf = (parts, nextCursor = null) => ({ ok: true, result: { parts, nextCursor, limit: 50 } });

function setup({ page, count, search = "" } = {}) {
  h.page = page ?? pageOf(PART_ROWS);
  h.count = count ?? { ok: true, result: PART_ROWS.length };
  h.params = new URLSearchParams(search);
  h.setSearchParams = vi.fn();
  h.call.mockClear();
  h.call.mockImplementation((operation) => Promise.resolve(operation === "countParts" ? h.count : h.page));
  // INSIDE A ROUTER, because the list now reaches its record. Part Master was the one MIGRATE
  // family with a real record page and no way to open it from its own collection; wiring the row
  // anchor made `useNavigate` and `<Link>` real dependencies, and a component rendered outside a
  // Router throws on the first of them. The harness follows the component rather than the component
  // being kept navigation-free to suit the harness.
  return render(
    <MemoryRouter>
      <PartMasterList />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  // Checked after EVERY test, so no state of the screen -- including a failed read or a failed
  // count -- may reach Firestore, as a fallback or otherwise.
  expect(h.firebaseLoaded).toEqual([]);
});

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
      page: pageOf([]),
      count: { ok: true, result: 0 },
      search: "f=status:EQUALS:DISCONTINUED",
    });
    expect(await screen.findByText(/no records match these filters/i)).toBeTruthy();
    // Telling somebody the catalogue is empty when they filtered it empty sends them hunting a bug
    // that is not there.
    expect(screen.queryByText(/No canonical Part records exist yet/i)).toBeNull();
  });

  it("a genuinely empty catalogue says so", async () => {
    setup({ page: pageOf([]), count: { ok: true, result: 0 } });
    expect(await screen.findByText(/No canonical Part records exist yet/i)).toBeTruthy();
  });

  it("a denied read says denied — never an empty Part Master", async () => {
    // The Catalog client's refusal categories. The screen used to test Firestore's
    // "permission-denied", which the Catalog client never returns -- so a real denial would have
    // rendered as an outage.
    setup({ page: { ok: false, code: "FORBIDDEN", message: "no" } });
    expect(await screen.findByText(/do not have access to the Part Master/i)).toBeTruthy();
  });

  it("a signed-out caller is a denial too, not an outage", async () => {
    setup({ page: { ok: false, code: "NOT_SIGNED_IN", message: "sign in" } });
    expect(await screen.findByText(/do not have access to the Part Master/i)).toBeTruthy();
  });

  it("an unreachable Catalog says unavailable — and nothing else is consulted", async () => {
    setup({ page: { ok: false, code: "UNREACHABLE", message: "down" } });
    expect(await screen.findByText(/Part Master is currently unavailable/i)).toBeTruthy();
    expect(screen.queryByText(/do not have access/i)).toBeNull();
    // Every read the screen made went to the Catalog; there is no second source to have tried.
    for (const [op] of h.call.mock.calls) expect(["searchParts", "countParts"]).toContain(op);
  });
});

describe("the read is bounded by the canonical runtime", () => {
  it("the first read carries the page bound, the default sort and no cursor", async () => {
    setup();
    await screen.findByText("PRT-1001");
    const [input] = searchCalls();
    // The bound is the runtime's pageSize -- the runtime has no argument that removes one, and the
    // server clamps it again. The server reads one row beyond the page to decide hasMore itself.
    expect(input.limit).toBe(partIndexList.pageSize);
    expect(input.sort).toEqual({ field: "internalPartNumber", direction: "ASC" });
    expect(input.cursor).toBeUndefined();
  });

  it("a URL filter reaches the Catalog as a real query constraint", async () => {
    setup({ search: "f=status:EQUALS:ACTIVE" });
    await screen.findByText("PRT-1001");
    const [input] = searchCalls();
    expect(input.status).toBe("ACTIVE");
    expect(input.statuses).toBeUndefined();
  });

  it("an undeclared filter NEVER reaches the Catalog", async () => {
    setup({ search: "f=category:EQUALS:Drive" });
    await screen.findByText("PRT-1001");
    const [input] = searchCalls();
    // Parsed out at the URL, and refused again by buildQueryDescriptor if it ever got past. Two
    // gates, because this is the one that would otherwise fail in production.
    for (const key of ["category", "status", "statuses", "stockingClass", "stockingClasses"]) {
      expect(input[key], key).toBeUndefined();
    }
  });

  it("the stated sort reaches the Catalog, and the page keeps the SERVER's order", async () => {
    // Descending by part number: the server answers PRT-1001 then CW-P-0004. The Part view mapping
    // sorts ascending by part number, which would silently undo the sort inside every page.
    setup({ search: "sort=internalPartNumber:DESC", page: pageOf([PART_ROWS[0], PART_ROWS[1]]) });
    await screen.findByText("PRT-1001");
    expect(searchCalls()[0].sort).toEqual({ field: "internalPartNumber", direction: "DESC" });
    const rendered = [...document.querySelectorAll("td.fo-pml__part-number")].map((td) => td.textContent);
    expect(rendered).toEqual(["PRT-1001", "CW-P-0004"]);
  });

  it("the total is the Catalog's count over the SAME filters as the page", async () => {
    setup({ search: "f=status:EQUALS:ACTIVE", count: { ok: true, result: 31 } });
    await screen.findByText("PRT-1001");
    await waitFor(() => expect(countCalls().length).toBeGreaterThan(0));
    expect(countCalls().at(-1)).toEqual({ status: "ACTIVE" });
    await waitFor(() => expect(document.body.textContent).toMatch(/31\s*parts/i));
    expect(document.body.textContent).toMatch(/31 items/);
  });

  it("a failed count renders NO count, never 0", async () => {
    setup({ count: { ok: false, code: "UNREACHABLE", message: "down" } });
    await screen.findByText("PRT-1001");
    await waitFor(() => expect(countCalls().length).toBeGreaterThan(0));
    // Let the refused count settle before asserting its absence, so this cannot pass on timing alone.
    await new Promise((r) => setTimeout(r, 25));
    // Two rows are on screen; a tally of them would read "2 parts". Neither that nor 0 may appear.
    expect(document.body.textContent).not.toMatch(/\d+\s*(parts|items)/i);
  });

  it("a record the Catalog serves is a PART, not a malformed record", async () => {
    // The canonical record carries `id`, not `partId`; the view gate compares the two. Passing it
    // over unmapped made every Render-served Part "malformed".
    setup();
    await screen.findByText("PRT-1001");
    expect(screen.queryByText(/malformed record/i)).toBeNull();
  });

  it("a genuinely malformed record is still separated out and SAID", async () => {
    setup({ page: pageOf([...PART_ROWS, { id: "bad-1", internalPartNumber: "X-1", status: "NOT_A_STATUS" }]) });
    await screen.findByText("PRT-1001");
    expect((await screen.findAllByText(/1 malformed record/i)).length).toBeGreaterThan(0);
  });

  it("a complete page offers no pager", async () => {
    setup();
    await screen.findByText("PRT-1001");
    expect(screen.queryByRole("button", { name: /load more parts/i })).toBeNull();
  });

  it("more pages offer a pager that CARRIES the cursor", async () => {
    setup({ page: pageOf(PART_ROWS, "k1.opaque-server-token") });
    await screen.findByText("PRT-1001");

    h.page = pageOf([{ ...PART_ROWS[0], id: "p3", internalPartNumber: "PRT-1099", name: "Seal kit" }]);
    fireEvent.click(screen.getByRole("button", { name: /load more parts/i }));

    await waitFor(() => expect(searchCalls()).toHaveLength(2));
    // Opaque: the screen hands back exactly what the server gave it, under the same sort.
    expect(searchCalls()[1].cursor).toBe("k1.opaque-server-token");
    expect(searchCalls()[1].sort).toEqual(searchCalls()[0].sort);
    // Appended, not replaced: the page already on screen stays on screen.
    expect(await screen.findByText("PRT-1099")).toBeTruthy();
    expect(screen.getByText("PRT-1001")).toBeTruthy();
  });
});

describe("the descriptor is translated into the governed Catalog query, or refused", () => {
  const client = (answer) => ({ call: vi.fn(() => Promise.resolve(answer)) });
  const describeWith = (request) => buildQueryDescriptor(partIndexList, partEntity, request).descriptor;

  it("IN filters become statuses / stockingClasses; the count takes the same keys", async () => {
    const descriptor = describeWith({
      filters: [
        { fieldId: "status", operator: "IN", value: ["ACTIVE", "DRAFT"] },
        { fieldId: "stockingClass", operator: "IN", value: ["KIT"] },
      ],
      sort: [{ fieldId: "status", direction: "DESC" }],
    });
    const c = client(pageOf(PART_ROWS, "k1.next"));
    const res = await fetchPartMasterPage({ descriptor }, { client: c });
    expect(c.call).toHaveBeenCalledWith("searchParts", {
      query: "", statuses: ["ACTIVE", "DRAFT"], stockingClasses: ["KIT"],
      sort: { field: "status", direction: "DESC" }, limit: partIndexList.pageSize,
    });
    expect(res).toMatchObject({ ok: true, hasMore: true, nextCursor: "k1.next" });
    expect(res.parts.map((p) => p.partId)).toEqual(["p1", "p2"]);

    const cc = client({ ok: true, result: 7 });
    expect(await countPartMaster(descriptor, { client: cc })).toBe(7);
    expect(cc.call).toHaveBeenCalledWith("countParts", { statuses: ["ACTIVE", "DRAFT"], stockingClasses: ["KIT"] });
  });

  it("a descriptor the Catalog cannot express is REFUSED, never run broader", async () => {
    const c = client(pageOf(PART_ROWS));
    const unfilterable = { filters: [{ fieldId: "category", operator: "EQUALS", value: "x" }], sort: [], pageSize: 50 };
    expect(await fetchPartMasterPage({ descriptor: unfilterable }, { client: c })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    const unsortable = { filters: [], sort: [{ fieldId: "category", direction: "ASC" }], pageSize: 50 };
    expect(await fetchPartMasterPage({ descriptor: unsortable }, { client: c })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(c.call).not.toHaveBeenCalled();
    expect(await countPartMaster(unfilterable, { client: c })).toBeNull();
  });

  it("a failed count is null, never 0", async () => {
    const descriptor = describeWith({ filters: [], sort: [] });
    expect(await countPartMaster(descriptor, { client: client({ ok: false, code: "FORBIDDEN" }) })).toBeNull();
    expect(await countPartMaster(descriptor, { client: client({ ok: true, result: "12" }) })).toBeNull();
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
