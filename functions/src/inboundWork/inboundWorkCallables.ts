// Email Connections + Inbound Work -- the CALLABLE SURFACE. Thin by design: every one of these resolves
// the caller's identity from request.auth (never from the payload), resolves ONE governed capability
// through the trusted effective-access feed, and delegates to the command or read that owns the behavior.
//
// AUTHORITY IS NEVER CLIENT-SUPPLIED. `actorUid` is `request.auth.uid` in every case -- no callable below
// accepts an actor, an operating company, a provider authority, or a decision timestamp from the payload,
// so there is nothing for a client to spoof. The operating company on an intake record comes from the
// mailbox or a routing rule an administrator wrote; the accepting user comes from the authenticated
// session; the acceptance time is a server timestamp.
//
// EXPORT != DEPLOY, REGISTER != GRANT. All six capabilities are registered active:false, so
// resolveEffectivePermission() denies every principal in every environment until a per-environment
// activation AND a governed roleAssignment exist. Production activation is hard-blocked.
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { resolveEffectiveAccess } from "../access/effectiveAccessFeed";
import { assertNonProductionImportTarget } from "../dataImport/importTargetGuard";
import { WorkOrderEquipmentError } from "../workOrderEquipment";
import { EmailProviderError, isEmailProviderId, normalizeProviderMessage } from "./emailProvider";
import { upsertEmailConnection, upsertEmailMailbox, upsertEmailRoutingRule } from "./emailAdminCommands";
import { ingestInboundMessage } from "./inboundIntakeCommand";
import {
  acceptInboundWorkRequest,
  attachInboundWorkRequest,
  declineInboundWorkRequest,
  InboundDecisionError,
} from "./inboundDecisionCommands";
import {
  readEmailIntakeConfiguration,
  readInboundWorkQueue,
  readInboundWorkRequest,
  readMailbox,
  readRoutingRules,
} from "./inboundWorkReadService";
import { INBOUND_WORK_STATUSES, InboundWorkValidationError, boundedString, type InboundWorkStatus } from "./inboundWorkModel";

export const ADMIN_EMAIL_INTAKE_READ = "administration.emailIntake.read";
export const ADMIN_EMAIL_INTAKE_MANAGE = "administration.emailIntake.manage";
export const INBOUND_WORK_READ = "service.inboundWork.read";
export const INBOUND_WORK_ACCEPT = "service.inboundWork.accept";
export const INBOUND_WORK_DECLINE = "service.inboundWork.decline";
export const INBOUND_WORK_ATTACH = "service.inboundWork.attachExisting";

const REGION = "us-central1";

/** Fail-closed capability gate. A resolution failure denies -- it never falls through to allow. */
async function requireCapability(uid: string, capability: string): Promise<void> {
  let allowed = false;
  try {
    const { decisions } = await resolveEffectiveAccess({ principalUid: uid, permissionIds: [capability] });
    allowed = decisions[capability] === true;
  } catch (err) {
    console.error(`[inboundWork] capability resolution failed for ${capability}`, err);
    allowed = false;
  }
  if (!allowed) throw new HttpsError("permission-denied", "You are not authorized to perform this action.");
}

function callerUid(request: { auth?: { uid?: string } | null }): string {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Must be signed in.");
  return uid;
}

/** Map a domain error to the right client-visible failure without leaking internals. */
function toHttpsError(err: unknown): HttpsError {
  if (err instanceof HttpsError) return err;
  if (err instanceof InboundDecisionError) {
    const code =
      err.code === "NOT_FOUND" || err.code === "WORK_ORDER_NOT_FOUND"
        ? "not-found"
        : err.code === "ALREADY_DECIDED"
          ? "failed-precondition"
          : "invalid-argument";
    return new HttpsError(code, err.message);
  }
  if (err instanceof WorkOrderEquipmentError || err instanceof EmailProviderError || err instanceof InboundWorkValidationError) {
    return new HttpsError("invalid-argument", err.message);
  }
  console.error("[inboundWork] unexpected failure", err);
  return new HttpsError("internal", "That action is temporarily unavailable.");
}

const requestedStatuses = (raw: unknown): InboundWorkStatus[] | undefined => {
  if (!Array.isArray(raw)) return undefined;
  const out = raw.filter((s): s is InboundWorkStatus => (INBOUND_WORK_STATUSES as readonly string[]).includes(s as string));
  return out.length ? out : undefined;
};

// ── Service: the queue and one request's review detail ────────────────────────────────────────────
export const listInboundWork = onCall({ region: REGION }, async (request) => {
  const uid = callerUid(request);
  await requireCapability(uid, INBOUND_WORK_READ);
  try {
    const data = (request.data ?? {}) as Record<string, unknown>;
    return await readInboundWorkQueue(getFirestore(), {
      statuses: requestedStatuses(data.statuses),
      limit: typeof data.limit === "number" ? data.limit : undefined,
    });
  } catch (err) {
    throw toHttpsError(err);
  }
});

export const getInboundWorkRequest = onCall({ region: REGION }, async (request) => {
  const uid = callerUid(request);
  await requireCapability(uid, INBOUND_WORK_READ);
  try {
    const requestId = boundedString((request.data as Record<string, unknown>)?.requestId, 255);
    const detail = await readInboundWorkRequest(getFirestore(), requestId);
    if (!detail) throw new HttpsError("not-found", "That inbound request does not exist.");
    return detail;
  } catch (err) {
    throw toHttpsError(err);
  }
});

// ── Service: the three decisions ──────────────────────────────────────────────────────────────────
export const acceptInboundWork = onCall({ region: REGION }, async (request) => {
  const uid = callerUid(request);
  await requireCapability(uid, INBOUND_WORK_ACCEPT);
  const d = (request.data ?? {}) as Record<string, unknown>;
  try {
    return await acceptInboundWorkRequest(getFirestore(), {
      requestId: boundedString(d.requestId, 255),
      // NOT from the payload, ever.
      actorUid: uid,
      customerId: boundedString(d.customerId, 255),
      locationId: boundedString(d.locationId, 255),
      equipmentId: boundedString(d.equipmentId, 255) || null,
      requestType: (d.requestType as never) ?? null,
      priority: (d.priority as never) ?? null,
      problemDescription: boundedString(d.problemDescription, 500) || null,
    });
  } catch (err) {
    throw toHttpsError(err);
  }
});

export const declineInboundWork = onCall({ region: REGION }, async (request) => {
  const uid = callerUid(request);
  await requireCapability(uid, INBOUND_WORK_DECLINE);
  const d = (request.data ?? {}) as Record<string, unknown>;
  try {
    return await declineInboundWorkRequest(getFirestore(), {
      requestId: boundedString(d.requestId, 255),
      actorUid: uid,
      reason: d.reason as never,
      note: boundedString(d.note, 500) || null,
    });
  } catch (err) {
    throw toHttpsError(err);
  }
});

export const attachInboundWorkToWorkOrder = onCall({ region: REGION }, async (request) => {
  const uid = callerUid(request);
  await requireCapability(uid, INBOUND_WORK_ATTACH);
  const d = (request.data ?? {}) as Record<string, unknown>;
  try {
    return await attachInboundWorkRequest(getFirestore(), {
      requestId: boundedString(d.requestId, 255),
      actorUid: uid,
      workOrderId: boundedString(d.workOrderId, 255),
    });
  } catch (err) {
    throw toHttpsError(err);
  }
});

// ── Administration: configuration ─────────────────────────────────────────────────────────────────
export const getEmailIntakeConfiguration = onCall({ region: REGION }, async (request) => {
  const uid = callerUid(request);
  await requireCapability(uid, ADMIN_EMAIL_INTAKE_READ);
  try {
    return await readEmailIntakeConfiguration(getFirestore());
  } catch (err) {
    throw toHttpsError(err);
  }
});

export const saveEmailConnection = onCall({ region: REGION }, async (request) => {
  const uid = callerUid(request);
  await requireCapability(uid, ADMIN_EMAIL_INTAKE_MANAGE);
  const d = (request.data ?? {}) as Record<string, unknown>;
  try {
    return await upsertEmailConnection(getFirestore(), { id: boundedString(d.id, 255) || null, actorUid: uid, config: d.config });
  } catch (err) {
    throw toHttpsError(err);
  }
});

export const saveEmailMailbox = onCall({ region: REGION }, async (request) => {
  const uid = callerUid(request);
  await requireCapability(uid, ADMIN_EMAIL_INTAKE_MANAGE);
  const d = (request.data ?? {}) as Record<string, unknown>;
  try {
    return await upsertEmailMailbox(getFirestore(), {
      id: boundedString(d.id, 255) || null,
      actorUid: uid,
      config: d.config,
      status: d.status === "DISABLED" ? "DISABLED" : "ACTIVE",
    });
  } catch (err) {
    throw toHttpsError(err);
  }
});

export const saveEmailRoutingRule = onCall({ region: REGION }, async (request) => {
  const uid = callerUid(request);
  await requireCapability(uid, ADMIN_EMAIL_INTAKE_MANAGE);
  const d = (request.data ?? {}) as Record<string, unknown>;
  try {
    return await upsertEmailRoutingRule(getFirestore(), { id: boundedString(d.id, 255) || null, actorUid: uid, rule: d.rule });
  } catch (err) {
    throw toHttpsError(err);
  }
});

/**
 * DELIVER ONE PROVIDER MESSAGE INTO INTAKE -- the non-production delivery seam.
 *
 * WHY IT EXISTS. Real delivery is a provider poll or webhook holding an OAuth token, and no non-production
 * Microsoft 365 / Google Workspace tenant or client registration is available to this repository. Rather
 * than fabricate credentials, this callable takes a message in the PROVIDER'S OWN native shape (a Microsoft
 * Graph message resource, or a Gmail users.messages resource) and runs it through the identical adapter,
 * routing, processing, threading and intake path a real poll would use. When a tenant is bound, the poller
 * calls `ingestInboundMessage` with an adapter-normalized message and nothing else changes.
 *
 * IT IS REFUSED IN PRODUCTION, twice over: the environment guard below (project identity from the runtime,
 * never from the payload -- `taylor-parts` refused by name AND any role:"production" registry entry refused)
 * and the capability itself, which no production environment can activate. It also requires the
 * ADMINISTRATION manage authority, not the Service queue authority -- injecting a message is a
 * configuration/test act, not an operational one.
 */
export const deliverInboundEmailMessage = onCall({ region: REGION }, async (request) => {
  const uid = callerUid(request);
  await requireCapability(uid, ADMIN_EMAIL_INTAKE_MANAGE);
  try {
    // The same non-production boundary Data Import uses, applied to the same question ("may this
    // environment take externally-shaped writes at all"). Reused rather than re-implemented: a second copy
    // of a production-refusal guard is a second thing that can be got wrong.
    assertNonProductionImportTarget(process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT ?? "");
  } catch (err) {
    throw new HttpsError("failed-precondition", `Simulated inbound delivery is not available in this environment. ${(err as Error).message}`);
  }
  const d = (request.data ?? {}) as Record<string, unknown>;
  const provider = d.provider;
  if (!isEmailProviderId(provider)) throw new HttpsError("invalid-argument", "provider must be MICROSOFT_365 or GOOGLE_WORKSPACE.");
  const mailboxId = boundedString(d.mailboxId, 255);
  if (!mailboxId) throw new HttpsError("invalid-argument", "mailboxId is required.");
  try {
    const db = getFirestore();
    const mailbox = await readMailbox(db, mailboxId);
    const message = normalizeProviderMessage(provider, d.message, {
      connectionId: mailbox?.connectionId ?? boundedString(d.connectionId, 255),
      mailboxId,
    });
    const rules = mailbox ? await readRoutingRules(db) : [];
    return await ingestInboundMessage(db, { message, mailbox, rules, actorUid: uid });
  } catch (err) {
    throw toHttpsError(err);
  }
});
