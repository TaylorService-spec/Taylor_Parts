// EOS Data Import -- the sandbox-only boundary.
//
// P1 must be IMPOSSIBLE to run against production, and that has to be true of the
// BACKEND, not of a hidden menu item. A browser can send any payload it likes; the
// only thing that decides where an import lands is this module.
//
// The rule is taken byte-for-byte from the established privileged-tooling pattern in
// functions/scripts/seedSandboxTransactional.js's assertNonProductionTarget():
//
//   * no default target -- absence is a refusal, never a fallback;
//   * `taylor-parts` is refused by name, explicitly;
//   * the target must resolve in config/environments.json, THE single source of
//     environment identity. An unknown project is not "probably fine", it is unknown;
//   * role === "production" is refused whoever owns the deployment. ADR-011: `role`
//     (what an environment is FOR) is independent of `deployment` (whose it is), so a
//     future non-Taylor production project is refused by the same check.
//
// Two checks overlap deliberately: the explicit taylor-parts name AND the registry
// role. Neither alone has to be trusted, which is the same belt-and-braces posture the
// seeder uses.
//
// This module is PURE apart from reading the registry: no Firestore, no Admin SDK, no
// network. It can therefore be exercised directly by unit tests without an emulator,
// which is what makes "the backend refuses production independent of the browser"
// provable rather than asserted.

import { readFileSync } from "node:fs";
import path from "node:path";

/** The customer production project, refused by name as well as by registry role. */
export const PRODUCTION_PROJECT_ID = "taylor-parts";

export type ImportTargetRefusalCode =
  | "TARGET_MISSING"
  | "TARGET_PRODUCTION_PROJECT"
  | "TARGET_UNKNOWN_ENVIRONMENT"
  | "TARGET_PRODUCTION_ROLE"
  | "TARGET_REGISTRY_UNREADABLE";

export class ImportTargetRefusedError extends Error {
  readonly code: ImportTargetRefusalCode;
  constructor(code: ImportTargetRefusalCode, message: string) {
    super(message);
    this.name = "ImportTargetRefusedError";
    this.code = code;
  }
}

export interface ResolvedImportTarget {
  readonly environmentId: string;
  readonly projectId: string;
  readonly role: string;
}

interface RegistryEnvironment {
  id?: unknown;
  role?: unknown;
  firebase?: { projectId?: unknown } | null;
}

/**
 * Default registry location. Resolved from this module so it is correct from both the
 * compiled lib/ output and a ts-node style run; callers may override for tests.
 */
export function defaultEnvironmentRegistryPath(): string {
  // functions/src/dataImport -> functions/src -> functions -> repo root
  return path.resolve(__dirname, "..", "..", "..", "config", "environments.json");
}

function readRegistry(registryPath: string): RegistryEnvironment[] {
  let raw: string;
  try {
    raw = readFileSync(registryPath, "utf8");
  } catch (e) {
    throw new ImportTargetRefusedError(
      "TARGET_REGISTRY_UNREADABLE",
      `REFUSING: the environment registry could not be read at ${registryPath}. Import targets are resolved only through the registry.`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ImportTargetRefusedError(
      "TARGET_REGISTRY_UNREADABLE",
      "REFUSING: the environment registry is not valid JSON.",
    );
  }
  const envs = (parsed as { environments?: unknown })?.environments;
  if (!Array.isArray(envs)) {
    throw new ImportTargetRefusedError(
      "TARGET_REGISTRY_UNREADABLE",
      "REFUSING: the environment registry has no environments array.",
    );
  }
  return envs as RegistryEnvironment[];
}

/**
 * Resolve a caller-supplied target project id to a NON-PRODUCTION environment, or throw.
 *
 * Every refusal path throws. There is no boolean return a caller could forget to check
 * and no default target a caller could omit their way into.
 */
export function assertNonProductionImportTarget(
  projectId: unknown,
  options: { registryPath?: string } = {},
): ResolvedImportTarget {
  // No default. An absent target is a refusal, not a fallback to "the current project".
  if (typeof projectId !== "string" || projectId.trim() === "") {
    throw new ImportTargetRefusedError(
      "TARGET_MISSING",
      "REFUSING: an explicit target environment is required. Data Import has no default target.",
    );
  }
  const target = projectId.trim();

  // Explicit, by name, before any registry lookup can be reasoned about.
  if (target === PRODUCTION_PROJECT_ID) {
    throw new ImportTargetRefusedError(
      "TARGET_PRODUCTION_PROJECT",
      `REFUSING: '${PRODUCTION_PROJECT_ID}' is the customer production project. Data Import is sandbox-only.`,
    );
  }

  const environments = readRegistry(options.registryPath ?? defaultEnvironmentRegistryPath());
  const env = environments.find(
    (e) => e && e.firebase && typeof e.firebase === "object" && (e.firebase as { projectId?: unknown }).projectId === target,
  );

  // Unknown projects fail closed. "Not in the registry" is not evidence of safety.
  if (!env) {
    throw new ImportTargetRefusedError(
      "TARGET_UNKNOWN_ENVIRONMENT",
      `REFUSING: '${target}' is not a known provisioned environment. Unknown targets fail closed.`,
    );
  }

  // Role, not deployment. ADR-011: a production-role environment is refused whoever owns it.
  if (env.role === "production") {
    throw new ImportTargetRefusedError(
      "TARGET_PRODUCTION_ROLE",
      `REFUSING: environment '${String(env.id)}' has role 'production'. Data Import is sandbox-only.`,
    );
  }

  return Object.freeze({
    environmentId: String(env.id),
    projectId: target,
    role: String(env.role),
  });
}

/**
 * Non-throwing form for surfaces that need to describe the refusal rather than fail,
 * e.g. rendering "this environment cannot be imported into" in an admin screen.
 * The authorization decision itself always uses the throwing form above.
 */
export function describeImportTarget(
  projectId: unknown,
  options: { registryPath?: string } = {},
): { allowed: true; target: ResolvedImportTarget } | { allowed: false; code: ImportTargetRefusalCode; message: string } {
  try {
    return { allowed: true, target: assertNonProductionImportTarget(projectId, options) };
  } catch (e) {
    if (e instanceof ImportTargetRefusedError) return { allowed: false, code: e.code, message: e.message };
    throw e;
  }
}
