// G-6: the Dispatcher Board's view, date and technician filter survive Back, refresh and a link.
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { readBoardUrlState, writeBoardUrlState } from "../src/domain/dispatchBoardUrlState.js";

const NOW = new Date(2026, 9, 15, 10, 40).getTime();
const TODAY = new Date(2026, 9, 15).getTime();

describe("reading the board state from the URL", () => {
  it("an empty URL is today's Day view with every technician", () => {
    const s = readBoardUrlState(new URLSearchParams(""), NOW);
    assert.deepEqual(s, { view: "DAY", anchorMillis: TODAY, technicianFilter: null });
  });

  it("reads view, date and the technician filter", () => {
    const s = readBoardUrlState(new URLSearchParams("view=week&date=2026-10-20&techs=emp-b,emp-a"), NOW);
    assert.equal(s.view, "WEEK");
    assert.equal(s.anchorMillis, new Date(2026, 9, 20).getTime());
    assert.deepEqual([...s.technicianFilter].sort(), ["emp-a", "emp-b"]);
  });

  it("unknown or retired values fall back instead of breaking the board", () => {
    // `map` was a view; it is not one any more (Map is honestly unavailable).
    for (const q of ["view=map", "view=MONTH", "date=2026-02-31", "date=yesterday"]) {
      const s = readBoardUrlState(new URLSearchParams(q), NOW);
      assert.equal(s.view, "DAY", q);
      assert.equal(s.anchorMillis, TODAY, q);
      assert.equal(s.technicianFilter, null, q);
    }
  });

  it("an explicitly empty filter hides every lane; an absent one shows everyone", () => {
    assert.equal(readBoardUrlState(new URLSearchParams("techs=,,"), NOW).technicianFilter.size, 0);
    assert.equal(writeBoardUrlState(new URLSearchParams(), { view: "DAY", anchorMillis: NOW, technicianFilter: new Set() }, NOW).toString(), "techs=");
  });
});

describe("writing the board state to the URL", () => {
  it("round-trips, and leaves other params alone", () => {
    const state = { view: "FORTNIGHT", anchorMillis: new Date(2026, 9, 27).getTime(), technicianFilter: new Set(["emp-z", "emp-a"]) };
    const written = writeBoardUrlState(new URLSearchParams("keep=1"), state, NOW);
    assert.equal(written.toString(), "keep=1&view=fortnight&date=2026-10-27&techs=emp-a%2Cemp-z");
    const back = readBoardUrlState(written, NOW);
    assert.equal(back.view, "FORTNIGHT");
    assert.equal(back.anchorMillis, state.anchorMillis);
    assert.deepEqual([...back.technicianFilter].sort(), ["emp-a", "emp-z"]);
  });

  it("omits defaults: Day, today and everyone leave a clean URL", () => {
    const written = writeBoardUrlState(new URLSearchParams("view=week&date=2026-10-20&techs=a"),
      { view: "DAY", anchorMillis: NOW, technicianFilter: null }, NOW);
    assert.equal(written.toString(), "");
  });
});
