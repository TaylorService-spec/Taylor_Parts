import { expect, test } from "vitest";
import { isoDate, parseLocalDate } from "../src/modules/sales/SalesWorkspace.jsx";

test("Sales Workspace date input uses the same local calendar day as its display", () => {
  const value = new Date(2026, 7, 12, 18).getTime();
  expect(isoDate(value)).toBe("2026-08-12");
  const parsed = new Date(parseLocalDate("2026-08-12"));
  expect(parsed.getFullYear()).toBe(2026);
  expect(parsed.getMonth()).toBe(7);
  expect(parsed.getDate()).toBe(12);
});
