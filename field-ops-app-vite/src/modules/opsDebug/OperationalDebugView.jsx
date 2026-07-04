import { useState, useCallback, useEffect } from "react";
import { useFirestoreCollection } from "../../hooks/useFirestoreCollection";
import { JOBS_COLLECTION, TECHNICIANS_COLLECTION, LOCATION_TYPE } from "../../domain/constants";
import { getTechnicianAvailability } from "../../domain/dispatchScoring";
import {
  ensureInventoryDoc,
  getInventory,
  reservePart,
  consumePart,
} from "../../services/inventoryService";
import {
  createJobWithParts,
  assignJobWithPhase,
  startTravelWithPhase,
  startWorkWithPhase,
  completeJobWithPhase,
} from "../../services/jobService";
import { getRecentJobEvents } from "../../services/jobEventService";

// Sprint 4.12: operational debug view. Debugging/exercising the Sprint 4
// service layer only -- not a production dependency, and deliberately
// separate from Dispatch.jsx/FieldMode.jsx (Sprint 3.6's UI layer, left
// "unchanged logically" per this sprint's architecture principle). Every
// action here calls into services/inventoryService.js or
// services/jobService.js -- this component never writes to Firestore
// directly.

const WAREHOUSE_LOCATION_ID = "central";
const DEBUG_PARTS = [
  { partId: "Compressor", name: "Compressor" },
  { partId: "Capacitor", name: "Capacitor" },
  { partId: "Filter Drier", name: "Filter Drier" },
];

export default function OperationalDebugView() {
  const { data: jobs } = useFirestoreCollection(JOBS_COLLECTION);
  const { data: technicians } = useFirestoreCollection(TECHNICIANS_COLLECTION);

  const [selectedTechId, setSelectedTechId] = useState("");
  const [selectedJobId, setSelectedJobId] = useState("");
  const [selectedPartId, setSelectedPartId] = useState(DEBUG_PARTS[0].partId);
  const [quantity, setQuantity] = useState(1);
  const [log, setLog] = useState([]);
  const [truckInventory, setTruckInventory] = useState([]);
  const [warehouseInventory, setWarehouseInventory] = useState([]);
  const [recentEvents, setRecentEvents] = useState([]);

  const selectedJob = jobs.find((j) => j.id === selectedJobId) ?? null;

  const appendLog = useCallback((message) => {
    setLog((prev) => [{ id: `${Date.now()}-${Math.random()}`, message }, ...prev].slice(0, 20));
  }, []);

  const refreshInventory = useCallback(async () => {
    if (selectedTechId) {
      const truck = await Promise.all(
        DEBUG_PARTS.map((p) => getInventory(LOCATION_TYPE.TRUCK, selectedTechId, p.partId))
      );
      setTruckInventory(truck.filter(Boolean));
    }
    const warehouse = await Promise.all(
      DEBUG_PARTS.map((p) => getInventory(LOCATION_TYPE.WAREHOUSE, WAREHOUSE_LOCATION_ID, p.partId))
    );
    setWarehouseInventory(warehouse.filter(Boolean));
  }, [selectedTechId]);

  const refreshEvents = useCallback(async () => {
    setRecentEvents(await getRecentJobEvents(20));
  }, []);

  useEffect(() => {
    refreshInventory();
    refreshEvents();
  }, [refreshInventory, refreshEvents]);

  async function handleSeedInventory() {
    if (!selectedTechId) {
      appendLog("Select a technician first (seeds their truck).");
      return;
    }
    for (const part of DEBUG_PARTS) {
      await ensureInventoryDoc(LOCATION_TYPE.WAREHOUSE, WAREHOUSE_LOCATION_ID, part.partId, part.name, 20);
      await ensureInventoryDoc(LOCATION_TYPE.TRUCK, selectedTechId, part.partId, part.name, 5);
    }
    appendLog(`Seeded warehouse + truck ${selectedTechId} inventory (idempotent).`);
    await refreshInventory();
  }

  async function handleCreateJob() {
    const partsRequired = Object.fromEntries(DEBUG_PARTS.map((p) => [p.partId, 1]));
    const job = await createJobWithParts("OpsDebug Test Customer", "Sprint 4 service-layer test job", partsRequired);
    appendLog(job.blocked ? "Create job BLOCKED (demo/panic mode)" : `Created job ${job.id} (phase=CREATED)`);
    await refreshEvents();
  }

  async function handleAssign() {
    if (!selectedJob || !selectedTechId) return appendLog("Select a job and technician first.");
    const technician = technicians.find((t) => t.id === selectedTechId);
    try {
      const result = await assignJobWithPhase(selectedJob, technician);
      appendLog(result?.blocked ? "Assign BLOCKED (demo/panic mode)" : `Assigned ${selectedJob.id} -> ${technician.name} (phase=ASSIGNED)`);
    } catch (err) {
      appendLog(`Assign failed: ${err.message}`);
    }
    await refreshEvents();
  }

  async function handleStartTravel() {
    if (!selectedJob) return appendLog("Select a job first.");
    try {
      const result = await startTravelWithPhase(selectedJob);
      appendLog(result?.blocked ? "Start travel BLOCKED (demo/panic mode)" : `${selectedJob.id} phase=EN_ROUTE`);
    } catch (err) {
      appendLog(`Start travel failed: ${err.message}`);
    }
    await refreshEvents();
  }

  async function handleStartWork() {
    if (!selectedJob) return appendLog("Select a job first.");
    try {
      // Real status transition: ASSIGNED -> IN_PROGRESS (via the
      // unmodified updateJobStatus() primitive) -- required before
      // Complete can succeed; canTransitionJob() doesn't allow
      // ASSIGNED -> COMPLETE directly.
      const result = await startWorkWithPhase(selectedJob);
      appendLog(result?.blocked ? "Start work BLOCKED (demo/panic mode)" : `${selectedJob.id} status=in_progress, phase=IN_PROGRESS`);
    } catch (err) {
      appendLog(`Start work failed: ${err.message}`);
    }
    await refreshEvents();
  }

  async function handleReserve() {
    if (!selectedJob || !selectedTechId) return appendLog("Select a job and technician first.");
    try {
      const result = await reservePart(selectedJob, selectedTechId, selectedPartId, Number(quantity));
      appendLog(result?.blocked ? "Reserve BLOCKED (demo/panic mode)" : `Reserved ${quantity}x ${selectedPartId} for ${selectedJob.id}`);
    } catch (err) {
      appendLog(`Reserve failed: ${err.message}`);
    }
    await refreshInventory();
    await refreshEvents();
  }

  async function handleConsume() {
    if (!selectedJob || !selectedTechId) return appendLog("Select a job and technician first.");
    try {
      const result = await consumePart(selectedJob, selectedTechId, selectedPartId, Number(quantity));
      appendLog(result?.blocked ? "Consume BLOCKED (demo/panic mode)" : `Consumed ${quantity}x ${selectedPartId} on ${selectedJob.id}`);
    } catch (err) {
      appendLog(`Consume failed: ${err.message}`);
    }
    await refreshInventory();
    await refreshEvents();
  }

  async function handleComplete() {
    if (!selectedJob) return appendLog("Select a job first.");
    try {
      const result = await completeJobWithPhase(selectedJob);
      appendLog(result?.blocked ? "Complete BLOCKED (demo/panic mode)" : `Completed ${selectedJob.id} (phase=COMPLETED)`);
    } catch (err) {
      appendLog(`Complete failed: ${err.message}`);
    }
    await refreshEvents();
  }

  return (
    <div className="fo-panel">
      <h2>Operational Debug View</h2>
      <p className="fo-muted">
        Sprint 4 service-layer exerciser. Debugging only -- nothing here is a production dependency.
      </p>

      <div className="fo-card">
        <h3>Selection</h3>
        <div className="fo-form">
          <select value={selectedTechId} onChange={(e) => setSelectedTechId(e.target.value)}>
            <option value="">Select technician…</option>
            {technicians.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({getTechnicianAvailability(t, jobs)})
              </option>
            ))}
          </select>
          <select value={selectedJobId} onChange={(e) => setSelectedJobId(e.target.value)}>
            <option value="">Select job…</option>
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>
                {j.customer} ({j.status}{j.phase ? `, phase=${j.phase}` : ""})
              </option>
            ))}
          </select>
          <select value={selectedPartId} onChange={(e) => setSelectedPartId(e.target.value)}>
            {DEBUG_PARTS.map((p) => (
              <option key={p.partId} value={p.partId}>
                {p.name}
              </option>
            ))}
          </select>
          <input type="number" min="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        </div>
      </div>

      <div className="fo-card">
        <h3>Actions</h3>
        <div className="fo-form">
          <button onClick={handleSeedInventory}>Seed Sample Inventory</button>
          <button onClick={handleCreateJob}>Create Test Job (with parts)</button>
          <button onClick={handleAssign}>Assign Selected Job</button>
          <button onClick={handleStartTravel}>Start Travel (phase only)</button>
          <button onClick={handleStartWork}>Start Work (status + phase)</button>
          <button onClick={handleReserve}>Reserve Part</button>
          <button onClick={handleConsume}>Consume Part</button>
          <button onClick={handleComplete}>Complete Selected Job</button>
        </div>
      </div>

      {selectedJob && (
        <div className="fo-card">
          <h3>Selected Job Detail</h3>
          <div>Status: {selectedJob.status} · Phase: {selectedJob.phase ?? "(none)"}</div>
          <div>Parts required: {JSON.stringify(selectedJob.partsRequired ?? {})}</div>
          <div>Parts reserved: {JSON.stringify(selectedJob.partsReserved ?? {})}</div>
        </div>
      )}

      <div className="fo-card">
        <h3>Warehouse Inventory ({WAREHOUSE_LOCATION_ID})</h3>
        {warehouseInventory.length === 0 ? (
          <p className="fo-muted">No inventory seeded yet.</p>
        ) : (
          warehouseInventory.map((inv) => (
            <div key={inv.id}>
              {inv.name}: {inv.quantityAvailable} available, {inv.quantityReserved} reserved
            </div>
          ))
        )}
      </div>

      <div className="fo-card">
        <h3>Truck Inventory {selectedTechId ? `(${selectedTechId})` : ""}</h3>
        {truckInventory.length === 0 ? (
          <p className="fo-muted">Select a technician and seed inventory.</p>
        ) : (
          truckInventory.map((inv) => (
            <div key={inv.id}>
              {inv.name}: {inv.quantityAvailable} available, {inv.quantityReserved} reserved
            </div>
          ))
        )}
      </div>

      <div className="fo-card">
        <h3>Recent Job Events</h3>
        {recentEvents.length === 0 ? (
          <p className="fo-muted">No events logged yet.</p>
        ) : (
          recentEvents.map((event) => (
            <div key={event.id} className="fo-muted">
              {new Date(event.timestamp).toLocaleTimeString()} · {event.eventType} · job {event.jobId} ·{" "}
              {JSON.stringify(event.payload)}
            </div>
          ))
        )}
      </div>

      <div className="fo-card">
        <h3>Action Log</h3>
        {log.map((entry) => (
          <div key={entry.id} className="fo-muted">
            {entry.message}
          </div>
        ))}
      </div>
    </div>
  );
}
