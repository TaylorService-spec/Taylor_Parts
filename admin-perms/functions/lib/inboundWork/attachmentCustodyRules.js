"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UNSAFE_ATTACHMENT_MIME_TYPES = exports.UNSAFE_ATTACHMENT_EXTENSIONS = exports.AttachmentRefusal = exports.MAX_ATTACHMENT_BYTES = void 0;
exports.safeAttachmentFilename = safeAttachmentFilename;
exports.attachmentCustodyId = attachmentCustodyId;
exports.sha256Of = sha256Of;
exports.assertStorableAttachment = assertStorableAttachment;
exports.unsafeAttachmentReason = unsafeAttachmentReason;
exports.summarizeCustody = summarizeCustody;
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
const node_crypto_1 = require("node:crypto");
const inboundWorkModel_1 = require("./inboundWorkModel");
/** Provider ceilings are ~25-150MB; EOS takes the conservative one. A bigger file is refused, not truncated. */
exports.MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
class AttachmentRefusal extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.name = "AttachmentRefusal";
        this.code = code;
    }
}
exports.AttachmentRefusal = AttachmentRefusal;
/** A filename safe to STORE AS DATA and offer as a download name: no separators, traversal, controls or leading dots. */
function safeAttachmentFilename(raw) {
    const name = (0, inboundWorkModel_1.boundedString)(raw, 255)
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
function attachmentCustodyId(requestId, sourceMessageId, providerAttachmentId) {
    const request = String(requestId ?? "").replace(/[^A-Za-z0-9_-]/g, "");
    if (!request)
        throw new AttachmentRefusal("INVALID_METADATA", "An attachment cannot be stored without its inbound request.");
    const digest = (0, node_crypto_1.createHash)("sha256").update(`${request}|${sourceMessageId}|${providerAttachmentId}`).digest("hex").slice(0, 40);
    return `iwa_${digest}`;
}
function sha256Of(bytes) {
    return (0, node_crypto_1.createHash)("sha256").update(bytes).digest("hex");
}
/** Bounds checked BEFORE a write. A zero-byte attachment is real and is kept. */
function assertStorableAttachment(bytes, declaredSize) {
    if (!Buffer.isBuffer(bytes))
        throw new AttachmentRefusal("INVALID_METADATA", "The provider returned no attachment content.");
    if (bytes.length > exports.MAX_ATTACHMENT_BYTES) {
        throw new AttachmentRefusal("TOO_LARGE", `That attachment is larger than the ${Math.round(exports.MAX_ATTACHMENT_BYTES / 1024 / 1024)}MB limit.`);
    }
    if (declaredSize > exports.MAX_ATTACHMENT_BYTES) {
        throw new AttachmentRefusal("TOO_LARGE", "The provider reports an attachment larger than the limit; it was not fetched.");
    }
}
/** Executable and script forms a service request has no business carrying. Lower-case, without the dot. */
exports.UNSAFE_ATTACHMENT_EXTENSIONS = new Set([
    "exe", "com", "scr", "pif", "bat", "cmd", "msi", "msp", "dll", "cpl", "jar", "js", "jse", "vbs", "vbe", "wsf", "wsh",
    "ps1", "psm1", "hta", "lnk", "reg", "sh", "apk", "app", "iso", "img",
]);
exports.UNSAFE_ATTACHMENT_MIME_TYPES = new Set([
    "application/x-msdownload", "application/x-msdos-program", "application/x-dosexec", "application/x-executable",
    "application/x-sh", "application/x-bat", "application/hta", "application/java-archive", "application/x-ms-installer",
    "application/vnd.microsoft.portable-executable", "text/javascript", "application/javascript", "text/vbscript",
]);
/** Why an attachment is unsafe, or null. Every dotted segment is checked, so `invoice.pdf.exe` is caught. */
function unsafeAttachmentReason(attachment) {
    const name = (0, inboundWorkModel_1.boundedString)(attachment?.filename, 255).toLowerCase();
    const segments = name.split(".").slice(1).map((s) => s.trim());
    const ext = segments.find((s) => exports.UNSAFE_ATTACHMENT_EXTENSIONS.has(s));
    if (ext)
        return `executable or script attachment (.${ext})`;
    const mime = (0, inboundWorkModel_1.boundedString)(attachment?.mimeType, 120).toLowerCase().split(";")[0].trim();
    if (exports.UNSAFE_ATTACHMENT_MIME_TYPES.has(mime))
        return `executable or script content type (${mime})`;
    const size = typeof attachment?.size === "number" ? attachment.size : 0;
    if (size > exports.MAX_ATTACHMENT_BYTES)
        return `attachment larger than the ${Math.round(exports.MAX_ATTACHMENT_BYTES / 1024 / 1024)}MB limit`;
    return null;
}
/** COMPLETE only when every attachment is stored. Anything less says so, rather than looking finished. */
function summarizeCustody(records) {
    if (records.length === 0)
        return "NONE";
    const states = records.map((r) => r.custody ?? "PENDING");
    if (states.every((s) => s === "STORED"))
        return "COMPLETE";
    if (states.every((s) => s === "METADATA_ONLY"))
        return "METADATA_ONLY";
    if (states.some((s) => s === "REFUSED_UNSAFE") && !states.some((s) => s === "STORED" || s === "PENDING"))
        return "REFUSED_UNSAFE";
    if (states.every((s) => s === "FAILED" || s === "REFUSED_UNSAFE"))
        return "FAILED";
    if (states.some((s) => s === "STORED"))
        return "PARTIAL";
    return states.some((s) => s === "PENDING") ? "PENDING" : "FAILED";
}
//# sourceMappingURL=attachmentCustodyRules.js.map