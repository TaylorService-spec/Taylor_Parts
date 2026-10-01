// Inbound Work -- ATTACHMENT CUSTODY RULES. Pure: no Firebase, no database, no network.
//
// The rules the Firebase custody path (attachmentCustody.ts, retired with the Firebase provider runtime --
// Controller SERVICE EXPERIENCE COMPLETION, 2026-09-30) applied, kept as one provider-neutral module the EOS /
// PostgreSQL custody (eosOps/inboundProviderRuntime.ts) and intake (eosOps/inboundWorkIntake.ts) both use.
//
// EVERY ATTACHMENT IS UNTRUSTED EXTERNAL INPUT:
//   1. The provider's filename is DATA, never a path. Custody ids are derived from EOS ids and a hash.
//   2. The provider's content type is a CLAIM. It travels as data; bytes are only ever served as
//      application/octet-stream with a download disposition.
//   3. Size is bounded before a byte is stored.
//   4. An attachment whose NAME or DECLARED TYPE is an executable / script is UNSAFE: its bytes are never fetched,
//      and a new intake carrying one is QUARANTINED for a person to look at.
//
// NOTHING HERE SCANS FOR MALWARE, and nothing claims to. The unsafe screen is a name / declared-type rule, not a
// content scan; content scanning is a recorded security follow-up.
import { createHash } from "node:crypto";
import { boundedString } from "./inboundWorkModel";

/** Provider ceilings are ~25-150MB; EOS takes the conservative one. A bigger file is refused, not truncated. */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

export type AttachmentCustodyState = "PENDING" | "STORED" | "FAILED" | "REFUSED_UNSAFE" | "METADATA_ONLY";
export type IntakeAttachmentCustody = "NONE" | "PENDING" | "PARTIAL" | "COMPLETE" | "FAILED" | "METADATA_ONLY" | "REFUSED_UNSAFE";

export class AttachmentRefusal extends Error {
  readonly code: "TOO_LARGE" | "INVALID_METADATA" | "UNSAFE_ATTACHMENT";
  constructor(code: "TOO_LARGE" | "INVALID_METADATA" | "UNSAFE_ATTACHMENT", message: string) {
    super(message);
    this.name = "AttachmentRefusal";
    this.code = code;
  }
}

/** A filename safe to STORE AS DATA and offer as a download name: no separators, traversal, controls or leading dots. */
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
 * The custody id. Derived from EOS ids and a hash of the provider's message/attachment pair -- never from the
 * filename. Deterministic: the same attachment retried lands on the same id instead of accumulating copies.
 */
export function attachmentCustodyId(requestId: string, sourceMessageId: string, providerAttachmentId: string): string {
  const request = String(requestId ?? "").replace(/[^A-Za-z0-9_-]/g, "");
  if (!request) throw new AttachmentRefusal("INVALID_METADATA", "An attachment cannot be stored without its inbound request.");
  const digest = createHash("sha256").update(`${request}|${sourceMessageId}|${providerAttachmentId}`).digest("hex").slice(0, 40);
  return `iwa_${digest}`;
}

export function sha256Of(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Bounds checked BEFORE a write. A zero-byte attachment is real and is kept. */
export function assertStorableAttachment(bytes: Buffer, declaredSize: number): void {
  if (!Buffer.isBuffer(bytes)) throw new AttachmentRefusal("INVALID_METADATA", "The provider returned no attachment content.");
  if (bytes.length > MAX_ATTACHMENT_BYTES) {
    throw new AttachmentRefusal("TOO_LARGE", `That attachment is larger than the ${Math.round(MAX_ATTACHMENT_BYTES / 1024 / 1024)}MB limit.`);
  }
  if (declaredSize > MAX_ATTACHMENT_BYTES) {
    throw new AttachmentRefusal("TOO_LARGE", "The provider reports an attachment larger than the limit; it was not fetched.");
  }
}

/** Executable and script forms a service request has no business carrying. Lower-case, without the dot. */
export const UNSAFE_ATTACHMENT_EXTENSIONS: ReadonlySet<string> = new Set([
  "exe", "com", "scr", "pif", "bat", "cmd", "msi", "msp", "dll", "cpl", "jar", "js", "jse", "vbs", "vbe", "wsf", "wsh",
  "ps1", "psm1", "hta", "lnk", "reg", "sh", "apk", "app", "iso", "img",
]);
export const UNSAFE_ATTACHMENT_MIME_TYPES: ReadonlySet<string> = new Set([
  "application/x-msdownload", "application/x-msdos-program", "application/x-dosexec", "application/x-executable",
  "application/x-sh", "application/x-bat", "application/hta", "application/java-archive", "application/x-ms-installer",
  "application/vnd.microsoft.portable-executable", "text/javascript", "application/javascript", "text/vbscript",
]);

/** Why an attachment is unsafe, or null. Every dotted segment is checked, so `invoice.pdf.exe` is caught. */
export function unsafeAttachmentReason(attachment: { filename?: unknown; mimeType?: unknown; size?: unknown }): string | null {
  const name = boundedString(attachment?.filename, 255).toLowerCase();
  const segments = name.split(".").slice(1).map((s) => s.trim());
  const ext = segments.find((s) => UNSAFE_ATTACHMENT_EXTENSIONS.has(s));
  if (ext) return `executable or script attachment (.${ext})`;
  const mime = boundedString(attachment?.mimeType, 120).toLowerCase().split(";")[0].trim();
  if (UNSAFE_ATTACHMENT_MIME_TYPES.has(mime)) return `executable or script content type (${mime})`;
  const size = typeof attachment?.size === "number" ? attachment.size : 0;
  if (size > MAX_ATTACHMENT_BYTES) return `attachment larger than the ${Math.round(MAX_ATTACHMENT_BYTES / 1024 / 1024)}MB limit`;
  return null;
}

/** COMPLETE only when every attachment is stored. Anything less says so, rather than looking finished. */
export function summarizeCustody(records: readonly { custody?: string }[]): IntakeAttachmentCustody {
  if (records.length === 0) return "NONE";
  const states = records.map((r) => r.custody ?? "PENDING");
  if (states.every((s) => s === "STORED")) return "COMPLETE";
  if (states.every((s) => s === "METADATA_ONLY")) return "METADATA_ONLY";
  if (states.some((s) => s === "REFUSED_UNSAFE") && !states.some((s) => s === "STORED" || s === "PENDING")) return "REFUSED_UNSAFE";
  if (states.every((s) => s === "FAILED" || s === "REFUSED_UNSAFE")) return "FAILED";
  if (states.some((s) => s === "STORED")) return "PARTIAL";
  return states.some((s) => s === "PENDING") ? "PENDING" : "FAILED";
}
