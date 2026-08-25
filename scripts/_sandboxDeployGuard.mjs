// Sandbox deploy guard, called before every sandbox deploy step in
// _sandboxRefresh.run.sh. Asserts the target is the sandbox and NEVER
// production, per Owner-mandated structural safety check. Exits non-zero to
// ABORT the pipeline on any mismatch. Interim tooling pending a canonical
// rebuild.mjs (separate follow-up per Owner).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { resolveEnvironment, isProductionEnvironment } from "./resolveEnvironment.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const registry = JSON.parse(readFileSync(resolve(ROOT, "config/environments.json"), "utf8"));
const TARGET_ENV = "platform-sandbox";
const TARGET_PROJECT = "eos-platform-sandbox";
const FORBIDDEN_PROJECT = "taylor-parts";

const env = resolveEnvironment(registry, TARGET_ENV);
// EXIT 3 IS "REFUSED BEFORE DEPLOYING", distinct from a mid-run failure. This guard runs before any
// deploy step, so nothing has shipped when it fires -- and the operator wrapper says so rather than
// warning about functions that may already have updated.
const REFUSED_BEFORE_DEPLOY = 3;
const fail = (m) => { console.error("ABORT:", m); process.exit(REFUSED_BEFORE_DEPLOY); };

if (isProductionEnvironment(env)) fail(`role is production (${env.role})`);
if (env.role === "production") fail("role === production");
if (env.firebase.projectId !== TARGET_PROJECT) fail(`projectId ${env.firebase.projectId} != ${TARGET_PROJECT}`);
if (env.firebase.projectId === FORBIDDEN_PROJECT) fail(`projectId is ${FORBIDDEN_PROJECT}`);

console.log(`GUARD OK: env=${env.id} role=${env.role} projectId=${env.firebase.projectId} (!= ${FORBIDDEN_PROJECT})`);
