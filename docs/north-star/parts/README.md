# EOS Parts North Star — design sources

**These files are VISUAL ACCEPTANCE AUTHORITY for the Parts page family.**

They are **not** runtime authority, data authority, workflow authority, or permission authority.
Nothing here grants a capability, defines a state machine, or decides who may do what. Where an
artifact implies a behaviour the engine does not have, **the repository is right** and the gap is
recorded as a named product decision — never closed in the UI.

| File | What it is |
| --- | --- |
| `North Star - Parts P1.dc.html` | **Current visual authority.** 1a workspace (Lists North Star grammar applied) · 1b part detail desktop 1440 · 1c handheld 375 · 1d honest states + identifier surface. |
| `DESIGN-HANDOFF-PARTS-P1.md` | Design's own handoff, verbatim. |

Provenance: `Claude Design Docs/Parts North Star P1v1.zip`, folder `design_handoff_parts`, received
2026-08-30. Byte-identical to that package; only the handoff's filename is normalised so it sorts
and links cleanly, matching `../opportunity/README.md`'s convention.

## Read this before writing any code

[`docs/design/parts-north-star-composition-map.md`](../../design/parts-north-star-composition-map.md)
— the reconciliation of this artifact against the governed modules that would have to supply each
drawn element. Fifteen elements checked, **nine not buildable as drawn**, three live defects found in
passing, and three questions that belong to the Owner:

- **ND-25** — may a Parts surface show a quantity at all today, and which one?
- **ND-26** — which string is "the part number", `partId` or `internalPartNumber`?
- **ND-27** — may the legacy static cost be displayed on the Parts record?

All three are in
[`north-star-open-product-decisions.md`](../../design/north-star-open-product-decisions.md).
The workspace's principal column, the record's title and one rail section are each blocked on one of
them.

The shared collection grammar this workspace composes through is `../lists/` — whose P2 artifact
carries its own **2i Parts study**. Where the two differ, P2 explicitly permits an object family's own
artifact to override shared composition where its operational needs require it.
