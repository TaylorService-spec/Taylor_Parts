// POWERSHELL ENCODING GUARD -- every .ps1 must be pure ASCII, or carry a UTF-8 BOM.
// Run: node --test scripts/powershellEncoding.test.mjs
//
// ============================ THE FAILURE THIS EXISTS TO STOP ============================
//
// Windows PowerShell 5.1 -- still the default `powershell.exe` on Windows 10 -- reads a .ps1 file as
// ANSI (CP1252) unless the file carries a UTF-8 BOM. It does NOT assume UTF-8.
//
// So a UTF-8 em dash (E2 80 94) is decoded as three CP1252 characters, and the last of them, 0x94,
// is a RIGHT DOUBLE QUOTATION MARK. PowerShell's parser treats it as a quote.
//
// That means an em dash in a COMMENT silently breaks string parsing somewhere further down the file,
// and the reported error points at a line that is perfectly correct. The real cause is invisible.
//
// It has already happened once here: scripts/Invoke-SandboxRefresh.ps1 shipped with em dashes in its
// header comments and failed with "The string is missing the terminator" at line 77 -- seventy lines
// below the actual problem.
//
// ============================ WHY THE OBVIOUS CHECK IS NOT ENOUGH ============================
//
// Tokenizing the file's CONTENT after reading it with a UTF-8-aware tool proves nothing: the tool
// decodes it correctly and the parse succeeds. The bug only appears when PowerShell itself opens the
// file. So this guard checks the BYTES, which is the thing that actually differs.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKIP = new Set(["node_modules", ".git", "dist", "build", "lib", "coverage"]);

function findPowerShellFiles(dir, found = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = path.join(dir, entry);
    let s;
    try { s = statSync(full); } catch { continue; }
    if (s.isDirectory()) findPowerShellFiles(full, found);
    else if (entry.toLowerCase().endsWith(".ps1")) found.push(full);
  }
  return found;
}

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);

test("every .ps1 is pure ASCII, or declares its encoding with a UTF-8 BOM", () => {
  const files = findPowerShellFiles(ROOT);
  assert.ok(files.length > 0, "the guard found no .ps1 files at all -- it is not looking where it thinks");

  const offenders = [];
  for (const file of files) {
    const bytes = readFileSync(file);
    if (bytes.subarray(0, 3).equals(UTF8_BOM)) continue; // BOM present: PowerShell reads it as UTF-8.

    for (let i = 0; i < bytes.length; i += 1) {
      const b = bytes[i];
      // Printable ASCII plus tab, LF and CR. Anything else is decoded as CP1252 by PowerShell 5.1.
      const ok = (b >= 0x20 && b <= 0x7e) || b === 0x09 || b === 0x0a || b === 0x0d;
      if (ok) continue;
      const line = bytes.subarray(0, i).toString("latin1").split("\n").length;
      offenders.push(`${path.relative(ROOT, file)}:${line} byte 0x${b.toString(16).padStart(2, "0")}`);
      break; // one report per file is enough to act on
    }
  }

  assert.deepEqual(
    offenders,
    [],
    "These .ps1 files contain non-ASCII bytes and no UTF-8 BOM. Windows PowerShell 5.1 will decode " +
    "them as CP1252, and 0x94 becomes a closing quote that breaks string parsing far from the real " +
    "cause. Replace the characters with ASCII (em dash -> --), or save the file with a UTF-8 BOM:\n  " +
    offenders.join("\n  "),
  );
});
