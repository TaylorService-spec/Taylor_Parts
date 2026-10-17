// Board -> Employee record -> Work Schedule, and back: the addresses, and the open-redirect guard.
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { BOARD_PATH, employeeScheduleHref, safeBoardReturn } from "../src/domain/employeeScheduleLink.js";

describe("the Work schedule link", () => {
  it("opens the Employee record on its Work Schedule tab, carrying the board address back", () => {
    const board = "/service/dispatcher-board?view=week&focus=emp-1";
    const href = employeeScheduleHref("emp-1", board);
    const url = new URL(href, "https://app.example");
    assert.equal(url.pathname, "/administration/users/emp-1");
    assert.equal(url.searchParams.get("tab"), "schedule");
    assert.equal(url.searchParams.get("back"), board);
  });
  it("encodes the Employee id and drops a back that is not the board", () => {
    const href = employeeScheduleHref("a/b c", "https://evil.example");
    assert.equal(new URL(href, "https://app.example").pathname, "/administration/users/a%2Fb%20c");
    assert.equal(new URL(href, "https://app.example").searchParams.get("back"), null);
  });
});

describe("Back to the board accepts only the board", () => {
  it("accepts the board path, with or without a query", () => {
    assert.equal(safeBoardReturn(BOARD_PATH), BOARD_PATH);
    assert.equal(safeBoardReturn(`${BOARD_PATH}?view=week&techs=a,b`), `${BOARD_PATH}?view=week&techs=a,b`);
  });
  it("refuses anything else", () => {
    for (const bad of [null, undefined, "", "https://evil.example", "//evil.example", "/service/dispatcher-boards",
      "/service/dispatcher-board/x", "/administration/users", "/service/dispatcher-board#frag", "/service/dispatcher-board?a=\\b",
      "/service/dispatcher-board?a=\u0008", "/service/dispatcher-board?a=\n",
      "javascript:alert(1)", `${BOARD_PATH}?${"x".repeat(4100)}`]) {
      assert.equal(safeBoardReturn(bad), null, String(bad).slice(0, 40));
    }
  });
});
