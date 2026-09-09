#!/usr/bin/env node
// Run the EOS trusted API against a LOCAL database and the LOCAL auth emulator.
//
// For development and browser acceptance only. It refuses to start when EOS_ENVIRONMENT names
// production, because startEosApi does -- this file adds no bypass, it only supplies configuration
// a developer would otherwise type twice.
import { readServiceConfig, startEosApi } from "../lib/eosApi/server.js";

const service = await startEosApi({ config: readServiceConfig() });
console.log(`EOS API listening on ${service.port}`);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    void service.close().then(() => process.exit(0));
  });
}
