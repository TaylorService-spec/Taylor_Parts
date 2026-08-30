# EOS Lists North Star — shared collection design sources

**These files are VISUAL ACCEPTANCE AUTHORITY for every collection / index / queue / register surface.**

They are **not** runtime authority, data authority, workflow authority, or permission authority.
Nothing here grants a capability, defines a state machine, or decides who may do what. Where an
artifact implies a behaviour the engine does not have, **the repository is right** and the gap is
recorded as a named product decision — never closed in the UI.

| File | What it is |
| --- | --- |
| `Lists-North-Star-P2.dc.html` | **Current visual authority.** 2a desktop anatomy · 2b tablet 768 · 2c mobile 375/320 · 2d 17-state board · 2e three-axis state board · 2f row-priority + drop/fold · 2g Opportunity study · 2h Work Order study · 2i Parts study · 2j major-object matrix · 2k authority-dependent board · 2l component board. |
| `DESIGN-HANDOFF-LISTS-P2.md` | Design's own handoff, verbatim. |
| `Lists-North-Star-P1.dc.html` | Superseded by P2. Kept for provenance, not for implementation. P1 is the artifact the Opportunity P1v4 handoff cites as "Lists P1"; it had never been in this repository. |
| `LISTS-P2-RECONCILIATION.md` | The Phase 0 output: current-collection inventory, Design-to-Authority matrix, gap classification, migration sequence. **Read this before writing any code.** |
| `LISTS-P2-COLLECTION-DISPOSITION.md` | Every EOS collection surface (75), each classified MIGRATE / COMPOSE / EXEMPT / BLOCKED, plus the restraint rules and the ten-question acceptance test each family answers before merge. Required by the Owner addendum of 2026-08-27. |
| `LISTS-VIEW-CHIP-ROLLOUT.md` | Where each list's view chips come from, what each one may honestly claim about counts, and **the gaps by name** — including the list that has views but no counting authority. Owner directive of 2026-08-30. |

Provenance: `Claude Design Docs/Lists and States North Star P2v1.zip`, folder
`design_handoff_lists`, received 2026-08-27. Byte-identical to that package; only the filenames are
normalised so they sort and link cleanly, matching `../opportunity/README.md`'s convention.

Opportunity remains its own collection authority (`../opportunity/`). P2 extracts the **shared**
grammar and explicitly permits an object family's own artifact to override shared composition where
its operational needs require it.
