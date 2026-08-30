# Handoff: Parts family — North Star design source
## VERSION: Parts North Star P1 — DESIGN AUTHORITY. Presentation-layer migration only; no platform/authority changes.

## Visual authority
`North Star - Parts P1.dc.html`: 1a workspace (Lists North Star grammar applied), 1b part detail desktop 1440 (master), 1c handheld 375, 1d honest states + identifier surface.

## Behavioral authority
TaylorService-spec/Taylor_Parts @ main: domain/partDetailView.js (5 states, per-field PROVENANCE, ledger selection), partVocabulary.js (status/control/stocking/OEM/unit words), partIdentifiers.js (10 alias types, validation mirror, outcome + probe vocabulary), partTrackingMode.js (NONE/SERIAL/LOT fail-closed), inventoryLedgerEvent.js (7 operational movement types + source taxonomy), partWorkOrderDemand.js, partsAttentionProjection.js, partLookup.js, truckInventoryView.js, serializedAsset* modules; modules/inventory/PartsList.jsx, PartDetail.jsx, PartMasterList.jsx, mobile/*, mobile/PartsScanner.jsx; metadata/definitions/part.js, partAlias.js, stockLocation.js, warehouse.js, truck.js.

## Composition
**Workspace (1a):** Lists P1 grammar in full (views/toolbar/16 states). Object choices: columns Part (number bold + description) · Manufacturer · Category · Control (words) · Status (words+tone) · On hand (right, tabular) · Attention (from partsAttentionProjection, e.g. "Below reorder point"). Search placeholder names what the governed lookup actually resolves: part number, description, barcode, alias. Scan button = existing scanner entry (identification only). New Part only where the part-master write capability is granted.
**Detail (1b):** kicker `Part · {control words} · {stocking words}` → title = part number (the governed identity; document ids never render) → serif description subtitle → facts (status words, manufacturer · category · unit words, OEM words, on-hand summary). Actions: **Edit part** (governed part-master write) and **Manage identifiers** (governed alias commands) — nothing else. Attention strip only when the projection yields items (here: open WO demand vs on hand — derived, clearly non-reserving). MAIN: Where it is (location table: warehouse + truck reads; bin/display note; NO Available column) → Serialized units (SERIAL parts only; assets, never loose qty; LOT parts get a lot table; untracked get nothing) → Open demand (existing WO-demand read; "planned demand, not a reservation") → Activity (governed ledger, 20 recent: type words + tone, human references PO/TR/CS/WO, location, actor, signed qty; COUNTED renders "= n"). RAIL: Classification (vocabulary words) → Identifiers (alias list, type words, inactive struck with the a-scan-won't-resolve note, link to the manage surface) → Purchasing context (cost + reorder point **with visible "baseline" provenance markers**; on-order = honest absence) → Used on (compatibility catalog, reference data).

## The quantity truth rules (non-negotiable)
- **On hand ≠ Available.** No Available column/field anywhere — no availability authority exists. AUTHORITY REQUIRED.
- **On hand is the governed baseline** (warehouseQty provenance = STATIC_FALLBACK until UD-3/UD-4); the UI shows the provenance marker rather than hiding it.
- **Demand is planned, never reserved.** The demand section says so in its heading.
- **Serialized units are assets, not quantity.** SERIALIZED_LOT fails closed upstream; the page renders the domain's own blocked state if it ever appears.
- **Location ≠ custody.** The Where-it-is heading states it.
- **Scan identifies; it never mutates.** All scanner invariants preserved (stow/count/return/pick/receive/handoff each keep their governed workflows).

## Annotations (per §22)
- EOS FACT: identity/vocabulary facts, location rows, serialized units, ledger events, WO demand, alias list, compatibility rows, baseline cost/reorder with provenance.
- EOS ACTION: part-master edit, alias add/deactivate/reactivate, scan-to-test probe, scanner entry.
- EOS NAVIGATION: PO/Transfer/Count/WO/Truck/Warehouse references, Part Master, workspace links.
- VERIFY AUTHORITY: bin/display location note on warehouse rows ("Bin R4-08") — believed present in stock-location data; verify the read before rendering. Serialized "staged for WO" context line — verify the serialized-asset projection carries it.
- AUTHORITY REQUIRED: Available/reservable quantities; live multi-location inventory position (UD-3/UD-4); open-PO/incoming quantity read on this page; any replenishment calculation; "number of stocking locations" as a derived aggregate beyond the rows shown.

## States (1d)
Blocked-permission / blocked-unavailable / blocked-unverified (three distinct sentences, never a static fallback) · Not found (legitimate, distinct) · zero-inventory valid part (full record + last-movement fact) · capability-inactive sections (structure preserved, honest sentence) · plus the Lists P1 workspace states. Loading = skeletons in shell.

## Mobile (1c)
search+scan sticky at top → identity → status/control/on-hand → location cards → serials → More (identifiers, demand, activity). Probe vocabulary surfaces on scan (inactive/unknown identifiers say so). Targets ≥44px; no horizontal scroll.

## Do-not-invent list
No availability math, reorder algorithms, or replenishment suggestions; no vendor authority or purchasing mutations from Parts; no universal timeline beyond the governed ledger + WO ledger; no serialized mutation UI; no alias/barcode canonicalization; no scan-driven inventory changes; no role flattening (capability gates drive every action's presence); no AI surfaces; raw enums/ids never render where vocabulary words/references exist.

## Acceptance checklist
- [ ] Side-by-side vs 1a/1b (whole composition)
- [ ] No "Available" anywhere; provenance markers visible on baseline values
- [ ] Vocabulary words everywhere (no raw enums); document ids never displayed
- [ ] All 1d states reachable + Lists workspace states; blocked ≠ not-found
- [ ] Actions render only with their real capabilities; scan mutates nothing
- [ ] Serialized/lot/untracked parts each render their own treatment
