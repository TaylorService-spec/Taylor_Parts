// NO SOURCE FILE CARRIES A LITERAL CONTROL BYTE WHERE AN ESCAPE SEQUENCE BELONGS.
// Run: node --test test/noLiteralControlBytes.test.mjs
//
// ════════════════════ THE DEFECT THIS CLOSES ════════════════════
//
// The certification harness's RAW_ID detector read:
//
//     text.match(/\b[A-Za-z0-9]{20}\b/g)
//
// except the two `\b` sequences were not escapes. They were a single byte 0x08 — an actual
// BACKSPACE character — so the pattern was /<BS>[A-Za-z0-9]{20}<BS>/ and could never match
// anything. The detector had never been capable of firing.
//
// That is why the sweep reported ZERO raw-id findings across 270 visits while SalesOrderDetail was
// rendering a Firestore document id as visible content. The missing dynamic routes were real, and
// they were the second reason; this was the first.
//
// FOUR MORE FILES CARRIED THE SAME CORRUPTION, and every one of them was a NEGATIVE assertion:
//
//     cycleCountScan            expect(body).not.toMatch(/\b12\b/)
//     cycleCountScan            expect(body).not.toMatch(/\b(over|short) by\b/i)
//     loginHistoryNavigation    expect(container.textContent).not.toMatch(/\bEOS\b/)
//     technicianShellReachability   .filter(f => /\b(setDoc|updateDoc|…)\s*\(/.test(…))
//
// A pattern that cannot match makes `not.toMatch` ALWAYS TRUE and makes that `.filter` return
// nothing. Four guards — one of them about technician write authority — passed unconditionally,
// and every one of them would have kept passing while the thing it guards broke.
//
// ════════════════════ WHY A BYTE-LEVEL GUARD ════════════════════
//
// This is not a typo anybody makes by hand: it is what an escaping layer does when `\b` passes
// through one interpreter too many. It is invisible in an editor, invisible in a diff, and it
// renders as `\b` in JSON.stringify output — which is how it survived being looked at directly.
// Nothing but a byte check can see it.
//
// It applies to every control character, not only 0x08: \f (0x0C), \v (0x0B) and \0 fail the same
// way for the same reason. Tab, newline and carriage return are excluded because they are ordinary
// whitespace in source.

import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const roots = [path.resolve(here, ".."), path.resolve(here, "..", "..", "functions", "src"), path.resolve(here, "..", "..", "scripts")];
const SKIP = new Set(["node_modules", ".git", "dist", "coverage", "build", ".vite"]);
const SOURCE = /\.(mjs|cjs|js|jsx|ts|tsx|sh|json|yml|yaml|css|html)$/;

// WHICH BYTES THIS HUNTS, AND WHY NOT ALL OF THEM.
//
// The corruption is an ESCAPE SEQUENCE that lost its backslash, so the guard targets exactly the
// bytes a JS escape can collapse into: \b, \f, \v and \0. Each has a valid escape form, so a
// literal one in source is far more likely a mangled escape than an intent.
//
// ESC (27) IS DELIBERATELY NOT HUNTED. JavaScript has no \e escape, so a literal ESC cannot arise
// from this corruption — it is always written on purpose, and it IS written on purpose here:
// scripts/verifyDeployedCallablesFirebase.mjs strips ANSI colour codes from CLI output with a
// literal-ESC regex, carrying its own eslint-disable for no-control-regex. Flagging it would ask
// somebody to break working code to satisfy a guard aimed at a different problem.
const HUNTED = new Map([
  [0, "\\0 (NUL)"],
  [8, "\\b (BACKSPACE)"],
  [11, "\\v (VERTICAL TAB)"],
  [12, "\\f (FORM FEED)"],
]);
/** Tab, newline and carriage return are ordinary whitespace in source. */
const ALLOWED = new Set([9, 10, 13]);

function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (SKIP.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (SOURCE.test(e.name)) out.push(full);
  }
  return out;
}

const files = [...new Set(roots.flatMap((r) => walk(r)))];

test("the scan actually reached the source tree", () => {
  // A walk that silently returns nothing turns the assertion below into a vacuous pass — which is
  // precisely the failure mode this file exists to catch.
  assert.ok(files.length > 400, `expected the source tree, scanned ${files.length} files`);
  assert.ok(files.some((f) => f.endsWith("certify.mjs")) || files.some((f) => f.endsWith("probe.mjs")),
    "the certification harness must be in scope — it is where this was found");
});

test("NO LITERAL CONTROL BYTE APPEARS IN ANY SOURCE FILE", () => {
  const offenders = [];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (let i = 0; i < text.length; i += 1) {
      const code = text.charCodeAt(i);
      if (HUNTED.has(code)) {
        const line = text.slice(0, i).split("\n").length;
        offenders.push(`${path.relative(path.resolve(here, "..", ".."), file)}:${line} contains ${HUNTED.get(code)}`);
        break; // one report per file is enough to act on
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "A literal control byte where an escape belongs silently disables whatever reads it — a regex " +
      "that can never match, and therefore a `not.toMatch` that can never fail:\n  " + offenders.join("\n  "),
  );
});

test("MUTATION PROOF: the guard detects an injected backspace", () => {
  // The check it replaces reported zero for months. Before trusting a zero from this one, prove it
  // is capable of a non-zero.
  const poisoned = `const re = /${String.fromCharCode(8)}word${String.fromCharCode(8)}/;`;
  const found = [...poisoned].some((c) => HUNTED.has(c.charCodeAt(0)));
  assert.equal(found, true, "the byte check must see an injected backspace");
  // And it must NOT fire on the ordinary whitespace every file contains.
  const clean = "const re = /\\bword\\b/;\n\tindented\r\n";
  assert.equal([...clean].some((c) => HUNTED.has(c.charCodeAt(0))), false);
});
