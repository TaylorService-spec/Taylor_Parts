// LABELS & EXPORT — the rendered surface, the barcode renderer, and the authority proofs.
//
// The authority block at the bottom is static: it reads the shipped source and proves P5 introduced
// no capability, no Rules change, no label collection and no direct Firestore read. Those are the
// claims a reviewer would otherwise have to take on trust.
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import BinLabelsAndExport from "../src/modules/administration/BinLabelsAndExport.jsx";
import BinBarcode, { BIN_BARCODE_SYMBOLOGY } from "../src/shared/ui/BinBarcode.jsx";
import { toBinScanToken, labelsToCsv, buildBinLabels } from "../src/domain/binLabel.js";

afterEach(cleanup);

const read = (rel) => readFileSync(resolve(process.cwd(), rel), "utf8");

/**
 * Read a source file with its comments removed.
 *
 * The authority guards below assert that certain names do not appear in P5 code. Those same names
 * appear in P5 COMMENTS, which exist precisely to explain why the thing is absent -- a comment
 * saying "there is no labelVersion" is evidence of care, not a violation. Matching raw text would
 * punish documenting the decision, so the guards read code only.
 */
const readCode = (rel) => read(rel)
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split(/\r?\n/)
  // The [^:] guard keeps a "https://" inside a string literal from looking like a line comment.
  .map((line) => line.replace(/(^|[^:])\/\/.*$/, "$1"))
  .join("\n");

const WAREHOUSE = { id: "WH-1", name: "Phoenix" };
const bins = [
  { binId: "bin_a", code: "A01-001", name: null, status: "ACTIVE", area: "PARTS_ROOM", aisle: "A", bay: 1, position: 1 },
  { binId: "bin_b", code: "A01-003", name: "Fast movers", status: "ACTIVE", area: "PARTS_ROOM", aisle: "A", bay: 1, position: 3 },
  { binId: "bin_c", code: "A02-001", name: null, status: "INACTIVE", area: "PARTS_ROOM", aisle: "A", bay: 2, position: 1 },
];

const mount = (props = {}) => render(
  <BinLabelsAndExport bins={props.bins ?? bins} warehouse={WAREHOUSE} download={props.download ?? vi.fn()} />,
);

const selectAll = () => fireEvent.click(screen.getByText("Select all shown"));

describe("selection defaults to bins that are in use", () => {
  it("out-of-use bins are not offered by default", () => {
    mount();
    expect(screen.getByText("A01-001")).toBeTruthy();
    expect(screen.queryByText("A02-001")).toBeNull();
  });

  it("including them is an explicit choice, and they are marked", () => {
    mount();
    fireEvent.click(screen.getByLabelText("Include bins that are out of use"));
    expect(screen.getByText("A02-001")).toBeTruthy();
    expect(screen.getAllByText("Out of use").length).toBeGreaterThan(0);
  });

  it("an inactive label carries a visible OUT OF USE mark, so it cannot read as operational", () => {
    mount();
    fireEvent.click(screen.getByLabelText("Include bins that are out of use"));
    selectAll();
    expect(screen.getByText("OUT OF USE")).toBeTruthy();
  });

  it("turning the inactive option back off does not leave a hidden bin selected", () => {
    mount();
    const toggle = screen.getByLabelText("Include bins that are out of use");
    fireEvent.click(toggle);
    selectAll();
    fireEvent.click(toggle);
    expect(screen.getByText("Select labels to print")).toBeTruthy();
  });

  it("select all shown picks exactly the visible bins", () => {
    mount();
    selectAll();
    expect(screen.getByText("Print 2 labels")).toBeTruthy();
  });

  it("a single selection is named in the singular", () => {
    mount();
    fireEvent.click(screen.getByLabelText(/A01-001/i, { selector: "input" }) ?? screen.getAllByRole("checkbox")[1]);
    expect(screen.getByText("Print 1 label")).toBeTruthy();
  });
});

describe("nothing selected produces nothing", () => {
  it("says so, and offers no print or export", () => {
    mount();
    expect(screen.getByText(/Nothing is selected/)).toBeTruthy();
    expect(screen.getByText("Select labels to print").closest("button").disabled).toBe(true);
    expect(screen.getByText("Export CSV").closest("button").disabled).toBe(true);
  });

  it("no file is produced when nothing is selected", () => {
    const download = vi.fn();
    mount({ download });
    fireEvent.click(screen.getByText("Export CSV"));
    expect(download).not.toHaveBeenCalled();
  });

  it("a warehouse with no bins says so rather than showing an empty grid", () => {
    mount({ bins: [] });
    expect(screen.getByText(/no bins to label/i)).toBeTruthy();
  });
});

describe("the preview is what prints, and what exports", () => {
  it("renders the human code as dominant text and the barcode beside it", () => {
    mount();
    selectAll();
    const sheet = document.querySelector(".fo-labelsheet");
    expect(within(sheet).getByText("A01-001")).toBeTruthy();
    expect(sheet.querySelectorAll("svg.fo-binbarcode")).toHaveLength(2);
  });

  it("the label shows warehouse and area context, never the raw binId", () => {
    mount();
    selectAll();
    const sheet = document.querySelector(".fo-labelsheet");
    expect(within(sheet).getAllByText(/Phoenix · PARTS_ROOM/).length).toBe(2);
    expect(sheet.textContent).not.toContain("bin_a");
  });

  it("each label has an accessible identity, so the barcode is not the only representation", () => {
    mount();
    selectAll();
    expect(screen.getByLabelText("Label for A01-001, area PARTS_ROOM")).toBeTruthy();
    expect(screen.getByLabelText("Barcode encoding location A01-001")).toBeTruthy();
  });

  it("exports exactly the selected rows, through the same projection the preview used", () => {
    const download = vi.fn();
    mount({ download });
    selectAll();
    fireEvent.click(screen.getByText("Export CSV"));
    const [filename, csv] = download.mock.calls[0];
    expect(filename).toBe("bin-labels-wh-1.csv");
    expect(csv).toBe(labelsToCsv(buildBinLabels(bins, { warehouse: WAREHOUSE })));
    expect(csv).not.toContain("A02-001"); // the out-of-use bin was never selected
  });

  it("print asks the browser and nothing else — no backend, no printer bridge", () => {
    const print = vi.fn();
    vi.stubGlobal("print", print);
    mount();
    selectAll();
    fireEvent.click(screen.getByText("Print 2 labels"));
    expect(print).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it("the mass-print gate is stated, not hidden", () => {
    mount();
    expect(screen.getByText(/confirm the code width, the barcode type and the label stock/)).toBeTruthy();
  });

  it("the surface tells the truth about rename: the barcode keeps working", () => {
    mount();
    selectAll();
    expect(screen.getByText(/keeps working even if the printed code is changed later/)).toBeTruthy();
  });
});

describe("the barcode renderer", () => {
  it("draws a real Code 128 symbol locally", () => {
    const { container } = render(<BinBarcode payload={toBinScanToken("bin_a")} />);
    const svg = container.querySelector("svg");
    expect(svg.querySelectorAll("rect").length).toBeGreaterThan(10);
    expect(BIN_BARCODE_SYMBOLOGY).toBe("CODE128");
  });

  it("uses no remote image service and no external URL", () => {
    const { container } = render(<BinBarcode payload={toBinScanToken("bin_a")} />);
    const svg = container.querySelector("svg");
    expect(svg.querySelectorAll("image")).toHaveLength(0);
    // The only http(s) string permitted is the SVG XML namespace, which is an identifier, not a fetch.
    const urls = (svg.outerHTML.match(/https?:\/\/[^"' ]+/g) ?? [])
      .filter((u) => u !== "http://www.w3.org/2000/svg");
    expect(urls).toEqual([]);
  });

  it("a renderer failure is visible and does not crash the page around it", () => {
    // Code 128 cannot encode an empty payload; the component must say so, not throw.
    const { container } = render(<BinBarcode payload="" />);
    expect(screen.getByText(/could not be generated. Do not use this label/)).toBeTruthy();
    expect(container.querySelector("svg.fo-binbarcode")).toBeNull();
  });

  it("the payload it encodes is the scan token, not the human code", () => {
    const token = toBinScanToken("bin_a");
    const { container } = render(<BinBarcode payload={token} />);
    expect(container.querySelector("svg").getAttribute("aria-label")).toContain(token);
  });
});

describe("authority — proved from the shipped source, not asserted in prose", () => {
  const label = readCode("src/domain/binLabel.js");
  const surface = readCode("src/modules/administration/BinLabelsAndExport.jsx");
  const barcode = readCode("src/shared/ui/BinBarcode.jsx");
  const download = readCode("src/services/downloadFile.js");
  const p5Sources = [label, surface, barcode, download];

  it("no P5 source reads Firestore directly", () => {
    for (const src of p5Sources) {
      expect(src).not.toMatch(/from "firebase\/firestore"/);
      expect(src).not.toMatch(/collection\(|getDocs\(|onSnapshot\(/);
    }
  });

  it("no P5 source names bins or bin_code_claims as a collection", () => {
    for (const src of p5Sources) {
      expect(src).not.toMatch(/["']bin_code_claims["']/);
      expect(src).not.toMatch(/["']bins["']/);
    }
  });

  it("no label collection or persisted label configuration is introduced", () => {
    for (const src of p5Sources) {
      for (const forbidden of [
        "location_labels", "bin_labels", "label_registry", "printed_labels",
        "barcode_locations", "location_aliases", "label_templates", "label_settings",
      ]) {
        expect(src).not.toContain(forbidden);
      }
    }
  });

  it("no persistent printed-label state is invented", () => {
    for (const src of p5Sources) {
      for (const forbidden of ["labelVersion", "lastPrintedCode", "printedAt", "physicalLabelStatus", "labelNeeded"]) {
        expect(src).not.toContain(forbidden);
      }
    }
  });

  it("no new capability id is introduced", () => {
    for (const src of p5Sources) {
      expect(src).not.toMatch(/inventory\.location\.label|barcode\.print|label\.export/);
    }
  });

  it("the capability catalog is unchanged by P5 — no label capability exists in either copy", () => {
    for (const rel of ["src/access/permissionCatalog.ts", "../functions/src/access/permissionCatalog.ts"]) {
      const catalog = read(rel);
      expect(catalog).not.toMatch(/inventory\.location\.label/);
      expect(catalog).not.toMatch(/barcode\.print/);
    }
  });

  it("neither governed Rules copy mentions a label collection", () => {
    for (const rel of ["firestore.rules", "../firestore.rules"]) {
      const rules = read(rel);
      expect(rules).not.toMatch(/match \/(bin_)?labels?\b/);
      expect(rules).not.toMatch(/location_labels|label_templates/);
    }
  });

  it("P5 writes nothing: no callable, no mutation, no ledger", () => {
    for (const src of p5Sources) {
      expect(src).not.toMatch(/httpsCallable|createBin|renameBin|deactivateBin|recordPutAway/);
      expect(src).not.toMatch(/inventory_transactions|ledger/i);
    }
  });

  it("no quantity or custody concept appears anywhere in P5", () => {
    for (const src of p5Sources) {
      for (const forbidden of ["onHand", "expectedQuantity", "reservedQty", "custody", "rollUp"]) {
        expect(src).not.toContain(forbidden);
      }
    }
  });

  it("the scan parser is imported, never forked", () => {
    expect(label).not.toContain("TAYLOR|EOS"); // no copied regex
    const test = read("test/binLabel.test.jsx");
    expect(test).toContain('from "../src/domain/scannedIdentity.js"');
  });

  it("stock_locations stays retired — BIN-P2R still holds", () => {
    for (const src of p5Sources) expect(src).not.toContain("stock_locations");
    for (const rel of ["firestore.rules", "../firestore.rules"]) {
      expect(read(rel)).not.toMatch(/match \/stock_locations/);
    }
  });

  it("print is browser-native, with no printer bridge or OS dependency", () => {
    expect(surface).toContain("window.print()");
    expect(surface).not.toMatch(/ZPL|zebra|printerName|ipp:|lpr/i);
  });

  it("the print stylesheet keeps the label sheet and hides everything else", () => {
    const css = read("src/index.css");
    expect(css).toMatch(/@media print/);
    expect(css).toMatch(/\.fo-labelsheet,\s*\n?\s*\.fo-labelsheet \* \{\s*\n?\s*visibility: visible;/);
    expect(css).toMatch(/break-inside: avoid/);
  });
});
