// BARCODE / ALIAS LOOKUP — the mounted surface (vitest + jsdom).
//
// The composition rules are proved pure in test/partLookupAlias.test.mjs. These cover what only the
// screen can show: that each identifier outcome reaches the user in its own words and with the right
// urgency, that a resolved-by-barcode result SAYS it matched an alias, and that adding a second
// question added no way to change anything.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import LookupScan from "../src/modules/scan/LookupScan.jsx";

afterEach(cleanup);

const PART = {
  invalid: false, partId: "PRT-1001", internalPartNumber: "TS-1001", name: "Compressor relay",
  description: "Start relay, 240V", category: "Electrical", status: "ACTIVE",
  stockingUnit: "EACH", controlType: "STANDARD", stockingClass: "STOCKED", version: 3,
};
const BARCODE = "0037000112345";

const readable = (...parts) => vi.fn().mockResolvedValue({ ok: true, parts, invalid: [] });
const idResult = (payload) => vi.fn().mockResolvedValue(payload);

const scan = (resolveIdentifier, token = BARCODE, fetchParts = readable(PART)) => {
  render(<LookupScan deps={{ fetchParts, resolveIdentifier }} />);
  fireEvent.change(screen.getByLabelText(/part code or barcode/i), { target: { value: token } });
  fireEvent.click(screen.getByRole("button", { name: /look up/i }));
};

// ────────────────────────────────────────────── resolution by barcode

describe("Barcode lookup (a scan that is not a part code)", () => {
  it("resolves the part, and SAYS it matched a registered identifier rather than the part code", async () => {
    scan(idResult({ result: { result: "FOUND", partId: "PRT-1001", aliasType: "SUPPLIER_SKU", aliasId: "a1" } }));
    expect(await screen.findByRole("heading", { name: /compressor relay/i })).toBeTruthy();
    // Without this line, a barcode registered against the WRONG part looks exactly like a correct scan.
    const note = screen.getByText(/matched a registered/i);
    expect(note.textContent).toMatch(/supplier SKU/i);
    expect(note.textContent).not.toMatch(/SUPPLIER_SKU/, "an operator should never see a raw enum");
  });

  it("shows the same part fields whichever way it was reached", async () => {
    scan(idResult({ result: { result: "FOUND", partId: "PRT-1001", aliasType: "UPC", aliasId: "a1" } }));
    const card = await screen.findByRole("region", { name: /part TS-1001/i });
    expect(within(card).getByText("TS-1001")).toBeTruthy();
    expect(within(card).getByText("ACTIVE")).toBeTruthy();
  });

  it("a DIRECT part-code match shows no identifier note at all", async () => {
    scan(idResult({ result: { result: "NOT_FOUND" } }), "PRT-1001");
    await screen.findByRole("heading", { name: /compressor relay/i });
    expect(screen.queryByText(/matched a registered/i)).toBeNull();
  });
});

// ────────────────────────────────────────────── each failure, its own words

describe("Barcode lookup (four ways to fail, four different sentences)", () => {
  it("INACTIVE says registered-but-retired and names the part it pointed to", async () => {
    scan(idResult({ result: { result: "INACTIVE", partId: "PRT-1001", aliasType: "UPC", aliasId: "a1" } }));
    const msg = await screen.findByText(/no longer active/i);
    expect(msg.textContent).toMatch(/PRT-1001/);
    expect(screen.queryByRole("heading", { name: /compressor relay/i })).toBeNull();
    // and it is a status, not an alarm — retiring an identifier is a normal thing to have done
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("AMBIGUOUS lists the parts and resolves none of them", async () => {
    scan(idResult({ result: { result: "AMBIGUOUS", matches: [{ partId: "PRT-1001" }, { partId: "PRT-2002" }] } }));
    expect(await screen.findByText(/registered against more than one part/i)).toBeTruthy();
    expect(screen.getByText(/PRT-2002/)).toBeTruthy();
    expect(screen.queryByRole("heading", { name: /compressor relay/i })).toBeNull();
  });

  it("DENIED is an alert saying the check could not be MADE, not that nothing was found", async () => {
    scan(idResult({ errorStatus: "permission-denied", errorDetail: "DENIED" }));
    const msg = await screen.findByRole("alert");
    expect(msg.textContent).toMatch(/not authorized to look up registered identifiers/i);
    expect(msg.textContent).not.toMatch(/no governed record|not registered/i);
  });

  it("NOT SWITCHED ON is a status, not a denial and not an absence", async () => {
    // The state every environment is in today: PART_IDENTIFIER_TRANSPORT_READY is false everywhere.
    scan(idResult({ errorStatus: "transport-not-ready", errorDetail: null }));
    const msg = await screen.findByText(/not switched on in this environment/i);
    expect(msg.getAttribute("role")).toBe("status");
    expect(msg.textContent).not.toMatch(/not authorized/i);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("an unknown identifier says so WITHOUT lecturing about part-code shape", async () => {
    // A UPC is valid input now. Telling someone their barcode does not look like a part code was
    // right when part codes were the only input and became wrong the moment barcodes were too.
    scan(idResult({ result: { result: "NOT_FOUND" } }));
    const msg = await screen.findByText(/not a registered identifier/i);
    expect(msg.textContent).not.toMatch(/look like PRT-/i);
  });

  it("an identifier pointing at an UNREADABLE part names that part", async () => {
    scan(idResult({ result: { result: "FOUND", partId: "PRT-GHOST", aliasType: "UPC", aliasId: "a1" } }));
    const msg = await screen.findByText(/could not be read/i);
    expect(msg.textContent).toMatch(/PRT-GHOST/);
  });
});

// ────────────────────────────────────────────── conflict

describe("Barcode lookup (the code means two different things)", () => {
  it("CONFLICT is an ALERT, resolves neither part, and names both", async () => {
    const other = { ...PART, partId: "PRT-2002", internalPartNumber: "TS-2002", name: "Other part" };
    scan(
      idResult({ result: { result: "FOUND", partId: "PRT-2002", aliasType: "UPC", aliasId: "a1" } }),
      "PRT-1001",
      readable(PART, other),
    );
    const box = await screen.findByRole("alert");
    expect(box.textContent).toMatch(/part number AND a registered identifier/i);
    expect(box.textContent).toMatch(/PRT-1001/);
    expect(box.textContent).toMatch(/PRT-2002/);
    expect(screen.queryByRole("heading", { name: /compressor relay/i })).toBeNull();
    expect(screen.queryByRole("heading", { name: /other part/i })).toBeNull();
  });
});

// ────────────────────────────────────────────── still reads only

describe("Barcode lookup (a second question added no way to change anything)", () => {
  it("asks BOTH questions on one lookup, and neither is a write", async () => {
    const fetchParts = readable(PART);
    const resolveIdentifier = idResult({ result: { result: "NOT_FOUND" } });
    render(<LookupScan deps={{ fetchParts, resolveIdentifier }} />);
    fireEvent.change(screen.getByLabelText(/part code or barcode/i), { target: { value: BARCODE } });
    fireEvent.click(screen.getByRole("button", { name: /look up/i }));

    expect(await screen.findByText(/not a registered identifier/i)).toBeTruthy();
    expect(fetchParts).toHaveBeenCalledTimes(1);
    expect(resolveIdentifier).toHaveBeenCalledTimes(1);
    expect(resolveIdentifier).toHaveBeenCalledWith({ rawValue: BARCODE });
  });

  it("still offers exactly one control and no quantity input", async () => {
    scan(idResult({ result: { result: "FOUND", partId: "PRT-1001", aliasType: "UPC", aliasId: "a1" } }));
    await screen.findByRole("heading", { name: /compressor relay/i });
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.queryByRole("spinbutton")).toBeNull();
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
  });

  it("keeps the standing reads-only assurance", () => {
    render(<LookupScan deps={{ fetchParts: readable(PART), resolveIdentifier: idResult({ result: { result: "NOT_FOUND" } }) }} />);
    expect(screen.getByText(/reads only.*nothing here moves/i)).toBeTruthy();
  });

  it("uses the SHARED alias transport, not a scanner-only identifier service", async () => {
    // Structural. A second transport could drift from the administration one and resolve a scan
    // differently from the screen that registered it.
    const src = readFileSync(resolve(process.cwd(), "src/modules/scan/LookupScan.jsx"), "utf8");
    expect(src).toMatch(/from\s*"\.\.\/\.\.\/services\/partAliasCallableClient\.js"/);
    expect(src).not.toMatch(/httpsCallable|firebase\/functions/, "the surface must not build its own transport");
  });
});
