# Microsoft Dynamics 365 Field Service + Business Central

**Last researched:** 2026-08-16 · **By:** Claude (seed entry — establishes the format)

**Why this product first:** it is what the first prospect actually runs. Field Service for
service, Business Central for parts, inventory and financials.

## Capability claims (what the vendor says it does)

| Claim | Source | Notes |
| --- | --- | --- |
| A **native, bi-directional** integration exists between Field Service and Business Central | [Microsoft Learn — admin-integrate-field-service](https://learn.microsoft.com/en-us/dynamics365/business-central/admin-integrate-field-service) | First-party, not a third-party connector |
| The integration *"eliminates duplicate data entry"* and updates in one system *"automatically reflect in the other"* | [Rand Group — FS + BC integration](https://www.randgroup.com/insights/microsoft/dynamics-365/customer-engagement/field-service/integrate-dynamics-365-field-service-and-business-central-to-streamline-operations/) | Partner marketing language; verify against primary docs |
| Shipped/expanded across consecutive release waves | [2024 wave 1](https://learn.microsoft.com/en-us/dynamics365/release-plan/2024wave1/service/dynamics365-field-service/integrate-field-service-business-central) · [2025 wave 1](https://learn.microsoft.com/en-us/dynamics365/release-plan/2025wave1/smb/dynamics365-business-central/integrate-field-service-service-management) | Actively invested in, not legacy |

## Lived experience (what users say after buying)

**Not yet researched.** The first search returned vendor and partner marketing only. This is
the highest-value gap in this entry — see Next research below.

## Positioning (how they sell, and what they pre-empt)

The integration is positioned squarely at the *disconnected systems* problem. That it exists
and is marketed this way is itself evidence that **disconnection is a widely felt pain** — you
do not build and market a fix for a problem nobody has.

## Barriers (licence tier, pricing, configuration cost)

**Not yet researched.** Requires both products licensed; exact tiers and cost unverified.
This matters more than the capability itself — see below.

## What this changes for us

**This directly weakens a claim we were going to lead with.** "Your two systems don't talk"
invites the answer *"there's a native integration for that"* — from Microsoft, from a partner,
or from a competing vendor. That objection must not be met for the first time in the room.

**What a native FS↔BC sync still does not give them** (each of these remains a real gap):

- **Two legal entities under one roof**, correctly separated and combinable for reporting
- **Intercompany transfer pricing** between those entities (our `G21`/`G22`)
- **A CRM** — they still do not have one and still want one
- **Excel out of the equipment lifecycle**
- **True cost across both companies** — syncing two ledgers is not one cost model

So the claim shifts from *"your systems don't talk"* to *"even with Microsoft's integration
switched on, you still have two companies, no CRM, and Excel running your equipment
lifecycle."* That is materially harder to wave away.

## Next research (highest value first)

1. **Real-world limits of the integration** — forums and community boards, not marketing. What
   syncs, what does not, what breaks. A documented capability that users complain about is the
   wedge; a documented capability that works is a wall.
2. **Licence tiers and cost.** "Exists" is not "affordable." The Owner's own instinct is that
   firms this size cannot afford the full Microsoft stack — worth confirming with a pricing page.
3. **Does the prospect already have it available?** A question for the Owner's contact, not the
   web, and worth more than either of the above.
4. **Whether Business Central models intercompany at all**, and at what tier. This is the
   suspected moat and it is currently an assumption.

## ASSUMPTIONS (unsourced — do not act on without verifying)

- That the prospect does not currently have the integration enabled. Inferred from their
  reported double-entry pain, not confirmed.
- That the required licence tier is beyond what they hold. The Owner's judgement, unverified.
