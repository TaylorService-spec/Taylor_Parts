#!/usr/bin/env node
// DISPATCH & SCHEDULER -- the LIVE Scheduling Functional Gate.
//
// ============================ WHY THIS EXISTS ============================
//
// PR #1549 shipped the governed Scheduling domain and its emulator suites; the callables were then
// deployed to the sandbox. Neither of those facts is a certification. The emulator suites prove the
// COMMANDS are correct against a local Firestore; `verifySandboxFunctions.mjs` proves the deployed
// callables EXIST, are ACTIVE and run nodejs22. Nothing so far has proved that the DEPLOYED estate
// -- functions, Rules, indexes, capability activation and role bindings together -- actually
// schedules, refuses and un-schedules when a real dispatcher's ID token asks it to.
//
// DEPLOYED IS NOT CERTIFIED. This is the step that closes that gap, and it is the precondition the
// Dispatch North Star composition sits behind.
//
// ============================ WHAT IT DOES TO THE SANDBOX ============================
//
// It MUTATES SANDBOX DATA, deliberately and through governed commands only: it schedules, re-times,
// reassigns and un-schedules ONE Work Order it selects at run time, and it creates + deletes ONE
// technician blocked-time record. Every mutation goes through a trusted callable with a reason --
// there is no direct Firestore write anywhere in this file, and there must never be one, because a
// gate that reached around the authority it is certifying would certify nothing.
//
// It refuses to run against any project but the sandbox. `--confirm-project` must be passed and must
// match, so an absent-minded `--project taylor-parts` is a usage error rather than a production write.
//
// It restores what it changed: the Work Order it borrows is returned to the queue by the governed
// Unschedule it is testing, and the blocked time it creates is deleted by the governed delete it is
// testing. Restoration is itself part of the evidence.
//
// ============================ WHAT IT PROVES ============================
//
// Availability   -- the trusted read path answers, and answers UNKNOWN as null rather than as zero.
// Rules          -- a client ID token cannot read either deny-all availability collection directly.
// Authorization  -- a technician persona is refused every scheduling command.
// Placement      -- Schedule, Reschedule, Reassign and Unschedule commit and are visible afterward.
// Refusal        -- past start, blocked time and overlap each refuse, with their governed codes.
// Warning        -- outside recorded working hours WARNS on a SUCCESSFUL response, and unrecorded
//                   availability warns differently. Neither is silently upgraded to a refusal.
// Lifecycle      -- Unschedule is SCHEDULED -> READY_TO_DISPATCH, and MarkReady cannot stand in for it.
// Integrity      -- a refused mutation leaves the prior committed placement intact.
//
// Usage:
//   node scripts/schedulingFunctionalGate.mjs --confirm-project eos-platform-sandbox
//   node scripts/schedulingFunctionalGate.mjs --confirm-project eos-platform-sandbox --json out.json
//
// Exit codes: 0 = every check passed. 1 = at least one failed. 2 = usage/precondition error.
import { readFileSync, writeFileSync } from "node:fs";

import { loadSandboxPersona } from "./sandboxCredentials.mjs";

const SANDBOX_PROJECT = "eos-platform-sandbox";
const REGION = "us-central1";
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// ---------------------------------------------------------------- args

export function parseArgs(argv) {
  const args = { confirmProject: null, json: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--confirm-project") { args.confirmProject = argv[i + 1] ?? null; i += 1; continue; }
    if (argv[i] === "--json") { args.json = argv[i + 1] ?? null; i += 1; continue; }
  }
  return args;
}

// ---------------------------------------------------------------- transport

function sandboxWebApiKey() {
  const envs = JSON.parse(readFileSync(new URL("../config/environments.json", import.meta.url), "utf8")).environments;
  const sb = envs.find((e) => e?.firebase?.projectId === SANDBOX_PROJECT);
  if (!sb?.firebase?.apiKey) throw new Error(`no web config for ${SANDBOX_PROJECT} in config/environments.json`);
  return sb.firebase.apiKey;
}

/**
 * Sign in one persona and return its uid + ID token. The password is read through the canonical
 * loader, passed straight into the request body, and never read back or logged -- the same contract
 * every other persona tool in this repository holds itself to.
 */
async function signIn(personaId, apiKey) {
  const cred = loadSandboxPersona(personaId);
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: cred.email, password: cred.password, returnSecureToken: true }),
  });
  const body = await res.json().catch(() => ({}));
  if (!body.idToken) throw new Error(`sign-in failed for persona ${personaId} (${body.error?.message ?? res.status})`);
  return { personaId, uid: body.localId, token: body.idToken };
}

/** Invoke a deployed callable over the real HTTPS callable protocol. */
async function callable(name, actor, data) {
  const res = await fetch(`https://${REGION}-${SANDBOX_PROJECT}.cloudfunctions.net/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${actor.token}` },
    body: JSON.stringify({ data }),
  });
  const body = await res.json().catch(() => ({}));
  return {
    ok: res.status === 200 && body.result !== undefined,
    status: res.status,
    result: body.result,
    errorStatus: body.error?.status ?? null,
    errorMessage: body.error?.message ?? null,
  };
}

/** Read one document through the CLIENT Firestore REST surface, so Rules apply. */
async function clientGetDoc(actor, collection, docId) {
  const res = await fetch(
    `https://firestore.googleapis.com/v1/projects/${SANDBOX_PROJECT}/databases/(default)/documents/${collection}/${docId}`,
    { headers: { authorization: `Bearer ${actor.token}` } },
  );
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

/** List a collection through the CLIENT Firestore REST surface, so Rules apply. */
async function clientListDocs(actor, collection, pageSize = 300) {
  const res = await fetch(
    `https://firestore.googleapis.com/v1/projects/${SANDBOX_PROJECT}/databases/(default)/documents/${collection}?pageSize=${pageSize}`,
    { headers: { authorization: `Bearer ${actor.token}` } },
  );
  const body = await res.json().catch(() => ({}));
  return { status: res.status, documents: body.documents ?? [], error: body.error ?? null };
}

/**
 * A scheduling window field, as epoch millis, whichever way it is stored. Both write paths persist a
 * Firestore Timestamp (transitionWorkOrder and schedulingCommands both call `Timestamp.fromMillis`)
 * and every reader normalises before comparing -- so this gate does too, rather than asserting one
 * representation and reporting a serialization detail as a scheduling defect.
 */
export function millisOf(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === "number") return value;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/** Firestore REST returns typed values; flatten the handful of shapes this gate reads. */
export function plain(fields = {}) {
  const out = {};
  for (const [k, v] of Object.entries(fields)) {
    if ("stringValue" in v) out[k] = v.stringValue;
    else if ("integerValue" in v) out[k] = Number(v.integerValue);
    else if ("doubleValue" in v) out[k] = v.doubleValue;
    else if ("booleanValue" in v) out[k] = v.booleanValue;
    else if ("nullValue" in v) out[k] = null;
    else if ("timestampValue" in v) out[k] = v.timestampValue;
    else if ("mapValue" in v) out[k] = plain(v.mapValue.fields ?? {});
    else if ("arrayValue" in v) out[k] = (v.arrayValue.values ?? []).map((x) => plain({ x }).x);
  }
  return out;
}

// ---------------------------------------------------------------- reporting

const checks = [];
function record(id, passed, detail) {
  checks.push({ id, passed, detail });
  process.stdout.write(`${passed ? "PASS" : "FAIL"}  ${id}${detail ? ` -- ${detail}` : ""}\n`);
  return passed;
}
/** A check whose own precondition could not be established. Counts as a failure, named as one. */
function blocked(id, detail) { return record(id, false, `BLOCKED: ${detail}`); }

// ---------------------------------------------------------------- window helpers

/** How far the named zone is from UTC at one instant, resolved through Intl rather than assumed. */
export function zoneOffsetMillis(timeZone, instant) {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(instant)).reduce((a, x) => { a[x.type] = x.value; return a; }, {});
  const asIfUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asIfUtc - Math.floor(instant / 1000) * 1000;
}

/**
 * The instant at which it is `hour`:00 local time in `timeZone`, on the calendar day `minDays` days
 * from now. Resolved through Intl, for the same reason availabilityModel resolves working hours that
 * way: a stored offset is correct for half the year, and a gate that drifted an hour every March
 * would report an availability defect that did not exist.
 */
export function nextLocalHour(timeZone, hour, minDays, from = Date.now()) {
  const probe = from + minDays * DAY;
  const p = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date(probe)).reduce((a, x) => { a[x.type] = x.value; return a; }, {});
  const naive = Date.UTC(+p.year, +p.month - 1, +p.day, hour, 0, 0);
  // Two passes: the offset at the naive instant, then re-resolved at the corrected one, so a target
  // that lands near a DST boundary settles rather than staying an hour out.
  const once = naive - zoneOffsetMillis(timeZone, naive);
  return naive - zoneOffsetMillis(timeZone, once);
}

// ---------------------------------------------------------------- the gate

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.confirmProject !== SANDBOX_PROJECT) {
    console.error(`ERROR: --confirm-project must be exactly "${SANDBOX_PROJECT}". This gate mutates data and runs nowhere else.`);
    process.exit(2);
  }

  const apiKey = sandboxWebApiKey();
  const dispatcher = await signIn("dispatcher", apiKey);
  const technician = await signIn("technician", apiKey);
  console.log(`\nScheduling Functional Gate -- ${SANDBOX_PROJECT}`);
  console.log(`dispatcher uid ${dispatcher.uid} | technician uid ${technician.uid}\n`);

  // -------------------------------------------------- A. trusted availability read
  const now = Date.now();
  const readWindow = { startMillis: now, endMillis: now + 14 * DAY };
  const avail = await callable("readTechnicianAvailabilityCallable", dispatcher, readWindow);
  if (!record("A1 availability read answers a dispatcher", avail.ok,
    avail.ok ? `${avail.result.technicians.length} technicians` : `${avail.errorStatus}: ${avail.errorMessage}`)) {
    console.error("\nThe trusted read path is the floor everything else stands on. Stopping.");
    return finish(args);
  }
  const techs = avail.result.technicians;

  const unknown = techs.filter((t) => t.workingAvailability === null);
  record(
    "A2 unrecorded availability reads as null, never as zero",
    unknown.every((t) => t.availableMinutes === null),
    `${unknown.length} without a working schedule; availableMinutes null for ${unknown.filter((t) => t.availableMinutes === null).length}`,
  );

  const recorded = techs.filter((t) => t.workingAvailability !== null);
  record(
    "A3 recorded availability returns hours and a zone",
    recorded.length > 0 && recorded.every((t) => t.workingAvailability.timeZone && t.workingAvailability.weeklyHours),
    recorded.length > 0
      ? `${recorded.length} with a recorded schedule, e.g. ${recorded[0].technicianId} / ${recorded[0].workingAvailability.timeZone}`
      : "no technician has a recorded working schedule",
  );

  // -------------------------------------------------- B. Rules: the collections are closed to clients
  for (const collection of ["technician_working_availability", "technician_blocked_time"]) {
    const listed = await clientListDocs(dispatcher, collection);
    record(
      `B1 client read of ${collection} is refused`,
      listed.status === 403 || listed.status === 401,
      `HTTP ${listed.status}${listed.error ? ` (${listed.error.status})` : ""}`,
    );
  }

  // -------------------------------------------------- C. authorization on the read
  const techAttempt = await callable("readTechnicianAvailabilityCallable", technician, readWindow);
  record(
    "C1 a technician may not read technician availability",
    !techAttempt.ok && techAttempt.errorStatus === "PERMISSION_DENIED",
    `${techAttempt.status} / ${techAttempt.errorStatus}`,
  );

  // -------------------------------------------------- D. pick a Work Order to borrow
  const wos = await clientListDocs(dispatcher, "fieldops_wos");
  if (wos.status !== 200) {
    blocked("D0 a Work Order is reachable", `workOrders list returned HTTP ${wos.status}`);
    return finish(args);
  }
  const allWos = wos.documents.map((d) => ({ id: d.name.split("/").pop(), ...plain(d.fields) }));
  const subject = allWos.find((w) => w.status === "READY_TO_DISPATCH");
  if (!subject) {
    blocked("D0 a READY_TO_DISPATCH Work Order exists to schedule",
      `${allWos.length} Work Orders read, none READY_TO_DISPATCH`);
    return finish(args);
  }
  record("D0 subject Work Order selected", true, `${subject.id} (${subject.status})`);

  // A technician with a RECORDED schedule, so the working-hours warning has a denominator, and one
  // without, so the unrecorded warning can be told apart from it.
  const withHours = recorded[0] ?? null;
  const withoutHours = unknown[0] ?? null;
  if (!withHours) { blocked("D1 a technician with recorded hours exists", "none found"); return finish(args); }
  const zone = withHours.workingAvailability.timeZone;

  // -------------------------------------------------- E. past-start, on BOTH placement paths
  //
  // Deliberately asked of the Schedule TRANSITION and of the Reschedule COMMAND separately. ND-20's
  // collision table is written as a property of the Scheduling domain, not of one entry point, so a
  // dispatcher who can reach a refused-condition window by pressing a different button has found a
  // hole in the policy rather than a shortcut.
  const pastStart = now - 3 * HOUR;
  const pastOnSchedule = await callable("transitionWorkOrder", dispatcher, {
    workOrderId: subject.id, action: "Schedule",
    scheduledStart: pastStart, scheduledEnd: pastStart + 2 * HOUR, scheduledTechId: withHours.technicianId,
  });
  // A refusal only counts if it refused for THIS reason. An overlap conflict against some unrelated
  // placement would also come back as a refusal, and reading that as "past starts are refused" is how
  // a gate certifies a rule it never actually exercised.
  const pastRefusedForOverlap = /overlapping/i.test(String(pastOnSchedule.errorMessage ?? ""));
  record("E1 a start in the past is refused by the Schedule transition",
    !pastOnSchedule.ok && !pastRefusedForOverlap,
    pastRefusedForOverlap
      ? `INCONCLUSIVE: refused for overlap, not for the past start -- ${String(pastOnSchedule.errorMessage).slice(0, 70)}`
      : `${pastOnSchedule.errorStatus ?? pastOnSchedule.status}: ${String(pastOnSchedule.errorMessage).slice(0, 90)}`);

  const afterPast = plain((await clientGetDoc(dispatcher, "fieldops_wos", subject.id)).body.fields ?? {});
  record("E2 a refused placement leaves the Work Order untouched",
    afterPast.status === "READY_TO_DISPATCH", `status is ${afterPast.status}`);

  // If E1 committed, the subject is now sitting in the past. Return it to the queue before going on,
  // so the rest of the gate starts from the state it expects rather than from the defect's wreckage.
  if (afterPast.status === "SCHEDULED") {
    await callable("transitionWorkOrder", dispatcher, {
      workOrderId: subject.id, action: "Unschedule",
      unscheduleReason: "Scheduling Functional Gate -- clearing a placement the past-start check let through",
    });
  }

  // -------------------------------------------------- F. the governed Schedule path
  // Inside recorded working hours, so a clean placement produces NO warnings.
  const inHours = nextLocalHour(zone, 9, 2);
  const sched = await callable("transitionWorkOrder", dispatcher, {
    workOrderId: subject.id, action: "Schedule",
    scheduledStart: inHours, scheduledEnd: inHours + 2 * HOUR, scheduledTechId: withHours.technicianId,
  });
  if (!record("F1 Schedule commits through the governed lifecycle path", sched.ok,
    sched.ok ? `${new Date(inHours).toISOString()} -> ${withHours.technicianId}` : `${sched.errorStatus}: ${sched.errorMessage}`)) {
    return finish(args);
  }
  const afterSchedule = plain((await clientGetDoc(dispatcher, "fieldops_wos", subject.id)).body.fields ?? {});
  record(
    "F2 the committed record carries status, window and technician",
    afterSchedule.status === "SCHEDULED"
      && millisOf(afterSchedule.scheduledStart) === inHours
      && afterSchedule.scheduledTechId === withHours.technicianId,
    `${afterSchedule.status} / ${afterSchedule.scheduledStart} / ${afterSchedule.scheduledTechId}`,
  );

  // -------------------------------------------------- G. overlap
  const overlap = await callable("rescheduleWorkOrderCallable", dispatcher, {
    workOrderId: subject.id, reason: "Scheduling Functional Gate -- self-overlap control",
    scheduledStart: inHours + 30 * MINUTE, scheduledEnd: inHours + 90 * MINUTE,
    scheduledTechId: withHours.technicianId,
  });
  // A Work Order does not conflict with itself; this must SUCCEED and is the control for G2.
  record("G1 a Work Order does not collide with its own placement", overlap.ok,
    overlap.ok ? "re-timed inside its own window" : `${overlap.errorStatus}: ${overlap.errorMessage}`);
  const heldStart = overlap.ok ? inHours + 30 * MINUTE : inHours;
  const heldEnd = overlap.ok ? inHours + 90 * MINUTE : inHours + 2 * HOUR;

  const other = allWos.find((w) => w.id !== subject.id && w.status === "READY_TO_DISPATCH");
  if (other) {
    const collide = await callable("transitionWorkOrder", dispatcher, {
      workOrderId: other.id, action: "Schedule",
      scheduledStart: heldStart + 15 * MINUTE, scheduledEnd: heldStart + 45 * MINUTE,
      scheduledTechId: withHours.technicianId,
    });
    record("G2 an overlapping placement on the same technician is refused", !collide.ok,
      `${collide.errorStatus ?? collide.status}: ${String(collide.errorMessage).slice(0, 90)}`);
    if (collide.ok) {
      // It committed, so put it back rather than leaving the sandbox holding a placement the gate made.
      await callable("transitionWorkOrder", dispatcher, {
        workOrderId: other.id, action: "Unschedule", unscheduleReason: "Scheduling Functional Gate cleanup",
      });
    }
  } else {
    blocked("G2 an overlapping placement on the same technician is refused",
      "no second READY_TO_DISPATCH Work Order to collide with");
  }

  // -------------------------------------------------- H. blocked time
  const blockStart = heldEnd + 4 * HOUR;
  const created = await callable("createTechnicianBlockedTimeCallable", dispatcher, {
    technicianId: withHours.technicianId, startMillis: blockStart, endMillis: blockStart + 3 * HOUR,
    kind: "TRAINING", reason: "Scheduling Functional Gate",
  });
  if (record("H1 blocked time is recorded through its governed command", created.ok,
    created.ok ? created.result.blockId : `${created.errorStatus}: ${created.errorMessage}`)) {
    const blockedRead = await callable("readTechnicianAvailabilityCallable", dispatcher, {
      startMillis: blockStart - HOUR, endMillis: blockStart + 4 * HOUR, technicianIds: [withHours.technicianId],
    });
    const view = blockedRead.result?.technicians?.[0];
    record(
      "H2 the trusted read surfaces that blocked time",
      Boolean(view?.blockedTime?.some((b) => b.blockId === created.result.blockId)),
      `${view?.blockedTime?.length ?? 0} blocks in window`,
    );

    const intoBlock = await callable("rescheduleWorkOrderCallable", dispatcher, {
      workOrderId: subject.id, reason: "Scheduling Functional Gate -- blocked-time probe",
      scheduledStart: blockStart + 30 * MINUTE, scheduledEnd: blockStart + 90 * MINUTE,
    });
    record("H3 a reschedule into blocked time is refused", !intoBlock.ok,
      `${intoBlock.errorStatus ?? intoBlock.status}: ${String(intoBlock.errorMessage).slice(0, 90)}`);

    const stillHeld = plain((await clientGetDoc(dispatcher, "fieldops_wos", subject.id)).body.fields ?? {});
    record("H4 the refused reschedule left the prior window committed",
      millisOf(stillHeld.scheduledStart) === heldStart, `scheduledStart is ${stillHeld.scheduledStart}`);

    // The same condition, asked of the Schedule TRANSITION -- see the note above section E.
    if (other) {
      const scheduleIntoBlock = await callable("transitionWorkOrder", dispatcher, {
        workOrderId: other.id, action: "Schedule",
        scheduledStart: blockStart + 30 * MINUTE, scheduledEnd: blockStart + 90 * MINUTE,
        scheduledTechId: withHours.technicianId,
      });
      record("H4b a Schedule into blocked time is refused", !scheduleIntoBlock.ok,
        `${scheduleIntoBlock.errorStatus ?? scheduleIntoBlock.status}: ${String(scheduleIntoBlock.errorMessage).slice(0, 90)}`);
      if (scheduleIntoBlock.ok) {
        await callable("transitionWorkOrder", dispatcher, {
          workOrderId: other.id, action: "Unschedule",
          unscheduleReason: "Scheduling Functional Gate -- clearing a placement the blocked-time check let through",
        });
      }
    } else {
      blocked("H4b a Schedule into blocked time is refused", "no second READY_TO_DISPATCH Work Order to place");
    }

    const removed = await callable("deleteTechnicianBlockedTimeCallable", dispatcher, { blockId: created.result.blockId });
    record("H5 blocked time is removed through its governed command", removed.ok,
      removed.ok ? "deleted" : `${removed.errorStatus}: ${removed.errorMessage}`);
  }

  // -------------------------------------------------- I. the working-hours WARNING
  const outOfHours = nextLocalHour(zone, 2, 3); // 02:00 local -- real emergency work, must not refuse
  const warned = await callable("rescheduleWorkOrderCallable", dispatcher, {
    workOrderId: subject.id, reason: "Scheduling Functional Gate -- after-hours emergency",
    scheduledStart: outOfHours, scheduledEnd: outOfHours + 2 * HOUR,
  });
  record(
    "I1 outside recorded working hours SUCCEEDS and warns",
    warned.ok && (warned.result.warnings ?? []).some((w) => w.code === "OUTSIDE_WORKING_HOURS"),
    warned.ok
      ? `warnings: ${(warned.result.warnings ?? []).map((w) => w.code).join(", ") || "none"}`
      : `refused ${warned.errorStatus}: ${warned.errorMessage}`,
  );

  // -------------------------------------------------- J. reassignment
  //
  // Onto a SECOND technician who also has recorded hours. Eligibility is a separate axis from
  // availability -- the sandbox's technicians without a recorded schedule turn out to be ineligible
  // as well, so reassigning onto one would refuse for the eligibility reason and prove nothing about
  // reassignment. Eligibility gets its own check below, where it is the thing being asked about.
  const secondEligible = recorded.find((t) => t.technicianId !== withHours.technicianId) ?? null;
  if (secondEligible) {
    const reassigned = await callable("reassignScheduledWorkOrderCallable", dispatcher, {
      workOrderId: subject.id, scheduledTechId: secondEligible.technicianId,
      reason: "Scheduling Functional Gate -- reassignment",
    });
    record(
      "J1 reassignment moves the technician and keeps the window",
      reassigned.ok
        && reassigned.result.scheduledTechId === secondEligible.technicianId
        && reassigned.result.scheduledStart === outOfHours,
      reassigned.ok ? `-> ${reassigned.result.scheduledTechId}` : `${reassigned.errorStatus}: ${reassigned.errorMessage}`,
    );
    const afterReassign = plain((await clientGetDoc(dispatcher, "fieldops_wos", subject.id)).body.fields ?? {});
    record("J2 reassignment does not change status", afterReassign.status === "SCHEDULED",
      `status is ${afterReassign.status}`);
    record("J3 the committed technician agrees with what the command returned",
      afterReassign.scheduledTechId === secondEligible.technicianId, `committed ${afterReassign.scheduledTechId}`);
  } else {
    blocked("J1 reassignment moves the technician and keeps the window", "only one technician has recorded hours");
  }

  // -------------------------------------------------- J4. ineligible technician
  if (withoutHours) {
    const ineligible = await callable("reassignScheduledWorkOrderCallable", dispatcher, {
      workOrderId: subject.id, scheduledTechId: withoutHours.technicianId,
      reason: "Scheduling Functional Gate -- eligibility probe",
    });
    // Either outcome is governed and both are truthful; what must NEVER happen is a silent success
    // that leaves the board showing a technician the engine would not place work on. A refusal is
    // recorded as a refusal, and an acceptance must carry the unrecorded-availability warning.
    const refusedForEligibility = !ineligible.ok;
    const acceptedWithWarning = ineligible.ok
      && (ineligible.result.warnings ?? []).some((w) => w.code === "NO_WORKING_AVAILABILITY_RECORDED");
    record(
      "J4 a technician with no recorded schedule either refuses as ineligible or warns -- never silently succeeds",
      refusedForEligibility || acceptedWithWarning,
      refusedForEligibility
        ? `refused ${ineligible.errorStatus}: ${String(ineligible.errorMessage).slice(0, 70)}`
        : `accepted with warnings: ${(ineligible.result?.warnings ?? []).map((w) => w.code).join(", ") || "NONE"}`,
    );
  } else {
    blocked("J4 an ineligible technician is refused", "every technician has a recorded schedule");
  }

  // -------------------------------------------------- K. authorization on the write commands
  const techWrite = await callable("rescheduleWorkOrderCallable", technician, {
    workOrderId: subject.id, reason: "Scheduling Functional Gate -- unauthorized probe",
    scheduledStart: inHours, scheduledEnd: inHours + HOUR,
  });
  record("K1 a technician may not reschedule",
    !techWrite.ok && techWrite.errorStatus === "PERMISSION_DENIED", `${techWrite.status} / ${techWrite.errorStatus}`);

  // -------------------------------------------------- L. reason gates
  const noReason = await callable("rescheduleWorkOrderCallable", dispatcher, {
    workOrderId: subject.id, scheduledStart: inHours, scheduledEnd: inHours + HOUR,
  });
  record("L1 reschedule without a reason is refused", !noReason.ok, `${noReason.errorStatus ?? noReason.status}`);

  // -------------------------------------------------- M. Unschedule, and MarkReady's exclusion
  const markReady = await callable("transitionWorkOrder", dispatcher, { workOrderId: subject.id, action: "MarkReady" });
  record("M1 MarkReady cannot stand in for Unschedule", !markReady.ok,
    `${markReady.errorStatus ?? markReady.status}: ${String(markReady.errorMessage).slice(0, 80)}`);

  const noUnscheduleReason = await callable("transitionWorkOrder", dispatcher, { workOrderId: subject.id, action: "Unschedule" });
  record("M2 Unschedule without a reason is refused", !noUnscheduleReason.ok,
    `${noUnscheduleReason.errorStatus ?? noUnscheduleReason.status}`);

  const unscheduled = await callable("transitionWorkOrder", dispatcher, {
    workOrderId: subject.id, action: "Unschedule",
    unscheduleReason: "Scheduling Functional Gate -- returning the borrowed Work Order to the queue",
  });
  record("M3 Unschedule returns the Work Order to the queue", unscheduled.ok,
    unscheduled.ok ? "committed" : `${unscheduled.errorStatus}: ${unscheduled.errorMessage}`);

  const final = plain((await clientGetDoc(dispatcher, "fieldops_wos", subject.id)).body.fields ?? {});
  record("M4 the committed status is READY_TO_DISPATCH", final.status === "READY_TO_DISPATCH", `status is ${final.status}`);
  record(
    "M5 Unschedule DELETES the scheduling fields rather than blanking them",
    final.scheduledTechId === undefined && final.scheduledStart === undefined,
    `scheduledTechId=${String(final.scheduledTechId)} scheduledStart=${String(final.scheduledStart)}`,
  );

  const unscheduleAgain = await callable("transitionWorkOrder", dispatcher, {
    workOrderId: subject.id, action: "Unschedule",
    unscheduleReason: "Scheduling Functional Gate -- a second Unschedule must refuse",
  });
  record("M6 Unschedule is offered from SCHEDULED only", !unscheduleAgain.ok,
    `${unscheduleAgain.errorStatus ?? unscheduleAgain.status}`);

  return finish(args);
}

function finish(args) {
  const failed = checks.filter((c) => !c.passed);
  const summary = {
    project: SANDBOX_PROJECT,
    ranAt: new Date().toISOString(),
    total: checks.length,
    passed: checks.length - failed.length,
    failed: failed.length,
    checks,
  };
  console.log(`\n${"=".repeat(72)}`);
  console.log(`SCHEDULING FUNCTIONAL GATE: ${failed.length === 0 ? "PASS" : "FAIL"} -- ${summary.passed}/${summary.total} checks`);
  if (failed.length) for (const f of failed) console.log(`  FAILED  ${f.id} -- ${f.detail}`);
  console.log("=".repeat(72));
  if (args.json) writeFileSync(args.json, JSON.stringify(summary, null, 2));
  process.exitCode = failed.length === 0 ? 0 : 1;
}

// Only an explicit `node scripts/schedulingFunctionalGate.mjs ...` runs the gate. Importing this
// module -- which the unit suite beside it does, to exercise the pure helpers -- must never sign a
// persona in or touch the sandbox.
const invokedDirectly = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href;
if (invokedDirectly) {
  main().catch((err) => { console.error(`\nGATE ABORTED: ${err.message}`); process.exit(2); });
}
