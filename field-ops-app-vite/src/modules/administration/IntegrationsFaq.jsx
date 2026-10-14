import { useMemo, useState } from "react";

const FAQS = [
  {
    category: "Getting started",
    question: "Can Field Ops connect to our existing company systems?",
    answer:
      "Yes. Field Ops is designed to connect with ERP, accounting, CRM, business-intelligence, data-warehouse, reporting, and AI systems through a controlled integration boundary. The exact connection method is selected for each approved integration; direct access to the operational database is not supported.",
  },
  {
    category: "Getting started",
    question: "What information do we need before planning a connection?",
    answer:
      "Identify the systems involved, the business outcome, which data must move, who owns that data, the direction of travel, the required frequency, expected volume, and the people responsible for security and support. A sample export or API specification from the existing system is also helpful.",
  },
  {
    category: "Getting started",
    question: "Is every integration available today?",
    answer:
      "No. The platform has an established integration architecture, but named vendor connectors are not automatically included. Each connection is reviewed and designed against the common architecture before it is implemented. The Integrations area will show configured connections as they become available.",
  },
  {
    category: "Connection patterns",
    question: "What types of connections are supported?",
    answer:
      "The architecture supports four patterns: export or extract from Field Ops, import or ingest into Field Ops, outbound event notifications, and a customer-hosted agent that mediates between Field Ops and company-managed systems. A connection may use one or more of these patterns.",
  },
  {
    category: "Connection patterns",
    question: "Can we send Field Ops data to our ERP, warehouse, or BI platform?",
    answer:
      "Yes. Export is the preferred pattern for operational data used in reporting, planning, accounting, or analytics. Exported information is a downstream copy; Field Ops remains the source of truth for its operational records, and an export failure does not block field work.",
  },
  {
    category: "Connection patterns",
    question: "Can our existing system send data into Field Ops?",
    answer:
      "Potentially. Inbound data is treated as untrusted until it passes the same business validation used elsewhere in Field Ops. Imports must use an approved platform write path and cannot bypass workflow rules or create a second way to update operational records.",
  },
  {
    category: "Connection patterns",
    question: "Does Field Ops support real-time connections or webhooks?",
    answer:
      "Event notifications, webhooks, streams, scheduled batches, and file transfers are all possible transport options, but no single transport is assumed for every connection. Timing and delivery method are chosen from the business need and the capabilities of the existing system.",
  },
  {
    category: "Data ownership",
    question: "Which system is the source of truth?",
    answer:
      "Field Ops remains the source of truth for the operational data it owns, including work orders, technicians, inventory, jobs, and customer operations. External systems remain authoritative for their native domains—for example, an accounting platform owns its general ledger and a CRM owns its sales pipeline.",
  },
  {
    category: "Data ownership",
    question: "Will connecting an ERP replace Field Ops records?",
    answer:
      "No. An ERP may receive a derived copy of Field Ops data or provide approved reference data, but it does not replace the operational records owned by Field Ops. Ownership and conflict rules must be agreed before data begins moving.",
  },
  {
    category: "Data ownership",
    question: "How are duplicate or conflicting records handled?",
    answer:
      "The integration design must define stable identifiers, record ownership, validation, and a reconciliation process. Conflicting inbound data is not allowed to silently overwrite authoritative operational state. Exceptions should be surfaced for review or rejected according to the approved mapping rules.",
  },
  {
    category: "Security & reliability",
    question: "Can an external system connect directly to Firestore?",
    answer:
      "No. External systems must use the platform's approved integration boundary. Direct Firestore queries or writes would expose internal implementation details and could bypass business and security controls.",
  },
  {
    category: "Security & reliability",
    question: "How are integrations authenticated?",
    answer:
      "Each integration uses credentials scoped to only the access it needs. The specific method—such as OAuth, a service identity, an API credential, or a customer-hosted-agent identity—is selected during design. Integration credentials are separate from employee sign-in and do not weaken existing access rules.",
  },
  {
    category: "Security & reliability",
    question: "What happens if the connected system is unavailable?",
    answer:
      "Core Field Ops work should continue. Integrations are intentionally loosely coupled, so an external outage must not block or roll back operational activity. Depending on the connection, failed transfers may be retried, queued, or flagged for reconciliation.",
  },
  {
    category: "Delivery & support",
    question: "Who owns a customer-hosted integration agent?",
    answer:
      "The customer owns the operation, credentials, and maintenance of a customer-hosted agent, working with the Field Ops platform operator. Field Ops is responsible for maintaining the stable platform boundary the agent connects to.",
  },
  {
    category: "Delivery & support",
    question: "How do we request a new connection?",
    answer:
      "Start with the integration readiness checklist below and contact your Field Ops administrator or platform owner. The request should describe the business outcome, systems, data ownership, direction, timing, security owner, and support owner so it can be reviewed before implementation is scheduled.",
  },
];

const CATEGORIES = ["All", ...new Set(FAQS.map((faq) => faq.category))];

export default function IntegrationsFaq() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");

  const filteredFaqs = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return FAQS.filter((faq) => {
      const matchesCategory = category === "All" || faq.category === category;
      const matchesQuery =
        !normalizedQuery ||
        faq.question.toLowerCase().includes(normalizedQuery) ||
        faq.answer.toLowerCase().includes(normalizedQuery);
      return matchesCategory && matchesQuery;
    });
  }, [category, query]);

  return (
    <div className="integration-faq-page">
      <section className="integration-faq-hero">
        <div>
          <span className="integration-faq-eyebrow">Integration guide</span>
          <h2>Connecting to Existing Company Infrastructure</h2>
          <p>
            A practical guide to connecting Field Ops with the systems your company already uses—without
            disrupting operational work or creating competing sources of truth.
          </p>
        </div>
        <div className="integration-faq-status" aria-label="Integration architecture status">
          <span className="integration-faq-status-dot" aria-hidden="true" />
          <div>
            <strong>Architecture ready</strong>
            <span>Connections are reviewed individually</span>
          </div>
        </div>
      </section>

      <section className="integration-faq-summary" aria-label="Integration principles">
        <div><strong>Field Ops stays authoritative</strong><span>Operational records keep one trusted owner.</span></div>
        <div><strong>Secure by design</strong><span>Every connection uses a controlled boundary.</span></div>
        <div><strong>Operations keep moving</strong><span>External outages do not block field work.</span></div>
      </section>

      <div className="integration-faq-layout">
        <aside className="integration-readiness fo-panel">
          <span className="integration-faq-eyebrow">Before you request</span>
          <h3>Integration readiness checklist</h3>
          <ul>
            <li>Business outcome and sponsor</li>
            <li>Systems to be connected</li>
            <li>Data owner for each record type</li>
            <li>Inbound, outbound, or both</li>
            <li>Timing and data volume</li>
            <li>Security and support owners</li>
            <li>Sample file or API documentation</li>
          </ul>
          <p className="integration-readiness-note">
            Keep credentials and production data out of the initial request. Share them only through an approved secure process.
          </p>
        </aside>

        <section className="integration-faq-content fo-panel">
          <div className="integration-faq-heading">
            <div>
              <span className="integration-faq-eyebrow">Frequently asked questions</span>
              <h3>What your team needs to know</h3>
            </div>
            <label className="integration-faq-search">
              <span className="sr-only">Search integration questions</span>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search questions"
              />
            </label>
          </div>

          <div className="integration-faq-filters" aria-label="Filter questions by category">
            {CATEGORIES.map((item) => (
              <button
                key={item}
                type="button"
                className={item === category ? "fo-filter-btn fo-filter-btn-active" : "fo-filter-btn"}
                onClick={() => setCategory(item)}
                aria-pressed={item === category}
              >
                {item}
              </button>
            ))}
          </div>

          <div className="integration-faq-list">
            {filteredFaqs.map((faq, index) => (
              <details key={faq.question} className="integration-faq-item" open={index === 0 && !query}>
                <summary>
                  <span>{faq.question}</span>
                  <span className="integration-faq-chevron" aria-hidden="true">+</span>
                </summary>
                <div className="integration-faq-answer">
                  <span className="integration-faq-category">{faq.category}</span>
                  <p>{faq.answer}</p>
                </div>
              </details>
            ))}
            {filteredFaqs.length === 0 && (
              <div className="integration-faq-empty">
                <strong>No matching questions</strong>
                <p>Try a broader search or select another category.</p>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
