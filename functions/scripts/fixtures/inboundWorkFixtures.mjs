// Email Connections + Inbound Work -- DETERMINISTIC SANDBOX FIXTURES.
//
// Eight scenarios, in the PROVIDERS' OWN native message shapes, so the seed and the tests exercise the
// real adapter rather than a convenient internal object. Same input, same ids, same result on every run:
// every id is fixed, every timestamp is a literal, and nothing here reads a clock or a random source. That
// is what makes the seed re-runnable and the emulator suite reproducible.
//
// CLEARLY TEST DATA. Every address is under `.example` (RFC 2606, which can never be a real domain), every
// customer is "Sandbox", and no real Taylor, vendor or manufacturer mailbox appears anywhere in this file
// or anywhere else in the repository. Certification fixtures are untouched: nothing here writes to the
// certification world or reads its fixture authority.
//
// The scenarios, matching the acceptance list:
//   1. corporate warranty request        5. a request to decline
//   2. known customer + known equipment   6. a request to accept (creates exactly one Work Order)
//   3. unknown customer/equipment         7. attachment preservation
//   4. reply on the same thread           8. a processing failure / retry state
//
// The last one is not a message: a FAILED intake is produced by a processing provider that throws, which is
// exercised in the suite through the provider seam rather than by seeding a doc that claims to have failed.

export const SANDBOX_CONNECTION_ID = "sbx-conn-m365";
export const SANDBOX_MAILBOXES = Object.freeze({
  service: "sbx-mb-service",
  warranty: "sbx-mb-warranty",
  parts: "sbx-mb-parts",
});

export const SANDBOX_CORPORATE_DOMAIN = "corporate.example";

/** The connection an administrator would have configured. No credential, by construction. */
export const SANDBOX_CONNECTION = Object.freeze({
  id: SANDBOX_CONNECTION_ID,
  config: Object.freeze({
    connectionName: "Sandbox Microsoft 365",
    provider: "MICROSOFT_365",
    tenantOrWorkspace: "sandbox-tenant-id",
    connectedAccount: "intake@sandbox.example",
    inboundEnabled: true,
    outboundEnabled: false,
    credentialSecretName: null,
  }),
});

export const SANDBOX_MAILBOX_CONFIGS = Object.freeze([
  Object.freeze({
    id: SANDBOX_MAILBOXES.service,
    config: {
      connectionId: SANDBOX_CONNECTION_ID,
      displayName: "Service",
      emailAddress: "service@sandbox.example",
      purpose: "SERVICE",
      destination: "SERVICE",
      defaultQueue: "SERVICE_REVIEW",
      processingMode: "REVIEW_REQUIRED",
      attachmentPolicy: "PRESERVE_METADATA",
      threadingEnabled: true,
      inboundEnabled: true,
    },
  }),
  Object.freeze({
    id: SANDBOX_MAILBOXES.warranty,
    config: {
      connectionId: SANDBOX_CONNECTION_ID,
      displayName: "Warranty",
      emailAddress: "warranty@sandbox.example",
      purpose: "WARRANTY",
      destination: "SERVICE",
      defaultQueue: "WARRANTY_REVIEW",
      processingMode: "REVIEW_REQUIRED",
      attachmentPolicy: "PRESERVE_METADATA",
      threadingEnabled: true,
      inboundEnabled: true,
    },
  }),
  Object.freeze({
    id: SANDBOX_MAILBOXES.parts,
    config: {
      connectionId: SANDBOX_CONNECTION_ID,
      displayName: "Parts",
      emailAddress: "parts@sandbox.example",
      purpose: "PARTS",
      destination: "PARTS",
      defaultQueue: "PARTS_REVIEW",
      processingMode: "REVIEW_REQUIRED",
      attachmentPolicy: "PRESERVE_METADATA",
      threadingEnabled: true,
      inboundEnabled: true,
    },
  }),
]);

/**
 * The example the product documentation describes, expressed as configuration rather than as code:
 * a message from the corporate domain arriving in the warranty mailbox is warranty work for Service,
 * queued for review. Nothing about this rule lives in the product; an administrator writes it.
 */
export const SANDBOX_ROUTING_RULES = Object.freeze([
  Object.freeze({
    id: "sbx-rule-corporate-warranty",
    rule: {
      name: "Corporate warranty requests",
      enabled: true,
      order: 10,
      when: { senderDomain: SANDBOX_CORPORATE_DOMAIN, mailboxId: SANDBOX_MAILBOXES.warranty },
      then: {
        requestType: "WARRANTY",
        destination: "SERVICE",
        queue: "WARRANTY_REVIEW",
        priority: 2,
        manualReview: false,
      },
    },
  }),
  Object.freeze({
    id: "sbx-rule-service-mailbox",
    rule: {
      name: "Service mailbox",
      enabled: true,
      order: 20,
      when: { mailboxId: SANDBOX_MAILBOXES.service },
      then: { requestType: "SERVICE", destination: "SERVICE", queue: "SERVICE_REVIEW", manualReview: true },
    },
  }),
]);

const graphMessage = ({ id, conversationId, internetMessageId, subject, from, body, attachments = [], headers = [], receivedDateTime }) => ({
  id,
  conversationId,
  internetMessageId,
  receivedDateTime,
  subject,
  from: { emailAddress: { address: from } },
  toRecipients: [{ emailAddress: { address: "warranty@sandbox.example" } }],
  body: { contentType: "HTML", content: body },
  internetMessageHeaders: headers,
  attachments,
});

/** 1 + 2 + 7: a corporate warranty request naming a known unit, with an authorization PDF attached. */
export const FIXTURE_CORPORATE_WARRANTY = Object.freeze({
  mailboxId: SANDBOX_MAILBOXES.warranty,
  provider: "MICROSOFT_365",
  message: graphMessage({
    id: "sbx-msg-warranty-1",
    conversationId: "sbx-conv-warranty-1",
    internetMessageId: "<sbx-warranty-1@corporate.example>",
    receivedDateTime: "2026-09-01T15:04:00Z",
    subject: "Warranty service required - Sandbox Grill North",
    from: `dispatch@${SANDBOX_CORPORATE_DOMAIN}`,
    body: [
      "<p>Hello,</p>",
      "<p>Please attend the following unit under warranty.</p>",
      "<p>Authorization: WR-4471<br/>Reference: CASE-88213<br/>Model: C712<br/>Serial: SBX-SN-0001</p>",
      "<p>Problem: the unit is not cooling and the compressor is short cycling</p>",
    ].join(""),
    attachments: [
      { id: "sbx-att-1", name: "warranty-authorization.pdf", contentType: "application/pdf", size: 20480 },
      { id: "sbx-att-2", name: "unit-photo.jpg", contentType: "image/jpeg", size: 51200 },
    ],
  }),
});

/** 3: nothing EOS can resolve -- no serial, an unknown sender. It still arrives, for a person to decide. */
export const FIXTURE_UNKNOWN_CUSTOMER = Object.freeze({
  mailboxId: SANDBOX_MAILBOXES.service,
  provider: "MICROSOFT_365",
  message: graphMessage({
    id: "sbx-msg-unknown-1",
    conversationId: "sbx-conv-unknown-1",
    internetMessageId: "<sbx-unknown-1@vendor.example>",
    receivedDateTime: "2026-09-01T16:10:00Z",
    subject: "Machine problem at our site",
    from: "manager@unknown-vendor.example",
    body: "<p>Hi,</p><p>One of the machines in the back is making a loud noise and has stopped working.</p>",
  }),
});

/** 4: the reply. Same conversation id AND a References header, so either evidence would associate it. */
export const FIXTURE_WARRANTY_REPLY = Object.freeze({
  mailboxId: SANDBOX_MAILBOXES.warranty,
  provider: "MICROSOFT_365",
  message: graphMessage({
    id: "sbx-msg-warranty-1-reply",
    conversationId: "sbx-conv-warranty-1",
    internetMessageId: "<sbx-warranty-1-reply@corporate.example>",
    receivedDateTime: "2026-09-02T09:00:00Z",
    subject: "RE: Warranty service required - Sandbox Grill North",
    from: `dispatch@${SANDBOX_CORPORATE_DOMAIN}`,
    body: "<p>Any update on the visit? The unit is still down.</p>",
    headers: [
      { name: "In-Reply-To", value: "<sbx-warranty-1@corporate.example>" },
      { name: "References", value: "<sbx-warranty-1@corporate.example>" },
    ],
  }),
});

/** 5: the request a reviewer turns away. Deliberately outside any service area the sandbox covers. */
export const FIXTURE_TO_DECLINE = Object.freeze({
  mailboxId: SANDBOX_MAILBOXES.service,
  provider: "MICROSOFT_365",
  message: graphMessage({
    id: "sbx-msg-decline-1",
    conversationId: "sbx-conv-decline-1",
    internetMessageId: "<sbx-decline-1@vendor.example>",
    receivedDateTime: "2026-09-01T17:20:00Z",
    subject: "Service request - out of area",
    from: "ops@faraway-vendor.example",
    body: "<p>Problem: freezer door seal is torn at our depot four states away.</p>",
  }),
});

/** 6 + Gmail parity: the SAME workflow arriving through Google Workspace instead of Microsoft. */
export const FIXTURE_GMAIL_SERVICE = Object.freeze({
  mailboxId: SANDBOX_MAILBOXES.service,
  provider: "GOOGLE_WORKSPACE",
  message: {
    id: "sbx-gmail-1",
    threadId: "sbx-gthread-1",
    internalDate: "1756742640000",
    payload: {
      mimeType: "multipart/mixed",
      headers: [
        { name: "From", value: "Sandbox Vendor <service@vendor.example>" },
        { name: "To", value: "service@sandbox.example" },
        { name: "Subject", value: "Service call needed" },
        { name: "Message-ID", value: "<sbx-gmail-1@vendor.example>" },
      ],
      parts: [
        {
          mimeType: "text/plain",
          body: {
            data: Buffer.from(
              ["Hello,", "Problem: ice machine is leaking water onto the floor", "Serial: SBX-SN-0001", "Reference: VEN-5512"].join("\n"),
            ).toString("base64url"),
          },
        },
      ],
    },
  },
});

export const SANDBOX_MESSAGES = Object.freeze([
  FIXTURE_CORPORATE_WARRANTY,
  FIXTURE_UNKNOWN_CUSTOMER,
  FIXTURE_TO_DECLINE,
  FIXTURE_GMAIL_SERVICE,
  FIXTURE_WARRANTY_REPLY,
]);

/** The customer / location / equipment the known-unit scenarios resolve against. */
export const SANDBOX_RECORDS = Object.freeze({
  accountId: "sbx-acct-grill-north",
  account: { name: "Sandbox Grill North", nameLower: "sandbox grill north", status: "ACTIVE" },
  locationId: "sbx-loc-grill-north",
  location: { name: "Sandbox Grill North - Main", accountId: "sbx-acct-grill-north" },
  equipmentId: "sbx-eq-ice-001",
  equipment: {
    name: "Ice machine (sandbox)",
    accountId: "sbx-acct-grill-north",
    locationId: "sbx-loc-grill-north",
    serialNumber: "SBX-SN-0001",
    serialNumberKey: "SBX-SN-0001",
    status: "ACTIVE",
  },
  contactId: "sbx-contact-corporate",
  contact: { name: "Sandbox Corporate Dispatch", email: `dispatch@${SANDBOX_CORPORATE_DOMAIN}`, accountId: "sbx-acct-grill-north" },
});
