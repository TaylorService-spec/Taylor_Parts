#!/usr/bin/env node
// SANDBOX SCANNER SCENARIOS -- the twelve validation scenarios, run as REAL personas against the
// REAL deployed callables.
//
// ============================ WHY IT SIGNS IN RATHER THAN SIMULATING ============================
//
// Every cheaper way of validating this proves something weaker than it appears to. Resolving a
// persona's capabilities with the Admin SDK proves the resolver agrees with itself. Calling a
// command with an injected `authorize` stub proves the command's own logic. Neither exercises the
// path an operator's phone actually takes: sign in, get an ID token, call a deployed callable, and
// have the SERVER decide.
//
// So this authenticates each persona with their real sandbox password and calls the deployed
// functions over HTTPS. What it measures is what the deployment does.
//
// ============================ A REFUSAL IS A RESULT, NOT AN ERROR ============================
//
// Six of these scenarios are supposed to be refused. A scenario that "passes" by succeeding when it
// should have been denied is a release failure, so every case declares its EXPECTATION and the
// harness compares against that -- never against "did it throw".
//
// It also distinguishes the reasons a call can fail, because they mean different things:
//   permission-denied  -> the governed gate refused. Usually the intended result.
//   not-found          -> the callable is not deployed. A deployment problem, not an access one.
//   unauthenticated    -> sign-in failed. A harness problem.
//   anything else      -> reported verbatim rather than bucketed.
//
// READ-MOSTLY. The write scenarios (put-away, returns, cycle count) create their own scoped records
// and never delete or mutate anything pre-existing. Sandbox only; it refuses production outright.
import { loadSandboxPersona } from "./sandboxCredentials.mjs";

const PROJECT_ID = "eos-platform-sandbox";
const REGION = "us-central1";

if (process.env.TARGET_PROJECT && process.env.TARGET_PROJECT !== PROJECT_ID) {
  console.error("REFUSING: this harness targets the sandbox only.");
  process.exit(2);
}

const registry = JSON.parse(
  await (await import("node:fs/promises")).readFile(new URL("../config/environments.json", import.meta.url), "utf8"),
);
const envEntry = registry.environments.find((e) => e?.firebase?.projectId === PROJECT_ID);
if (!envEntry || envEntry.role === "production") {
  console.error("REFUSING: target is not a non-production sandbox entry.");
  process.exit(2);
}
const API_KEY = envEntry.firebase.apiKey;

// ── auth ─────────────────────────────────────────────────────────────────────────────────────────
const tokens = new Map();
async function idTokenFor(personaKey) {
  if (tokens.has(personaKey)) return tokens.get(personaKey);
  const { email, password } = loadSandboxPersona(personaKey);
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  );
  const body = await res.json();
  if (!res.ok || !body.idToken) throw new Error(`sign-in failed for ${personaKey}: ${body?.error?.message ?? res.status}`);
  tokens.set(personaKey, body.idToken);
  return body.idToken;
}

/**
 * Call a deployed callable as a persona.
 *
 * Returns a DISCRIMINATED result rather than throwing, because "it was refused" and "it blew up" are
 * different findings and a harness that conflates them cannot validate a refusal.
 */
async function callAs(personaKey, name, data) {
  let token;
  try { token = await idTokenFor(personaKey); }
  catch (err) { return { ok: false, code: "harness-signin", message: String(err.message) }; }

  const res = await fetch(`https://${REGION}-${PROJECT_ID}.cloudfunctions.net/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ data: data ?? {} }),
  });
  const body = await res.json().catch(() => ({}));
  if (res.ok && body.result !== undefined) return { ok: true, result: body.result };
  const code = body?.error?.status ?? body?.error?.code ?? `http-${res.status}`;
  return { ok: false, code: String(code).toLowerCase(), message: body?.error?.message ?? `HTTP ${res.status}` };
}

// ── reporting ────────────────────────────────────────────────────────────────────────────────────
const results = [];
function record(scenario, persona, expected, actual, pass, note = "") {
  results.push({ scenario, persona, expected, actual, pass, note });
  const mark = pass ? "PASS" : "FAIL";
  console.log(`${mark}  [${scenario}] ${persona}: expected ${expected}, got ${actual}${note ? ` -- ${note}` : ""}`);
}

/**
 * A call that must be REFUSED -- and refused for the RIGHT REASON.
 *
 * `kind` is required, because "it was refused" is not a finding on its own:
 *
 *   "gate"       -> the CAPABILITY check refused (permission-denied). Anything else here means the
 *                   call got past the gate, which is the failure the scenario exists to detect. A
 *                   validation error masquerading as a gate refusal would let a missing grant hide
 *                   behind malformed input.
 *   "validation" -> the COMMAND refused the request itself (failed-precondition / invalid-argument):
 *                   an unknown bin, a same-location transfer, a condition nobody recognises. A
 *                   permission-denied here is a FAILURE, not a pass -- it means the persona never
 *                   had the authority, so the rule under test was never actually exercised.
 *
 * Conflating the two is how a validation suite reports green while proving nothing.
 */
const GATE_CODES = ["permission-denied", "permission_denied"];
const VALIDATION_CODES = ["failed-precondition", "failed_precondition", "invalid-argument", "invalid_argument"];

async function expectRefused(scenario, persona, name, data, kind, note = "") {
  if (kind !== "gate" && kind !== "validation") throw new Error(`expectRefused needs kind gate|validation, got ${kind}`);
  const r = await callAs(persona, name, data);
  if (r.ok) return record(scenario, persona, `REFUSED(${kind})`, "ALLOWED", false, "a refusal scenario succeeded -- release failure");

  const isGate = GATE_CODES.some((c) => r.code.includes(c));
  const isValidation = VALIDATION_CODES.some((c) => r.code.includes(c));
  const isMissing = r.code.includes("not-found") || r.code.includes("not_found");

  if (kind === "gate") {
    return record(scenario, persona, "REFUSED(gate)", r.code, isGate,
      isGate ? note : (isMissing ? "WRONG REASON: callable missing, not a gate refusal" : String(r.message ?? "").slice(0, 90)));
  }
  // kind === "validation"
  return record(scenario, persona, "REFUSED(validation)", r.code, isValidation,
    isValidation ? note
      : (isGate ? "WRONG REASON: the persona lacked the capability, so this rule was never exercised"
                : String(r.message ?? "").slice(0, 90)));
}

/** A call that must be ALLOWED, optionally with an extra assertion on the payload. */
async function expectAllowed(scenario, persona, name, data, assertFn = null, note = "") {
  const r = await callAs(persona, name, data);
  if (!r.ok) return record(scenario, persona, "ALLOWED", r.code, false, r.message?.slice(0, 110));
  if (assertFn) {
    const verdict = assertFn(r.result);
    if (verdict !== true) return record(scenario, persona, "ALLOWED+correct", "ALLOWED but wrong payload", false, String(verdict).slice(0, 110));
  }
  return record(scenario, persona, "ALLOWED", "ALLOWED", true, note);
}

export { callAs, expectRefused, expectAllowed, record, results };
