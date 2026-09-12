# EOS Parts North Star — design sources

**These files are VISUAL ACCEPTANCE AUTHORITY for the Parts page family.**

They are **not** runtime authority, data authority, workflow authority, or permission authority.
Nothing here grants a capability, defines a state machine, or decides who may do what. Where an
artifact implies a behaviour the engine does not have, **the repository is right** and the gap is
recorded as a named product decision — never closed in the UI.

| File | What it is |
| --- | --- |
| `North Star - Parts P1.dc.html` | **SUPERSEDED — not current authority.** 1a workspace (Lists North Star grammar applied) · 1b part detail desktop 1440 · 1c handheld 375 · 1d honest states + identifier surface. Retained as provenance for what P1 drew and which nine elements the repository could not build (see `DESIGN-BRIEF-PARTS-P1v2.md`). |
| `DESIGN-HANDOFF-PARTS-P1.md` | Design's own handoff for P1, verbatim. Also superseded. |

Provenance: `Claude Design Docs/Parts North Star P1v1.zip`, folder `design_handoff_parts`, received
2026-08-30. Byte-identical to that package; only the handoff's filename is normalised so it sorts
and links cleanly, matching `../opportunity/README.md`'s convention.

> ## ⚠️ CURRENT VISUAL AUTHORITY IS P1v2, AND ITS SOURCE IS UNAVAILABLE
>
> `IMPLEMENTATION-DELTA-PARTS-P1v2.md:34` names the design and acceptance authority for this
> family as **`DESIGN-HANDOFF-PARTS-P1v2.md` plus frames `1a`, `1a-m`, `1b`, `1b-m`**. None of
> those five files exists in this directory, on any branch, or in any tag — and
> `Parts North Star P1v3.zip` is byte-identical to P1v2, so there is no fallback package.
> They are classified **HISTORICAL ACCEPTANCE EVIDENCE — SOURCE UNAVAILABLE** in
> [`docs/design/archaeology/historical-acceptance-evidence-register.md`](../../design/archaeology/historical-acceptance-evidence-register.md).
>
> The shipped Parts surface was Owner-accepted against those unavailable frames, so its visual
> conformance cannot now be re-audited. Per Owner ruling **G0-3**, this does not block Atlas or
> Design P2: a future Owner-accepted North Star supersedes unavailable historic visual authority.
> **Do not reconstruct the P1v2 frames from the prose that describes them** — prose about an
> artifact is provenance, never authority.
>
> The P1 artifact below is kept as provenance. It is **not** the current target.

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
