// THE NORTH STAR WORK ORDER, RENDERED.
//
// The domain suites prove the derivations; workOrderNorthStarSurface proves the shared primitives.
// This renders the REAL PAGE with its reads mocked, because every defect this branch was reviewed
// for was of the kind that passes a derivation test and fails on screen: a hook destructured with
// the wrong key, a fact rendered twice in two treatments, an enum reaching a rail.
//
// EVERY ASSERTION HERE IS MUTATION-PROVEN. Each was watched to FAIL against a deliberately broken
// page before being kept -- a check that cannot fail is a false green, and this repository has been
// bitten by that before. The proofs are recorded in the PR body.
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";

const state = {};

vi.mock("react-router-dom", () => ({
  useParams: () => ({ workOrderId: "wodocidaaaaaaaaaaaaa" }),
  useNavigate: () => vi.fn(),
  Link: ({ children, to, ...rest }) => <a href={String(to)} {...rest}>{children}</a>,
}));
vi.mock("../src/auth/AuthContext", () => ({ useAuth: () => ({ role: "admin", user: { uid: "u1" } }) }));
vi.mock("../src/hooks/useWorkOrder", () => ({
  useWorkOrder: () => ({ workOrder: state.workOrder, loading: state.loading, error: state.error, retry: vi.fn() }),
}));
vi.mock("../src/hooks/useAccount", () => ({ useAccount: () => ({ account: state.account, error: state.accountError }) }));
vi.mock("../src/hooks/useLocation", () => ({ useLocation: () => ({ location: state.location, error: state.locationError }) }));
vi.mock("../src/hooks/useEquipment", () => ({ useEquipmentDoc: () => ({ equipment: state.equipment, loading: false, error: null }) }));
vi.mock("../src/hooks/useFirestoreCollection", () => ({
  useFirestoreCollection: () => ({ data: state.technicians, loading: false, error: state.techniciansError }),
}));
vi.mock("../src/access/useWorkOrderPartsPlanCapability.js", () => ({
  useWorkOrderPartsPlanCapability: () => state.capability,
}));
vi.mock("../src/modules/workOrders/WorkOrderPartsPlanEditor", () => ({ default: () => <div data-testid="parts-editor" /> }));
vi.mock("../src/services/workOrderService", () => ({ transitionWorkOrder: vi.fn(), updateWorkOrderExecutionData: vi.fn() }));

import WorkOrderDetailPage from "../src/modules/workOrders/WorkOrderDetailPage.jsx";

const DAY = 86400000;
const T0 = Date.UTC(2026, 7, 21, 16, 41);
const ts = (ms) => ({ toMillis: () => ms, toDate: () => new Date(ms) });

// Ids are deliberately shaped like Firestore auto-ids (20 chars of [A-Za-z0-9]) so the raw-id
// detector below has something real to catch.
const baseWo = (over = {}) => ({
  id: "wodocidaaaaaaaaaaaaa",
  woNumber: "WO-2026-000873",
  status: "DISPATCHED",
  type: "SERVICE_CALL",
  priority: 2,
  customerId: "acctdocidaaaaaaaaaaa",
  locationId: "locdocidaaaaaaaaaaaa",
  equipmentId: "eqdocidaaaaaaaaaaaaa",
  scheduledTechId: "techdocidaaaaaaaaaaa",
  complaint: "Barrel temperature climbing above spec on the PM cycle.",
  diagnosis: "Suspected worn scraper blades.",
  createdAt: ts(T0),
  dispatchedAt: ts(T0 + 6 * 3600000),
  scheduledStart: ts(T0 + DAY),
  scheduledEnd: ts(T0 + DAY + 4 * 3600000),
  inventorySnapshot: [{ partId: "X49463-3", sku: "X49463-3", name: "Scraper Blade Kit", qtyPlanned: 2 }],
  ...over,
});

beforeEach(() => {
  state.workOrder = baseWo();
  state.loading = false;
  state.error = null;
  state.account = { name: "Desert Sun Beverage Co." };
  state.accountError = null;
  state.location = { name: "Broadway Plant" };
  state.locationError = null;
  state.equipment = { id: "eq1", name: "Soft Serve Freezer 2", manufacturer: "Taylor", model: "C712", serialNumber: "K1122873" };
  state.technicians = [{ id: "techdocidaaaaaaaaaaa", name: "J. Barela" }];
  state.techniciansError = null;
  state.capability = { allowed: false, reason: "NOT_ENABLED" };
});
afterEach(cleanup);

const RAW_ID = /\b[A-Za-z0-9]{20}\b/;

// TEXT AS A READER SEES IT, not as textContent concatenates it.
//
// A naive container.textContent runs adjacent elements together: a serial number ending one node
// and the next two headings produced "K1122873SiteBroadway" -- twenty alphanumerics, and a false
// positive for the id detector. Reading text nodes and joining them on a boundary keeps the
// detector honest in both directions: it still catches a real id, and it no longer invents one.
function visibleText(root) {
  const walker = root.ownerDocument.createTreeWalker(root, 4 /* SHOW_TEXT */);
  const parts = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) parts.push(n.nodeValue);
  return parts.join("\n");
}

describe("the page actually renders", () => {
  it("RENDERS THE RECORD, not a shell and not a login form", () => {
    const { container } = render(<WorkOrderDetailPage />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("WO-2026-000873");
    expect(container.querySelector(".ns-page")).toBeTruthy();
    expect(container.textContent).toMatch(/Barrel temperature/);
    expect(container.textContent).not.toMatch(/sign in|log in|password/i);
  });

  it("carries the rule pair and the six-stage spine the composition is built on", () => {
    const { container } = render(<WorkOrderDetailPage />);
    expect(container.querySelector(".ns-rulepair")).toBeTruthy();
    expect(container.querySelectorAll(".ns-chip")).toHaveLength(6);
  });

  it("KEEPS THE COMPOSITION ORDER: identity, spine, body, rail", () => {
    const { container } = render(<WorkOrderDetailPage />);
    const all = [...container.querySelectorAll("*")];
    const at = (sel) => {
      const el = container.querySelector(sel);
      expect(el, sel + " is missing").toBeTruthy();
      return all.indexOf(el);
    };
    const positions = [at(".ns-identity"), at(".ns-lifecycle"), at(".ns-record-body"), at(".ns-rail")];
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });
});

describe("one fact, one rendering (NS-P4)", () => {
  it("THE RECORD STATE IS RENDERED IN EXACTLY ONE TREATMENT", () => {
    // The pilot audit found status "four times in four treatments" on this page. The count that
    // matters is TREATMENTS, not occurrences of the word: the spine names the stage the record has
    // reached, and the timeline names a dispatch that happened, and neither is a second rendering
    // of "what state is this record in". A status PILL is that rendering, and there may be one.
    const { container } = render(<WorkOrderDetailPage />);
    expect(container.querySelectorAll(".fo-status-pill, .fo-status-text")).toHaveLength(1);
    // And it lives in the record header, not scattered through the body.
    expect(container.querySelector(".ns-identity .fo-status-pill, .ns-identity .fo-status-text")).toBeTruthy();
  });

  it("the status word is not repeated inside the record body", () => {
    const { container } = render(<WorkOrderDetailPage />);
    const body = container.cloneNode(true);
    // The spine and its detail strip legitimately name the stage; the timeline names an event.
    body.querySelector(".ns-lifecycle")?.remove();
    body.querySelector(".ns-stage-detail")?.remove();
    body.querySelector(".ns-timeline")?.remove();
    expect(visibleText(body).split("Dispatched").length - 1).toBe(1);
  });

  it("NO MACHINE VALUE REACHES THE SCREEN", () => {
    const { container } = render(<WorkOrderDetailPage />);
    for (const machine of ["SERVICE_CALL", "WORK_IN_PROGRESS", "READY_TO_DISPATCH"]) {
      expect(container.textContent).not.toContain(machine);
    }
    // The governed word IS present, so this cannot pass by rendering nothing.
    expect(container.textContent).toContain("Service Call");
  });

  it("NO DOCUMENT ID REACHES THE SCREEN", () => {
    const { container } = render(<WorkOrderDetailPage />);
    expect(visibleText(container)).not.toMatch(RAW_ID);
  });

  it("customer, site and technician render as NAMES", () => {
    const { container } = render(<WorkOrderDetailPage />);
    expect(container.textContent).toContain("J. Barela");
    expect(container.textContent).toContain("Desert Sun Beverage Co.");
    expect(container.textContent).toContain("Broadway Plant");
  });
});

describe("the equipment read is consumed on the contract the hook actually returns", () => {
  it("RENDERS THE UNIT -- the rail said reference unavailable on every record while this was wrong", () => {
    const { container } = render(<WorkOrderDetailPage />);
    expect(container.textContent).toContain("Soft Serve Freezer 2");
    expect(container.textContent).toContain("K1122873");
  });

  it("a record with NO unit says so, and does not claim a read failed", () => {
    state.workOrder = baseWo({ equipmentId: null });
    state.equipment = null;
    const { container } = render(<WorkOrderDetailPage />);
    expect(container.textContent).toMatch(/No unit is recorded/i);
  });

  it("a unit that did not resolve is UNAVAILABLE, never blank and never the id", () => {
    state.equipment = null;
    const { container } = render(<WorkOrderDetailPage />);
    expect(container.textContent).toMatch(/reference unavailable/i);
    expect(visibleText(container)).not.toMatch(RAW_ID);
  });
});

describe("the timeline shows only what was recorded", () => {
  it("one row per RECORDED timestamp, each with its own distinct time", () => {
    const { container } = render(<WorkOrderDetailPage />);
    const rows = [...container.querySelectorAll(".ns-timeline__row")];
    expect(rows).toHaveLength(2);
    const times = rows.map((r) => r.querySelector(".ns-timeline__when").textContent);
    expect(new Set(times).size).toBe(times.length);
    expect(times.every((t) => t && t !== "—" && t !== "Unknown")).toBe(true);
  });

  it("NEVER RENDERS AN EVENT THE RECORD DID NOT REACH", () => {
    const { container } = render(<WorkOrderDetailPage />);
    expect(container.textContent).not.toMatch(/became READY/i);
    expect(container.textContent).not.toMatch(/Job assigned/i);
  });

  it("a record with nothing recorded says so rather than rendering an empty list", () => {
    state.workOrder = baseWo({ createdAt: null, dispatchedAt: null });
    const { container } = render(<WorkOrderDetailPage />);
    expect(container.textContent).toMatch(/No recorded events yet/i);
  });
});

describe("honest states survive rendering", () => {
  it("LOADING is a state, not a blank page", () => {
    state.loading = true;
    state.workOrder = null;
    const { container } = render(<WorkOrderDetailPage />);
    expect(container.textContent.trim().length).toBeGreaterThan(0);
  });

  it("A FAILED READ AND AN EMPTY READ SAY DIFFERENT THINGS", () => {
    state.error = "The work order could not be read.";
    state.workOrder = null;
    const failed = render(<WorkOrderDetailPage />).container.textContent;
    cleanup();
    state.error = null;
    state.workOrder = null;
    const empty = render(<WorkOrderDetailPage />).container.textContent;
    expect(failed).not.toBe(empty);
    // The governed reason survives verbatim; it is not replaced with friendlier copy.
    expect(failed).toContain("The work order could not be read.");
    expect(empty).toMatch(/could not be found/i);
  });

  it("A DENIED SITE READ IS NOT AN EMPTY ONE, and the governed reason is not softened away", () => {
    state.locationError = "You do not have access to this location.";
    state.location = null;
    const { container } = render(<WorkOrderDetailPage />);
    expect(container.textContent).toContain("You do not have access to this location.");
    const rail = container.querySelector(".ns-rail");
    expect(within(rail).getByText(/role|available/i)).toBeTruthy();
  });

  it("a parts plan nobody has filled in is EMPTY, in words", () => {
    state.workOrder = baseWo({ inventorySnapshot: [] });
    const { container } = render(<WorkOrderDetailPage />);
    expect(container.textContent).toMatch(/No parts have been planned/i);
  });

  it("READINESS IS NOT AVAILABLE, and never a tick this system cannot substantiate", () => {
    const { container } = render(<WorkOrderDetailPage />);
    const table = container.querySelector(".ns-table");
    expect(table.textContent).toMatch(/Not available/i);
    expect(table.textContent).not.toMatch(/On truck|Staged/i);
  });
});

describe("accessibility of the composition", () => {
  it("THE RECORD HAS EXACTLY ONE h1, and it is the governed reference", () => {
    render(<WorkOrderDetailPage />);
    const h1s = screen.getAllByRole("heading", { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0].textContent).toBe("WO-2026-000873");
  });

  it("EVERY LIFECYCLE STAGE IS A REAL BUTTON, reachable by keyboard", () => {
    const { container } = render(<WorkOrderDetailPage />);
    const chips = [...container.querySelectorAll(".ns-chip")];
    expect(chips.length).toBeGreaterThan(0);
    for (const chip of chips) {
      // A terminal badge is deliberately not interactive; every other chip must be.
      if (chip.classList.contains("ns-chip--terminal")) continue;
      expect(chip.tagName).toBe("BUTTON");
      expect(chip.getAttribute("aria-expanded")).toBeTruthy();
      expect(chip.hasAttribute("disabled")).toBe(false);
    }
  });

  it("STATE IS NEVER CONVEYED BY COLOUR ALONE", () => {
    const { container } = render(<WorkOrderDetailPage />);
    const done = [...container.querySelectorAll(".ns-chip--complete")];
    expect(done.length).toBeGreaterThan(0);
    for (const chip of done) expect(chip.textContent).toContain("✓");
    expect(container.querySelector(".ns-chip--current").getAttribute("aria-current")).toBe("step");
  });

  it("the lifecycle is a labelled list, so it is reachable rather than decorative", () => {
    render(<WorkOrderDetailPage />);
    expect(screen.getByRole("list", { name: /lifecycle/i })).toBeTruthy();
  });

  it("the pulsing dot is DECORATIVE and never the only carrier of meaning", () => {
    const { container } = render(<WorkOrderDetailPage />);
    const pulse = container.querySelector(".ns-chip__pulse");
    expect(pulse.getAttribute("aria-hidden")).toBe("true");
    expect(pulse.textContent).toBe("");
  });

  it("a wide table scrolls inside its own container rather than widening the page", () => {
    const { container } = render(<WorkOrderDetailPage />);
    expect(container.querySelector(".ns-table-wrap")).toBeTruthy();
  });
});

describe("hostile data does not break the composition", () => {
  it("survives long values, many parts and missing references at once", () => {
    const long = "Compressor discharge temperature exceeds specification ".repeat(30);
    state.account = { name: "A".repeat(300) };
    state.location = { name: "B".repeat(300) };
    state.equipment = { name: "C".repeat(300), manufacturer: "D".repeat(200), model: "E".repeat(200), serialNumber: "F".repeat(200) };
    state.workOrder = baseWo({
      complaint: long,
      diagnosis: long,
      inventorySnapshot: Array.from({ length: 120 }, (_, i) => ({ partId: "P" + i, sku: "P" + i, name: "Part " + i, qtyPlanned: i })),
    });
    const { container } = render(<WorkOrderDetailPage />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("WO-2026-000873");
    expect(container.querySelectorAll(".ns-table tbody tr")).toHaveLength(120);
  });

  it("an unscheduled, unassigned record still renders every region", () => {
    state.workOrder = baseWo({ scheduledStart: null, scheduledEnd: null, scheduledTechId: null });
    const { container } = render(<WorkOrderDetailPage />);
    expect(container.textContent).toMatch(/Not scheduled/i);
    expect(container.textContent).toMatch(/Unassigned/i);
    expect(container.querySelector(".ns-rail")).toBeTruthy();
  });

  it("a CANCELLED record shows its terminal outcome and offers no transition", () => {
    state.workOrder = baseWo({ status: "CANCELLED" });
    const { container } = render(<WorkOrderDetailPage />);
    expect(container.querySelector(".ns-chip--terminal").textContent).toBe("Cancelled");
    expect(container.querySelector(".ns-chip__pulse")).toBeNull();
    expect(container.querySelector(".ns-identity__actions .fo-button")).toBeNull();
  });

  it("a status the spine does not recognise is STATED, never drawn as a fresh record", () => {
    state.workOrder = baseWo({ status: "SOMETHINGLEGACY" });
    const { container } = render(<WorkOrderDetailPage />);
    expect(container.textContent).toMatch(/not one the lifecycle recognises/i);
    expect(container.textContent).not.toContain("SOMETHINGLEGACY");
  });

  it("EVERY GOVERNED STATUS RENDERS -- no state of the machine crashes the page", () => {
    const statuses = ["CREATED", "READY_TO_DISPATCH", "SCHEDULED", "DISPATCHED", "ACCEPTED",
      "EN_ROUTE", "ARRIVED", "WORK_IN_PROGRESS", "COMPLETED", "CLOSED", "CANCELLED"];
    for (const status of statuses) {
      state.workOrder = baseWo({ status });
      const { container, unmount } = render(<WorkOrderDetailPage />);
      expect(container.querySelector("h1").textContent, status).toBe("WO-2026-000873");
      // The spine can never show two current stages, whatever the engine reports.
      expect(container.querySelectorAll(".ns-chip--current").length, status).toBeLessThanOrEqual(1);
      unmount();
    }
  });
});

describe("the record title is a serif, and stays one", () => {
  // jsdom applies no stylesheet, so the DOM half and the CSS half are asserted separately and
  // JOINED: the h1 must carry the class, and that class must RESOLVE -- through its token, not by
  // the token merely being mentioned -- to a serif family. Checking either half alone is how a
  // title silently reverts to the interface sans while a green test says otherwise.
  const cssPath = () => import("node:path").then(({ join }) => join(process.cwd(), "src/index.css"));

  it("the h1 carries the record-title class", () => {
    const { container } = render(<WorkOrderDetailPage />);
    const h1 = container.querySelector("h1");
    expect(h1.classList.contains("ns-identity__title")).toBe(true);
  });

  it("THAT CLASS RESOLVES TO A SERIF -- token followed, not just named", async () => {
    const { readFileSync } = await import("node:fs");
    const css = readFileSync(await cssPath(), "utf8");

    const rule = css.match(/\.ns-identity__title\s*\{([^}]*)\}/);
    expect(rule, ".ns-identity__title has no rule").toBeTruthy();
    const family = rule[1].match(/font-family:\s*([^;]+);/);
    expect(family, ".ns-identity__title declares no font-family").toBeTruthy();

    const tokenName = family[1].trim().match(/^var\(\s*(--[\w-]+)\s*\)$/);
    expect(tokenName, "the title must resolve through a token, not a hard-coded stack").toBeTruthy();

    const decl = css.match(new RegExp("\\" + tokenName[1] + ":\\s*([^;]+);"));
    expect(decl, tokenName[1] + " is never declared").toBeTruthy();
    const stack = decl[1].toLowerCase();

    expect(stack.endsWith("serif"), "the stack must terminate in the generic serif").toBe(true);
    for (const sans of ["sans-serif", "inter", "barlow", "arial", "system-ui", "helvetica", "segoe"]) {
      expect(stack.includes(sans), "the record title resolved to a sans (" + sans + ")").toBe(false);
    }
  });

  it("THE FAMILY THAT LEADS THE STACK IS VENDORED, and its file is in the build", async () => {
    const { readFileSync, existsSync } = await import("node:fs");
    const { join } = await import("node:path");
    const css = readFileSync(join(process.cwd(), "src/index.css"), "utf8");

    // Start from the stack, not from a hard-coded family name: dropping the vendored face out of
    // the token must fail here, and an earlier version of this check did not notice because it
    // only asked whether an @font-face existed somewhere in the file.
    const decl = css.match(/--font-record-title:\s*([^;]+);/);
    expect(decl, "--font-record-title is never declared").toBeTruthy();
    const leading = decl[1].split(",")[0].trim().replace(/^["']|["']$/g, "");

    const face = css.match(new RegExp('@font-face\\s*\\{[^}]*font-family:\\s*"' + leading + '"[^}]*\\}'));
    expect(face, "the stack leads with " + leading + ", which no @font-face declares").toBeTruthy();

    const url = face[0].match(/url\(\s*"([^"]+)"/);
    expect(url, leading + " declares no src").toBeTruthy();
    expect(
      existsSync(join(process.cwd(), "src", url[1].replace(/^\.\//, ""))),
      "the font file " + url[1] + " is not in the build",
    ).toBe(true);

    // Self-hosted: no runtime dependency on a font CDN anywhere in the stylesheet.
    expect(/@import\s+url\(\s*["']?https?:/.test(css)).toBe(false);
    expect(/fonts\.(googleapis|gstatic)\.com/.test(css)).toBe(false);
  });
});

describe("data ownership did not change", () => {
  it("EACH READ HAS EXACTLY ONE CALL SITE, and none of them sits inside a loop", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(join(process.cwd(), "src/modules/workOrders/WorkOrderDetailPage.jsx"), "utf8");
    // Comments discuss these hooks by name, so count CODE only.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const hook of ["useWorkOrder(", "useAccount(", "useLocationDoc(", "useEquipmentDoc(", "useFirestoreCollection("]) {
      expect(code.split(hook).length - 1, hook + " must have exactly one call site").toBe(1);
    }
    expect(/\.map\([^)]*use[A-Z]/.test(code), "a read inside a map is an N+1").toBe(false);
  });
});
