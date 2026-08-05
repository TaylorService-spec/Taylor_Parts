---
artifact_type: review
gate: Tooling / Marketplace Skill Scan
status: Draft
date: 2026-08-05
owner: Claude Code
method: background research agent (gh search + WebSearch), provenance-checked
purpose: Vetted shortlist of Claude Code skills/plugins to help build a world-class SMB CRM + inventory system. NOTHING installed — vet + Owner decision required before install.
---

# Tooling & Marketplace Skill Scan — Build Support Shortlist

Star counts pulled live via GitHub API on 2026-08-05 by the scanning agent (reproduced here, not independently re-verified in this doc). **No plugin below is installed.** Each requires vetting (the same audit we did for impeccable/taste-skill) and an Owner decision before install. We already run: impeccable + taste-skill (design), the `anthropic-skills` pack (docx/pdf/pptx/xlsx/dataviz), and a local `run-field-ops-app-vite` Playwright skill.

## Headline

The **official Anthropic-managed marketplace** — `anthropics/claude-plugins-official` (33.1k★, Apache-2.0) — already carries first-party plugins for nearly every category we need. First-party / vendor-authored + curated = highest trust available; these should anchor the install list over third-party skill packs.

## By category

### Firebase / Firestore / Cloud Functions (our backend)
- **firebase** (Anthropic, official marketplace) — first-party Firebase backend + DB plugin; exact stack match. Ships MCP — vet connector, keep pointed at emulators, do NOT wire prod service accounts.
- **firestore-native** (Google LLC, official marketplace) — Google-authored Firestore query/connect plugin; complements the above. Ships MCP; vet before any creds.
- gannonh/firebase-mcp (248★, MIT) — community fallback only; unknown author, ships MCP + scripts → heavier vetting. Prefer the official ones.

### Testing (Playwright / e2e)
- **microsoft/playwright-mcp** (35.8k★, Apache-2.0) — official MS Playwright MCP; maps onto our existing `run-field-ops-app-vite` driver. Reputable, standard vetting. (We already discussed this earlier.)
- debs-obrien/playwright-mcp-prompts (73★) — Playwright DevRel prompt files; pure-markdown, low-risk.

### Code review / refactoring / migration
- **code-review**, **code-modernization**, **code-simplifier** (Anthropic, official) — first-party; drop straight into our PR-gated, ChatGPT-reviews-before-merge loop. Highest trust.
- **obra/superpowers** (267k★, MIT) — Jesse Vincent's TDD + systematic-debugging + parallel-review framework; strong fit for a governance-heavy repo. **Ships hooks — vet hooks before enabling.**
- **trailofbits/skills-curated** (477★, CC-BY-SA-4.0) — security-firm-vetted marketplace (each skill code-reviewed by Trail of Bits). Best third-party provenance story. Useful: `planning-with-files`, `skill-extractor`, `security-awareness`.

### Documentation generation
- **mintlify** (official marketplace) — build/update a docs site; fits user-guide + API docs. Vendor-authored.
- (Already have `anthropic-skills` docx/pdf/pptx/xlsx — covers document deliverables natively, no new install.)

### CRM patterns / pipeline
- **Honest gap:** no strong general-purpose "build-a-CRM" skill exists. Community CRM skills are tiny/low-trust (`monica-crm` 13★, `ambient_crm` 1★ → ignore). Real value = SaaS-CRM *integration* plugins in the official marketplace as **reference patterns**, not our engine: **monday-crm**, **carta-crm**, **airtable**, **retool** (study for customer-record UI + pipeline modeling). For domain design, lean on VoltAgent `08-business-product` subagents.

### Forms / data tables / dashboards / design systems
- **frontend-design** (Anthropic, official) — first-party production-grade UI generation; complements impeccable/taste for tables & dashboards.
- **dataviz** (already installed) — charts/KPI/dashboard design system; covers our data-viz need.
- **VoltAgent/awesome-claude-code-subagents** (24k★, MIT) — 100+ role-based subagents (quality-security, data-ai, business-product) for CRM/inventory domain modeling. Markdown agents, low-risk; review individual prompts.

### Inventory / warehouse / stock
- **Honest gap:** no dedicated, trustworthy Claude Code inventory/warehouse skill exists. Do not chase a branded one. Best path: treat inventory as a domain-modeling problem, use official **data** plugins (duckdb/mongodb/postgres/clickhouse) for stock/ledger query patterns + our own INV-governance docs.

## TOP 5 to vet & install next (best first)
1. **Anthropic official Firebase + firestore-native** — highest trust, exact backend match; vet MCP, keep on emulators. Biggest single win.
2. **microsoft/playwright-mcp** — reinforces our e2e verification; reputable vendor.
3. **Anthropic official code-review + code-modernization + code-simplifier** — slot into the PR-gated governance loop.
4. **trailofbits/skills-curated** — only marketplace with an explicit third-party safety-vetting guarantee; take `planning-with-files`, `skill-extractor`, `security-awareness`.
5. **obra/superpowers** — best-in-class TDD/debugging/review methodology; **vet hooks before enabling**.

## Flags / avoid
- CRM & inventory *branded* skills — all low-star / unknown-author. Noise, not options.
- Mega "N skills" packs (e.g. "345 skills", "848 skills") — high stars but kitchen-sink unvetted markdown; cherry-pick individual files after review, never bulk-install. Inflated-count naming = mild hype smell.
- 0★ firebase-mcp forks (`petepc/fb-mcp-server`, `sjgant80-hub/...`) — possible typosquats; ignore in favor of the official plugin.

## Next step
Owner + ChatGPT decide which of the TOP 5 to pursue. For any chosen plugin that ships hooks/MCP/scripts (Firebase, firestore-native, superpowers, playwright-mcp), run the same source audit we applied to impeccable/taste-skill before install (see [[reference_claude_code_skill_plugins_audited]]). Nothing here is wired to production credentials.
