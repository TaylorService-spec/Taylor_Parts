# INV-CONVERGENCE-E Stage A — Decision #44 evidence attestation

- The evidence in this directory was **manually captured from the production diagnostic** at `https://taylor-parts.web.app/admin/diagnostics/inventory-parts-parity` (build `73d9e1b`) by the operator.
- The parity payload (`live-pass.json`) was **copied from the diagnostic's sanitized "Copy sanitized evidence" action**, verbatim.
- **No values or timestamps were reconstructed or approximated.** `capturedAtStart`/`capturedAtEnd` are the diagnostic's own capture timestamps as copied.
- The earlier **build-`5609496`** PASS remains **supporting technical parity evidence only**; it is **not** the qualifying Decision #44 artifact (its capture timestamps were not surfaced/exported by that build).
- **This build-`73d9e1b` PASS is the qualifying Decision #44 artifact** — a production current-vs-shadow pre-cutover parity PASS with 190 canonical matches, 10 governed static-only exclusions, complete `sourceCounts`, capture timestamps, and zero model/workflow divergences; the Hosting-only deployment preserved the live Rules and Functions inventories.
- **Stage A remains diagnostic and non-authoritative.**
- **This evidence does not authorize a consumer source switch or a PartsList/PartDetail cutover.**
- No credentials, passwords, UIDs, emails, reset links, tokens, authentication secrets, or complete production records are recorded in this evidence.
