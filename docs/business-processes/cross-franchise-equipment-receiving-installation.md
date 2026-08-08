# TAYLOR PARTS / EOS
## Cross-Franchise Equipment Receiving & Installation
### Business Process Definition — Discovery Baseline

**Status:** Discovery Baseline<br>
**Scope:** Business process only<br>
**Architecture status:** Not yet determined<br>
**Implementation status:** Not authorized by this document

## 1. Purpose

This document defines the discovered business process used when one Taylor organization sells equipment that must be received, delivered, installed, and subsequently serviced within another Taylor organization's operating area.

Taylor Freezer of Arizona is used as the fulfilling Taylor in the primary example, but the process is reciprocal.

The purpose is to establish how the business actually operates before determining how Enterprise Operations OS (EOS) should represent ownership, custody, serialized-equipment availability, cross-company fulfillment, billing responsibility, or related concepts.

This document intentionally does not define an EOS data model, authority, API, lifecycle implementation, or software architecture.

## 2. Core Business Scenario

A Taylor organization outside Arizona sells equipment for a customer location within Taylor Arizona's operating area.

The selling Taylor coordinates the commercial transaction and sends the equipment to Taylor Arizona for local fulfillment.

Taylor Arizona:
- receives the equipment;
- takes physical custody;
- controls it through its normal inventory process;
- stages it for the customer installation;
- prepares it through the Service Shop;
- schedules and dispatches the installation;
- delivers and commissions the equipment;
- charges for its local installation/service work according to the agreed billing arrangement; and
- becomes the normal local service provider after installation.

The equipment does not become Taylor Arizona-owned inventory merely because it enters Taylor Arizona's warehouse or inventory controls.

## 3. Governing Business Principle

The discovered process establishes that the following concepts are independent and must not automatically be treated as equivalent:

- equipment ownership;
- physical custody;
- inventory location;
- commercial seller;
- customer relationship responsibility;
- fulfillment responsibility;
- installation responsibility;
- service responsibility;
- warranty responsibility; and
- billing responsibility.

In particular:

> Physical custody of equipment does not establish ownership or independent disposition rights.

Equipment owned by another Taylor may physically exist within Taylor Arizona's warehouse and inventory controls while remaining unavailable for unrelated Arizona sales or allocations.

## 4. Parties

### 4.1 Selling Taylor

The Taylor organization responsible for the originating equipment sale.

During the pre-delivery process, the Selling Taylor:
- owns the equipment;
- maintains the originating commercial relationship;
- coordinates the broader customer or national-account requirement;
- provides the fulfilling Taylor with the information necessary to begin local fulfillment;
- coordinates expected equipment shipment based on expected installation timing; and
- remains involved when disposition of the equipment must change before customer delivery.

The Selling Taylor may be Taylor Arizona when Arizona sells equipment destined for another Taylor territory.

### 4.2 Fulfilling Taylor

The Taylor organization responsible for local fulfillment in the destination territory.

In the primary scenario this is Taylor Freezer of Arizona.

The Fulfilling Taylor:
- receives the equipment;
- assumes physical custody without assuming ownership;
- controls the equipment through its normal equipment inventory process;
- prepares the equipment;
- schedules the local customer installation;
- delivers and installs/commissions the equipment;
- provides local labor and installation materials;
- bills its applicable charges according to the established arrangement; and
- provides subsequent local service.

### 4.3 End Customer

The customer/location receiving the equipment.

The customer becomes the equipment owner following successful delivery under the discovered normal process.

The customer may also be responsible for paying some or all of the Fulfilling Taylor's local installation/service charges depending upon the arrangement established for the transaction.

## 5. Reciprocal Nature of the Process

This process is reciprocal among Taylor organizations.

Taylor Arizona may:
- fulfill equipment sold by another Taylor into Arizona; or
- act as the Selling Taylor for equipment destined for another Taylor territory.

The underlying relationship remains substantially the same when the roles reverse.

Therefore, this is not an Arizona-specific exception process.

It is a cross-franchise/cross-Taylor business relationship in which one Taylor can originate the commercial equipment transaction while another performs local operational fulfillment.

## 6. Normal Business Process

### Stage 1 — Selling Taylor Initiates the Request

The Selling Taylor notifies the Fulfilling Taylor's Controller that equipment will be coming into the territory for a customer installation.

For Taylor Arizona, the Controller is the normal entry point into the process.

Information provided includes:
- customer information;
- customer/location information;
- expected equipment receipt;
- equipment serial number;
- expected installation date or timeframe; and
- information necessary to establish how local installation/service costs will be handled.

The initial installation date may be an expected date rather than a firm customer appointment.

### Stage 2 — Controller Establishes the Internal Transaction

Upon receiving the request, the Controller creates an internal Purchase Order (PO).

The PO exists so the transaction can enter and follow the Fulfilling Taylor's normal internal document and operational controls.

The PO should not, by itself, be interpreted as evidence of equipment ownership or as evidence that the Selling Taylor formally issued a purchase order to the Fulfilling Taylor.

Its discovered business purpose in this process is to initiate the Fulfilling Taylor's normal internal equipment process.

### Stage 3 — Local Billing Responsibility Is Identified

During initial coordination, the Controller identifies how the Fulfilling Taylor's installation/service costs are structured.

Taylor Arizona's local charges may ultimately be billed to:
- the Selling Taylor; or
- the end customer.

The payer depends upon the arrangement for the particular transaction.

The party paying Taylor Arizona for local work is not necessarily the party that owns the equipment.

### Stage 4 — Fulfillment Documents Are Prepared

The Work Order and picklist are created later, closer to the expected arrival/fulfillment period.

They are not necessarily created simultaneously with the initial internal PO.

This allows the administrative transaction to begin before physical fulfillment becomes immediately actionable.

Except for the cross-franchise distinctions documented here, the document and preparation process follows the same business process used for internal equipment purchases.

### Stage 5 — Equipment Arrives at Receiving

Equipment enters the Fulfilling Taylor through the normal Receiving process.

There is not a separate cross-franchise receiving workflow.

The equipment is subjected to the same operational controls used for equipment the Fulfilling Taylor owns.

However, applying the same operational controls does not transfer ownership.

At this point:

Selling Taylor: owner<br>
Fulfilling Taylor: physical custodian

### Stage 6 — Equipment Enters Controlled Inventory

The equipment is applied to inventory and placed on HOLD pending its installation.

The equipment is associated with the applicable national-account/customer transaction.

The equipment may therefore physically appear within the Fulfilling Taylor's inventory operation while remaining owned by the Selling Taylor.

The HOLD protects the existing customer/installation commitment.

Critically:

> Physical inventory presence does not make the equipment unrestricted available inventory.

The Fulfilling Taylor cannot independently sell, allocate, transfer, or otherwise dispose of the Selling Taylor's equipment merely because it is physically located in its warehouse.

### Stage 7 — Equipment Is Connected to Fulfillment Work

The specific equipment is matched to the applicable Work Order and picklist.

This establishes the operational connection between the serialized equipment and the planned customer installation.

From this point forward, the equipment follows the same fulfillment process as equipment the Fulfilling Taylor would normally deliver and install.

### Stage 8 — Normal Fulfillment Process

The equipment proceeds through the normal operational path:

Inventory/HOLD<br>
→ checkout<br>
→ Service Shop preparation<br>
→ Dispatcher assignment<br>
→ customer scheduling<br>
→ delivery<br>
→ installation/commissioning

Cross-franchise origin does not create a separate field-service workflow.

## 7. Installation Scheduling

The Selling Taylor provides an expected installation date or timeframe.

This does not necessarily constitute the final customer appointment.

The Fulfilling Taylor's normal Dispatch process coordinates the actual installation schedule with the end customer.

Therefore, the process distinguishes between expected installation timing and operationally scheduled customer appointment.

## 8. Installation Labor and Materials

The equipment itself remains associated with the Selling Taylor's equipment transaction.

Local installation requirements outside of the equipment are charges of the Fulfilling Taylor.

These may include applicable:
- installation labor;
- local parts;
- installation materials; and
- other local installation/service costs.

Those charges may be billed to the Selling Taylor or the end customer according to the arrangement established for the transaction.

## 9. Installation Completion

The technician completes the installation through the normal Work Order process.

Normal completion includes the applicable:
- installation/startup work;
- testing/commissioning;
- labor recording;
- recording of Arizona-supplied parts/materials;
- completion documentation; and
- customer completion/sign-off.

The completed Work Order provides the operational basis for the Fulfilling Taylor's billing process.

## 10. Ownership Transition

Prior to customer delivery:

Selling Taylor owns the equipment.

While the equipment is physically at the Fulfilling Taylor:

Fulfilling Taylor has custody but does not own the equipment.

Following successful delivery:

Customer owns the equipment.

The ownership transition does not depend upon which Taylor physically installed the equipment.

## 11. Post-Installation Service

After delivery, the equipment is treated like other customer equipment within the local Taylor's service operation.

Taylor Arizona becomes the local servicing organization for equipment installed within its operating area.

The fact that another Taylor originally sold the machine does not prevent Arizona from providing normal service.

Therefore:

> Original seller and current local service provider may be different Taylor organizations.

## 12. Warranty

Warranty service follows the normal Taylor warranty process.

Taylor Arizona handles qualifying warranty work in the same manner it handles warranty work for other Taylor equipment.

The Selling Taylor does not need to remain the servicing organization merely because it originated the equipment sale.

Therefore:

Original seller ≠ required warranty service provider.

## 13. Delayed Installation

If the customer/site is not ready, the Fulfilling Taylor can continue holding the equipment pending installation.

During the delay:
- Selling Taylor continues to own the equipment;
- Fulfilling Taylor continues to have custody;
- equipment remains committed to the intended transaction; and
- equipment does not become unrestricted local inventory.

Extended storage may eventually become chargeable to the Selling Taylor.

However, discovery has not identified a standard fixed period after which storage charges automatically begin.

Storage charging therefore remains a variable business practice rather than a confirmed universal timing rule.

## 14. Cancellation or Destination Change

If the original customer installation is canceled or the destination changes before delivery, the Fulfilling Taylor does not independently determine the equipment's disposition.

The Fulfilling Taylor and Selling Taylor coordinate the appropriate action.

Potential outcomes may include:
- continuing to hold the equipment;
- returning the equipment;
- redirecting the equipment; or
- another mutually agreed disposition.

The important business rule is:

> Custody does not confer disposition authority.

The Fulfilling Taylor cannot simply reallocate the machine to one of its own customers because it happens to possess it.

## 15. Incorrect Equipment Received

If the wrong equipment is received, the Controller contacts the Selling Taylor and notifies them of the discrepancy.

The two Taylor organizations work together to determine the appropriate resolution.

Discovery has not established one universal resolution process.

Therefore the notification/escalation responsibility is confirmed, while the subsequent resolution path remains situational.

## 16. National-Account / Multi-Location Rollouts

Large national-account programs do not fundamentally change the Fulfilling Taylor's normal equipment process.

The Selling Taylor coordinates equipment movement based upon expected installation timing.

Equipment is generally sent based on expected need, creating a just-in-time-style fulfillment pattern rather than necessarily sending an entire national rollout into the Fulfilling Taylor's warehouse at once.

Once an individual equipment transaction enters the local operation, it follows the same normal fulfillment process.

## 17. Commercial Relationship

Local fulfillment does not automatically transfer the originating commercial relationship.

A Taylor organization can maintain the broader/national customer relationship while another Taylor performs local:
- receiving;
- warehousing;
- preparation;
- dispatch;
- installation; and
- subsequent service.

This is reciprocal when Taylor Arizona sells equipment destined for another Taylor's operating area.

Local operational responsibility therefore must not automatically be interpreted as ownership of the broader customer sales relationship.

## 18. Separate Scenario — Local/Outside Dealer Delivery

A different scenario exists where a local dealer delivers equipment directly to a customer as part of a larger contract.

Taylor Arizona may subsequently provide service on that equipment.

In that situation, Arizona did not necessarily participate in:
- the equipment sale;
- receiving;
- warehouse custody;
- staging;
- delivery; or
- installation.

This is not the same business process as the cross-Taylor fulfillment process defined above.

It demonstrates another important distinction:

> Being the local service provider does not prove participation in the original sale or fulfillment transaction.

## 19. Confirmed Business Invariants

### INV-1 — Custody Does Not Establish Ownership
A Taylor organization may physically possess and control equipment owned by another Taylor.

### INV-2 — Inventory Presence Does Not Establish Availability
Equipment physically located in a Taylor warehouse is not necessarily available for that Taylor's unrelated sales or allocations.

### INV-3 — Custody Does Not Confer Disposition Rights
The Fulfilling Taylor cannot independently sell, redirect, transfer, or allocate equipment owned by the Selling Taylor.

### INV-4 — Operational Controls Do Not Establish Ownership
Applying normal Receiving, inventory, HOLD, Work Order, picklist, shop, dispatch, or installation controls does not change equipment ownership.

### INV-5 — Seller and Fulfilling Organization May Differ
One Taylor can own/originate the equipment transaction while another performs local fulfillment.

### INV-6 — Seller and Service Provider May Differ
The Taylor that originally sold the equipment does not have to be the Taylor that subsequently services it.

### INV-7 — Local Fulfillment Does Not Transfer Commercial Relationship Ownership
Performing installation/service within a territory does not automatically transfer the broader national/customer sales relationship.

### INV-8 — Billing Responsibility Does Not Establish Equipment Ownership
The party paying the Fulfilling Taylor's local installation/service charges is not necessarily the equipment owner.

### INV-9 — Normal Fulfillment Should Remain Normal
Unless a specific cross-franchise exception has been identified, the transaction follows the same process used for internal equipment purchasing, receiving, preparation, delivery, installation, and service.

### INV-10 — Ownership Changes Independently of Service Responsibility
The Selling Taylor owns the equipment before delivery, the customer owns it after delivery, and the local Taylor can continue as service provider after that ownership transition.

## 20. Confirmed Responsibility Transitions

| Phase | Equipment Owner | Physical Custodian | Local Fulfillment | Local Service |
|---|---|---|---|---|
| Before shipment | Selling Taylor | Selling Taylor / shipping chain | Fulfilling Taylor preparing | Not yet applicable |
| At Fulfilling Taylor | Selling Taylor | Fulfilling Taylor | Fulfilling Taylor | Not yet normal customer service |
| Staged/HOLD | Selling Taylor | Fulfilling Taylor | Fulfilling Taylor | Not yet normal customer service |
| Delivery/installation | Transitioning to customer | Fulfilling Taylor until delivery | Fulfilling Taylor | Fulfilling Taylor |
| After successful delivery | Customer | Customer | Complete | Local/Fulfilling Taylor |

This table describes discovered business responsibilities only. It is not an EOS authority or state model.

## 21. Practices That Remain Variable

The following have been identified as legitimate variations rather than universal rules:

### Installation payer
Arizona may bill the Selling Taylor or the end customer.

### Extended storage
Arizona may eventually charge the Selling Taylor for extended storage, but no standard threshold has been established.

### Receiving exception resolution
The Taylors coordinate resolution based on circumstances rather than following one confirmed universal process.

### Cancellation/disposition
Return, redirect, continued hold, or another agreed disposition may be appropriate depending upon the situation.

## 22. Remaining Discovery Unknowns

The following have not been sufficiently established and should not be invented:

### Freight damage
Exact responsibility and claims handling when equipment arrives freight-damaged.

### Storage policy
Whether formal contractual or franchise-specific storage terms exist beyond the observed situational practice.

### Inter-Taylor financial settlement
Detailed accounting mechanics used when one Taylor charges another Taylor.

### Required completion package
Whether particular documents, commissioning records, photographs, signatures, or other artifacts must formally be returned to the Selling Taylor.

### Sales credit / commission
No discovery conclusion has been reached regarding sales credit or commission allocation.

These unknowns do not prevent definition of the normal operational process.

## 23. Initial EOS Capability Observations — Not Decisions

Discovery exposes several requirements that future EOS design will need to consider.

These are observations only.

### A. Serialized availability requires more than physical location

EOS must eventually be able to distinguish between physically present and commercially/operationally available for allocation.

A serialized machine located in Taylor Arizona's warehouse cannot automatically qualify for an unrelated Arizona Sales Order.

### B. Ownership and custody are independent

EOS currently needs further analysis regarding whether it has sufficient concepts to represent an organization controlling equipment it does not own.

No new authority is ratified by this document.

### C. Cross-company fulfillment is real

One organization can originate the commercial transaction while another performs operational fulfillment.

This may eventually require EOS capability beyond Taylor-specific franchise terminology.

No abstraction is selected yet.

### D. Existing fulfillment should be reused

Discovery does not support creating an entirely separate cross-franchise receiving/install workflow.

The normal equipment fulfillment process remains the business process.

Future design should therefore focus on representing the differing rights, responsibilities, and commercial context without unnecessarily duplicating operational workflow.

### E. Commercial Coverage may be relevant

The discovered ability for one Taylor to maintain a national/customer commercial relationship while another performs local fulfillment is consistent with EOS's existing principle that Commercial Coverage is distinct from operational responsibility.

Whether or how Commercial Coverage participates in this process remains a later design decision.

### F. Temporary Placement is not established

Nothing discovered here establishes this process as Temporary Placement.

The equipment is not being temporarily placed into customer use under the process described.

Before delivery it is equipment owned by the Selling Taylor and entrusted to the Fulfilling Taylor for fulfillment.

Whether those concepts ultimately share infrastructure remains undecided.

## 24. Discovery Conclusion

Cross-franchise equipment receiving and installation is not fundamentally a separate fulfillment workflow.

It is primarily the normal Taylor equipment fulfillment process operating under a different distribution of ownership, custody, commercial relationship, billing responsibility, and service responsibility.

The central business requirement is therefore not:

> Create a special cross-franchise installation process.

It is:

> Preserve the normal fulfillment process while correctly distinguishing who owns the equipment, who possesses it, what transaction it is committed to, who may dispose of it, who performs the work, who pays for that work, and who services the equipment afterward.

The strongest serialized-equipment safety requirement discovered is:

> Physical presence within an organization's inventory cannot, by itself, establish that serialized equipment is available for that organization's sales or allocation.

## 25. Next Discovery/Definition Stage

This Business Process Definition should become the baseline for the next phase:

Lifecycle & Responsibility Model

That phase should define the business transitions among:

expected → inbound → received/custodied → held/committed → prepared → dispatched → delivered/installed → customer-owned/serviceable

while separately tracking changes in:
- ownership;
- custody;
- fulfillment responsibility;
- disposition authority;
- billing responsibility;
- commercial relationship responsibility; and
- service/warranty responsibility.

That work should remain at the business-definition level initially.

Only after the lifecycle, responsibility transitions, and exception flows are understood should EOS determine whether existing capabilities are sufficient or whether a new custody/cross-company-fulfillment capability is required.
