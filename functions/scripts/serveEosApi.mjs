#!/usr/bin/env node
// The EOS trusted API entry point — the process a host runs.
//
// ONE ENTRY, LOCAL AND HOSTED. This was named runEosApiLocal.mjs and called itself
// development-only, which was never true of its behaviour: it reads configuration from the
// environment and starts the server, which is exactly what a hosted process does. A second,
// near-identical "production" entry would be two things to keep in step, and the one that drifts is
// always the one nobody runs locally.
//
// It refuses to start when EOS_ENVIRONMENT names production, because startEosApi does. This file
// adds no bypass; it wires configuration and signals and nothing else.
import { readServiceConfig, startEosApi } from "../lib/eosApi/server.js";

const service = await startEosApi({ config: readServiceConfig() });
console.log(`EOS API listening on ${service.port}`);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    void service.close().then(() => process.exit(0));
  });
}
