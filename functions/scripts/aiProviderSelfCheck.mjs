#!/usr/bin/env node
// AI PROVIDER SELF-CHECK. The operator command that proves the path end to end.
//
//   node scripts/aiProviderSelfCheck.mjs
//
// Run from `functions/` after `npm run build`. It reads the trusted environment, runs the policy,
// calls whichever provider the policy named, and prints normalised metadata. It performs NO EOS
// read and NO EOS write, and it prints no prompt and no model text -- only whether text arrived.
//
// It is intentionally not a callable and not a route: proving the plumbing does not require an HTTP
// surface, and adding one would be a deployment decision this package does not make.
//
// Everything is off by default, so an unconfigured environment prints a governed unavailable result
// rather than doing anything. To exercise the private gateway in a sandbox:
//
//   AI_SELF_HOSTED_ENABLED=true \
//   AI_SELF_HOSTED_BASE_URL=http://127.0.0.1:8080 \
//   AI_SELF_HOSTED_API_KEY=... \
//   AI_SELF_HOSTED_TENANT_ID=... \
//   node scripts/aiProviderSelfCheck.mjs
//
// The key is passed in the environment and is never written to the repository, never echoed here,
// and never included in any output this script produces.
import process from "node:process";
import { runAiProviderDiagnostic } from "../lib/assistant/aiProviderDiagnostic.js";
import { buildAiProvider, redactedAiConfigSummary, resolveProviderPolicyConfig, resolveSelfHostedConfig } from "../lib/assistant/aiProviderConfig.js";

/** The real network, adapted to the injected-fetch shape the adapters take. */
const realFetch = (url, init) => fetch(url, init);

function parseArgs(argv) {
  const args = { workloadClass: "ROUTINE", health: false };
  for (const arg of argv.slice(2)) {
    if (arg === "--deep") args.workloadClass = "REASONING";
    else if (arg === "--health") args.health = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log("usage: node scripts/aiProviderSelfCheck.mjs [--deep] [--health]");
    return 0;
  }

  const env = process.env;
  const summary = redactedAiConfigSummary(env);
  console.log("AI configuration (redacted):");
  console.log(JSON.stringify(summary, null, 2));

  if (args.health) {
    // Reachability only. Reports configured/not-configured and an HTTP outcome, never a credential.
    const provider = buildAiProvider("selfHosted", env, {
      gatewayFetch: realFetch, openAiFetch: realFetch, anthropicFetch: realFetch,
    });
    const health = await provider.health();
    console.log("\nGateway health:");
    console.log(JSON.stringify(health, null, 2));
    return health.healthy ? 0 : 1;
  }

  const selfHosted = resolveSelfHostedConfig(env);
  const result = await runAiProviderDiagnostic({
    policyConfig: resolveProviderPolicyConfig(env),
    buildProvider: (providerId) => buildAiProvider(providerId, env, {
      gatewayFetch: realFetch, openAiFetch: realFetch, anthropicFetch: realFetch,
    }),
    workloadClass: args.workloadClass,
    tenantId: selfHosted.tenantId,
    correlationId: `selfcheck-${Date.now()}`,
  });

  console.log("\nDiagnostic result:");
  console.log(JSON.stringify(result, null, 2));

  if (result.status === "OK") {
    console.log("\nOK — the request reached the selected provider and a normalised result came back.");
    return 0;
  }
  // Not an error in the script: a governed unavailable outcome is a correct outcome, and the exit
  // code says "the path did not complete" without implying anything was misbehaving.
  console.log(`\n${result.status} — reason ${result.selectionReason}${result.errorClass ? `, error class ${result.errorClass}` : ""}.`);
  return 1;
}

main().then((code) => { process.exitCode = code; }).catch((err) => {
  // Never print the raw error object: a transport error can carry request headers, and the headers
  // carry the key.
  console.error(`self-check failed: ${err instanceof Error ? err.message : "unknown error"}`);
  process.exitCode = 1;
});
