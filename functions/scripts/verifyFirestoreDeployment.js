#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const {
  OPERATIONS,
  VerificationError,
  canonicalJson,
  extractRulesSource,
  interpretStatus,
  normalizeFunctionsInventory,
  sha256,
  validateConfig,
  verifyDeploymentLog,
  verifyFunctionsAttestation,
  writeEvidence,
} = require("./firestoreDeploymentVerificationShared");

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith("--")) throw new VerificationError(`Unexpected argument: ${argv[i]}`);
    const key = argv[i].slice(2);
    const value = argv[++i];
    if (!value || value.startsWith("--")) throw new VerificationError(`Missing value for --${key}.`);
    result[key] = value;
  }
  for (const required of ["config", "deployment-log", "evidence-dir"]) {
    if (!result[required]) throw new VerificationError(`--${required} is required.`);
  }
  if (Boolean(result["functions-baseline"]) === Boolean(result["functions-attestation"])) {
    throw new VerificationError("Provide exactly one of --functions-baseline or --functions-attestation.");
  }
  return result;
}

function gitShow(commit, file) {
  return execFileSync("git", ["show", `${commit}:${file}`], { encoding: "utf8", maxBuffer: 5 * 1024 * 1024 });
}

function gcloudAccessToken() {
  const executable = process.env.GCLOUD_BIN || (process.platform === "win32" ? "gcloud.cmd" : "gcloud");
  if (process.platform === "win32" && executable.toLowerCase().endsWith(".ps1")) {
    return execFileSync(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", executable, "auth", "print-access-token"],
      { encoding: "utf8" }
    ).trim();
  }
  return execFileSync(executable, ["auth", "print-access-token"], { encoding: "utf8" }).trim();
}

async function jsonFetch(url, init = {}) {
  const response = await fetch(url, init);
  const text = await response.text();
  let json = {};
  try { json = text ? JSON.parse(text) : {}; } catch { /* status is authoritative for matrix probes */ }
  return { response, json };
}

async function authenticatePersona(apiKey, persona) {
  const email = process.env[persona.emailEnv];
  const password = process.env[persona.passwordEnv];
  if (!email || !password) throw new VerificationError(`Missing secret environment variable for ${persona.label}.`);
  const { response, json } = await jsonFetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    }
  );
  if (!response.ok || !json.idToken) {
    const rawCode = String(json && json.error && json.error.message || "UNKNOWN").split(/\s*:\s*/)[0];
    const safeCodes = new Set([
      "EMAIL_NOT_FOUND",
      "INVALID_EMAIL",
      "INVALID_LOGIN_CREDENTIALS",
      "INVALID_PASSWORD",
      "TOO_MANY_ATTEMPTS_TRY_LATER",
      "USER_DISABLED",
      "OPERATION_NOT_ALLOWED",
    ]);
    const code = safeCodes.has(rawCode) ? rawCode : "AUTH_REJECTED";
    throw new VerificationError(`Authentication preflight failed for ${persona.label}: ${code} (${response.status}).`);
  }
  return json.idToken;
}

async function fetchLiveRules(projectId, accessToken) {
  const releases = await jsonFetch(`https://firebaserules.googleapis.com/v1/projects/${projectId}/releases`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!releases.response.ok) throw new VerificationError(`Rules release lookup failed (${releases.response.status}).`);
  const release = (releases.json.releases || []).find((item) => String(item.name || "").endsWith("cloud.firestore"));
  if (!release) throw new VerificationError("Firestore Rules release was not found.");
  const ruleset = await jsonFetch(`https://firebaserules.googleapis.com/v1/${release.rulesetName}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!ruleset.response.ok) throw new VerificationError(`Ruleset lookup failed (${ruleset.response.status}).`);
  return ruleset.json;
}

async function fetchFunctions(projectId, accessToken) {
  const result = await jsonFetch(`https://cloudfunctions.googleapis.com/v2/projects/${projectId}/locations/-/functions`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!result.response.ok) throw new VerificationError(`Functions inventory lookup failed (${result.response.status}).`);
  return normalizeFunctionsInventory(result.json);
}

async function runMatrix(projectId, tokens) {
  const results = [];
  for (const [persona, token] of Object.entries(tokens)) {
    for (const operation of OPERATIONS) {
      const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${operation.target}`;
      const response = await fetch(url, {
        method: operation.method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(operation.body ? { "content-type": "application/json" } : {}),
        },
        ...(operation.body ? { body: JSON.stringify(operation.body) } : {}),
      });
      const interpreted = interpretStatus(persona, operation, response.status);
      results.push({
        persona,
        operation: operation.id,
        status: response.status,
        interpretation: interpreted.interpretation,
        expected: interpreted.expected,
        pass: interpreted.pass,
      });
      if (!interpreted.pass) throw new VerificationError(`Matrix mismatch: ${persona}/${operation.id} returned ${response.status}.`);
    }
  }
  return results;
}

function matrixMarkdown(results) {
  const lines = [
    "# Firestore production access matrix",
    "",
    "| Persona | Operation | HTTP | Interpretation | Expected | Result |",
    "|---|---|---:|---|---|---|",
  ];
  for (const row of results) {
    lines.push(`| ${row.persona} | ${row.operation} | ${row.status} | ${row.interpretation} | ${row.expected.join("/")} | ${row.pass ? "PASS" : "FAIL"} |`);
  }
  return `${lines.join("\n")}\n`;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const config = validateConfig(JSON.parse(fs.readFileSync(args.config, "utf8")));
  if (path.resolve(args["evidence-dir"]).startsWith(path.resolve(os.tmpdir()))) {
    throw new VerificationError("Evidence directory must be durable, not the temporary directory.");
  }

  const governedSource = gitShow(config.governedCommit, "firestore.rules");
  const mirrorSource = gitShow(config.governedCommit, "field-ops-app-vite/firestore.rules");
  if (governedSource !== mirrorSource) throw new VerificationError("Governed root and mirror Rules sources differ.");
  if (sha256(governedSource) !== config.governedRulesSha256) throw new VerificationError("Governed Git/LF Rules hash mismatch.");

  const deploymentScope = verifyDeploymentLog(fs.readFileSync(args["deployment-log"], "utf8"));
  let functionsBaseline = null;
  let functionsScopeEvidence = null;
  if (args["functions-baseline"]) {
    const functionsBaselineInput = JSON.parse(fs.readFileSync(args["functions-baseline"], "utf8"));
    functionsBaseline = Array.isArray(functionsBaselineInput)
      ? functionsBaselineInput
      : normalizeFunctionsInventory(functionsBaselineInput);
    functionsScopeEvidence = { exactInventoryComparison: true };
  } else {
    functionsScopeEvidence = verifyFunctionsAttestation(
      fs.readFileSync(args["functions-attestation"], "utf8")
    );
  }

  const apiKey = process.env[config.webApiKeyEnv];
  if (!apiKey) throw new VerificationError(`Missing ${config.webApiKeyEnv}.`);

  // Gate: every identity authenticates before the first Firestore production request.
  const tokens = {};
  for (const persona of config.personas) tokens[persona.label] = await authenticatePersona(apiKey, persona);

  const accessToken = gcloudAccessToken();
  const [rulesApi, functionsLive] = await Promise.all([
    fetchLiveRules(config.projectId, accessToken),
    fetchFunctions(config.projectId, accessToken),
  ]);
  const liveSource = extractRulesSource(rulesApi);
  const liveRulesSha256 = sha256(liveSource);
  if (liveRulesSha256 !== config.governedRulesSha256 || liveSource !== governedSource) {
    throw new VerificationError("Live extracted Rules source does not match governed Git/LF source.");
  }
  if (functionsBaseline && canonicalJson(functionsLive) !== canonicalJson(functionsBaseline)) {
    throw new VerificationError("Live Functions inventory differs from the governed predeployment baseline.");
  }

  const matrix = await runMatrix(config.projectId, tokens);
  for (const key of Object.keys(tokens)) tokens[key] = "";

  const generatedAt = new Date().toISOString();
  const summary = {
    generatedAt,
    projectId: config.projectId,
    governedCommit: config.governedCommit,
    governedRulesSha256: config.governedRulesSha256,
    liveRulesSha256,
    identitiesPreflightedBeforeFirestore: config.personas.map((p) => p.label),
    deploymentScope,
    functionsScopeEvidence,
    matrixAssertions: matrix.length,
    matrixPassed: matrix.every((row) => row.pass),
    firestoreMutations: "NONE (all write probes returned 403)",
  };
  writeEvidence(args["evidence-dir"], {
    "verification-summary.json": summary,
    "production-matrix.json": matrix,
    "production-matrix.md": matrixMarkdown(matrix),
    "functions-inventory.normalized.json": functionsLive,
  });
  console.log(`PASS: ${matrix.length}/${matrix.length} matrix assertions; evidence: ${args["evidence-dir"]}`);
  return summary;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`FAIL: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { main, matrixMarkdown, parseArgs, runMatrix };
