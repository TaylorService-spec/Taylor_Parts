// LISTS P2 — the shared collection contract, and the two claims a collection page makes.
//
// DESIGN AUTHORITY: docs/north-star/lists/Lists-North-Star-P2.dc.html (boards 2d, 2j, 2k).
// RECONCILIATION:   docs/north-star/lists/LISTS-P2-RECONCILIATION.md.
//
// This is Phase 1 infrastructure: the shared pieces every family's migration will stand on, proved
// before any family moves. Two things are under test, and they are the two things a collection page
// asserts about the world:
//
//   1. THE SEVENTEEN STATES ARE SEVENTEEN FACTS. P2's rule is that "TRUE EMPTY / EMPTY VIEW /
//      SEARCH ZERO / FILTER ZERO / UNKNOWN / DENIED / UNAVAILABLE are seven different facts with
//      seven different sentences and seven different ways out — never one generic empty component."
//      A vocabulary that declares seventeen and renders one is worse than one that declares one.
//
//   2. A ROW REACHES ITS RECORD. `rowNavigationTo` is a promise about the route table, and until
//      this suite existed nothing checked it. Two of the four declared templates named routes that
//      do not exist in this application, and a URL matching nothing lands on the Dashboard — so the
//      failure mode is not an error, it is a person quietly somewhere they did not ask to be.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import HonestState, { HONEST_STATE } from "../src/shared/ui/HonestState.jsx";
import {
  COLLECTION_PAGE_STATES,
  COLLECTION_PAGE_STATE_IDS,
  RENDERED_BY,
  findCollectionPageState,
  statesRenderedBy,
  unreachableStates,
  validateCollectionPageStates,
} from "../src/shared/ui/collectionPageState.js";
import { NAV_DOMAINS } from "../src/navigation/navConfig.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..", "src");
const read = (relPath) => readFileSync(join(SRC, relPath), "utf8");

// ═════════════════════════════════════════ the state contract

describe("the seventeen collection page states", () => {
  it("declares exactly the seventeen the design board names", () => {
    // Pinned as a literal list rather than a count, so an accidental rename shows up as the rename
    // it is. The order is the board's.
    expect(COLLECTION_PAGE_STATE_IDS).toEqual([
      "IDLE",
      "LOADING",
      "POPULATED",
      "TRUE_EMPTY",
      "EMPTY_VIEW",
      "SEARCH_ZERO",
      "FILTER_ZERO",
      "UNKNOWN",
      "NOT_ENABLED",
      "DENIED",
      "UNAVAILABLE",
      "DEGRADED",
      "OFFLINE_STALE",
      "SELECTION_MODE",
      "ACTION_IN_PROGRESS",
      "ACTION_FAILURE",
      "ACTION_SUCCESS",
    ]);
    expect(COLLECTION_PAGE_STATES).toHaveLength(17);
  });

  it("is internally valid", () => {
    expect(validateCollectionPageStates()).toEqual([]);
  });

  it("the validator BITES — this is not a function that always returns []", () => {
    // Every rule the contract enforces, mutated one at a time. Without this the suite above proves
    // only that `validateCollectionPageStates` can return an empty array.
    const ok = {
      id: "OK_STATE",
      summary: "a sentence",
      renderedBy: RENDERED_BY.LIST_BODY,
      reachable: true,
      awaits: null,
      honestState: null,
    };
    const problems = (patch) => validateCollectionPageStates([{ ...ok, ...patch }]);

    expect(problems({ id: "lower_case" })[0]).toMatch(/SCREAMING_SNAKE/);
    expect(problems({ summary: null })[0]).toMatch(/summary is required/);
    expect(problems({ renderedBy: "SOMEWHERE" })[0]).toMatch(/renderedBy must be one of/);
    // The load-bearing pair: a state that says HonestState renders it must name the id, and a state
    // that names an id must actually be rendered by HonestState.
    expect(problems({ renderedBy: RENDERED_BY.HONEST_STATE })[0]).toMatch(/requires a honestState id/);
    expect(problems({ honestState: HONEST_STATE.EMPTY })[0]).toMatch(/renders this state, not HonestState/);
    // And the rule that stops a design board becoming a silent backlog.
    expect(problems({ reachable: false })[0]).toMatch(/must name the authority it awaits/);
    expect(problems({ awaits: "something" })[0]).toMatch(/must not claim to await/);
    // A duplicate id would make `findCollectionPageState` answer with whichever came first.
    expect(validateCollectionPageStates([ok, ok]).join(" ")).toMatch(/duplicate id/);
  });

  it("every state HonestState claims to render, HonestState actually renders", () => {
    // The declaration-nothing-consumes check, run in the direction that matters. A state naming a
    // rendering it does not have would be discovered by a user, in the one moment they most need
    // the screen to be truthful.
    for (const s of statesRenderedBy(RENDERED_BY.HONEST_STATE)) {
      expect(Object.values(HONEST_STATE), `${s.id} names ${s.honestState}`).toContain(s.honestState);
      const { container, unmount } = render(<HonestState state={s.honestState} subject="work orders" />);
      expect(container.textContent.trim(), `${s.id} rendered nothing`).not.toBe("");
      unmount();
    }
  });

  it("the five unreachable states each NAME the authority they await", () => {
    const unreachable = unreachableStates().map((s) => s.id);
    // P2's own 2k board classifies all of these as authority-dependent. EOS has no governed bulk
    // transition of any kind: every governed command today takes one record.
    expect(unreachable).toEqual([
      "SELECTION_MODE",
      "ACTION_IN_PROGRESS",
      "ACTION_FAILURE",
      "ACTION_SUCCESS",
    ]);
    for (const s of unreachableStates()) {
      expect(s.awaits, `${s.id}`).toBeTruthy();
      expect(s.awaits.length, `${s.id}'s reason is too short to be a reason`).toBeGreaterThan(20);
    }
  });

  it("POPULATED and DEGRADED are NOT HonestState's job", () => {
    // POPULATED is the list itself; routing it through the state resolver would mean the resolver
    // renders rows. DEGRADED's substance is per-cell — the row says "Name unavailable" where the
    // name would have been — and HonestState carries only the one quiet line above the table.
    expect(findCollectionPageState("POPULATED").renderedBy).toBe(RENDERED_BY.LIST_BODY);
    expect(findCollectionPageState("DEGRADED").renderedBy).toBe(RENDERED_BY.ROW);
  });

  it("NOT_APPLICABLE is a record state and is deliberately not one of the seventeen", () => {
    // HonestState still carries it for its record-page callers. Letting it in here would turn a
    // collection page-state contract into a general-purpose state grab bag.
    expect(HONEST_STATE.NOT_APPLICABLE).toBe("NOT_APPLICABLE");
    expect(COLLECTION_PAGE_STATE_IDS).not.toContain("NOT_APPLICABLE");
  });
});

// ═════════════════════════════════════════ the renderings are actually different

describe("the seven empties are seven sentences", () => {
  const sentence = (props) => {
    const { container, unmount } = render(<HonestState subject="work orders" {...props} />);
    const text = container.textContent.replace(/\s+/g, " ").trim();
    unmount();
    return text;
  };

  it("no two of the seven say the same thing", () => {
    // The whole reason the vocabulary exists. If two of these collapse, a person is told their
    // pipeline is empty when their permission is, or that a filter found nothing when the
    // collection is genuinely new.
    const seven = [
      sentence({ state: HONEST_STATE.EMPTY }),
      sentence({ state: HONEST_STATE.EMPTY_VIEW }),
      sentence({ state: HONEST_STATE.SEARCH_ZERO, query: "Taylor C713" }),
      sentence({ state: HONEST_STATE.FILTER_ZERO, narrowedFrom: 41 }),
      sentence({ state: HONEST_STATE.UNKNOWN }),
      sentence({ state: HONEST_STATE.DENIED }),
      sentence({ state: HONEST_STATE.UNAVAILABLE }),
    ];
    expect(new Set(seven).size, `collapsed sentences:\n${seven.join("\n")}`).toBe(7);
  });

  it("IDLE is not LOADING — it states nothing rather than announcing a request that does not exist", () => {
    const { container: idle } = render(<HonestState state={HONEST_STATE.IDLE} subject="work orders" />);
    // No live region: `aria-live` on IDLE would have assistive tech announce progress on a read
    // that has not been issued.
    expect(idle.querySelector("[aria-live]")).toBeNull();
    expect(idle.querySelector(".fo-state-loading")).toBeNull();
    expect(idle.textContent.trim()).not.toBe("");

    const { container: loading } = render(<HonestState state={HONEST_STATE.LOADING} subject="work orders" />);
    expect(loading.querySelector("[aria-live]")).not.toBeNull();
    expect(idle.textContent).not.toBe(loading.textContent);
  });

  it("SEARCH_ZERO echoes the query and states what was actually searched", () => {
    render(
      <HonestState
        state={HONEST_STATE.SEARCH_ZERO}
        subject="work orders"
        query="Taylor C713"
        scope="work order numbers beginning with this"
      />,
    );
    expect(screen.getByText(/Taylor C713/)).toBeTruthy();
    // The scope sentence is what stops "no results" reading as a claim about the whole collection
    // when the search only reached the rows already loaded.
    expect(screen.getByText(/work order numbers beginning with this/)).toBeTruthy();
  });

  it("FILTER_ZERO says how many rows the filters are eating", () => {
    render(<HonestState state={HONEST_STATE.FILTER_ZERO} subject="work orders" narrowedFrom={41} />);
    expect(screen.getByText(/41 records are being narrowed to none/)).toBeTruthy();
  });

  it("FILTER_ZERO with an unknown denominator does NOT invent one", () => {
    // Absent is not zero here either: a caller that cannot count what it is narrowing must not
    // produce "0 records are being narrowed to none", which is both false and demoralising.
    const { container } = render(<HonestState state={HONEST_STATE.FILTER_ZERO} subject="work orders" />);
    expect(container.textContent).not.toMatch(/\d/);
  });

  it("UNKNOWN renders NO number — unknown is not zero", () => {
    // The rendering has no count slot at all, so a caller cannot print a 0 beside a sentence that
    // says the answer is unknown. P2 2d: "The view says so and renders NO count."
    const { container } = render(<HonestState state={HONEST_STATE.UNKNOWN} subject="work orders" />);
    expect(container.textContent).not.toMatch(/\d/);
    expect(container.textContent).toMatch(/can't determine/i);
  });

  it("DENIED leaks nothing about what exists, and is not retryable", () => {
    const { container } = render(<HonestState state={HONEST_STATE.DENIED} subject="Work orders" />);
    expect(container.textContent).not.toMatch(/\d/);
    // A denial is not an error the reader can fix by trying again, so it must not be announced as
    // one — `role="alert"` belongs to UNAVAILABLE.
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("the pre-P2 ids still render exactly as their callers expect", () => {
    // Five record pages and two collections call these today. The six states P2 adds are additive;
    // if this fails, the extension broke something that was already accepted.
    for (const id of ["LOADING", "EMPTY", "NO_MATCHES", "DENIED", "NOT_ENABLED", "UNAVAILABLE", "NOT_APPLICABLE"]) {
      const { container, unmount } = render(<HonestState state={HONEST_STATE[id]} subject="records" />);
      expect(container.textContent.trim(), id).not.toBe("");
      unmount();
    }
  });

  it("an UNMAPPED state is still reported rather than rendered as nothing", () => {
    // The fail-blank defect this component exists to remove, re-checked after adding six branches.
    const { container } = render(<HonestState state="NOT_A_STATE" />);
    expect(container.textContent).toMatch(/could not be determined/);
  });
});

// ═════════════════════════════════════════ a row reaches its record

/**
 * Every record route this application actually mounts, derived from App.jsx.
 *
 * Read from source rather than listed by hand, for the reason navigation/objectRoutes.js gives for
 * deriving a list path from the nav config: a hand-kept copy is right on the day it is written and
 * wrong the next time a route moves, and the wrongness is invisible because nothing errors.
 *
 * The record routes are declared inside `{domain.key === "x" && ...}` blocks whose paths are
 * RELATIVE to that domain's own path in navConfig, so the domain in scope is tracked as the scan
 * walks the routing function and the two halves are joined.
 */
function mountedRoutes() {
  const src = read("App.jsx");
  const routing = src.slice(src.indexOf("function AppRoutes("));
  const domainPath = new Map(NAV_DOMAINS.map((d) => [d.key, d.path]));

  const token = /domain\.key === "([a-zA-Z]+)"|<Route[^>]*?\spath="([^"]*)"/g;
  const found = new Set();
  let domain = null;
  let m;
  while ((m = token.exec(routing)) !== null) {
    if (m[1] !== undefined) { domain = m[1]; continue; }
    const path = m[2];
    // `path="*"` is the catch-all — the very destination this check exists to keep rows away from.
    if (path === "*") continue;
    if (path.startsWith("/")) { found.add(path); continue; }
    if (!domain || !domainPath.has(domain)) continue;
    found.add(path === "" ? `/${domainPath.get(domain)}` : `/${domainPath.get(domain)}/${path}`);
  }
  return found;
}

/** Parameter names differ between a template and its route; the SHAPE is what has to match. */
const shapeOf = (route) => route.replace(/:[^/]+/g, ":param");

/** Every `rowNavigationTo` any list definition declares, with the file that declares it. */
function declaredRowNavigation() {
  const dir = join(SRC, "metadata", "definitions");
  const out = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".js")) continue;
    const source = readFileSync(join(dir, name), "utf8");
    for (const m of source.matchAll(/^\s*rowNavigationTo:\s*"([^"]+)"/gm)) {
      out.push({ file: `metadata/definitions/${name}`, template: m[1] });
    }
  }
  return out;
}

describe("rowNavigationTo names a route that exists", () => {
  it("the derivation finds the real record routes (so an empty result cannot pass this suite)", () => {
    // Without this, a regex that stopped matching would make every assertion below vacuous — the
    // mutation hole GATE 2b² found in the conformance gate, in a different shape.
    const shapes = new Set([...mountedRoutes()].map(shapeOf));
    expect(shapes).toContain("/customers/:param");
    expect(shapes).toContain("/customers/opportunities/:param");
    expect(shapes).toContain("/service/work-orders/:param");
    expect(shapes).toContain("/inventory/:param");
    expect(shapes).toContain("/equipment/:param");
  });

  it("every declared template resolves to a mounted route", () => {
    const shapes = new Set([...mountedRoutes()].map(shapeOf));
    const declared = declaredRowNavigation();
    // At least the five families that have one. A zero here would mean the scan broke.
    expect(declared.length).toBeGreaterThanOrEqual(5);

    const dead = declared.filter((d) => !shapes.has(shapeOf(d.template)));
    expect(
      dead,
      `These row-navigation templates name routes this application does not mount. A URL matching ` +
        `nothing falls through to the catch-all, so a row click lands on the Dashboard:\n` +
        dead.map((d) => `  ${d.file}: ${d.template}`).join("\n"),
    ).toEqual([]);
  });

  it("the check BITES — a plausible-looking wrong route fails it", () => {
    // Both defects this suite was written for, reproduced: "/work-orders/:id" and "/parts/:id" read
    // as obviously correct and match nothing.
    const shapes = new Set([...mountedRoutes()].map(shapeOf));
    expect(shapes.has(shapeOf("/work-orders/:id"))).toBe(false);
    expect(shapes.has(shapeOf("/parts/:id"))).toBe(false);
  });
});
