// Email Connections -- ADMINISTRATION WRITES. Connections, operational mailboxes and routing rules.
//
// SEPARATE AUTHORITY FROM THE QUEUE, deliberately. Connecting or disconnecting a provider is an
// administration act; reviewing and accepting Service work is a Service act. A Service coordinator who can
// work the Inbound Work queue all day cannot reach any function in this file, and an administrator who can
// configure mailboxes holds no authority to accept a job. That split is enforced by two different
// capabilities at the callables, and it is the reason this file is not merged into the decision commands.
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import {
  EMAIL_CONNECTIONS_COLLECTION,
  EMAIL_MAILBOXES_COLLECTION,
  EMAIL_ROUTING_RULES_COLLECTION,
} from "../constants/collections";
import { stageAuditEvent } from "../access/auditEventWriter";
import { EmailProviderError, validateConnectionConfig, validateMailboxConfig, assertNoCredentialMaterial } from "./emailProvider";
import { normalizeOutcome, type RoutingCondition, type RoutingRule } from "./inboundRouting";
import { boundedString, normalizeEmailAddress } from "./inboundWorkModel";

/** A connection is never written as CONNECTED by a form -- only a completed authorization can do that. */
export async function upsertEmailConnection(
  db: Firestore,
  input: { id?: string | null; actorUid: string; config: unknown },
): Promise<{ id: string }> {
  const config = validateConnectionConfig(input?.config);
  const actorUid = boundedString(input?.actorUid, 255);
  if (!actorUid) throw new EmailProviderError("An authenticated actor is required.");
  const id = boundedString(input?.id, 255);
  const ref = id ? db.collection(EMAIL_CONNECTIONS_COLLECTION).doc(id) : db.collection(EMAIL_CONNECTIONS_COLLECTION).doc();

  await db.runTransaction(async (tx) => {
    const existing = await tx.get(ref);
    const base = {
      ...config,
      connectionStatus: existing.exists ? existing.data()?.connectionStatus ?? "CONFIGURED" : "CONFIGURED",
      // OAuth state is owned by the authorization flow, not by this form. A new connection starts
      // NOT_CONNECTED and an existing one keeps whatever the flow last recorded.
      oauthStatus: existing.exists ? existing.data()?.oauthStatus ?? "NOT_CONNECTED" : "NOT_CONNECTED",
      health: existing.exists ? existing.data()?.health ?? "UNKNOWN" : "UNKNOWN",
      lastSuccessfulSync: existing.exists ? existing.data()?.lastSuccessfulSync ?? null : null,
      lastMessageReceived: existing.exists ? existing.data()?.lastMessageReceived ?? null : null,
      updatedBy: actorUid,
      updatedAt: FieldValue.serverTimestamp(),
      ...(existing.exists ? {} : { createdBy: actorUid, createdAt: FieldValue.serverTimestamp() }),
    };
    tx.set(ref, base, { merge: true });
    stageAuditEvent(tx, {
      actorUid,
      action: "configureEmailConnection",
      targetType: "emailConnection",
      targetId: ref.id,
      outcome: "applied",
      summary: `${existing.exists ? "updated" : "created"} ${config.provider} connection "${config.connectionName}"`,
    });
  });
  return { id: ref.id };
}

export async function upsertEmailMailbox(
  db: Firestore,
  input: { id?: string | null; actorUid: string; config: unknown; status?: "ACTIVE" | "DISABLED" },
): Promise<{ id: string }> {
  const config = validateMailboxConfig(input?.config);
  const actorUid = boundedString(input?.actorUid, 255);
  if (!actorUid) throw new EmailProviderError("An authenticated actor is required.");
  const id = boundedString(input?.id, 255);
  const ref = id ? db.collection(EMAIL_MAILBOXES_COLLECTION).doc(id) : db.collection(EMAIL_MAILBOXES_COLLECTION).doc();

  await db.runTransaction(async (tx) => {
    const connection = await tx.get(db.collection(EMAIL_CONNECTIONS_COLLECTION).doc(config.connectionId));
    if (!connection.exists) throw new EmailProviderError("That connection does not exist.");
    const existing = await tx.get(ref);
    tx.set(
      ref,
      {
        ...config,
        // The mailbox key inbound delivery matches on. Derived by the WRITER so a mailbox cannot be
        // configured in a shape the intake path can never find.
        emailAddressKey: normalizeEmailAddress(config.emailAddress),
        status: input?.status === "DISABLED" ? "DISABLED" : "ACTIVE",
        updatedBy: actorUid,
        updatedAt: FieldValue.serverTimestamp(),
        ...(existing.exists ? {} : { createdBy: actorUid, createdAt: FieldValue.serverTimestamp() }),
      },
      { merge: true },
    );
    stageAuditEvent(tx, {
      actorUid,
      action: "configureEmailMailbox",
      targetType: "emailMailbox",
      targetId: ref.id,
      outcome: "applied",
      summary: `${existing.exists ? "updated" : "created"} ${config.purpose} mailbox ${config.emailAddress}`,
    });
  });
  return { id: ref.id };
}

/** Validate an administrator-authored rule condition into the closed shape the evaluator understands. */
export function validateRoutingCondition(raw: unknown): RoutingCondition {
  const w = (raw ?? {}) as Record<string, unknown>;
  const out: RoutingCondition = {};
  const senderAddress = normalizeEmailAddress(w.senderAddress);
  if (senderAddress) out.senderAddress = senderAddress;
  const senderDomain = boundedString(w.senderDomain, 255).toLowerCase().replace(/^@/, "");
  if (senderDomain) out.senderDomain = senderDomain;
  const mailboxId = boundedString(w.mailboxId, 255);
  if (mailboxId) out.mailboxId = mailboxId;
  const terms = (v: unknown): string[] =>
    (Array.isArray(v) ? v : []).slice(0, 10).map((t) => boundedString(t, 120)).filter(Boolean);
  const subjectContains = terms(w.subjectContains);
  if (subjectContains.length) out.subjectContains = subjectContains;
  const bodyContains = terms(w.bodyContains);
  if (bodyContains.length) out.bodyContains = bodyContains;
  if (typeof w.hasAttachments === "boolean") out.hasAttachments = w.hasAttachments;
  if (Object.keys(out).length === 0) {
    throw new EmailProviderError("A routing rule must have at least one condition -- a rule that matches everything is not a rule.");
  }
  return out;
}

export async function upsertEmailRoutingRule(
  db: Firestore,
  input: { id?: string | null; actorUid: string; rule: unknown },
): Promise<{ id: string }> {
  const actorUid = boundedString(input?.actorUid, 255);
  if (!actorUid) throw new EmailProviderError("An authenticated actor is required.");
  assertNoCredentialMaterial(input?.rule);
  const r = (input?.rule ?? {}) as Record<string, unknown>;
  const name = boundedString(r.name, 120);
  if (!name) throw new EmailProviderError("A routing rule needs a name.");
  const when = validateRoutingCondition(r.when);
  const then = normalizeOutcome(r.then);
  if (Object.keys(then).length === 0) throw new EmailProviderError("A routing rule must set at least one outcome.");
  const order = typeof r.order === "number" && Number.isFinite(r.order) ? Math.floor(r.order) : 100;
  const id = boundedString(input?.id, 255);
  const ref = id ? db.collection(EMAIL_ROUTING_RULES_COLLECTION).doc(id) : db.collection(EMAIL_ROUTING_RULES_COLLECTION).doc();

  await db.runTransaction(async (tx) => {
    const existing = await tx.get(ref);
    const rule: Omit<RoutingRule, "id"> = { name, enabled: r.enabled !== false, order, when, then };
    tx.set(
      ref,
      {
        ...rule,
        updatedBy: actorUid,
        updatedAt: FieldValue.serverTimestamp(),
        ...(existing.exists ? {} : { createdBy: actorUid, createdAt: FieldValue.serverTimestamp() }),
      },
      { merge: true },
    );
    stageAuditEvent(tx, {
      actorUid,
      action: "configureEmailRoutingRule",
      targetType: "emailRoutingRule",
      targetId: ref.id,
      outcome: "applied",
      summary: `${existing.exists ? "updated" : "created"} routing rule "${name}"`,
    });
  });
  return { id: ref.id };
}
