#!/usr/bin/env node
// Regenerate the machine-readable companion to the dashboard reporting authority census.
//
//   node scripts/generateDashboardCensusJson.mjs
//
// Reads the markdown census, writes the JSON beside it. Writes nothing else, touches no
// environment, and reaches no network. Run it after editing the markdown; the validator
// (scripts/dashboardCensus.test.mjs) fails if you forget.
import { writeFileSync } from "node:fs";
import { buildCensusDocument, CENSUS_JSON } from "./dashboardCensus.lib.mjs";

const doc = buildCensusDocument();
writeFileSync(CENSUS_JSON, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
console.log(`wrote ${CENSUS_JSON} — ${doc.entries.length} fact families`);
for (const [k, v] of Object.entries(doc.totals)) console.log(`  ${k}: ${v}`);
