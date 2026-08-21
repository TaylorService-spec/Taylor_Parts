# Returns disposition — Owner decision package

**Design only. Nothing in this document has been built, and nothing should be built from it until the
decisions in §3 are made.** No capability is proposed for registration, no schema is changed, no
command is written. Reconciled against `origin/main` on 2026-08-20.

---

## 1. Where this stands today

Returns **intake** exists and works: `recordReturnIntake` writes one document to `inventory_returns`
and touches nothing else. Per DECISIONS #118 it captures only what can be authoritative and leaves the
return in the single state `AWAITING_DISPOSITION`.

**Disposition does not exist.** Not as a command, not as a capability, not as a state. That is
deliberate — #118 says a return must not automatically restore inventory to sellable stock, and the
cleanest way to guarantee that was to build no path that could.

The evidence: `RETURNED` is a schema-legal operational movement type with **no writer anywhere in the
repository**. Every return that has ever been taken in is sitting in one state, waiting for a decision
that has not been made.

### What intake already knows

| Field | Note |
| --- | --- |
| `partId` | The part |
| `source` | `WORK_ORDER` · `CUSTOMER` · `TRUCK` · `SUPPLIER` · `UNKNOWN` |
| `sourceReference` | Free text — a WO number, an RMA number, a name |
| `condition` | `UNOPENED` · `OPENED` · `DAMAGED` · `UNKNOWN` |
| `reason` | Free text, optional |
| `quantity` **or** `serialNumbers` | Exactly one of the two, never both |
| `state` | Always `AWAITING_DISPOSITION` |
| `receivedAt` / `receivedBy` | Who took it in, and when |

An unrecognized `source` or `condition` is **refused**, never coerced to `UNKNOWN` — because UNKNOWN
means "nobody could tell" and a typo means the caller is broken.

---

## 2. Two structural gaps that must be settled before any disposition can be written

These are not preferences. They are things the current record cannot answer, and a disposition
command would have to invent an answer to proceed.

### Gap A — a returned item has no location

Intake records **no warehouse and no location of any kind.** Every other inventory authority in the
platform counts a movement at a `location` — that is how on-hand, transfer sufficiency and cycle-count
expectation all work.

So a disposition that restores stock has nowhere to restore it *to*. The three ways out:

1. **Capture the location at intake.** Correct, and it changes the intake command — which means the
   returns surface has to know which warehouse the returns desk is standing in.
2. **Capture it at disposition.** The person deciding says where it goes. Defensible: the item may
   genuinely have moved between the desk and the shelf.
3. **Infer it.** From the receiving warehouse, the work order's site, the actor's assignment. **This
   would be a guess, and a guess here writes a real balance at a real location.**

> A disposition command cannot be written until this is decided, because option 3 is the only one
> that requires no other change — and it is the one that puts stock on a shelf nobody chose.

### Gap B — nothing records whose property it is

`source: "CUSTOMER"` and `source: "WORK_ORDER"` both describe where an item came *from*, not who
**owns** it. A customer's own equipment returned for repair is not company stock, and restoring it to
sellable inventory would record somebody else's property as ours.

The serialized-asset registry already carries `ownership` (`COMPANY` and others). The returns record
does not. Until it does, a disposition command cannot tell the two cases apart, and "return to stock"
is unsafe for an entire class of returns.

### And one thing the schema has already assumed

`MOVEMENT_SOURCE_TYPE.RETURNED` is `"RMA"` — the ledger already presumes a `RETURNED` movement is
produced by an **RMA object**, which does not exist in the repository.

Either that object gets built, or the mapping is wrong and should be corrected deliberately rather
than worked around by a command that passes an RMA id it invented. **This is a real fork, not a
detail.**

---

## 3. The decisions

### D-1. What may a disposition be?

The candidate set from #118, none of which is implied by intake:

| Disposition | What it means | What it would have to write |
| --- | --- | --- |
| `RETURN_TO_STOCK` | Sellable again | A `RETURNED` ledger movement — **the first writer of that type** |
| `INSPECT` / `QUARANTINE` | Held pending a decision | A hold state; **no ledger movement** |
| `REPAIR` | Goes to a bench | A work order, or a state that a work order can pick up |
| `VENDOR_RETURN` | Goes back to the supplier | An outbound obligation — an RMA object, or a transfer to a supplier location |
| `SCRAP` | Written off | A `SCRAPPED` movement, which **also has no writer today** |

**The question:** which of these does the business actually do, and which is the smallest set worth
building first?

**Recommendation:** `RETURN_TO_STOCK` and `SCRAP` only, and only after §2 is settled. They are the two
that terminate — every other option in the table leaves the item in a state that needs a *further*
decision, which means building the follow-on workflow too. A first slice that can only park things
somewhere new has not reduced the backlog of undecided returns; it has renamed it.

### D-2. Does condition constrain the legal set?

May a `DAMAGED` item be returned to stock? May an `UNKNOWN`-condition one?

**Recommendation: no, and no.** `DAMAGED` returning to sellable stock is how a customer receives a
broken part someone already rejected. `UNKNOWN` means nobody could tell — and "we could not tell"
must not resolve to "sellable" by default, which is the same fail-open this platform refuses
everywhere else. Both should route to `INSPECT` if that disposition exists, and otherwise remain
awaiting disposition.

If the Owner disagrees, the override must be an explicit, audited, reasoned act — never a silent
allowance.

### D-3. Who may disposition?

Intake and disposition are separate authorities (#118), so this is a genuinely separate audience.

Intake is a receiving-desk job. Disposition decides whether the company may sell something again —
which is closer to a cycle-count reconciliation than to a stow. The cycle-count precedent is directly
applicable: **DECISIONS #111 says a counter cannot approve their own material variance.**

**Recommendation:** a new inert capability `inventory.returns.disposition`, registered `active: false`
and granted to nobody, distinct from `inventory.returns.intake`. Whether one person may do both on the
same return is D-4.

### D-4. May the person who took a return in also disposition it?

**Recommendation: not for `RETURN_TO_STOCK`.** Taking an item in and declaring it sellable is exactly
the shape #111 already ruled on. A separation-of-duties rule here is cheap now and expensive to
retrofit, because retrofitting it invalidates whatever was dispositioned under the old rule.

The counter-argument deserves stating: a two-person warehouse cannot operate a two-person rule. If
that is the reality, the honest answer is a **recorded single-actor exception** with the actor named
in the audit — not an unstated absence of the rule.

### D-5. Is a disposition reversible?

Somebody will scrap the wrong thing.

**Recommendation: no reversal command.** A correction is a *new* movement with its own reason and its
own actor, exactly as every other ledger authority in the platform works. An "undo" that erases the
original hides that the mistake happened, and the ledger's whole value is that it does not.

### D-6. Partial disposition

Ten come back; six are fine and four are broken. Is that one return dispositioned twice, or split?

**Recommendation: one return, many disposition events, each with its own quantity or serials,** with
the return closing only when everything is accounted for. Splitting the return document loses the fact
that they arrived together, which is often the most diagnostic thing about them.

---

## 4. What is deliberately NOT in this package

- **Costing and valuation.** What a returned item is worth, whether a credit is owed, and how a
  write-off hits the books are finance decisions with their own authority. Nothing here should be
  read as settling them.
- **Customer-facing RMA.** Issuing an RMA number to a customer before anything ships back is a
  different workflow from receiving what arrives.
- **Supplier claims.** Recovering value from a vendor for a bad part is a purchasing matter.
- **Automatic disposition of any kind.** No rule, no default, no "if condition is UNOPENED then". #118
  forbids the automatic restock, and a rule engine that reaches the same outcome by a different route
  is the same decision wearing a disguise.

---

## 5. What happens if this is deferred

Deferring is a legitimate choice, and it is not free — so the cost should be visible:

Every return taken in accumulates in `AWAITING_DISPOSITION` with no way out. The intake workflow keeps
working and stays truthful, and nothing becomes wrong. But the pile grows, and the eventual
disposition command will face a backlog of returns recorded **before** §2's gaps were closed — with no
location and no ownership on any of them.

That is the concrete cost of waiting: **the longer intake runs without disposition, the larger the set
of returns that a future disposition command cannot act on without a human re-examining the physical
item.**

If deferral is the decision, the cheapest mitigation is to close **Gap A and Gap B at intake now**,
even with disposition itself unbuilt — so that the pile being accumulated is one a future command can
actually act on.

---

## 6. Recommended next action

1. Settle **Gap A** (location) and **Gap B** (ownership), and decide the **RMA** fork in §2.
2. If disposition is to be built: **D-1** (the set), then **D-3/D-4** (the authority).
3. Everything else in §3 follows from those and can be decided with the implementation.

Nothing in §1's existing behaviour changes as a result of any of this, and no rollout action is
implied. The intake path stays exactly as it is until a disposition decision is actually made.
