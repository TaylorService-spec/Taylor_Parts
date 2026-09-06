// Email Connections + Inbound Work -- the OFFLINE suite. Everything provable without a database:
// sanitization of untrusted message content, provider message mapping for both providers, routing,
// thread association, native processing, the provider-neutral processing contract, and the refusal to
// store credential material.
//
// No emulator, no firebase-admin, no network. Every module under test here is pure by construction, which
// is the property that lets these run in seconds on every pull request.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  toPlainText,
  normalizeInboundMessage,
  normalizeEmailAddress,
  emailDomain,
  MAX_NORMALIZED_BODY_LENGTH,
  INBOUND_WORK_STATUSES,
  DECIDABLE_STATUSES,
} from "../lib/inboundWork/inboundWorkModel.js";
import { evaluateRouting, ruleMatches, normalizeOutcome, UNROUTED_OUTCOME } from "../lib/inboundWork/inboundRouting.js";
import { associateInboundMessage } from "../lib/inboundWork/inboundThreading.js";
import {
  processInboundMessageNatively,
  normalizeProcessingResult,
  extractProblemDescription,
} from "../lib/inboundWork/inboundProcessing.js";
import {
  validateConnectionConfig,
  validateMailboxConfig,
  buildAuthorizationRequest,
  normalizeProviderMessage,
  EmailProviderError,
} from "../lib/inboundWork/emailProvider.js";
import { workOrderTypeForRequestType } from "../lib/inboundWork/inboundDecisionCommands.js";

// ── Untrusted content ────────────────────────────────────────────────────────────────────────────
test("script and style CONTENT is dropped whole, not merely unwrapped", () => {
  const hostile = '<p>Unit down</p><script>alert("xss")</script><style>body{}</style>';
  const text = toPlainText(hostile, "text/html");
  assert.equal(text.includes("alert"), false);
  assert.equal(text.includes("body{}"), false);
  assert.match(text, /Unit down/);
});

test("an UNCLOSED script tag cannot smuggle its body through the tag strip", () => {
  const text = toPlainText("<p>hi</p><script>window.x=1", "text/html");
  assert.equal(text.includes("window.x"), false);
});

test("the plain-text result never contains an angle bracket, however the entity was encoded", () => {
  for (const hostile of [
    "&lt;img src=x onerror=alert(1)&gt;",
    "&amp;lt;script&amp;gt;",
    "<div onclick='steal()'>text</div>",
    "&#39;&lt;svg onload=alert(1)&gt;",
  ]) {
    const text = toPlainText(hostile, "text/html");
    assert.equal(/[<>]/.test(text), false, `angle bracket survived: ${text}`);
  }
});

test("a hostile body is bounded, so one message cannot take unbounded storage", () => {
  const text = toPlainText(`<p>${"x".repeat(500_000)}</p>`, "text/html");
  assert.ok(text.length <= MAX_NORMALIZED_BODY_LENGTH);
});

test("normalizeInboundMessage requires the two facts an intake record cannot exist without", () => {
  assert.throws(() => normalizeInboundMessage({ mailboxId: "mb-1" }), /messageId/);
  assert.throws(() => normalizeInboundMessage({ messageId: "m-1" }), /mailboxId/);
});

test("addresses are normalized, malformed ones are dropped rather than stored as identity", () => {
  assert.equal(normalizeEmailAddress("  Service@Taylor.example  "), "service@taylor.example");
  assert.equal(normalizeEmailAddress('"Taylor Corp" <corp@taylor.example>'), "corp@taylor.example");
  assert.equal(normalizeEmailAddress("not-an-address"), "");
  assert.equal(emailDomain("corp@taylor.example"), "taylor.example");
});

test("recipient and attachment lists are bounded and de-duplicated", () => {
  const message = normalizeInboundMessage({
    messageId: "m-1",
    mailboxId: "mb-1",
    recipients: Array.from({ length: 500 }, (_, i) => `person${i}@x.example`),
    attachments: Array.from({ length: 500 }, (_, i) => ({ id: `a${i}`, name: `f${i}.pdf`, size: 1 })),
  });
  assert.equal(message.recipients.length, 50);
  assert.equal(message.attachments.length, 50);
  assert.equal(message.attachments[0].sourceMessageId, "m-1");
});

// ── Provider mapping ─────────────────────────────────────────────────────────────────────────────
test("a Microsoft Graph message maps to the canonical shape", () => {
  const graph = {
    id: "AAMkAD",
    conversationId: "conv-1",
    receivedDateTime: "2026-09-04T17:05:00Z",
    subject: "Warranty call - unit down",
    from: { emailAddress: { address: "Service@Corp.example" } },
    toRecipients: [{ emailAddress: { address: "warranty@op.example" } }],
    ccRecipients: [{ emailAddress: { address: "cc@op.example" } }],
    body: { contentType: "HTML", content: "<p>Authorization: WR-4471</p>" },
    internetMessageHeaders: [
      { name: "In-Reply-To", value: "<prior@corp.example>" },
      { name: "References", value: "<older@corp.example> <prior@corp.example>" },
    ],
    attachments: [{ id: "att-1", name: "authorization.pdf", contentType: "application/pdf", size: 1024 }],
  };
  const message = normalizeProviderMessage("MICROSOFT_365", graph, { connectionId: "conn-1", mailboxId: "mb-1" });
  assert.equal(message.messageId, "AAMkAD");
  assert.equal(message.threadId, "conv-1");
  assert.equal(message.sender, "service@corp.example");
  assert.deepEqual(message.recipients, ["warranty@op.example"]);
  assert.equal(message.inReplyTo, "<prior@corp.example>");
  assert.deepEqual(message.references, ["<older@corp.example>", "<prior@corp.example>"]);
  assert.equal(message.attachments[0].filename, "authorization.pdf");
  assert.ok(message.receivedAt > 0);
});

test("a Gmail message maps to the SAME canonical shape -- Gmail needs no change above the adapter", () => {
  const body = Buffer.from("Authorization: WR-4471\nSerial: SN-9931").toString("base64url");
  const gmail = {
    id: "18f",
    threadId: "thread-1",
    internalDate: "1757001900000",
    payload: {
      headers: [
        { name: "From", value: "Service Desk <service@corp.example>" },
        { name: "To", value: "warranty@op.example, ops@op.example" },
        { name: "Subject", value: "Warranty call" },
        { name: "In-Reply-To", value: "<prior@corp.example>" },
      ],
      mimeType: "multipart/mixed",
      parts: [
        { mimeType: "multipart/alternative", parts: [{ mimeType: "text/plain", body: { data: body } }] },
        { mimeType: "application/pdf", filename: "auth.pdf", body: { attachmentId: "att-9", size: 22 } },
      ],
    },
  };
  const message = normalizeProviderMessage("GOOGLE_WORKSPACE", gmail, { connectionId: "conn-2", mailboxId: "mb-2" });
  assert.equal(message.messageId, "18f");
  assert.equal(message.threadId, "thread-1");
  assert.equal(message.sender, "service@corp.example");
  assert.deepEqual(message.recipients, ["warranty@op.example", "ops@op.example"]);
  assert.equal(message.originalBodyContentType, "text/plain");
  assert.match(message.originalBody, /WR-4471/);
  assert.equal(message.attachments[0].providerAttachmentId, "att-9");
});

test("an unsupported provider is refused rather than guessed at", () => {
  assert.throws(() => normalizeProviderMessage("SOME_OTHER", {}, { connectionId: "c", mailboxId: "m" }), EmailProviderError);
});

// ── Connections: no credential material, ever ────────────────────────────────────────────────────
test("a connection config carrying credential material is REFUSED, not silently stripped", () => {
  for (const field of ["password", "clientSecret", "refreshToken", "accessToken", "privateKey"]) {
    assert.throws(
      () =>
        validateConnectionConfig({
          connectionName: "Ops",
          provider: "MICROSOFT_365",
          tenantOrWorkspace: "tenant-1",
          connectedAccount: "svc@op.example",
          [field]: "value",
        }),
      EmailProviderError,
      `${field} must be refused`,
    );
  }
});

test("a valid connection keeps identity and the secret NAME only", () => {
  const config = validateConnectionConfig({
    connectionName: "Operations 365",
    provider: "MICROSOFT_365",
    tenantOrWorkspace: "tenant-1",
    connectedAccount: "Service@Op.example",
    credentialSecretName: "projects/x/secrets/email-intake",
  });
  assert.equal(config.connectedAccount, "service@op.example");
  assert.equal(config.credentialSecretName, "projects/x/secrets/email-intake");
  assert.equal("password" in config, false);
});

test("an unknown provider or a malformed account is refused", () => {
  assert.throws(() => validateConnectionConfig({ provider: "IMAP", connectionName: "x", tenantOrWorkspace: "y", connectedAccount: "a@b.co" }), EmailProviderError);
  assert.throws(() => validateConnectionConfig({ provider: "MICROSOFT_365", connectionName: "x", tenantOrWorkspace: "y", connectedAccount: "nope" }), EmailProviderError);
});

test("the authorization request is built from deployment configuration and never invents one", () => {
  assert.throws(
    () => buildAuthorizationRequest({ provider: "MICROSOFT_365", tenantOrWorkspace: "t", connectedAccount: "a@b.co" }, { clientId: "", redirectUri: "https://x", state: "s" }),
    EmailProviderError,
  );
  assert.throws(
    () => buildAuthorizationRequest({ provider: "MICROSOFT_365", tenantOrWorkspace: "t", connectedAccount: "a@b.co" }, { clientId: "c", redirectUri: "http://insecure", state: "s" }),
    EmailProviderError,
  );
  const request = buildAuthorizationRequest(
    { provider: "GOOGLE_WORKSPACE", tenantOrWorkspace: "op.example", connectedAccount: "svc@op.example" },
    { clientId: "client-1", redirectUri: "https://app.example/callback", state: "state-1" },
  );
  assert.match(request.authorizationUrl, /^https:\/\/accounts\.google\.com/);
  assert.match(request.authorizationUrl, /state=state-1/);
  assert.ok(request.scopes.length > 0);
});

test("a mailbox is operational configuration and defaults to requiring review", () => {
  const mailbox = validateMailboxConfig({ connectionId: "conn-1", emailAddress: "Warranty@Op.example" });
  assert.equal(mailbox.emailAddress, "warranty@op.example");
  assert.equal(mailbox.processingMode, "REVIEW_REQUIRED");
  assert.equal(mailbox.attachmentPolicy, "PRESERVE_METADATA");
  assert.equal(mailbox.threadingEnabled, true);
  assert.throws(() => validateMailboxConfig({ connectionId: "", emailAddress: "a@b.co" }), EmailProviderError);
});

// ── Routing ──────────────────────────────────────────────────────────────────────────────────────
const warrantyRule = {
  id: "rule-warranty",
  name: "Corporate warranty",
  enabled: true,
  order: 10,
  when: { senderDomain: "corp.example", mailboxId: "mb-warranty" },
  then: { requestType: "WARRANTY", destination: "SERVICE", queue: "WARRANTY_REVIEW", manualReview: true },
};

const subject = (overrides = {}) => ({
  mailboxId: "mb-warranty",
  sender: "service@corp.example",
  subject: "Warranty call",
  normalizedBody: "Authorization: WR-4471",
  hasAttachments: true,
  ...overrides,
});

test("a rule matches on sender domain AND mailbox together", () => {
  assert.equal(ruleMatches(warrantyRule, subject()), true);
  assert.equal(ruleMatches(warrantyRule, subject({ mailboxId: "mb-service" })), false);
  assert.equal(ruleMatches(warrantyRule, subject({ sender: "service@other.example" })), false);
});

test("domain matching is exact -- a look-alike domain does not match", () => {
  assert.equal(ruleMatches(warrantyRule, subject({ sender: "a@notcorp.example" })), false);
  assert.equal(ruleMatches(warrantyRule, subject({ sender: "a@corp.example.evil.test" })), false);
});

test("routing is deterministic: first match by (order, id), whatever order the rules arrive in", () => {
  const rules = [
    { ...warrantyRule, id: "b", order: 20, then: { requestType: "SERVICE" } },
    { ...warrantyRule, id: "a", order: 20, then: { requestType: "PM" } },
    { ...warrantyRule, id: "c", order: 5, then: { requestType: "WARRANTY" } },
  ];
  for (const permutation of [rules, [...rules].reverse(), [rules[1], rules[2], rules[0]]]) {
    const result = evaluateRouting(permutation, subject());
    assert.equal(result.ruleId, "c");
    assert.equal(result.outcome.requestType, "WARRANTY");
  }
});

test("a disabled rule never matches", () => {
  assert.equal(evaluateRouting([{ ...warrantyRule, enabled: false }], subject()).ruleId, null);
});

test("an unrouted message is still taken in, classified Service and flagged for review", () => {
  const result = evaluateRouting([], subject());
  assert.equal(result.ruleId, null);
  assert.equal(result.reason, "noRuleMatched");
  assert.deepEqual(result.outcome, { ...UNROUTED_OUTCOME });
  assert.equal(result.outcome.manualReview, true);
});

test("an administrator cannot write an outcome the model does not understand", () => {
  const outcome = normalizeOutcome({ requestType: "ANYTHING", destination: "MARS", priority: 9, queue: "  ", manualReview: "yes" });
  assert.deepEqual(outcome, {});
});

// ── Threading and duplicates ─────────────────────────────────────────────────────────────────────
const existing = [
  { id: "req-1", sourceMessageId: "<m1@corp.example>", sourceThreadId: "conv-1", messageIds: ["<m1@corp.example>"], status: "ACCEPTED", workItemId: "wo-1" },
  { id: "req-2", sourceMessageId: "<m2@corp.example>", sourceThreadId: "conv-2", messageIds: ["<m2@corp.example>"], status: "AWAITING_DECISION", workItemId: null },
];

test("the same provider message id is a DUPLICATE, even when it also carries thread evidence", () => {
  const result = associateInboundMessage({ messageId: "<m1@corp.example>", threadId: "conv-2", inReplyTo: null, references: [] }, existing);
  assert.equal(result.outcome, "DUPLICATE");
  assert.equal(result.requestId, "req-1");
  assert.equal(result.matchedOn, "providerMessageId");
});

test("a reply on a known conversation associates with the existing request", () => {
  const result = associateInboundMessage({ messageId: "<m3@corp.example>", threadId: "conv-1", inReplyTo: null, references: [] }, existing);
  assert.equal(result.outcome, "THREAD_MATCH");
  assert.equal(result.requestId, "req-1");
});

test("In-Reply-To / References associate when the provider supplies no conversation id", () => {
  const result = associateInboundMessage(
    { messageId: "<m4@corp.example>", threadId: null, inReplyTo: "<m2@corp.example>", references: [] },
    existing,
  );
  assert.equal(result.outcome, "THREAD_MATCH");
  assert.equal(result.requestId, "req-2");
  assert.equal(result.matchedOn, "messageReferences");
});

test("AMBIGUOUS evidence fails safe to review rather than attaching to the wrong job", () => {
  const twoOnOneThread = [existing[0], { ...existing[1], sourceThreadId: "conv-1" }];
  const result = associateInboundMessage({ messageId: "<m5@corp.example>", threadId: "conv-1", inReplyTo: null, references: [] }, twoOnOneThread);
  assert.equal(result.outcome, "AMBIGUOUS");
  assert.equal(result.requestId, null);
  assert.deepEqual(result.candidateIds.sort(), ["req-1", "req-2"]);
});

test("a matching SUBJECT alone associates nothing -- subject text is not evidence", () => {
  const result = associateInboundMessage({ messageId: "<new@corp.example>", threadId: null, inReplyTo: null, references: [] }, existing);
  assert.equal(result.outcome, "NEW");
});

// ── Native processing and the provider-neutral contract ──────────────────────────────────────────
const message = (body) => ({ subject: "Warranty call - unit down", ...{}, provider: "MICROSOFT_365", originalBody: body });

test("base EOS extracts the facts a dispatcher would retype, with no add-on", () => {
  const body = [
    "Hello,",
    "Please attend the following under warranty.",
    "Authorization: WR-4471",
    "Reference: CASE-88213",
    "Model: C712",
    "Serial: SN-9931",
    "Problem: unit is not cooling and the compressor is cycling",
    "Priority: 2",
  ].join("\n");
  const result = processInboundMessageNatively(message(body), body);
  assert.equal(result.authorizationNumber, "WR-4471");
  assert.equal(result.externalReference, "CASE-88213");
  assert.equal(result.serialNumber, "SN-9931");
  assert.equal(result.modelNumber, "C712");
  assert.equal(result.priority, 2);
  assert.match(result.problemDescription, /not cooling/);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.requestType, null, "classification belongs to routing, not to the extractor");
});

test("what was not found is reported as a warning, never invented", () => {
  const body = "Hi, please call us back when you can.";
  const result = processInboundMessageNatively(message(body), body);
  assert.equal(result.authorizationNumber, null);
  assert.equal(result.serialNumber, null);
  assert.ok(result.warnings.includes("NO_SERIAL_NUMBER"));
  assert.ok(result.warnings.includes("NO_EXTERNAL_REFERENCE"));
});

test("the problem description skips greetings and stops at a quoted reply", () => {
  assert.equal(extractProblemDescription("Hi there,\n> the old message body\nnew text"), null);
  assert.match(extractProblemDescription("Hello,\nThe freezer is down at the north site."), /freezer is down/);
});

test("an EXTERNAL provider satisfies the same contract, and its confidence claim is not taken on trust", () => {
  const external = normalizeProcessingResult(
    {
      requestType: "WARRANTY",
      customerCandidate: { id: "acct-1", rawValue: "Taylor North", confidence: "EXACT", matchedOn: "mdmMatch" },
      // No id, but claims EXACT: a provider does not get to assert a match it cannot name.
      equipmentCandidate: { rawValue: "SN-9931", confidence: "EXACT" },
      authorizationNumber: "WR-4471",
      priority: 2,
      warnings: ["MASTERED_ADDRESS_DIFFERS"],
      providerMetadata: { pipeline: "vdx-warranty-v3" },
    },
    "VDX",
  );
  assert.equal(external.requestType, "WARRANTY");
  assert.equal(external.customerCandidate.confidence, "EXACT");
  assert.equal(external.equipmentCandidate.confidence, "NONE");
  assert.equal(external.equipmentCandidate.id, null);
  assert.equal(external.providerMetadata.provider, "VDX");
  assert.deepEqual(external.warnings, ["MASTERED_ADDRESS_DIFFERS"]);
});

test("a hostile or empty provider result degrades to the contract, never to an exception", () => {
  for (const raw of [null, "nope", {}, { priority: 99, warnings: "not-a-list" }]) {
    const result = normalizeProcessingResult(raw, "EXTERNAL");
    assert.equal(result.priority, null);
    assert.deepEqual(result.warnings, []);
    assert.equal(result.providerMetadata.provider, "EXTERNAL");
  }
});

// ── Lifecycle ────────────────────────────────────────────────────────────────────────────────────
test("only an undecided request is decidable", () => {
  assert.deepEqual([...DECIDABLE_STATUSES].sort(), ["AWAITING_DECISION", "NEEDS_REVIEW"]);
  for (const status of INBOUND_WORK_STATUSES) {
    if (status === "AWAITING_DECISION" || status === "NEEDS_REVIEW") continue;
    assert.equal(DECIDABLE_STATUSES.has(status), false, `${status} must not be decidable`);
  }
});

test("inbound classification maps onto the governed Work Order types, with no new type invented", () => {
  assert.equal(workOrderTypeForRequestType("WARRANTY"), "WARRANTY");
  assert.equal(workOrderTypeForRequestType("INSTALL"), "INSTALL");
  assert.equal(workOrderTypeForRequestType("PM"), "PM");
  assert.equal(workOrderTypeForRequestType("PARTS"), "SERVICE_CALL");
  assert.equal(workOrderTypeForRequestType(null), "SERVICE_CALL");
});
