import test from "node:test";
import assert from "node:assert/strict";
import { FINDINGS, SUBJECT_HEAD } from "./pr790-final-evidence.mjs";

test("final evidence declares only F1-F4 and exact immutable subject", () => {
  assert.deepEqual(Object.keys(FINDINGS), ["F1", "F2", "F3", "F4"]); assert.equal(SUBJECT_HEAD, "8a71f7cd3006fc149c7a80c52967a1643935ac7d");
  for (const cases of Object.values(FINDINGS)) for (const [file, name] of cases) { assert.ok(!/^[A-Za-z]:\\/.test(file)); assert.ok(file.includes("/") && name.length > 10); }
});
