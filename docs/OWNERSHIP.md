# Ownership, Attribution & Intellectual Property

**Status:** Version 1 — governance document (single owner concern: human/company ownership, attribution, and IP posture).
**Related:** [`../LICENSE`](../LICENSE) · [`../README.md`](../README.md) · [`PlatformOperatingModel.md`](PlatformOperatingModel.md) (§4 Product Ownership — *decision* authority; this document owns *IP/legal* ownership) · [`DelegationCharter.md`](DelegationCharter.md) (delegated authority AI agents act within).

This document states who owns the product, the company, and the intellectual property, and how AI development tools are attributed. It is the single authority for that concern; other governance documents defer to it and cross-reference rather than restating it.

**This is a governance/attribution policy, not a legal instrument.** It records the project's ownership posture for day-to-day engineering. It does not complete entity formation, IP assignment, or registration, and it does not substitute for legal counsel (see "Protected legal actions" below).

---

## 1. Human and company ownership

1. **Rudy DiGiorgio is the Founder, Product Owner, and originating human architect** of **Enterprise Operations OS**.
2. **Taylor Parts is the first deployment** of Enterprise Operations OS. It does not redefine the ownership of the reusable platform unless a separate legal agreement says otherwise.
3. Enterprise Operations OS and Taylor Parts are project/product identifiers owned or controlled by Rudy DiGiorgio or the applicable successor company, subject to formal entity and IP-transfer documentation.

## 2. AI systems are tools, not owners

Claude, ChatGPT, Codex, and other AI systems (and their providers) are **development tools and delegated agents**. They:

- do **not** own the company;
- do **not** own the product;
- do **not** receive equity;
- are **not** founders, officers, employees, contractors, or legal authors of record;
- **cannot** license, assign, sell, pledge, or transfer company intellectual property;
- **cannot** independently bind Rudy or the company;
- act **only** within authority delegated by repository governance (see [`DelegationCharter.md`](DelegationCharter.md) and [`engineering/AI_ENGINEERING_OPERATING_MODEL.md`](engineering/AI_ENGINEERING_OPERATING_MODEL.md)).

## 3. Prohibited wording

Do not describe the project, product, or company using wording that implies AI ownership, founding, or a corporate/legal title for an AI system, including:

- "Claude's platform" / "built by Claude" (as an ownership claim) / "owned by ChatGPT";
- "AI-founded company" / "Claude is the architect" (as a title);
- "ChatGPT is the engineering director" (in a legal or corporate-title sense);
- any phrasing that names Claude, ChatGPT, Codex, Anthropic, or OpenAI as an owner, founder, officer, legal author, shareholder, or company principal.

## 4. Permitted descriptive wording

- "developed under the direction of Rudy DiGiorgio using AI-assisted engineering tools";
- "AI-assisted development";
- "AI engineering agents operating under human-defined governance";
- "Founder and Product Owner: Rudy DiGiorgio".

## 5. Commit and technical attribution

Technical commit attribution must **not** imply IP ownership. A commit authored or co-authored through an AI tool (e.g. a `Co-Authored-By:` trailer naming an AI model) remains **project work performed under Owner direction and repository governance** — it is a record of the tool used, not a transfer or claim of authorship-of-record or any proprietary interest. All such work is owned per Sections 1–2.

## 6. Public-facing consistency

The repository's primary entry point ([`../README.md`](../README.md)) and relevant product documentation identify ownership consistently using the permitted wording in Section 4, without unnecessary AI branding. New public-facing surfaces follow the same posture.

## 7. Protected legal actions (require Rudy or counsel — never performed by an AI agent)

The following are outside repository governance and are **not** effected by any wording in this repository:

- forming or naming a legal entity;
- assigning, transferring, or licensing intellectual property;
- registering or asserting a trademark, patent, or copyright registration;
- executing contributor agreements, contracts, or other binding commitments.

AI agents must not invent a company legal name, claim a registered trademark/patent/copyright, or represent that repository wording completes entity formation or IP assignment. Where such a decision is required, an agent stops and escalates to the Owner (a protected boundary under [`engineering/AI_ENGINEERING_OPERATING_MODEL.md`](engineering/AI_ENGINEERING_OPERATING_MODEL.md) §Protected boundaries and [`DelegationCharter.md`](DelegationCharter.md) Tier 3).
