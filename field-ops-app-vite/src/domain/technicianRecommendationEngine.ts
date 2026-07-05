// Epic 2 Phase 2C -- Technician Recommendation Engine v1 (TRE-v1).
// Implements docs/architecture/ADR-004-technician-recommendation-engine.md
// ("v1 Realistic"). Pure, deterministic, UI-side only -- no Firestore
// calls, no persistence, not cached, no hooks, no async, no
// Math.random()/Date.now()-based logic. Uses ONLY data already loaded
// by useWorkOrders()/useFirestoreCollection(TECHNICIANS_COLLECTION);
// never fetches anything itself.
//
// This is decision SUPPORT, not decision enforcement (ADR-004 section
// 13): nothing here ever writes fieldops_wos, calls
// transitionWorkOrder(), or blocks a dispatcher from assigning any
// technician regardless of score.
import type { WorkOrder } from "../types/workOrder";

export interface Technician {
  id: string;
  name: string;
  phone?: string;
  status: string; // TECH_STATUS: available/on_job/off_shift
}

export interface RecommendationBreakdown {
  workload: number;
  experienceAffinity: number;
  availability: number;
  territoryMatch: number;
}

export interface RecommendedTechnician {
  techId: string;
  score: number; // 0-100
  rank: number;
  breakdown: RecommendationBreakdown;
  reasons: string[];
}

const WEIGHTS = {
  workload: 0.4,
  experienceAffinity: 0.25,
  availability: 0.2,
  territoryMatch: 0.15,
};

const TERMINAL_STATUSES = new Set(["COMPLETED", "CLOSED", "CANCELLED"]);

// Precomputed once per (technicians, workOrders) pair -- O(technicians
// + workOrders) -- then reused for every Work Order being scored, so
// scoring N work orders against M technicians is O(N * M) instead of
// O(N * M * N). Matters at the scale this epic's own test plan calls
// for (500 work orders / 30 technicians): the naive per-call approach
// (each call re-scanning the full workOrders array per technician) was
// O(WOs^2 * techs) when run once per queue card, ~7.5M operations for
// 500 WOs -- this precompute makes it ~15K + 15K, several orders of
// magnitude less redone work, recomputed on every Firestore snapshot
// exactly like before.
interface TechnicianAggregates {
  activeCount: number;
  countByType: Map<string, number>;
}

function computeAggregates(technicians: Technician[], workOrders: WorkOrder[]): Map<string, TechnicianAggregates> {
  const byTech = new Map<string, TechnicianAggregates>();
  for (const tech of technicians) {
    byTech.set(tech.id, { activeCount: 0, countByType: new Map() });
  }

  for (const wo of workOrders) {
    if (!wo.assignedTechId) continue;
    const agg = byTech.get(wo.assignedTechId);
    if (!agg) continue; // assigned to a technician not in the current technicians list (e.g. deactivated)

    if (!TERMINAL_STATUSES.has(wo.status)) agg.activeCount += 1;
    agg.countByType.set(wo.type, (agg.countByType.get(wo.type) ?? 0) + 1);
  }

  return byTech;
}

// A. Workload (40%) -- fewer active WOs = higher score. Normalized
// against whichever technician currently has the most active WOs (not
// an absolute scale, since there's no fixed "max capacity" field
// anywhere in the technician schema -- name/phone/status only, see
// ADR-004 section 5.2). If every technician has 0 active WOs, everyone
// scores 100 (nobody is loaded, so nobody is penalized).
function scoreWorkload(techId: string, aggregates: Map<string, TechnicianAggregates>): number {
  const counts = [...aggregates.values()].map((a) => a.activeCount);
  const max = Math.max(1, ...counts);
  const mine = aggregates.get(techId)?.activeCount ?? 0;
  return Math.round(100 * (1 - mine / max));
}

// B. Assignment frequency / experience affinity (25%) -- how often
// this technician has handled a Work Order of the same `type`
// (SERVICE_CALL/PM/INSTALL/WARRANTY/INSPECTION -- a job-category enum,
// not a dedicated "equipment type" field; see ADR-004's numbering
// note). Approximate proxy, exactly as ADR-004 frames it. Counts
// across ALL statuses (including active), since "has handled this
// type before" is about familiarity, not current load -- that's
// Workload's job. Normalized against whichever technician has the
// most matching-type history; if nobody has any, everyone scores 0
// (no favoritism from an empty signal).
function scoreExperienceAffinity(techId: string, targetType: string, aggregates: Map<string, TechnicianAggregates>): number {
  const countFor = (id: string) => aggregates.get(id)?.countByType.get(targetType) ?? 0;
  const counts = [...aggregates.keys()].map(countFor);
  const max = Math.max(0, ...counts);
  if (max === 0) return 0;
  return Math.round(100 * (countFor(techId) / max));
}

// C. Availability (20%) -- deliberately NOT a second read of active WO
// count (that would just duplicate Workload under a different name).
// Uses the technician's own TECH_STATUS field instead (available/
// on_job/off_shift) -- a real, existing field that's literally what
// "availability" means, distinct from *how much* work they're
// carrying. Documented deviation from ADR-004's literal "derived from
// active work order count" wording, made because TECH_STATUS already
// exists and using it avoids a redundant factor computing the same
// number twice under two names.
const AVAILABILITY_BY_STATUS: Record<string, number> = {
  available: 100,
  on_job: 50,
  off_shift: 0,
};

function scoreAvailability(status: string): number {
  return AVAILABILITY_BY_STATUS[status] ?? 50;
}

// D. Territory match (15%) -- ADR-004 section 6.1.D: "ONLY if Work
// Order contains location/region fields." WorkOrder.locationId exists
// (an opaque string id, not a region/territory), but technician docs
// have NO comparable field at all (name/phone/status only -- verified
// against domain/jobActions.js's createTechnician()). There is
// currently NO way to compute a real territory match. Per ADR-004
// section 12's "system degrades gracefully when data is missing"
// acceptance criterion, this returns a flat neutral score for every
// technician (no data => no distinguishing signal, not a penalty)
// rather than erroring or arbitrarily favoring anyone.
function scoreTerritoryMatch(): number {
  return 50;
}

function buildReasons(breakdown: RecommendationBreakdown): string[] {
  const reasons: string[] = [];
  const pts = (weight: number, score: number) => Math.round(weight * score);

  if (breakdown.workload >= 70) reasons.push(`Low current workload (+${pts(WEIGHTS.workload, breakdown.workload)} pts)`);
  else if (breakdown.workload <= 30) reasons.push(`Heavier current workload (+${pts(WEIGHTS.workload, breakdown.workload)} pts)`);
  else reasons.push(`Moderate current workload (+${pts(WEIGHTS.workload, breakdown.workload)} pts)`);

  if (breakdown.experienceAffinity > 0) {
    reasons.push(`Has handled similar Work Orders before (+${pts(WEIGHTS.experienceAffinity, breakdown.experienceAffinity)} pts)`);
  } else {
    reasons.push("No prior history with this Work Order type (+0 pts)");
  }

  if (breakdown.availability === 100) reasons.push(`Currently available (+${pts(WEIGHTS.availability, breakdown.availability)} pts)`);
  else if (breakdown.availability === 0) reasons.push("Currently off shift (+0 pts)");
  else reasons.push(`Currently on a job (+${pts(WEIGHTS.availability, breakdown.availability)} pts)`);

  reasons.push("Territory match: no location data available for technicians (neutral, +0 pts vs. others)");

  return reasons;
}

function scoreAllTechnicians(
  workOrder: WorkOrder,
  technicians: Technician[],
  aggregates: Map<string, TechnicianAggregates>
): RecommendedTechnician[] {
  const scored = technicians.map((tech) => {
    const breakdown: RecommendationBreakdown = {
      workload: scoreWorkload(tech.id, aggregates),
      experienceAffinity: scoreExperienceAffinity(tech.id, workOrder.type, aggregates),
      availability: scoreAvailability(tech.status),
      territoryMatch: scoreTerritoryMatch(),
    };

    const score = Math.round(
      WEIGHTS.workload * breakdown.workload +
        WEIGHTS.experienceAffinity * breakdown.experienceAffinity +
        WEIGHTS.availability * breakdown.availability +
        WEIGHTS.territoryMatch * breakdown.territoryMatch
    );

    return { techId: tech.id, score, breakdown, reasons: buildReasons(breakdown) };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.map((entry, index) => ({ ...entry, rank: index + 1 }));
}

// The original single-Work-Order entry point. Deterministic: same
// inputs always produce the same output. Fine for one-off calls (e.g.
// a single WorkOrderDetail-style preview); for scoring many work
// orders against the same technician list in one pass, use
// recommendTechniciansBatch() below instead -- it avoids recomputing
// the same technician aggregates once per work order.
export function recommendTechnicians(
  workOrder: WorkOrder,
  technicians: Technician[],
  workOrders: WorkOrder[]
): RecommendedTechnician[] {
  const aggregates = computeAggregates(technicians, workOrders);
  return scoreAllTechnicians(workOrder, technicians, aggregates);
}

// Batch variant: scores every work order in `workOrdersToScore`
// against the same technician list, computing technician aggregates
// exactly once. Used by DispatcherBoard.jsx, which needs a
// recommendation set for every card in the queue, not just the
// selected one.
export function recommendTechniciansBatch(
  workOrdersToScore: WorkOrder[],
  technicians: Technician[],
  allWorkOrders: WorkOrder[]
): Map<string, RecommendedTechnician[]> {
  const aggregates = computeAggregates(technicians, allWorkOrders);
  const result = new Map<string, RecommendedTechnician[]>();
  for (const wo of workOrdersToScore) {
    result.set(wo.id, scoreAllTechnicians(wo, technicians, aggregates));
  }
  return result;
}
