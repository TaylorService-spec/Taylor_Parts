import { useState } from "react";
import StructuredFields from "../../shared/ui/StructuredFields.jsx";
import { warehouseConflictCard, warehousePendingCard } from "../../offline/warehouseSyncPresentation.js";
import { needsAttention } from "../../offline/technicianIntent.js";
import { Button } from "../../shared/ui/primitives";

// THE WAREHOUSE QUEUE, VISIBLE — as objects, not as sentences.
//
// ============================ WHY THIS IS NOT THE TECHNICIAN'S QUEUE SCREEN ============================
//
// The technician's conflict card is prose, and prose is right there: a note either saved or it did
// not, and there is one thing to say about it.
//
// A warehouse conflict is a different question. Somebody standing at a rack with a box needs to know
// WHICH FIELD MOVED — was it the destination, the quantity, the transfer's status, the serial? Prose
// makes them parse a line to find out. Fields let them compare at a glance, which is exactly what the
// structured-object standard is for and exactly the moment it earns its keep.
//
// ============================ TWO STATUSES, NEVER ONE ============================
//
// Every card carries the business status and the SYNC status separately, because
// "the transfer has not been dispatched" and "your dispatch has not been sent" are opposite problems
// with opposite fixes.
//
// ============================ NOTHING IS HIDDEN ============================
//
// Items needing a person come first — they are the only ones with a decision attached. Everything
// else follows, so a warehouse worker can always see the whole of what this phone is holding.

export default function WarehouseSyncQueue({ runtime, onClose }) {
  const { queue, summary, syncing, durable, saveProblem, loadProblem, sync, retry, discard, clearSettled } = runtime;

  const attention = queue.filter(needsAttention);
  const rest = queue.filter((i) => !needsAttention(i));

  return (
    <section className="fo-sync-queue" aria-label="Sync queue">
      <header className="fo-sync-queue__head">
        <h3>Sync</h3>
        {onClose ? <Button variant="secondary" onClick={onClose}>Close</Button> : null}
      </header>

      {/* A DEVICE THAT CANNOT KEEP WORK SAYS SO BEFORE ANYBODY RELIES ON IT. In a warehouse the cost
          of the alternative is a receipt somebody believes happened and nobody recorded. */}
      {!durable ? (
        <p className="fo-sync-queue__warning" role="alert">
          This phone is not saving work offline
          {saveProblem === "quota_exceeded" ? " because its storage is full" : ""}.
          Anything you scan may be lost if the app closes. Stay in signal if you can.
        </p>
      ) : null}

      {loadProblem ? (
        <p className="fo-sync-queue__warning" role="alert">
          Work saved on this phone could not be read. It has not been deleted — do not re-scan
          anything until somebody has looked at it.
        </p>
      ) : null}

      <p className="fo-muted" role="status">
        {summary.unsynced === 0
          ? "Everything you have scanned is on the platform."
          : `${summary.unsynced} not sent${summary.attentionCount > 0 ? `, ${summary.attentionCount} needing you` : ""}.`}
      </p>

      <div className="fo-sync-queue__actions">
        <Button variant="secondary" onClick={() => sync(true)} disabled={syncing}>
          {syncing ? "Syncing…" : "Sync now"}
        </Button>
        {summary.synced > 0 ? (
          <Button variant="secondary" onClick={clearSettled}>Clear sent items</Button>
        ) : null}
      </div>

      {queue.length === 0 ? (
        <p className="fo-muted">Nothing waiting.</p>
      ) : (
        <ul className="fo-sync-queue__list">
          {attention.map((intent) => (
            <WarehouseConflictItem key={intent.intentId} intent={intent} onRetry={retry} onDiscard={discard} />
          ))}
          {rest.map((intent) => {
            const card = warehousePendingCard(intent);
            return (
              <li className="fo-sync-item" key={intent.intentId}>
                <p className="fo-sync-item__what">{card.attempted}</p>
                <StructuredFields fields={card.fields} label={`${card.attempted} details`} />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Something the platform did not accept — the only kind of item with a decision on it. */
function WarehouseConflictItem({ intent, onRetry, onDiscard }) {
  // `domainStatus` is passed when the caller could read current business truth. Absent is honest:
  // several of these records have no governed client read, and inventing a status would be worse
  // than showing only the sync status and saying so.
  const card = warehouseConflictCard(intent, { domainStatus: intent.currentDomainStatus ?? null });
  const [showTechnical, setShowTechnical] = useState(false);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);

  return (
    <li className="fo-sync-item fo-sync-item--attention">
      <p className="fo-sync-item__what">{card.attempted}</p>

      {/* THE FIELDS, so a person can see WHICH one moved. */}
      <StructuredFields fields={card.fields} label={`${card.attempted} details`} />

      <p className="fo-sync-item__happened">{card.happened}</p>
      <p className="fo-sync-item__preserved">{card.preserved}</p>
      <p className="fo-sync-item__next">{card.next}</p>

      <div className="fo-sync-item__actions">
        <Button variant="secondary" onClick={() => onRetry(card.intentId)}>Try again</Button>
        {confirmingDiscard ? (
          <>
            {/* The one destructive act here, so never one tap, and the cost is stated. */}
            <span className="fo-sync-item__confirm">Delete this scan for good?</span>
            <Button variant="secondary" onClick={() => onDiscard(card.intentId)}>Yes, delete</Button>
            <Button variant="secondary" onClick={() => setConfirmingDiscard(false)}>Keep it</Button>
          </>
        ) : (
          <Button variant="secondary" onClick={() => setConfirmingDiscard(true)}>Discard</Button>
        )}
        <Button variant="secondary" onClick={() => setShowTechnical((v) => !v)} aria-expanded={showTechnical}>
          Details
        </Button>
      </div>

      {showTechnical ? (
        <p className="fo-sync-item__technical">
          {card.intentId} · {card.technical.code ?? "no code"}
          {card.technical.details ? ` · ${card.technical.details}` : ""} · {card.technical.attempts} attempts
        </p>
      ) : null}
    </li>
  );
}
