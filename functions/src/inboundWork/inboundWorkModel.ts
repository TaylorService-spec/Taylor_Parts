// Email Connections + Inbound Work -- the PURE domain model. No firebase-admin, no firebase-functions,
// no Firestore: every symbol here is data, validation or a total function, so the intake lifecycle can be
// tested without a database (the same split partMaster/cycleCount use between their command core and their
// Firestore wiring).
//
// WHAT THIS RECORD IS. `InboundWorkRequest` is the OPERATIONAL INTAKE of one externally-originated request
// for work -- today an email, tomorrow potentially another channel. It is deliberately NOT a second Work
// Order, a second Customer, or a second Equipment record: it references those by id and never restates
// their fields. Accepting one CREATES a Work Order through the SAME governed createWorkOrderRecord core an
// admin/dispatcher uses by hand; it does not gain a private write path, and it never edits mastered
// Customer / Location / Contact / Equipment data (see inboundDecisionCommands.ts).
//
// UNTRUSTED INPUT. Every string on this record originates outside EOS. Nothing here is authority: the
// sender does not choose the operating company, the priority, the customer, or the accepting user. The
// provider payload is normalized and BOUNDED here (length caps, HTML stripped into `normalizedBody`) before
// it is ever persisted, and the raw message is retained separately as evidence -- never as markup a surface
// renders.

/** Where an inbound request came from. EMAIL is the only channel with an implementation in P1. */
export const INBOUND_SOURCE_CHANNELS = ["EMAIL", "API", "PORTAL", "WEB_FORM", "MANUFACTURER_FEED", "OTHER"] as const;
export type InboundSourceChannel = (typeof INBOUND_SOURCE_CHANNELS)[number];

/**
 * The intake lifecycle.
 *
 * DELIBERATELY ABSENT: `NEW` and `PROCESSING`. Intake is a single governed transaction -- a message is
 * normalized, routed and processed before it is written -- so no reader could ever observe either state,
 * and a state nothing can reach is a state that quietly rots. When an asynchronous provider poll lands
 * (P2, see docs), it adds them where they become observable rather than pretending they exist now.
 */
export const INBOUND_WORK_STATUSES = [
  /** Routed and processed; a reviewer's decision is the only thing outstanding. */
  "AWAITING_DECISION",
  /** Routing demanded manual review, or thread association was ambiguous. Same queue, louder. */
  "NEEDS_REVIEW",
  "ACCEPTED",
  "DECLINED",
  /** Preserved against an existing Work Order rather than creating a new one. */
  "ATTACHED",
  /** The same provider message id was already taken in. Retained, never silently dropped. */
  "DUPLICATE",
  /** Processing failed. Retained with the failure so it can be retried, not lost. */
  "FAILED",
  /** Refused before review: unknown mailbox, or content that must not be worked from. */
  "QUARANTINED",
] as const;
export type InboundWorkStatus = (typeof INBOUND_WORK_STATUSES)[number];

/** The statuses a reviewer decision may act on. Anything else is already decided or not reviewable. */
export const DECIDABLE_STATUSES: ReadonlySet<InboundWorkStatus> = new Set<InboundWorkStatus>([
  "AWAITING_DECISION",
  "NEEDS_REVIEW",
]);

export const INBOUND_DECLINE_REASONS = [
  "OUTSIDE_SERVICE_AREA",
  "UNSUPPORTED_EQUIPMENT",
  "CAPACITY",
  "DUPLICATE",
  "CUSTOMER_ACCOUNT_ISSUE",
  "INVALID_REQUEST",
  "OTHER",
] as const;
export type InboundDeclineReason = (typeof INBOUND_DECLINE_REASONS)[number];

/** Who produced the enrichment on an intake record. EOS_NATIVE is base EOS and needs no add-on. */
export const INBOUND_PROCESSING_PROVIDERS = ["EOS_NATIVE", "VDX", "EXTERNAL"] as const;
export type InboundProcessingProvider = (typeof INBOUND_PROCESSING_PROVIDERS)[number];

/** The request classification a routing rule may assign. Mirrors the Work Order types EOS already governs. */
export const INBOUND_REQUEST_TYPES = ["SERVICE", "WARRANTY", "INSTALL", "PM", "PARTS", "OTHER"] as const;
export type InboundRequestType = (typeof INBOUND_REQUEST_TYPES)[number];

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Bounds. An external sender does not get to choose how much of our storage one message occupies.
export const MAX_SUBJECT_LENGTH = 500;
export const MAX_BODY_LENGTH = 100_000;
export const MAX_NORMALIZED_BODY_LENGTH = 20_000;
export const MAX_RECIPIENTS = 50;
export const MAX_ATTACHMENTS = 50;
export const MAX_REFERENCES = 50;
export const MAX_EXTRACTED_FIELD_LENGTH = 120;

export interface InboundAttachmentRef {
  filename: string;
  mimeType: string;
  size: number;
  /** Provider-side content hash when the provider supplies one. Never computed from a body we did not fetch. */
  contentHash: string | null;
  /** The provider's own attachment identifier -- how the bytes are re-fetched through the connection. */
  providerAttachmentId: string;
  sourceMessageId: string;
  receivedAt: number;
}

/** The normalized provider message -- the ONE shape every provider adapter produces. */
export interface NormalizedInboundMessage {
  provider: string;
  connectionId: string;
  mailboxId: string;
  messageId: string;
  threadId: string | null;
  inReplyTo: string | null;
  references: string[];
  receivedAt: number;
  sender: string;
  recipients: string[];
  cc: string[];
  subject: string;
  /** The message as it arrived, retained as evidence. NEVER rendered as markup -- see normalizedBody. */
  originalBody: string;
  originalBodyContentType: "text/plain" | "text/html";
  attachments: InboundAttachmentRef[];
}

export class InboundWorkValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InboundWorkValidationError";
  }
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

export function boundedString(v: unknown, max: number): string {
  return str(v).slice(0, max);
}

/** An email address, lower-cased, or "" when the value is not one. Used for keys, never for authority. */
export function normalizeEmailAddress(v: unknown): string {
  const raw = str(v).toLowerCase();
  const angled = /<([^>]+)>/.exec(raw);
  const candidate = (angled ? angled[1] : raw).trim();
  return /^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(candidate) ? candidate : "";
}

export function emailDomain(address: unknown): string {
  const normalized = normalizeEmailAddress(address);
  const at = normalized.lastIndexOf("@");
  return at === -1 ? "" : normalized.slice(at + 1);
}

const HTML_BLOCK_ELEMENTS = /<\/?(?:p|div|br|tr|li|h[1-6]|table|blockquote)\b[^>]*>/gi;

/**
 * HTML -> plain text, for the ONE body a surface renders.
 *
 * TREAT INBOUND EMAIL AS HOSTILE. This is not a sanitizer that keeps "safe" markup -- keeping markup is
 * how an inbound message eventually reaches a `dangerouslySetInnerHTML`. Script and style CONTENT is
 * dropped whole (not merely unwrapped, or `alert(1)` survives as text-that-looks-like-a-body), every
 * remaining tag is removed, the handful of entities that matter are decoded ONCE (so `&amp;lt;` cannot
 * round-trip back into `<`), and the result is length-bounded. The output contains no `<` or `>` at all,
 * which is the property inboundWorkSanitization.test.mjs asserts directly.
 */
export function toPlainText(input: unknown, contentType: "text/plain" | "text/html" = "text/html"): string {
  let text = str(input);
  if (contentType === "text/html") {
    text = text
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
      // An unclosed <script> would otherwise survive the tag strip below with its body intact.
      .replace(/<(script|style)\b[\s\S]*$/gi, " ")
      .replace(HTML_BLOCK_ELEMENTS, "\n")
      .replace(/<[^>]*>/g, " ");
  }
  text = text
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&amp;/gi, "&")
    // Whatever the decode produced, this body is TEXT. Angle brackets are stripped unconditionally so no
    // decoded entity can reconstitute a tag downstream.
    .replace(/[<>]/g, " ")
    .replace(/[ \t\f\v ]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text.slice(0, MAX_NORMALIZED_BODY_LENGTH);
}

function boundedList(values: unknown, max: number, map: (v: unknown) => string): string[] {
  if (!Array.isArray(values)) return [];
  const out: string[] = [];
  for (const value of values) {
    const mapped = map(value);
    if (mapped && !out.includes(mapped)) out.push(mapped);
    if (out.length >= max) break;
  }
  return out;
}

function normalizeAttachment(raw: unknown, messageId: string, receivedAt: number): InboundAttachmentRef | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Record<string, unknown>;
  const filename = boundedString(a.filename ?? a.name, 255);
  const providerAttachmentId = boundedString(a.providerAttachmentId ?? a.id, 255);
  if (!filename || !providerAttachmentId) return null;
  const size = typeof a.size === "number" && Number.isFinite(a.size) && a.size >= 0 ? Math.floor(a.size) : 0;
  return {
    filename,
    mimeType: boundedString(a.mimeType ?? a.contentType, 255) || "application/octet-stream",
    size,
    contentHash: boundedString(a.contentHash ?? a.hash, 128) || null,
    providerAttachmentId,
    sourceMessageId: messageId,
    receivedAt,
  };
}

/**
 * Normalize whatever a provider adapter produced into the one canonical message shape, bounded and safe to
 * persist. Throws only for the two facts without which an intake record cannot exist at all: the message's
 * own provider id and the mailbox it arrived in.
 */
export function normalizeInboundMessage(raw: unknown): NormalizedInboundMessage {
  if (!raw || typeof raw !== "object") throw new InboundWorkValidationError("A provider message is required.");
  const m = raw as Record<string, unknown>;
  const messageId = boundedString(m.messageId, 255);
  if (!messageId) throw new InboundWorkValidationError("messageId is required.");
  const mailboxId = boundedString(m.mailboxId, 255);
  if (!mailboxId) throw new InboundWorkValidationError("mailboxId is required.");
  const receivedAt =
    typeof m.receivedAt === "number" && Number.isFinite(m.receivedAt) && m.receivedAt > 0 ? Math.floor(m.receivedAt) : 0;
  const contentType = m.originalBodyContentType === "text/plain" ? "text/plain" : "text/html";
  return {
    provider: boundedString(m.provider, 64),
    connectionId: boundedString(m.connectionId, 255),
    mailboxId,
    messageId,
    threadId: boundedString(m.threadId, 255) || null,
    inReplyTo: boundedString(m.inReplyTo, 255) || null,
    references: boundedList(m.references, MAX_REFERENCES, (v) => boundedString(v, 255)),
    receivedAt,
    sender: normalizeEmailAddress(m.sender),
    recipients: boundedList(m.recipients, MAX_RECIPIENTS, normalizeEmailAddress),
    cc: boundedList(m.cc, MAX_RECIPIENTS, normalizeEmailAddress),
    subject: boundedString(m.subject, MAX_SUBJECT_LENGTH),
    originalBody: boundedString(m.originalBody, MAX_BODY_LENGTH),
    originalBodyContentType: contentType,
    attachments: (Array.isArray(m.attachments) ? m.attachments : [])
      .slice(0, MAX_ATTACHMENTS)
      .map((a) => normalizeAttachment(a, messageId, receivedAt))
      .filter((a): a is InboundAttachmentRef => a !== null),
  };
}

export function isInboundDeclineReason(value: unknown): value is InboundDeclineReason {
  return typeof value === "string" && (INBOUND_DECLINE_REASONS as readonly string[]).includes(value);
}

export function isInboundRequestType(value: unknown): value is InboundRequestType {
  return typeof value === "string" && (INBOUND_REQUEST_TYPES as readonly string[]).includes(value);
}
