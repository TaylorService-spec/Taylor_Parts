// Email Connections -- THE SCHEDULE. The thing that makes delivery automatic rather than something an
// administrator remembers to press.
//
// ONE FUNCTION, EVERY ENABLED MAILBOX, EVERY FIVE MINUTES. Five minutes is a service business's tolerance
// for "a warranty email arrived", not a technical constant: a minute would quadruple the provider calls
// for no operational difference, and fifteen would have a dispatcher refreshing the queue.
//
// IT REFUSES PRODUCTION, from the runtime's own project identity, before it reads anything. Production
// mailbox polling is not authorized; a schedule that silently started running there the day somebody
// deployed it would be exactly the accident the guard exists to prevent.
//
// EXPORT IS NOT DEPLOY. Nothing schedules until this function is deployed to an environment, and
// deploying it is a separate, Owner-executed action.
import { onSchedule } from "firebase-functions/v2/scheduler";
import { getFirestore } from "firebase-admin/firestore";
import { EMAIL_CONNECTIONS_COLLECTION, EMAIL_MAILBOXES_COLLECTION } from "../constants/collections";
import { assertNonProductionImportTarget } from "../dataImport/importTargetGuard";
import { boundedString } from "./inboundWorkModel";
import { isEmailProviderId } from "./emailProvider";
import { readMailbox } from "./inboundWorkReadService";
import { EMAIL_PROVIDER_SECRETS, transportFor } from "./providerTransportFactory";
import { createSecretManagerVault } from "./providerCredentialVault";
import { createCloudAttachmentStore } from "./attachmentCustody";
import { pollMailboxOnce, type ConnectionRecord, type DeliveryResult } from "./emailDeliveryService";

/** The system actor delivery runs as. Never a person: nobody pressed anything. */
export const DELIVERY_SYSTEM_ACTOR = "system-email-delivery";

/** How many mailboxes one tick will poll. A bound, not a limit anybody is expected to hit. */
export const MAX_MAILBOXES_PER_TICK = 20;

/**
 * The pure-ish core: poll every enabled mailbox once, collecting results. Exported separately from the
 * schedule so a test can run exactly what the schedule runs, with its own database and adapters, without
 * a scheduler.
 */
export async function runDeliveryCycle(
  db: FirebaseFirestore.Firestore,
  deps: {
    transportFor: typeof transportFor;
    vaultFor: (projectId: string) => ReturnType<typeof createSecretManagerVault>;
    store: ReturnType<typeof createCloudAttachmentStore>;
    projectId: string;
    actorUid?: string;
    now?: () => number;
  },
): Promise<DeliveryResult[]> {
  const actorUid = deps.actorUid ?? DELIVERY_SYSTEM_ACTOR;
  const mailboxSnap = await db
    .collection(EMAIL_MAILBOXES_COLLECTION)
    .where("status", "==", "ACTIVE")
    .limit(MAX_MAILBOXES_PER_TICK)
    .get();

  const results: DeliveryResult[] = [];
  for (const doc of mailboxSnap.docs) {
    const mailbox = await readMailbox(db, doc.id);
    if (!mailbox || mailbox.inboundEnabled === false) continue;

    const connectionSnap = await db.collection(EMAIL_CONNECTIONS_COLLECTION).doc(mailbox.connectionId).get();
    if (!connectionSnap.exists) continue;
    const data = connectionSnap.data() as Record<string, unknown>;
    const provider = data.provider;
    // A connection that has never been authorized, or whose authorization was revoked, is skipped
    // silently rather than failing loudly every five minutes: it is a configuration state, not an
    // incident, and Administration already shows it as NOT_CONNECTED.
    if (!isEmailProviderId(provider) || data.oauthStatus !== "CONNECTED" || data.inboundEnabled === false) continue;

    const connection: ConnectionRecord = {
      id: connectionSnap.id,
      provider,
      tenantOrWorkspace: boundedString(data.tenantOrWorkspace, 255),
      connectedAccount: boundedString(data.connectedAccount, 255),
      inboundEnabled: true,
      oauthStatus: "CONNECTED",
    };

    try {
      results.push(
        await pollMailboxOnce(
          db,
          connection,
          { ...mailbox, deliveryCursor: (doc.data() as Record<string, unknown>).deliveryCursor as never },
          {
            adapter: deps.transportFor(provider),
            vault: deps.vaultFor(deps.projectId),
            store: deps.store,
            actorUid,
            now: deps.now,
          },
        ),
      );
    } catch (err) {
      // One mailbox's unexpected failure must not stop the others: this loop is the only thing standing
      // between a misconfigured mailbox and every other mailbox in the company.
      console.error(`[emailDelivery] mailbox ${doc.id} failed`, err instanceof Error ? err.message : err);
    }
  }
  return results;
}

export const pollEmailMailboxes = onSchedule(
  {
    region: "us-central1",
    schedule: "every 5 minutes",
    timeoutSeconds: 540,
    secrets: EMAIL_PROVIDER_SECRETS,
    retryCount: 0,
  },
  async () => {
    const projectId = process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT ?? "";
    try {
      assertNonProductionImportTarget(projectId);
    } catch (err) {
      // Refused, loudly and harmlessly: no read, no provider call, no write.
      console.warn(`[emailDelivery] refusing to poll in this environment: ${(err as Error).message}`);
      return;
    }
    const results = await runDeliveryCycle(getFirestore(), {
      transportFor,
      vaultFor: createSecretManagerVault,
      store: createCloudAttachmentStore(),
      projectId,
    });
    const totals = results.reduce(
      (sum, r) => ({ fetched: sum.fetched + r.fetched, created: sum.created + r.created, failures: sum.failures + r.failures }),
      { fetched: 0, created: 0, failures: 0 },
    );
    console.log(`[emailDelivery] polled ${results.length} mailbox(es): ${totals.fetched} fetched, ${totals.created} new, ${totals.failures} failed`);
  },
);
