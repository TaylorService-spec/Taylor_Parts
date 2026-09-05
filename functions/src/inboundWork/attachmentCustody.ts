// Email Connections + Inbound Work -- ATTACHMENT CUSTODY. PR #1811 preserved what an attachment IS
// (filename, type, size, provider id, provenance); this takes custody of the bytes.
//
// WHERE THE BYTES GO. Cloud Storage, in the environment's own bucket, under a key EOS derives -- never
// into Firestore, which is a document database with a 1MB limit and no business holding file content.
//
// THE BUCKET IS PRIVATE AND STAYS PRIVATE. No client reads it: `storage.rules` denies every client read
// and write, and the only way to the bytes is the governed read in inboundWorkCallables.ts, which
// authorizes against the INTAKE RECORD the attachment belongs to. Somebody who cannot open the inbound
// request cannot reach its attachment by guessing a URL, because there is no URL to guess.
//
// EVERY ATTACHMENT IS UNTRUSTED EXTERNAL INPUT, and three rules follow from that:
//   1. The provider's filename is metadata, never a path. Storage keys are derived from ids and a hash.
//   2. The provider's content type is a claim. Bytes are STORED as application/octet-stream so the
//      bucket can never serve an active type, and the claimed type travels beside them as data.
//   3. Size is bounded before a byte is written.
//
// NOTHING HERE SCANS FOR MALWARE, and this file does not pretend otherwise. No scanning architecture
// exists in this repository; claiming files are scanned when they are not is worse than the absence.
// Recorded as a security follow-up in the architecture document.
import { createHash } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { INBOUND_WORK_REQUESTS_COLLECTION } from "../constants/collections";
import { recordStandaloneAuditEvent } from "../access/auditEventWriter";
import { boundedString, type InboundAttachmentRef } from "./inboundWorkModel";
import { ProviderTransportError, type EmailTransportAdapter } from "./providerTransport";

/** Provider ceilings are ~25-150MB; EOS takes the conservative one. A bigger file is refused, not truncated. */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

export type AttachmentCustodyState = "PENDING" | "STORED" | "FAILED";
export type IntakeAttachmentCustody = "NONE" | "PENDING" | "PARTIAL" | "COMPLETE" | "FAILED";

export interface StoredAttachment {
  storageKey: string;
  size: number;
  contentHash: string;
}

/** The storage seam. One implementation for the platform, one for tests; nothing else knows the difference. */
export interface AttachmentStore {
  put(key: string, bytes: Buffer, metadata: Record<string, string>): Promise<StoredAttachment>;
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
}

export class AttachmentRefusal extends Error {
  readonly code: "TOO_LARGE" | "INVALID_METADATA";
  constructor(code: "TOO_LARGE" | "INVALID_METADATA", message: string) {
    super(message);
    this.name = "AttachmentRefusal";
    this.code = code;
  }
}

/**
 * A filename safe to STORE AS DATA. It is never a path segment, so this is about what a person will see
 * and what a browser will be offered as a download name -- path separators, traversal sequences, control
 * characters and leading dots all removed, length bounded.
 */
export function safeAttachmentFilename(raw: unknown): string {
  const name = boundedString(raw, 255)
    .replace(/[\\/]+/g, "_")
    .replace(/\.{2,}/g, ".")
    .replace(/[\u0000-\u001f]/g, "")
    .replace(/^\.+/, "")
    .trim();
  return name || "attachment";
}

/**
 * The storage key. Derived from EOS ids and a hash of the provider's message/attachment pair -- never
 * from the filename, never from anything a sender controls. Deterministic on purpose: the same
 * attachment retried lands on the same key instead of accumulating copies.
 */
export function attachmentStorageKey(requestId: string, sourceMessageId: string, providerAttachmentId: string): string {
  const digest = createHash("sha256").update(`${sourceMessageId}|${providerAttachmentId}`).digest("hex").slice(0, 40);
  const request = String(requestId ?? "").replace(/[^A-Za-z0-9_-]/g, "");
  if (!request) throw new AttachmentRefusal("INVALID_METADATA", "An attachment cannot be stored without its inbound request.");
  return `email-intake/${request}/${digest}`;
}

export function sha256Of(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Bounds checked BEFORE a write. A zero-byte attachment is real and is kept -- flagged, not refused. */
export function assertStorableAttachment(bytes: Buffer, declaredSize: number): void {
  if (!Buffer.isBuffer(bytes)) throw new AttachmentRefusal("INVALID_METADATA", "The provider returned no attachment content.");
  if (bytes.length > MAX_ATTACHMENT_BYTES) {
    throw new AttachmentRefusal("TOO_LARGE", `That attachment is larger than the ${Math.round(MAX_ATTACHMENT_BYTES / 1024 / 1024)}MB limit.`);
  }
  if (declaredSize > MAX_ATTACHMENT_BYTES) {
    throw new AttachmentRefusal("TOO_LARGE", "The provider reports an attachment larger than the limit; it was not fetched.");
  }
}

/** The Cloud Storage implementation. Lazy-imported so nothing that never stores a byte pays for it. */
export function createCloudAttachmentStore(bucketName?: string): AttachmentStore {
  const bucket = async () => {
    const { getStorage } = await import("firebase-admin/storage");
    return bucketName ? getStorage().bucket(bucketName) : getStorage().bucket();
  };
  return {
    async put(key, bytes, metadata) {
      const file = (await bucket()).file(key);
      await file.save(bytes, {
        resumable: false,
        // NEVER the provider's content type. A bucket that serves what a sender declared is a bucket that
        // can be made to serve text/html.
        contentType: "application/octet-stream",
        metadata: { cacheControl: "private, max-age=0, no-store", metadata },
      });
      return { storageKey: key, size: bytes.length, contentHash: sha256Of(bytes) };
    },
    async get(key) {
      const file = (await bucket()).file(key);
      const [exists] = await file.exists();
      if (!exists) return null;
      const [contents] = await file.download();
      return contents;
    },
    async delete(key) {
      await (await bucket())
        .file(key)
        .delete({ ignoreNotFound: true })
        .catch(() => undefined);
    },
  };
}

export function createInMemoryAttachmentStore(): AttachmentStore & { readonly objects: Map<string, Buffer> } {
  const objects = new Map<string, Buffer>();
  return {
    objects,
    async put(key, bytes) {
      objects.set(key, bytes);
      return { storageKey: key, size: bytes.length, contentHash: sha256Of(bytes) };
    },
    async get(key) {
      return objects.get(key) ?? null;
    },
    async delete(key) {
      objects.delete(key);
    },
  };
}

/** One attachment's custody record, as it is stored on the intake's attachmentRefs entry. */
export interface AttachmentCustodyRecord extends InboundAttachmentRef {
  custody: AttachmentCustodyState;
  storageKey: string | null;
  storedAt: number | null;
  attempts: number;
  failureCode: string | null;
  /** Production retention is an unresolved policy decision; nothing here expires anything. */
  retentionPolicy: "UNRESOLVED";
}

export function initialCustody(ref: InboundAttachmentRef): AttachmentCustodyRecord {
  return {
    ...ref,
    filename: safeAttachmentFilename(ref.filename),
    custody: "PENDING",
    storageKey: null,
    storedAt: null,
    attempts: 0,
    failureCode: null,
    retentionPolicy: "UNRESOLVED",
  };
}

/** COMPLETE only when every attachment is stored. Anything less says so, rather than looking finished. */
export function summarizeCustody(records: readonly { custody: AttachmentCustodyState }[]): IntakeAttachmentCustody {
  if (records.length === 0) return "NONE";
  if (records.every((r) => r.custody === "STORED")) return "COMPLETE";
  if (records.every((r) => r.custody === "FAILED")) return "FAILED";
  if (records.some((r) => r.custody === "STORED")) return "PARTIAL";
  return "PENDING";
}

export interface AttachmentCustodyDeps {
  store: AttachmentStore;
  adapter: EmailTransportAdapter;
  accessToken: string;
  mailboxAddress: string;
  /** Who the custody is recorded as. The poller's system actor, never an end user's claim. */
  actorUid: string;
  now?: () => number;
}

/**
 * Fetch and store every outstanding attachment on one intake record, then write the custody result back.
 *
 * IDEMPOTENT BY CONSTRUCTION. An already-STORED attachment is skipped, and the storage key is
 * deterministic, so a retry after a partial failure fetches only what is missing and cannot produce a
 * second copy of what succeeded.
 *
 * A FAILURE NEVER LOSES THE INTAKE. The request, its message and its metadata are already durable; a
 * failed attachment is recorded ON the record as FAILED with its reason, the intake reads PARTIAL, and
 * the reviewer sees "one attachment could not be retrieved" instead of a screen that looks complete.
 */
export async function fetchAndStoreAttachments(
  db: Firestore,
  requestId: string,
  deps: AttachmentCustodyDeps,
): Promise<{ stored: number; failed: number; skipped: number; custody: IntakeAttachmentCustody }> {
  const now = (deps.now ?? Date.now)();
  const ref = db.collection(INBOUND_WORK_REQUESTS_COLLECTION).doc(requestId);
  const snap = await ref.get();
  if (!snap.exists) return { stored: 0, failed: 0, skipped: 0, custody: "NONE" };

  const data = snap.data() as Record<string, unknown>;
  const existing = Array.isArray(data.attachmentRefs) ? (data.attachmentRefs as AttachmentCustodyRecord[]) : [];
  if (existing.length === 0) return { stored: 0, failed: 0, skipped: 0, custody: "NONE" };

  let stored = 0;
  let failed = 0;
  let skipped = 0;
  const updated: AttachmentCustodyRecord[] = [];

  for (const raw of existing) {
    const record = raw.custody ? { ...raw } : initialCustody(raw);
    if (record.custody === "STORED" && record.storageKey) {
      skipped += 1;
      updated.push(record);
      continue;
    }
    record.attempts = (record.attempts ?? 0) + 1;
    try {
      const fetched = await deps.adapter.fetchAttachment({
        accessToken: deps.accessToken,
        mailboxAddress: deps.mailboxAddress,
        messageId: record.sourceMessageId,
        attachmentId: record.providerAttachmentId,
      });
      assertStorableAttachment(fetched.bytes, record.size ?? 0);
      const key = attachmentStorageKey(requestId, record.sourceMessageId, record.providerAttachmentId);
      const result = await deps.store.put(key, fetched.bytes, {
        // Provenance travels with the object, so a bucket audit can answer where a file came from without
        // Firestore. All of it is data; none of it is authority.
        inboundRequestId: requestId,
        sourceMessageId: record.sourceMessageId,
        providerAttachmentId: record.providerAttachmentId,
        declaredMimeType: record.mimeType,
        filename: record.filename,
      });
      record.custody = "STORED";
      record.storageKey = result.storageKey;
      record.size = result.size;
      record.contentHash = result.contentHash;
      record.storedAt = now;
      record.failureCode = null;
      stored += 1;
    } catch (err) {
      record.custody = "FAILED";
      record.failureCode =
        err instanceof AttachmentRefusal ? err.code : err instanceof ProviderTransportError ? err.code : "ATTACHMENT_FETCH_FAILED";
      failed += 1;
    }
    updated.push(record);
  }

  const custody = summarizeCustody(updated);
  await ref.update({ attachmentRefs: updated, attachmentCustody: custody, attachmentCustodyUpdatedAt: now });
  // ONE event per record, with counts -- not one per attachment. The question this trail answers is
  // "does this request have its files, and if not why", which is a fact about the record.
  if (stored > 0 || failed > 0) {
    await recordStandaloneAuditEvent({
      actorUid: deps.actorUid,
      action: "attachmentCustodyRecorded",
      targetType: "inboundWorkRequest",
      targetId: requestId,
      outcome: failed > 0 ? "uncertain" : "applied",
      summary: `attachment custody ${custody}: ${stored} stored, ${failed} failed, ${skipped} already held`,
    });
  }
  return { stored, failed, skipped, custody };
}
