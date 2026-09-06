/**
 * Email Connections + Inbound Work -- sandbox seed. Deterministic, idempotent, sandbox-guarded.
 *
 * Configures one Microsoft 365 connection, three operational mailboxes (Service / Warranty / Parts) and
 * two routing rules, then delivers the fixture messages through the SAME adapter, routing, processing and
 * intake path a real provider poll uses. Nothing is written straight into `inbound_work_requests`: seeding
 * an intake record directly would prove the seed works, not the feature.
 *
 * SAFETY -- privileged seed tooling, the same posture as seedSandboxBaseline.js:
 *   - --projectId is required, no default;
 *   - `taylor-parts` is refused by name;
 *   - any environment whose registry role is `production` is refused, whoever owns it;
 *   - every id is fixed, so re-running converges instead of duplicating;
 *   - every address is under `.example` (RFC 2606) and cannot reach or collide with a real mailbox;
 *   - it holds and writes NO credential: EOS stores no mailbox password and no OAuth token.
 *
 * It does NOT decide anything. Nothing is accepted, declined or attached here, and no Work Order is
 * created -- those are a person's acts in Service -> Inbound Work, which is what the seeded queue exists
 * to let somebody perform.
 *
 * Usage:
 *   cd functions
 *   npm run build
 *   node scripts/seedSandboxInboundWork.mjs --projectId eos-platform-sandbox
 */
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

import { assertNonProductionImportTarget } from "../lib/dataImport/importTargetGuard.js";
import { normalizeProviderMessage } from "../lib/inboundWork/emailProvider.js";
import { upsertEmailConnection, upsertEmailMailbox, upsertEmailRoutingRule } from "../lib/inboundWork/emailAdminCommands.js";
import { ingestInboundMessage } from "../lib/inboundWork/inboundIntakeCommand.js";
import { readMailbox, readRoutingRules } from "../lib/inboundWork/inboundWorkReadService.js";
import {
  SANDBOX_CONNECTION,
  SANDBOX_MAILBOX_CONFIGS,
  SANDBOX_MESSAGES,
  SANDBOX_RECORDS,
  SANDBOX_ROUTING_RULES,
} from "./fixtures/inboundWorkFixtures.mjs";

const SEED_ACTOR = "sandbox-seed";

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      out[key] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : "true";
    }
  }
  return out;
}

async function main() {
  const { projectId } = parseArgs(process.argv.slice(2));
  // The SAME guard the delivery callable and Data Import use: an unknown project fails closed, and a
  // production-role environment is refused whoever owns it (ADR-011).
  const target = assertNonProductionImportTarget(projectId === "true" ? "" : projectId);
  console.log(`Seeding inbound work into ${target.projectId} (role ${target.role})`);

  initializeApp({ projectId: target.projectId, credential: applicationDefault() });
  const db = getFirestore();

  await upsertEmailConnection(db, { id: SANDBOX_CONNECTION.id, actorUid: SEED_ACTOR, config: SANDBOX_CONNECTION.config });
  for (const mailbox of SANDBOX_MAILBOX_CONFIGS) {
    await upsertEmailMailbox(db, { id: mailbox.id, actorUid: SEED_ACTOR, config: mailbox.config });
  }
  for (const rule of SANDBOX_ROUTING_RULES) {
    await upsertEmailRoutingRule(db, { id: rule.id, actorUid: SEED_ACTOR, rule: rule.rule });
  }

  // The customer, site and unit the known-unit scenarios resolve against. Written only when absent, so a
  // re-run never overwrites a record somebody has since edited in the sandbox.
  for (const [collection, id, data] of [
    ["accounts", SANDBOX_RECORDS.accountId, SANDBOX_RECORDS.account],
    ["locations", SANDBOX_RECORDS.locationId, SANDBOX_RECORDS.location],
    ["equipment", SANDBOX_RECORDS.equipmentId, SANDBOX_RECORDS.equipment],
    ["contacts", SANDBOX_RECORDS.contactId, SANDBOX_RECORDS.contact],
  ]) {
    const ref = db.collection(collection).doc(id);
    if (!(await ref.get()).exists) await ref.set(data);
  }

  const rules = await readRoutingRules(db);
  for (const fixture of SANDBOX_MESSAGES) {
    const mailbox = await readMailbox(db, fixture.mailboxId);
    const message = normalizeProviderMessage(fixture.provider, fixture.message, {
      connectionId: SANDBOX_CONNECTION.id,
      mailboxId: fixture.mailboxId,
    });
    const result = await ingestInboundMessage(db, { message, mailbox, rules, actorUid: SEED_ACTOR });
    console.log(`  ${fixture.message.id} -> ${result.outcome} (${result.status}) ${result.requestId}`);
  }

  console.log("Done. Open Service -> Inbound Work to review the queue.");
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
