import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalize, sha256Canonical } from "../lib/reviewArtifacts.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..", "..", "..");
export const SUBJECT_HEAD = "8a71f7cd3006fc149c7a80c52967a1643935ac7d";
export const PR_NUMBER = 790;
export const RESOLUTION_PATH = "docs/orchestration/reviews/resolutions/PR-790-F1-F4.resolution.json";

export const FINDINGS = Object.freeze({
  F1: [
    ["docs/orchestration/lib/secretProvider.test.mjs", "secret-bearing resolver/callback exceptions are replaced with stable non-secret codes"],
    ["docs/orchestration/lib/secretProvider.test.mjs", "DPAPI child receives only allowlisted environment metadata, never ambient credentials"],
    ["docs/orchestration/lib/secretProvider.test.mjs", "callback cannot return the raw credential in result/evidence"],
    ["integrations/chatgpt-eos-intake/test/app.test.mjs", "MCP internal errors never reflect store exception text"],
  ],
  F2: [
    ["integrations/chatgpt-eos-intake/test/reviewAuthorization.test.mjs", "review authorization binds authenticated Owner, work, budget, source, and hash without credential fields"],
    ["docs/orchestration/lib/openaiCredentialTransport.test.mjs", "binding mismatch and duplicate invocation refuse before credential/provider"],
  ],
  F3: [
    ["docs/orchestration/lib/credentialPathAudit.test.mjs", "every executable credential/provider occurrence is explicitly classified; none is UNSAFE/BYPASS"],
    ["docs/orchestration/lib/credentialPathAudit.test.mjs", "audit implementation is AUDIT_TOOLING only while it has no executable credential/provider behavior"],
    ["docs/orchestration/lib/credentialPathAudit.test.mjs", "unknown executable credential-use path remains fail-closed UNSAFE/BYPASS"],
    ["docs/orchestration/lib/credentialPathAudit.test.mjs", "known broker/runtime paths retain explicit classification"],
    ["docs/orchestration/lib/credentialPathAudit.test.mjs", "governed EOS transport delegates credential resolution only to broker.withCredential"],
  ],
  F4: [
    ["docs/orchestration/lib/openaiCredentialTransport.test.mjs", "per-invocation estimate above the authorized ceiling never resolves a credential"],
    ["docs/orchestration/lib/openaiCredentialTransport.test.mjs", "cumulative ceiling survives calls/retries and refuses before provider"],
    ["docs/orchestration/lib/openaiCredentialTransport.test.mjs", "durable ledger preserves cumulative spend and at-most-once ids across transport restart"],
  ],
});

const SUPPORT = Object.freeze({
  "docs/orchestration/lib/secretProvider.mjs": { findings: ["F1", "F3"], symbols: ["resolveDpapiSecret", "createSecretBroker", "withCredential"] },
  "docs/orchestration/lib/secretProvider.test.mjs": { findings: ["F1"], symbols: FINDINGS.F1.filter(([p]) => p.includes("secretProvider")).map(([, n]) => n) },
  "integrations/chatgpt-eos-intake/src/mcp.mjs": { findings: ["F1", "F2"], symbols: ["safeStoreCall", "authorize_review"] },
  "integrations/chatgpt-eos-intake/src/app.mjs": { findings: ["F1"], symbols: ["createApp"] },
  "integrations/chatgpt-eos-intake/test/app.test.mjs": { findings: ["F1"], symbols: [FINDINGS.F1[3][1]] },
  "docs/orchestration/lib/reviewAuthorization.mjs": { findings: ["F2"], symbols: ["reviewAuthorizationDigest", "resolveReviewAuthorization", "isVerifiedReviewAuthorization"] },
  "integrations/chatgpt-eos-intake/test/reviewAuthorization.test.mjs": { findings: ["F2"], symbols: [FINDINGS.F2[0][1]] },
  "docs/orchestration/lib/openaiCredentialTransport.mjs": { findings: ["F2", "F3", "F4"], symbols: ["createFileSpendLedger", "createOpenAICredentialTransport"] },
  "docs/orchestration/lib/openaiCredentialTransport.test.mjs": { findings: ["F2", "F4"], symbols: FINDINGS.F2.concat(FINDINGS.F4).filter(([p]) => p.includes("openaiCredentialTransport")).map(([, n]) => n) },
  "docs/orchestration/lib/credentialPathAudit.mjs": { findings: ["F3"], symbols: ["CREDENTIAL_PATH_CLASSIFICATION", "classifyCredentialPath"] },
  "docs/orchestration/lib/credentialPathAudit.test.mjs": { findings: ["F3"], symbols: FINDINGS.F3.map(([, n]) => n) },
  [RESOLUTION_PATH]: { findings: ["F1", "F2", "F3", "F4"], symbols: ["findings", "verification", "tokenFinding"] },
});

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const git = (cwd, args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

export function pathEvidence(subjectRoot, repo, path) {
  const row = git(subjectRoot, ["ls-tree", SUBJECT_HEAD, "--", path]);
  const match = row.match(/^\d+\s+blob\s+([0-9a-f]{40})\t(.+)$/);
  if (!match || match[2] !== path) throw new Error(`PATH_NOT_AT_HEAD:${path}`);
  const bytes = readFileSync(join(subjectRoot, path));
  return { path, gitBlobSha: match[1], contentSha256: sha256(bytes), sourceCommit: SUBJECT_HEAD, findings: SUPPORT[path].findings, symbolsOrTests: SUPPORT[path].symbols, githubUrl: `https://github.com/${repo}/blob/${SUBJECT_HEAD}/${path}` };
}

export function executeCases(subjectRoot, runId = null) {
  const byFile = new Map();
  for (const [finding, cases] of Object.entries(FINDINGS)) for (const [file, name] of cases) {
    if (!byFile.has(file)) byFile.set(file, []); byFile.get(file).push({ finding, name });
  }
  const records = [];
  for (const [file, cases] of byFile) {
    const pattern = cases.map((c) => c.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
    const args = ["--test", "--test-name-pattern", pattern, file];
    const child = spawnSync(process.execPath, args, { cwd: subjectRoot, encoding: "utf8", windowsHide: true });
    const output = `${child.stdout || ""}\n${child.stderr || ""}`;
    for (const item of cases) records.push({ findingId: item.finding, testFile: file, testName: item.name, command: `node ${args.map((a) => JSON.stringify(a)).join(" ")}`, exitCode: child.status, status: child.status === 0 && output.includes(`- ${item.name}`) ? "PASS" : "FAIL", sourceCommit: SUBJECT_HEAD, workflowRunId: runId || null });
    if (child.status !== 0 || records.slice(-cases.length).some((r) => r.status !== "PASS")) throw new Error(`TEST_EVIDENCE_FAILED:${file}`);
  }
  return records;
}

export async function buildEvidence({ subjectRoot, repo, fetchPr, runId = null }) {
  const pr = await fetchPr();
  if (pr?.number !== PR_NUMBER || pr?.head?.sha !== SUBJECT_HEAD) throw new Error("HEAD_MISMATCH");
  if (git(subjectRoot, ["rev-parse", "HEAD"]) !== SUBJECT_HEAD) throw new Error("CHECKOUT_HEAD_MISMATCH");
  const paths = Object.keys(SUPPORT).map((path) => pathEvidence(subjectRoot, repo, path));
  const testCases = executeCases(subjectRoot, runId);
  const testEvidenceContent = { prNumber: PR_NUMBER, reviewedHead: SUBJECT_HEAD, workflowRunId: runId || null, cases: testCases };
  const testEvidenceArtifactSha = sha256Canonical(testEvidenceContent);
  const resolutionArtifactSha = sha256Canonical(JSON.parse(readFileSync(join(subjectRoot, RESOLUTION_PATH), "utf8")));
  const findingEvidence = Object.fromEntries(Object.keys(FINDINGS).map((id) => [id, { paths: paths.filter((p) => p.findings.includes(id)), namedTests: testCases.filter((t) => t.findingId === id) }]));
  const content = { artifact: "PR-790-FINAL-EVIDENCE", prNumber: PR_NUMBER, reviewedHead: SUBJECT_HEAD, priorReviewSha: "7f73d097e253b7d3cc64404ae3a7db26a2553a5ed6446e92035387aacd664cc1", deltaReviewSha: "65c529fa92ab213180cba439277f2cf2b6945f5d3268261031ca21a773373e37", resolutionArtifactSha, testEvidenceArtifactSha, findingEvidence, verification: { everyPathAtExactHead: true, everyHashComputedFromExactCheckout: true, everyNamedTestExecuted: true, localPathRequired: false, narrativeOnlyAssertion: false } };
  return { content: { ...content, sha256: sha256Canonical(content) }, testEvidenceContent };
}

async function main() {
  const subjectRoot = process.env.REVIEW_SUBJECT_ROOT; const repo = process.env.REVIEW_REPO || "TaylorService-spec/Taylor_Parts"; const token = process.env.GITHUB_TOKEN;
  if (!subjectRoot || !token) throw new Error("evidence environment incomplete");
  const fetchPr = async () => { const r = await fetch(`https://api.github.com/repos/${repo}/pulls/${PR_NUMBER}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" } }); if (!r.ok) throw new Error(`GITHUB_API_${r.status}`); return r.json(); };
  const built = await buildEvidence({ subjectRoot, repo, fetchPr, runId: process.env.GITHUB_RUN_ID || null });
  const dir = join(ROOT, "docs", "orchestration", "reviews", "evidence", "pr-790"); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "PR-790-TEST-EVIDENCE.json"), canonicalize(built.testEvidenceContent), "utf8"); writeFileSync(join(dir, "PR-790-FINAL-EVIDENCE.json"), canonicalize(built.content), "utf8");
  process.stdout.write(JSON.stringify({ ok: true, reviewedHead: SUBJECT_HEAD, manifestSha256: built.content.sha256, testEvidenceArtifactSha: built.content.testEvidenceArtifactSha, cases: built.testEvidenceContent.cases.length }, null, 2) + "\n");
}
if (fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => { process.stdout.write(JSON.stringify({ ok: false, reason: e.message }) + "\n"); process.exit(1); });
