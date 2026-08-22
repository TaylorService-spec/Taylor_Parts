// GOVERNED TOOL REGISTRY. Every read the assistant can perform, and what it costs in authority.
//
// ============================ NO PARALLEL DATA AUTHORITY ============================
//
// A tool is a THIN WRAPPER over an existing trusted EOS read. It must not query Firestore directly,
// must not assemble its own projection, and must not exist at all unless a truthful governed read
// path already does.
//
// The temptation is obvious and is refused: the assistant would be more useful with a few more
// facts, the trusted read for those facts does not exist yet, and writing "just a small query" here
// is five minutes' work. That query would be a second, unreviewed authority model for the same
// business object -- exactly the thing this repository has spent its whole governance program
// eliminating, reintroduced under a friendlier name.
//
// WHEN NO TRUSTED READ EXISTS, RECORD A GAP. A missing tool makes the assistant less capable. An
// invented one makes the authority model fictional.
//
// V1 IS READ-ONLY. There is no mutation seam here at all -- not a disabled one, not a flagged one.
// A registry with a `write` field is a registry one boolean away from conversational mutation.
import type { PermissionId } from "../types/access";
import type { AssistantSurface } from "./assistantContext";
import type { AuthorizableTool } from "./assistantAuthorization";

export interface AssistantToolResult {
  readonly toolId: string;
  /** Shaped for a model: human identifiers, no raw ids where a business number exists. */
  readonly data: unknown;
  /** Business records touched, for the audit trail. */
  readonly recordsAccessed: readonly { readonly type: string; readonly id: string }[];
}

export interface AssistantToolExecutionInput {
  readonly companyId: string;
  readonly actorUid: string;
  readonly record: { readonly type: AssistantSurface; readonly id: string } | null;
}

export interface AssistantTool extends AuthorizableTool {
  readonly surfaces: readonly AssistantSurface[];
  readonly description: string;
  /**
   * Executes the underlying TRUSTED read.
   *
   * Never called unless authorizeTool returned ALLOW. That ordering is enforced by the gateway and
   * asserted by tests, not by a check inside each implementation -- a per-tool check would be one
   * forgotten `if` away from a leak, and there is no way to notice the omission.
   */
  execute(input: AssistantToolExecutionInput): Promise<AssistantToolResult>;
}

/** A domain the assistant should serve but cannot yet, because no trusted read exists. */
export interface AssistantToolGap {
  readonly intendedToolId: string;
  readonly surfaces: readonly AssistantSurface[];
  readonly whatUsersWouldAsk: string;
  readonly blockedBy: string;
}

export class AssistantToolRegistry {
  private readonly tools = new Map<string, AssistantTool>();
  private readonly gaps: AssistantToolGap[] = [];

  register(tool: AssistantTool): void {
    if (this.tools.has(tool.id)) throw new Error(`duplicate assistant tool id: ${tool.id}`);
    if (tool.requires.length === 0) {
      // A tool requiring nothing is a public read, and there are none here -- every EOS business
      // object is governed. An empty requirement is far more likely to be an omission than a
      // deliberate design, and the cost of being wrong is unauthorized data reaching a model.
      throw new Error(`assistant tool "${tool.id}" declares no required capability; refusing to register`);
    }
    this.tools.set(tool.id, tool);
  }

  recordGap(gap: AssistantToolGap): void {
    this.gaps.push(gap);
  }

  get(toolId: string): AssistantTool | undefined {
    return this.tools.get(toolId);
  }

  /** Tools plausibly useful on a surface. Selection is NOT authorization. */
  forSurface(surface: AssistantSurface): readonly AssistantTool[] {
    return [...this.tools.values()].filter((t) => t.surfaces.includes(surface));
  }

  all(): readonly AssistantTool[] {
    return [...this.tools.values()];
  }

  recordedGaps(): readonly AssistantToolGap[] {
    return [...this.gaps];
  }

  /** Every capability any registered tool can require. Used by tests and the usage report. */
  requiredCapabilities(): ReadonlySet<PermissionId> {
    const out = new Set<PermissionId>();
    for (const t of this.tools.values()) for (const p of t.requires) out.add(p);
    return out;
  }
}
