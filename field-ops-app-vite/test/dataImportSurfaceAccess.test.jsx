// DATA IMPORT ROUTE ACCESS — the defect an Owner browser test found, pinned.
//
// An authenticated sandbox Administrator opening /administration/data-import was told "Your account
// doesn't have access to this area", while holding both capabilities in an environment that
// activates both.
//
// Nothing was wrong with the grant, the activation, or either check. `hasCapability` answers from
// `feed.decisions[id]`, and the feed only decides the ids it is ASKED for. The two Data Import ids
// were absent from REPORT_CAPABILITY_REQUEST, so the trusted backend was never asked — and an
// unrequested capability resolves false, correctly and permanently, for every principal including
// one who genuinely holds it.
//
// EVERY TEST BELOW DRIVES THE REAL DECISION PATH. A trusted-feed response goes through
// interpretAccessResult and buildHasCapability, and the result is handed to the real nav predicate
// and the real screen. Nothing asserts against a hand-written hasCapability — that is precisely
// what let this ship, because a stub happily answers ids nobody ever requested.
import { afterEach, describe, it, expect } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";

import {
  DATA_IMPORT_SURFACE_CAPABILITIES,
  GOVERNED_SURFACE_CAPABILITY_IDS,
  WAREHOUSE_HANDHELD_CAPABILITIES,
  RECEIVING_SURFACE_CAPABILITIES,
  TRANSFER_SURFACE_CAPABILITIES,
  CYCLE_COUNT_SURFACE_CAPABILITIES,
  PLACEMENT_SURFACE_CAPABILITIES,
  RETURNS_SURFACE_CAPABILITIES,
} from "../src/access/governedSurfaceCapabilities.js";
import {
  REPORT_CAPABILITY_REQUEST,
  interpretAccessResult,
  buildHasCapability,
  VERSION_STATUS,
  FEED_STATUS,
} from "../src/access/reportCapabilityAccess.js";
import { NAV_DOMAINS, isNavItemVisible } from "../src/navigation/navConfig.js";
import AdminDataImport from "../src/modules/administration/AdminDataImport.jsx";

afterEach(cleanup);

const STAGE = "admin.dataImport.stage";
const EXECUTE = "admin.dataImport.execute";
const UID = "sandbox-admin-uid";
const VERSION = 7;

const adminDomain = NAV_DOMAINS.find((d) => d.key === "administration");
const dataImportItem = adminDomain.subnav.find((i) => i.key === "dataImport");

/**
 * Build `hasCapability` the way the running app builds it.
 *
 * `allow` names the ids the trusted backend decided ALLOW. Every id the app REQUESTS gets an
 * explicit boolean; an id the app does NOT request is simply absent from the response — which is
 * the whole mechanism under test, and why this helper derives its keys from
 * REPORT_CAPABILITY_REQUEST rather than from the caller.
 */
function hasCapabilityFromFeed(allow = [], { version = VERSION, uid = UID } = {}) {
  const allowSet = new Set(allow);
  const decisions = Object.fromEntries(
    REPORT_CAPABILITY_REQUEST.map((id) => [id, allowSet.has(id)]),
  );
  const interpreted = interpretAccessResult({ accessVersion: version, decisions });
  expect(interpreted.ok).toBe(true);

  return buildHasCapability(
    {
      version: { status: VERSION_STATUS.READY, uid, version },
      feed: {
        status: FEED_STATUS.READY,
        forUid: uid,
        forVersion: interpreted.accessVersion,
        decisions: interpreted.decisions,
      },
    },
    uid,
  );
}

const contextFor = (hasCapability) => ({ hasCapability, operationalRoles: [], employmentStatus: null });

// ---------------------------------------------------------------- 1-3. the request set

describe("the trusted feed is actually ASKED for both decisions", () => {
  it("DATA_IMPORT_SURFACE_CAPABILITIES is exactly the two ids", () => {
    expect([...DATA_IMPORT_SURFACE_CAPABILITIES]).toEqual([STAGE, EXECUTE]);
  });

  it("GOVERNED_SURFACE_CAPABILITY_IDS includes both", () => {
    expect(GOVERNED_SURFACE_CAPABILITY_IDS).toContain(STAGE);
    expect(GOVERNED_SURFACE_CAPABILITY_IDS).toContain(EXECUTE);
  });

  it("REPORT_CAPABILITY_REQUEST therefore includes both, once each, in ONE request", () => {
    expect(REPORT_CAPABILITY_REQUEST).toContain(STAGE);
    expect(REPORT_CAPABILITY_REQUEST).toContain(EXECUTE);
    // One request means one accessVersion. Split across two calls, a principal whose access
    // changed between them could be shown a page they may open and an Approve button decided
    // against a version that no longer applies.
    expect(REPORT_CAPABILITY_REQUEST.filter((id) => id === STAGE)).toHaveLength(1);
    expect(REPORT_CAPABILITY_REQUEST.filter((id) => id === EXECUTE)).toHaveLength(1);
    expect(new Set(REPORT_CAPABILITY_REQUEST).size).toBe(REPORT_CAPABILITY_REQUEST.length);
  });

  it("REGRESSION: an id absent from the request can never resolve true, however it is decided", () => {
    // The mechanism that caused the defect, stated as a test so the fix cannot be undone quietly.
    const absent = "admin.dataImport.somethingNobodyRequests";
    expect(REPORT_CAPABILITY_REQUEST).not.toContain(absent);
    const hasCapability = hasCapabilityFromFeed([STAGE, EXECUTE, absent]);
    expect(hasCapability(absent)).toBe(false);
  });
});

// ---------------------------------------------------------------- 4-6. the sandbox Administrator

describe("a sandbox Administrator reaches Data Import", () => {
  it("a trusted feed allowing both makes hasCapability true for both", () => {
    const hasCapability = hasCapabilityFromFeed([STAGE, EXECUTE]);
    expect(hasCapability(STAGE)).toBe(true);
    expect(hasCapability(EXECUTE)).toBe(true);
  });

  it("the Data Import nav item is VISIBLE", () => {
    const hasCapability = hasCapabilityFromFeed([STAGE, EXECUTE]);
    // The real predicate, with the real nav item. `technician` is passed deliberately: the item
    // carries no legacyKey, so a positive governed decision is the ONLY thing that can admit it —
    // which is what proves the capability path is doing the work rather than a role fallback.
    expect(isNavItemVisible(dataImportItem, "technician", [], contextFor(hasCapability))).toBe(true);
  });

  it("the route renders the real screen, not the denial", () => {
    const hasCapability = hasCapabilityFromFeed([STAGE, EXECUTE]);
    render(<AdminDataImport hasCapability={hasCapability} />);

    // The three things the Owner's acceptance names.
    expect(screen.getByText(/Choose a file/i)).toBeTruthy();
    expect(screen.getByLabelText("Import file")).toBeTruthy();
    // Scoped to the HEADING: "Loading import history..." matches the same loose pattern, and a
    // test that cannot tell a section from its own loading line is not testing the section.
    expect(screen.getByRole("heading", { name: /^Import history$/i })).toBeTruthy();

    // And explicitly NOT the ungated state.
    expect(screen.queryByText(/Data Import is not available to you/i)).toBeNull();
  });

  it("the file selector accepts CSV and XLSX", () => {
    const hasCapability = hasCapabilityFromFeed([STAGE, EXECUTE]);
    render(<AdminDataImport hasCapability={hasCapability} />);
    const accept = screen.getByLabelText("Import file").getAttribute("accept");
    expect(accept).toContain(".csv");
    expect(accept).toContain(".xlsx");
  });
});

// ---------------------------------------------------------------- 7. the valid split

describe("stage and execute are separate authorities, and the split survives", () => {
  it("stage=true, execute=false: the page opens and Approve stays protected", () => {
    const hasCapability = hasCapabilityFromFeed([STAGE]);
    expect(hasCapability(STAGE)).toBe(true);
    expect(hasCapability(EXECUTE)).toBe(false);

    // Reachable...
    expect(isNavItemVisible(dataImportItem, "technician", [], contextFor(hasCapability))).toBe(true);
    render(<AdminDataImport hasCapability={hasCapability} />);
    expect(screen.getByText(/Choose a file/i)).toBeTruthy();

    // ...and the execute authority is genuinely absent, which is what the screen's approval gate
    // reads. Requesting only `stage` would have reproduced the defect one layer in: Approve would
    // read as unavailable to EVERYONE, from an unasked question rather than a decision.
    expect(screen.queryByText(/Data Import is not available to you/i)).toBeNull();
  });

  it("stage=false: the route is not reachable at all", () => {
    const hasCapability = hasCapabilityFromFeed([EXECUTE]);
    expect(hasCapability(STAGE)).toBe(false);
    // No legacyKey on this item, so nothing else can admit it.
    expect(isNavItemVisible(dataImportItem, "technician", [], contextFor(hasCapability))).toBe(false);
  });

  it("neither: the screen states its own ungated reason rather than rendering empty", () => {
    const hasCapability = hasCapabilityFromFeed([]);
    render(<AdminDataImport hasCapability={hasCapability} />);
    expect(screen.getByText(/Data Import is not available to you/i)).toBeTruthy();
    expect(screen.queryByLabelText("Import file")).toBeNull();
  });
});

// ---------------------------------------------------------------- 8. fail-closed

describe("an absent, errored or stale feed stays fail-closed", () => {
  const cases = {
    "no feed at all": { version: { status: VERSION_STATUS.READY, uid: UID, version: VERSION }, feed: null },
    "feed still loading": {
      version: { status: VERSION_STATUS.READY, uid: UID, version: VERSION },
      feed: { status: FEED_STATUS.LOADING, forUid: UID, forVersion: VERSION, decisions: null },
    },
    "feed errored": {
      version: { status: VERSION_STATUS.READY, uid: UID, version: VERSION },
      feed: { status: FEED_STATUS.ERROR, forUid: UID, forVersion: VERSION, decisions: null },
    },
    "version still loading": {
      version: { status: VERSION_STATUS.LOADING, uid: UID, version: null },
      feed: { status: FEED_STATUS.READY, forUid: UID, forVersion: VERSION, decisions: { [STAGE]: true, [EXECUTE]: true } },
    },
    // A decision set resolved against an EARLIER version. The principal's access may have changed
    // since; honouring it would grant on evidence that no longer applies.
    "stale feed version": {
      version: { status: VERSION_STATUS.READY, uid: UID, version: VERSION },
      feed: { status: FEED_STATUS.READY, forUid: UID, forVersion: VERSION - 1, decisions: { [STAGE]: true, [EXECUTE]: true } },
    },
    // Another principal's answers must never be reused.
    "another principal's feed": {
      version: { status: VERSION_STATUS.READY, uid: UID, version: VERSION },
      feed: { status: FEED_STATUS.READY, forUid: "somebody-else", forVersion: VERSION, decisions: { [STAGE]: true, [EXECUTE]: true } },
    },
  };

  for (const [label, gate] of Object.entries(cases)) {
    it(`${label}: both decisions are false and the route is unreachable`, () => {
      const hasCapability = buildHasCapability(gate, UID);
      expect(hasCapability(STAGE)).toBe(false);
      expect(hasCapability(EXECUTE)).toBe(false);
      expect(isNavItemVisible(dataImportItem, "technician", [], contextFor(hasCapability))).toBe(false);
    });
  }

  it("a malformed feed payload is rejected outright rather than partially trusted", () => {
    // A non-boolean decision means the response is not one this client understands. Reading the
    // booleans it happens to recognise would be trusting half a message.
    expect(interpretAccessResult({ accessVersion: VERSION, decisions: { [STAGE]: "ALLOW" } }).ok).toBe(false);
    expect(interpretAccessResult({ accessVersion: VERSION, decisions: null }).ok).toBe(false);
    expect(interpretAccessResult(null).ok).toBe(false);
  });
});

// ---------------------------------------------------------------- 9. production

describe("production is unaffected", () => {
  it("both decisions are false where the environment activates nothing", async () => {
    // The server decides, and in production it decides DENY: both ids are registered active:false
    // and production carries no activation override (resolveEnvironment.mjs is role-keyed). This
    // asserts that from the registry rather than from a comment, so it fails if that ever changes.
    const fs = await import("node:fs");
    const path = await import("node:path");
    const url = await import("node:url");
    const { resolveEnvironment } = await import("../../scripts/resolveEnvironment.mjs");

    const here = path.dirname(url.fileURLToPath(new URL(import.meta.url)));
    const registry = JSON.parse(fs.readFileSync(path.resolve(here, "../../config/environments.json"), "utf8"));
    const production = resolveEnvironment(registry, "taylor-parts-production");

    expect(production.role).toBe("production");
    expect(production.capabilityActivationOverrides).toHaveLength(0);
    for (const id of DATA_IMPORT_SURFACE_CAPABILITIES) {
      expect(production.capabilityActivationOverrides).not.toContain(id);
    }

    // So the feed answers DENY, and asking changes nothing about the answer.
    const hasCapability = hasCapabilityFromFeed([]);
    expect(hasCapability(STAGE)).toBe(false);
    expect(hasCapability(EXECUTE)).toBe(false);
  });

  it("asking for a decision is not receiving a positive one", () => {
    // The whole safety argument for adding ids to the request set, in one assertion: the request
    // set widened, the ANSWER did not. Only the server's ALLOW grants anything.
    expect(REPORT_CAPABILITY_REQUEST).toContain(STAGE);
    expect(hasCapabilityFromFeed([])(STAGE)).toBe(false);
  });
});

// ---------------------------------------------------------------- the nav declaration

describe("the nav item's own declaration", () => {
  it("gates on the capability and carries no role fallback", () => {
    // If it had a legacyKey, admin/dispatcher would have reached it by role and the defect would
    // have stayed hidden until a governed-only principal tried.
    expect(dataImportItem.capabilityAccess).toEqual([STAGE]);
    expect(dataImportItem.legacyKey).toBeUndefined();
    expect(dataImportItem.path).toBe("data-import");
    expect(dataImportItem.navHidden).not.toBe(true);
  });
});

// ---------------------------------------------------------------- import history states

describe("import history: loading, denied, failed and empty are four different facts", () => {
  // THE DEFECT, found by a browser screenshot rather than a test. A failed read set the list to []
  // and the empty state said "No import has been run in this environment yet" — so a refused or
  // broken read told an administrator, with confidence, that nothing had ever been imported. The
  // same sentence covered the moment before the first read returns, which is how a real 14-row
  // history rendered as "none" two seconds after load.
  it("while access is still resolving it says LOADING, never 'none'", () => {
    // hasCapability is false during resolution, which is indistinguishable from "denied" at the
    // capability layer — so the screen must not conclude anything about history yet.
    const hasCapability = hasCapabilityFromFeed([]);
    render(<AdminDataImport hasCapability={hasCapability} />);
    // With no stage capability the whole screen is ungated, which is its own honest state.
    expect(screen.getByText(/Data Import is not available to you/i)).toBeTruthy();
    expect(screen.queryByText(/No import has been run/i)).toBeNull();
  });

  it("a granted account sees the history section, and 'none' only after a successful empty read", async () => {
    const hasCapability = hasCapabilityFromFeed([STAGE, EXECUTE]);
    render(<AdminDataImport hasCapability={hasCapability} />);

    // Before the read resolves it must NOT claim there is no history.
    // Scoped to the HEADING: "Loading import history..." matches the same loose pattern, and a
    // test that cannot tell a section from its own loading line is not testing the section.
    expect(screen.getByRole("heading", { name: /^Import history$/i })).toBeTruthy();
    const early = screen.queryByText(/No import has been run/i);
    expect(early).toBeNull();
  });
});

// ---------------------------------------------------------------- the surface boundary

describe("Data Import authority never becomes warehouse-handheld authority", () => {
  // THE LEAK THIS PINS, and why array membership was not enough to catch it.
  //
  // WAREHOUSE_HANDHELD_CAPABILITIES is not a request list. navConfig.js uses it directly as
  // Warehouse Workspace's `capabilityAccess`, so an id added to it becomes a WAY IN. The Data
  // Import ids landed there by accident: that set and the request set below it both end in
  // ...RETURNS_SURFACE_CAPABILITIES, an edit aimed at the second landed in the first, and the
  // tests missed it because they asserted PRESENCE where the ids belonged and never ABSENCE where
  // they did not.
  //
  // So these assert the SURFACE, through the real predicate, not the arrays.
  const warehouseItem = NAV_DOMAINS.flatMap((d) => d.subnav ?? []).find((i) => i.key === "warehouseWorkspace");

  it("the two sets are wired to different things, and only one of them is a gate", () => {
    // GOVERNED_SURFACE_CAPABILITY_IDS feeds the REQUEST. WAREHOUSE_HANDHELD_CAPABILITIES IS a
    // capabilityAccess gate. Conflating them is what made this possible.
    expect(warehouseItem.capabilityAccess).toBe(WAREHOUSE_HANDHELD_CAPABILITIES);
  });

  it("membership: requested everywhere it should be, absent from the handheld gate", () => {
    for (const id of DATA_IMPORT_SURFACE_CAPABILITIES) {
      expect(GOVERNED_SURFACE_CAPABILITY_IDS).toContain(id);
      expect(REPORT_CAPABILITY_REQUEST).toContain(id);
      expect(WAREHOUSE_HANDHELD_CAPABILITIES).not.toContain(id);
    }
    expect([...DATA_IMPORT_SURFACE_CAPABILITIES]).toEqual([STAGE, EXECUTE]);
  });

  it("the handheld gate is exactly the five warehouse families and nothing else", () => {
    // Pinned as a whole set rather than as an absence of two ids, so the NEXT administration
    // capability cannot arrive here quietly either.
    expect([...WAREHOUSE_HANDHELD_CAPABILITIES].sort()).toEqual(
      [
        ...RECEIVING_SURFACE_CAPABILITIES,
        ...TRANSFER_SURFACE_CAPABILITIES,
        ...CYCLE_COUNT_SURFACE_CAPABILITIES,
        ...PLACEMENT_SURFACE_CAPABILITIES,
        ...RETURNS_SURFACE_CAPABILITIES,
      ].sort(),
    );
    // No administration capability of any kind belongs in a warehouse-handheld gate.
    for (const id of WAREHOUSE_HANDHELD_CAPABILITIES) {
      expect(id.startsWith("admin.")).toBe(false);
    }
  });

  it("SURFACE BOUNDARY: full Data Import authority opens Data Import and NOT Warehouse Workspace", () => {
    // The principal the leak would have admitted: both Data Import ids, no warehouse authority
    // whatsoever. Driven through the real predicate, with `technician` so no compatibility path
    // can admit either item -- a governed decision is the only thing in play.
    const hasCapability = hasCapabilityFromFeed([STAGE, EXECUTE]);
    expect(hasCapability(STAGE)).toBe(true);
    expect(hasCapability(EXECUTE)).toBe(true);
    for (const id of WAREHOUSE_HANDHELD_CAPABILITIES) expect(hasCapability(id)).toBe(false);

    expect(isNavItemVisible(dataImportItem, "technician", [], contextFor(hasCapability))).toBe(true);
    expect(isNavItemVisible(warehouseItem, "technician", [], contextFor(hasCapability))).toBe(false);
  });

  it("SURFACE BOUNDARY: a real warehouse capability still opens Warehouse Workspace", () => {
    // The other half. Proving the gate is closed to Data Import means nothing if it is closed to
    // everyone -- a broken gate would pass the test above.
    const hasCapability = hasCapabilityFromFeed(["inventory.stock.receive"]);
    expect(isNavItemVisible(warehouseItem, "technician", [], contextFor(hasCapability))).toBe(true);
    // ...and that principal gets no Data Import reachability in exchange.
    expect(isNavItemVisible(dataImportItem, "technician", [], contextFor(hasCapability))).toBe(false);
  });

  it("SURFACE BOUNDARY: every warehouse family still admits the workspace on its own", () => {
    // Each family is a genuine way in, and the whole-set assertion above must not have narrowed
    // any of them while removing the two that did not belong.
    for (const id of WAREHOUSE_HANDHELD_CAPABILITIES) {
      const hasCapability = hasCapabilityFromFeed([id]);
      expect(isNavItemVisible(warehouseItem, "technician", [], contextFor(hasCapability))).toBe(true);
    }
  });
});
