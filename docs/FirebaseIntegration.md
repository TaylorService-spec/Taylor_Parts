# Firebase Client Integration Layer

This project already has a Firebase client integration layer — modular v9+ syntax, a real folder structure, and the exact functions (`createJob`, `getJobs`-equivalent, `updateJobStatus`) a fresh integration would ask for. This documents the real files rather than adding parallel ones, since a second `createJob()`/`updateJobStatus()` would bypass the single sanctioned write path this project has enforced since Sprint 1 (see `docs/PROJECT_ARCHITECTURE.md`).

## 1. App init + Firestore setup — `src/firebase/firebase.js`

```js
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "...",
  authDomain: "taylor-parts.firebaseapp.com",
  projectId: "taylor-parts",
  storageBucket: "taylor-parts.firebasestorage.app",
  messagingSenderId: "664399427363",
  appId: "1:664399427363:web:de29dd9ae77bf548907e96",
  measurementId: "G-58GLNRJ5C8",
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
```

Already modular v9+ (`firebase/app`, `firebase/firestore`, `firebase/auth` — tree-shakeable named imports, not the old namespaced/compat SDK). `db` and `auth` are the two exports every other file in the app imports from here. There is exactly one `initializeApp()` call in the codebase — keep it that way; a second call anywhere would create a second app instance pointed at the same project, which is a real and easy-to-hit Firebase footgun.

## 2. Folder structure — what's actually here (not `/src/services/firebase/`, `/jobs/`, `/techs/`)

```
src/
  firebase/
    firebase.js            # app/Firestore/Auth init (above)
    collectionStore.js      # generic Firestore CRUD wrapper (below)
  domain/
    constants.js             # collection names, status enums
    jobActions.js             # createJob/createTechnician/assignJob/updateJobStatus -- THE write path
    jobWorkflow.js             # canTransitionJob() -- status transition rules
    jobPhaseWorkflow.js         # canTransitionPhase() -- Sprint 4 phase transition rules
    errors.js                    # AssignmentConflictError, InsufficientInventoryError, etc.
  services/
    inventoryService.js         # Sprint 4: real inventory reserve/consume/transfer
    jobEventService.js           # Sprint 4: persisted job event log
    jobService.js                 # Sprint 4: composes jobActions.js with phase tracking
  hooks/
    useFirestoreCollection.js    # realtime collection subscription (the "getJobs()" of this app)
  lib/
    firebaseSafe.js               # demo/panic write-blocking gate (wraps addDoc/setDoc/updateDoc/deleteDoc)
  config/
    env.js                         # IS_DEMO / panic-mode flag
```

The split that matters here isn't "firebase vs. jobs vs. techs" folders — it's **domain/service layer vs. UI layer**. `domain/` and `services/` are the only places allowed to write to Firestore; everything under `modules/` (the UI components) calls into them and never touches `firebase/collectionStore.js` or the Firestore SDK directly.

## 3. Example functions

### `createJob()` — `domain/jobActions.js`

```js
export function createJob(customer, description) {
  return jobsStore.add({
    customer,
    description,
    status: JOB_STATUS.OPEN,
    technicianId: null,
    workOrderId: null,
  });
}
```

`jobsStore` comes from `collectionStore.js` (below) — `.add()` stamps `createdAt` automatically and routes through the demo/panic write gate.

### `getJobs()` — realtime, via `hooks/useFirestoreCollection.js`

This app doesn't have a one-shot `getJobs()` that returns a promise — every screen instead subscribes to live updates:

```js
import { useFirestoreCollection } from "../../hooks/useFirestoreCollection";
import { JOBS_COLLECTION } from "../../domain/constants";

const { data: jobs, loading } = useFirestoreCollection(JOBS_COLLECTION);
```

```js
// hooks/useFirestoreCollection.js
export function useFirestoreCollection(path) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ref = collection(db, path);
    const unsub = onSnapshot(ref, (snap) => {
      setData(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setLoading(false);
    });
    return () => unsub();
  }, [path]);

  return { data, loading };
}
```

Every job-list-consuming screen (Dispatch, Field Mode, Control Tower, Ops Debug) uses this same hook — there's one realtime subscription pattern, not a separate `getJobs()`/`getTechnicians()`/`getInventory()` per collection.

### `updateJobStatus()` — `domain/jobActions.js`

```js
export async function updateJobStatus(job, nextStatus) {
  if (!auth.currentUser) {
    throw new Error("Unauthenticated write attempt blocked");
  }
  if (isWriteBlocked()) {
    console.warn("WRITE BLOCKED (updateJobStatus)", job.id, nextStatus);
    return { blocked: true };
  }

  return runTransaction(db, async (tx) => {
    const jobRef = doc(db, JOBS_COLLECTION, job.id);
    const jobSnap = await tx.get(jobRef);
    const currentStatus = jobSnap.data().status;

    if (!canTransitionJob(currentStatus, nextStatus)) {
      throw new Error(`Invalid transition: ${currentStatus} → ${nextStatus}`);
    }

    tx.update(jobRef, { status: nextStatus });
    // ...also frees the technician when transitioning to COMPLETE
  });
}
```

Notably more than a plain `updateDoc()` call: it's transactional (re-reads the job's current status inside the transaction rather than trusting a stale client copy), validates the transition against `jobWorkflow.js`'s state machine before writing, and checks the demo/panic write gate first. This transactional shape exists specifically to fix a real bug found in Sprint 3.1 (a partial-write race that could strand a technician's status) — a plain `updateDoc()` reintroduces that class of bug.

## The underlying generic wrapper — `firebase/collectionStore.js`

```js
export function makeCollectionStore(collectionName) {
  const colRef = collection(db, collectionName);
  return {
    list() {
      return getDocs(colRef).then((snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    },
    add(data) {
      return safeAddDoc(colRef, { ...data, createdAt: Date.now() });
    },
    update(id, data) {
      return safeUpdateDoc(doc(db, collectionName, id), data);
    },
    remove(id) {
      return safeDeleteDoc(doc(db, collectionName, id));
    },
  };
}

export const jobsStore = makeCollectionStore(JOBS_COLLECTION);
export const techniciansStore = makeCollectionStore(TECHNICIANS_COLLECTION);
```

This is the one place `addDoc`/`updateDoc`/`deleteDoc` get called for the simple (non-transactional) writes, and it's already routed through `lib/firebaseSafe.js`'s safe wrappers so the demo-mode/panic-mode write gate (`config/env.js`) applies uniformly. `domain/jobActions.js`'s `createJob()`/`createTechnician()` call into this; `assignJob()`/`updateJobStatus()` bypass it deliberately for their own transactional writes (see the comment at the top of `jobActions.js`).

## If a genuinely new collection/service is needed later

Follow the Sprint 4 pattern (`services/inventoryService.js`, `services/jobEventService.js`): one service file per new domain concept, its own collection constant in `domain/constants.js`, every write gated by `isWriteBlocked()`, and — for anything transactional — `runTransaction()` rather than a bare `updateDoc()`. Add it under `services/`, not a new top-level folder per entity type.
