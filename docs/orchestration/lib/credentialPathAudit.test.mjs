import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyCredentialPath } from "./credentialPathAudit.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

test("every executable credential/provider occurrence is explicitly classified; none is UNSAFE/BYPASS", () => {
  const files = execFileSync("git", ["ls-files", "*.mjs", "*.ps1", ".github/workflows/*.yml"], { cwd: root, encoding: "utf8" }).split(/\r?\n/).filter(Boolean);
  const hits = files.filter((path) => /OPENAI_API_KEY|Authorization:\s*`Bearer|createOpenAICredentialTransport|invokeOpenAI/.test(readFileSync(resolve(root, path), "utf8")));
  assert.ok(hits.length > 0);
  const classified = hits.map((path) => ({ path: relative(root, resolve(root, path)).replaceAll("\\", "/"), classification: classifyCredentialPath(path.replaceAll("\\", "/")) }));
  assert.deepEqual(classified.filter((item) => item.classification === "UNSAFE/BYPASS"), []);
  assert.ok(classified.some((item) => item.classification === "AUTHORIZED BROKER PATH"));
  assert.ok(classified.some((item) => item.classification === "LEGACY ISOLATED PATH"));
  assert.ok(classified.some((item) => item.classification === "TEST/FIXTURE"));
});

test("governed EOS transport delegates credential resolution only to broker.withCredential", () => {
  const source = readFileSync(resolve(root, "docs/orchestration/lib/openaiCredentialTransport.mjs"), "utf8");
  assert.match(source, /broker\.withCredential\("OPENAI_REVIEW"/);
  assert.doesNotMatch(source, /process\.env|OPENAI_API_KEY|Authorization:\s*`Bearer/);
});
