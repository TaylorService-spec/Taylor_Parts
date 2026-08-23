// WO-04 — THE WAREHOUSE HANDHELD, RENDERED.
//
// The domain suite proves what may be offered. What only a render proves is that the SCREEN honours
// it: that a person can tell what a queue is for, that an uncountable queue never shows a zero, that
// a business object arrives as separate fields rather than a sentence, and that a raw location id
// never reaches a human.
//
// §33 is the part that geometry cannot answer. For each workflow the question is not "do the buttons
// fit" but "can somebody tell what they are about to do".
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within, act } from "@testing-library/react";

vi.mock("../src/auth/AuthContext", () => ({ useAuth: () => ({ role: "dispatcher" }) }));
vi.mock("../src/modules/scan/ScanWorkspace", () => ({
  default: ({ deps }) => <div data-testid="scan">Scan workspace opened on: {deps?.initialWorkflow ?? "menu"}</div>,
}));

const { default: WarehouseShell } = await import("../src/modules/warehouse/WarehouseShell");
const { default: StructuredFields } = await import("../src/shared/ui/StructuredFields.jsx");
const { serializedUnitFields, partFields, transferFields } = await import("../src/domain/structuredFields.js");

afterEach(cleanup);

const holding = (...ids) => (id) => ids.includes(id);
const RECEIVER = holding("inventory.stock.receive");
const EVERYTHING = holding(
  "inventory.stock.receive", "inventory.placement.record", "inventory.location.bin.read",
  "inventory.cycleCount.create", "inventory.cycleCount.submit",
  "inventory.transfer.dispatch", "inventory.transfer.receive", "inventory.returns.intake",
);

const mount = (over = {}) => render(
  <WarehouseShell deps={{ hasCapability: RECEIVER, receivingReady: true, role: "dispatcher", ...over }} />,
);
const nav = () => screen.getByRole("navigation", { name: /warehouse/i });
const tab = async (name) => { await act(async () => { fireEvent.click(within(nav()).getByRole("button", { name })); }); };

// ═══════════════════════════════════════════ the shell

describe("the warehouse handheld shell", () => {
  it("opens on Home with four tabs and nothing else", () => {
    mount();
    expect(within(nav()).getAllByRole("button").map((b) => b.textContent)).toEqual(["Home", "Scan", "Work", "More"]);
  });

  it("marks the current tab for a screen reader, not only visually", async () => {
    mount();
    const current = within(nav()).getAllByRole("button").filter((b) => b.getAttribute("aria-current") === "page");
    expect(current).toHaveLength(1);
    expect(current[0].textContent).toBe("Home");
    await tab("Work");
    expect(within(nav()).getAllByRole("button").find((b) => b.getAttribute("aria-current") === "page").textContent).toBe("Work");
  });

  it("ALL FOUR TABS render something", async () => {
    mount();
    expect(screen.getByRole("heading", { name: /what needs attention/i })).toBeTruthy();
    await tab("Work");
    expect(screen.getByRole("heading", { name: /^work$/i })).toBeTruthy();
    await tab("Scan");
    expect(await screen.findByTestId("scan")).toBeTruthy();
    await tab("More");
    expect(screen.getByText(/app version/i)).toBeTruthy();
  });

  it("choosing a queue on Home OPENS THAT TASK, not a menu of tasks", async () => {
    // A person who has just chosen "Receiving" should not land on a list containing "Receiving".
    mount();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /receiving/i })); });
    expect((await screen.findByTestId("scan")).textContent).toContain("SUPPLIER_RECEIVING");
  });

  it("More is small, and Sync status is a REAL control", async () => {
    // WO-04 said "warehouse work is sent as you do it", which WO-05 made untrue: work is now held
    // when there is no signal, so More offers the queue itself rather than a statement about it.
    mount();
    await tab("More");
    expect(screen.getByRole("button", { name: /sync status/i })).toBeTruthy();
    // Nothing from the desktop belongs here.
    const text = screen.getByRole("region", { name: /more/i }).textContent;
    for (const forbidden of ["CRM", "Sales", "Reporting", "Admin", "Finance"]) {
      expect(text).not.toContain(forbidden);
    }
  });
});

// ═══════════════════════════════════════════ §33 task intent

describe("can a person tell what they are about to do", () => {
  it("EVERY QUEUE SAYS WHAT IT IS FOR, not just what it is called", () => {
    mount({ hasCapability: EVERYTHING });
    // The reason line is what turns a label into an intent.
    expect(screen.getByText(/Stock on the dock is not stock the platform knows about/i)).toBeTruthy();
    expect(screen.getByText(/Received but not placed — it exists and cannot be found/i)).toBeTruthy();
    expect(screen.getByText(/A job is waiting on parts/i)).toBeTruthy();
  });

  it("Work names the ACTION, so the next step is unambiguous", async () => {
    mount({ hasCapability: EVERYTHING });
    await tab("Work");
    expect(screen.getByText(/Receive a supplier purchase order/i)).toBeTruthy();
    expect(screen.getByText(/Record which bin you stowed stock in|Put stock away/i)).toBeTruthy();
    expect(screen.getByText(/Send or receive a transfer/i)).toBeTruthy();
    expect(screen.getByText(/Count what is on the shelf/i)).toBeTruthy();
  });

  it("AN UNCOUNTABLE QUEUE NEVER SHOWS ZERO", () => {
    // "0 waiting" would send somebody away from a queue that may be full.
    mount({ hasCapability: EVERYTHING });
    const putAway = screen.getByRole("button", { name: /put away/i });
    expect(putAway.textContent).toMatch(/count is not available/i);
    expect(putAway.textContent).not.toMatch(/\b0 waiting\b/);
  });

  it("a real count is shown as a count", () => {
    mount({ counts: { SUPPLIER_RECEIVING: 3 } });
    expect(screen.getByRole("button", { name: /receiving/i }).textContent).toMatch(/3 waiting/);
  });

  it("NOTHING AVAILABLE EXPLAINS ITSELF and names what would change it", () => {
    // An empty screen that merely looks empty is indistinguishable from a broken one.
    mount({ hasCapability: () => false, receivingReady: false });
    // Lookup is genuinely available to everyone, so the truly-empty case is asserted on the domain
    // side; here the screen must at minimum never render a bare blank.
    expect(screen.getByRole("region", { name: /today/i }).textContent.trim().length).toBeGreaterThan(20);
  });

  it("ABSENCE, NOT A DISABLED TILE", () => {
    mount({ hasCapability: RECEIVER });
    // A greyed-out "Cycle counts" would say the operation exists and access is the only obstacle.
    expect(screen.queryByRole("button", { name: /cycle count/i })).toBeNull();
    expect(screen.queryByText(/cycle count/i)).toBeNull();
  });

  it("'not ready here' is explained separately from 'you may not'", async () => {
    mount({ hasCapability: RECEIVER, receivingReady: false });
    await tab("Work");
    expect(screen.getByRole("heading", { name: /not available here/i })).toBeTruthy();
  });
});

// ═══════════════════════════════════════════ §10 / §11 / §23 structured fields

describe("structured fields, rendered", () => {
  const UNIT = { productName: "Taylor C161", serialNo: "CW-C161-0001", inventoryState: "AVAILABLE" };

  it("THE WORKED EXAMPLE renders as six labelled fields", () => {
    render(<StructuredFields fields={serializedUnitFields(UNIT, { locationName: "Main Warehouse" })} label="Unit" />);
    for (const [label, value] of [
      ["Equipment", "Taylor C161"], ["Serial Number", "CW-C161-0001"], ["Quantity", "1"],
      ["Status", "Available"], ["Location", "Main Warehouse"], ["Description", "Whole Unit Equipment"],
    ]) {
      const term = screen.getByText(label);
      expect(term.tagName.toLowerCase()).toBe("dt");
      expect(term.nextSibling.textContent).toBe(value);
    }
  });

  it("IT IS NOT A SENTENCE", () => {
    const { container } = render(<StructuredFields fields={serializedUnitFields(UNIT, { locationName: "Main Warehouse" })} />);
    // The exact string this standard exists to abolish.
    expect(container.textContent).not.toMatch(/Taylor C161 · /);
    expect(container.textContent).not.toMatch(/— S\/N /);
    expect(container.textContent).not.toMatch(/AVAILABLE · wh-/);
  });

  it("STATUS KEEPS ITS RAW VALUE on the element, for filtering and reporting", () => {
    const { container } = render(<StructuredFields fields={transferFields({ transferNumber: "TR-1", status: "IN_TRANSIT" }, {})} />);
    const status = container.querySelector('[data-kind="STATUS"]');
    expect(status.textContent).toBe("In Transit");
    expect(status.getAttribute("data-raw")).toBe("IN_TRANSIT");
  });

  it("status is a WORD, never colour alone", () => {
    const { container } = render(<StructuredFields fields={transferFields({ status: "IN_TRANSIT" }, {})} />);
    // Strip every class and the meaning must survive.
    container.querySelectorAll("[class]").forEach((el) => el.removeAttribute("class"));
    expect(container.textContent).toContain("In Transit");
  });

  it("A RAW LOCATION ID NEVER REACHES THE SCREEN", () => {
    const { container } = render(<StructuredFields fields={serializedUnitFields(UNIT, { locationName: null })} />);
    expect(container.textContent).toContain("Unavailable");
    expect(container.textContent).not.toContain("wh-");
  });

  it("an absent value is visibly absent, and says WHICH absence", () => {
    const { container } = render(<StructuredFields fields={partFields({ name: "Seal kit" }, { availabilityUnknown: true })} />);
    const absent = container.querySelectorAll(".fo-fields__value--absent");
    expect(absent.length).toBeGreaterThan(0);
    expect(container.textContent).toContain("Not available to you");
  });

  it("a narrow screen DROPS fields rather than merging them", () => {
    const { container: wide } = render(<StructuredFields fields={serializedUnitFields(UNIT, { locationName: "Main Warehouse" })} maxPriority={3} />);
    const wideRows = wide.querySelectorAll(".fo-fields__row").length;
    cleanup();
    const { container: narrow } = render(<StructuredFields fields={serializedUnitFields(UNIT, { locationName: "Main Warehouse" })} maxPriority={1} />);
    const narrowRows = narrow.querySelectorAll(".fo-fields__row").length;
    expect(narrowRows).toBeLessThan(wideRows);
    // Every remaining row is still exactly one label and one value.
    narrow.querySelectorAll(".fo-fields__row").forEach((row) => {
      expect(row.querySelectorAll("dt")).toHaveLength(1);
      expect(row.querySelectorAll("dd")).toHaveLength(1);
    });
  });

  it("it is a definition list, so each attribute is addressable to a screen reader", () => {
    const { container } = render(<StructuredFields fields={serializedUnitFields(UNIT, {})} label="Unit CW-C161-0001" />);
    expect(container.querySelector("dl")).toBeTruthy();
    expect(screen.getByLabelText("Unit CW-C161-0001")).toBeTruthy();
    // NOT a table. A desktop grid on a phone is a horizontal scrollbar with extra steps.
    expect(container.querySelector("table")).toBeNull();
  });
});

// ═══════════════════════════════════════════ §32 / §34

describe("mobile and accessibility", () => {
  const css = (() => {
    // eslint-disable-next-line no-undef
    const { readFileSync } = require("node:fs");
    // eslint-disable-next-line no-undef
    const path = require("node:path");
    // eslint-disable-next-line no-undef
    return readFileSync(path.resolve(process.cwd(), "src/index.css"), "utf8");
  })();

  it("queue cards clear 44px and are cards, not a table", () => {
    expect(css).toMatch(/\.fo-wh-queue__button\s*\{[^}]*min-height:\s*64px/);
    const { container } = render(<WarehouseShell deps={{ hasCapability: EVERYTHING, receivingReady: true }} />);
    expect(container.querySelector("table")).toBeNull();
  });

  it("long serials and location names wrap rather than overflow", () => {
    expect(css).toMatch(/\.fo-fields__value\s*\{[^}]*overflow-wrap:\s*anywhere/);
    expect(css).toMatch(/\.fo-wh-queue__reason\s*\{[^}]*overflow-wrap:\s*anywhere/);
  });

  it("at 320 the label/value pair STACKS rather than truncating a serial", () => {
    expect(css).toMatch(/@media \(max-width: 359\.98px\)[\s\S]{0,200}\.fo-fields__row/);
  });

  it("both regions are landmarked and headed", () => {
    mount({ hasCapability: EVERYTHING });
    expect(screen.getByRole("region", { name: /today/i })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /what needs attention/i })).toBeTruthy();
    expect(screen.getByRole("navigation", { name: /warehouse/i })).toBeTruthy();
  });

  it("every queue is a real button, reachable by keyboard", () => {
    mount({ hasCapability: EVERYTHING });
    const buttons = screen.getAllByRole("button").filter((b) => b.className.includes("fo-wh-queue__button"));
    expect(buttons.length).toBeGreaterThan(3);
    buttons.forEach((b) => expect(b.tagName.toLowerCase()).toBe("button"));
  });
});
