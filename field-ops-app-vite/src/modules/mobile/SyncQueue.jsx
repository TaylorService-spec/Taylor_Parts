import { useState } from "react";
import { conflictCard, statusFor, INTENT_LABEL, HOLD_TEXT } from "../../offline/syncPresentation.js";
import { evaluateIntent } from "../../offline/intentQueue.js";
import { needsAttention } from "../../offline/technicianIntent.js";
import { Button } from "../../shared/ui/primitives/index.js";

// THE QUEUE, VISIBLE. Everything that has not reached the platform, and what to do about it.
//
// ============================ CARDS, NOT A TABLE ============================
//
// A queue is naturally a table and a table is unusable at 320px. Each item is a card that answers the
// technician's questions in order: what was it, which job, where has it got to, why, what now.
//
// ============================ NOTHING IS HIDDEN ============================
//
// Items that need a person come first, because they are the only ones with a decision attached.
// Everything else follows, including the things quietly waiting on other work — a technician wondering
// why finishing the job has not gone through deserves to read "waiting for the installation to be
// recorded first" rather than infer it.
//
// ============================ REFUSALS ARE NOT ERRORS ============================
//
// The copy describes the WORLD ("that machine is already installed for another customer"), never the
// transport. The raw code is kept, one tap away, for a support conversation.

export default function SyncQueue({ runtime, onClose }) {
  const { queue, summary, syncing, durable, saveProblem, loadProblem, sync, retry, discard, clearSettled } = runtime;

  const attention = queue.filter(needsAttention);
  const rest = queue.filter((i) => !needsAttention(i));

  return (
    <section className="fo-sync-queue" aria-label="Sync queue">
      <header className="fo-sync-queue__head">
        <h3>Sync</h3>
        {onClose ? <Button variant="secondary" onClick={onClose}>Close</Button> : null}
      </header>

      {/* A DEVICE THAT CANNOT KEEP WORK SAYS SO BEFORE THE TECHNICIAN RELIES ON IT. */}
      {!durable ? (
        <p className="fo-sync-queue__warning" role="alert">
          This phone is not saving work offline
          {saveProblem === "quota_exceeded" ? " because its storage is full" : ""}.
          Anything you enter may be lost if the app closes.
        </p>
      ) : null}

      {loadProblem ? (
        <p className="fo-sync-queue__warning" role="alert">
          Saved work on this phone could not be read. It has not been deleted — do not re-enter
          anything until somebody has looked at it.
        </p>
      ) : null}

      <p className="fo-muted" role="status">
        {summary.unsynced === 0
          ? "Everything you have entered is on the platform."
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
            <ConflictItem key={intent.intentId} intent={intent} onRetry={retry} onDiscard={discard} />
          ))}
          {rest.map((intent) => (
            <WaitingItem key={intent.intentId} intent={intent} queue={queue} />
          ))}
        </ul>
      )}
    </section>
  );
}

/** Something the platform did not accept. The only kind of item with a decision on it. */
function ConflictItem({ intent, onRetry, onDiscard }) {
  const card = conflictCard(intent);
  const [showTechnical, setShowTechnical] = useState(false);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);

  return (
    <li className="fo-sync-item fo-sync-item--attention">
      <p className="fo-sync-item__what">
        {card.attempted}
        {/* The word, so the status never depends on the colour of the card. */}
        <span className="fo-sync-item__status">{card.status.label}</span>
      </p>
      <p className="fo-sync-item__job">Job {card.workOrderId}</p>
      <p className="fo-sync-item__happened">{card.happened}</p>
      <p className="fo-sync-item__preserved">{card.preserved}</p>
      <p className="fo-sync-item__next">{card.next}</p>

      <div className="fo-sync-item__actions">
        <Button variant="secondary" onClick={() => onRetry(card.intentId)}>Try again</Button>
        {confirmingDiscard ? (
          <>
            {/* Discarding is the one destructive act here, so it is never one tap, and the cost is
                stated rather than implied. */}
            <span className="fo-sync-item__confirm">Delete this entry for good?</span>
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

/** Work that is fine and simply has not gone yet — including work waiting on other work. */
function WaitingItem({ intent, queue }) {
  const status = statusFor(intent);
  const hold = HOLD_TEXT[evaluateIntent(intent, queue, Number.MAX_SAFE_INTEGER).reason] ?? null;
  return (
    <li className="fo-sync-item">
      <p className="fo-sync-item__what">
        {INTENT_LABEL[intent.type] ?? intent.type}
        <span className="fo-sync-item__status">{status.label}</span>
      </p>
      <p className="fo-sync-item__job">Job {intent.workOrderId}</p>
      {hold ? <p className="fo-sync-item__hold">{hold}</p> : null}
    </li>
  );
}
