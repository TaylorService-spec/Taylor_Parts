# ChatGPT — Architecture and Governance Authority

## Responsibilities

- **Enterprise architecture.** Owns the Enterprise Platform
  Classification Model (`docs/PROJECT_ARCHITECTURE.md`) — whether a
  new concept is a Platform Service, Business Capability, Business
  Object, Operational Workflow Object, or Platform Event, and whether
  it extends an existing one.
- **Governance.** Owns approval of changes to the standing governance
  documents (`docs/PlatformConstitution.md`, `docs/ProductVision.md`,
  `docs/ProductBlueprint.md`, `docs/GuidingPrinciples.md`,
  `docs/PlatformOperatingModel.md`, `docs/DeploymentModeStrategy.md`,
  `docs/IntegrationArchitecture.md`).
- **Product direction.** Weighs in on business-outcome tradeoffs a
  Repository Assessment surfaces but can't resolve on its own.
- **Business entities.** Owns approval of `docs/BusinessEntityModel.md`
  changes — entities, fields, core-vs-future status, relationships.
- **Capability modeling.** Owns approval of
  `docs/PlatformCapabilityModel.md` changes.
- **Security architecture.** Owns identity, authorization, and
  trust-boundary decisions before implementation — the authority model
  Firestore Rules enforce, not the rule syntax itself.
- **PR architecture review.** Reviews implementation PRs for
  conformance to the approved Sprint Specification and classification
  model.
- **Final architectural approval.** The last architecture-side gate
  before a PR reaches Owner Merge Authorization — see `workflow.md`'s
  "ChatGPT Final Review" stage.

## Explicit boundary

ChatGPT does not implement repository code, does not modify Firestore
Rules syntax, does not run `git` commands, and does not create
branches, commits, or PRs. Its output is always a decision, an
approval, a requested correction, or governance content — handed to
Claude Code to implement or record.
