import "server-only";
import { TraceCollector } from "@/lib/catalog/trace";
import type { NormalizedProduct, SearchParams } from "@/lib/catalog/types";
import { extractModeIntent } from "./intent";
import { runPicksPipeline } from "./picks-pipeline";
import { runPlanPipeline } from "./plan-pipeline";
import { getMode } from "./registry";
import { routeMessage } from "./router";
import type {
  AgentFormFields,
  AgentResponse,
  BaseIntent,
  Blueprint,
  ConversationTurn,
  Pick,
  PlanResult,
  ShoppingModeId,
} from "./types";

/**
 * Strip any sentence that matches a mode's blocked-claim patterns (e.g.
 * diagnose/cure/guarantee) from generated copy — the enforcement half of a
 * mode's safety policy. Never lets the copy go empty.
 */
function sanitizeSentences(text: string, patterns: RegExp[]): string {
  const kept = text
    .split(/(?<=[.!?])\s+/)
    .filter((s) => !patterns.some((p) => p.test(s)));
  const out = kept.join(" ").trim();
  return out.length > 0 ? out : "Chosen from catalog data for this step.";
}

function sanitizePick(pick: Pick, patterns: RegExp[]): Pick {
  return {
    ...pick,
    reasons: pick.reasons.map((r) => sanitizeSentences(r, patterns)),
    tradeoff: sanitizeSentences(pick.tradeoff, patterns),
  };
}

function sanitizePlan(plan: PlanResult, patterns: RegExp[]): PlanResult {
  return {
    ...plan,
    components: plan.components.map((c) => ({
      ...c,
      label: sanitizeSentences(c.label, patterns),
      why: sanitizeSentences(c.why, patterns),
      primary: c.primary ? sanitizePick(c.primary, patterns) : null,
      alternatives: c.alternatives.map((a) => sanitizePick(a, patterns)),
    })),
  };
}

/** Sanitize the blueprint copy (label/why/note) shown at approval and echoed with the plan. */
function sanitizeBlueprint(blueprint: Blueprint, patterns: RegExp[]): Blueprint {
  return {
    components: blueprint.components.map((c) => ({
      ...c,
      label: sanitizeSentences(c.label, patterns),
      why: sanitizeSentences(c.why, patterns),
    })),
    note: blueprint.note ? sanitizeSentences(blueprint.note, patterns) : null,
  };
}

/**
 * Enforce a mode's opt-in policy (e.g. supplements): drop opt-in components
 * unless the shopper's own words asked for them. This is the code backstop for
 * `safety.requireOptIn` — advisory prompts aren't enough.
 */
function gateOptIn(blueprint: Blueprint, intent: BaseIntent, requireOptIn?: string[]): Blueprint {
  if (!requireOptIn || requireOptIn.length === 0) return blueprint;
  // Consent must come from POSITIVE signals only — hardConstraints/exclusions
  // carry negatives ("no supplements"), and counting them as consent would keep
  // exactly the category the shopper declined.
  const asked = [
    intent.occasion ?? "",
    ...intent.interests,
    ...intent.softPreferences,
    ...intent.searchThemes,
  ]
    .join(" ")
    .toLowerCase();
  if (requireOptIn.some((t) => asked.includes(t.toLowerCase()))) return blueprint;
  const isOptIn = (c: { key: string; label: string; query: string }) =>
    requireOptIn.some((t) =>
      `${c.key} ${c.label} ${c.query}`.toLowerCase().includes(t.toLowerCase()),
    );
  return { ...blueprint, components: blueprint.components.filter((c) => !isOptIn(c)) };
}

/** Apply opt-in gating + blocked-claim sanitization to a blueprint for a mode. */
function prepareBlueprint(
  blueprint: Blueprint,
  intent: BaseIntent,
  requireOptIn: string[] | undefined,
  patterns: RegExp[] | undefined,
): Blueprint {
  let bp = gateOptIn(blueprint, intent, requireOptIn);
  if (patterns) bp = sanitizeBlueprint(bp, patterns);
  return bp;
}

/**
 * The single agent. Routes a conversation to a lens, extracts its intent, and
 * dispatches to the picks pipeline (Gift, Swap) or the plan pipeline (the other
 * eight) — with a clarification gate and, for plan modes, a blueprint-approval
 * gate before any catalog search.
 */

export interface RunAgentInput {
  conversation: ConversationTurn[];
  form?: AgentFormFields;
  /** Explicit lens override (user tapped a mode in the picker). */
  modeId?: ShoppingModeId;
  clarificationCount?: number;
  /** Plan modes: the user approved the blueprint. */
  approved?: boolean;
  /** Plan modes: the (possibly edited) blueprint to run. */
  blueprint?: Blueprint;
  /** Similarity seed (swap product id / inspiration image). */
  like?: SearchParams["like"];
}

export async function runAgent(input: RunAgentInput): Promise<AgentResponse> {
  const trace = new TraceCollector();

  // 1. Route (unless the lens is pinned).
  let modeId = input.modeId;
  let routeConfidence = 1;
  if (!modeId) {
    const routed = await routeMessage(input.conversation);
    modeId = routed.modeId;
    routeConfidence = routed.confidence;
    trace.add({
      tool: "ai",
      label: `Routed to ${routed.modeId} (${routed.aiMode}, conf ${routed.confidence.toFixed(2)})`,
      detail: "",
      durationMs: 0,
      source: "live",
      ok: true,
    });
  }

  const mode = await getMode(modeId);

  // 2. Extract intent + project to base.
  const { intent, aiMode: extractMode } = await extractModeIntent(mode, input.conversation, input.form);
  const base = mode.toBaseIntent(intent);
  const disclaimer = mode.safety?.disclaimer ?? null;
  const gateMessage = mode.safety?.gate?.(base) ?? null;
  const blockedPatterns = mode.safety?.blockedClaimPatterns;
  const extraConstraint = mode.extraConstraints
    ? (p: NormalizedProduct) => mode.extraConstraints!(p, intent)
    : undefined;
  const noun = mode.noun ?? mode.meta.short.toLowerCase();

  // 3. Clarification gate — never intercept an approved plan run (the shopper
  //    has committed to a concrete blueprint; clarifying now would drop it).
  if (
    base.clarificationNeeded &&
    base.clarificationQuestion &&
    (input.clarificationCount ?? 0) < mode.clarifyMax &&
    !(input.approved && input.blueprint)
  ) {
    const common = {
      ok: true as const,
      modeId,
      routeConfidence,
      aiMode: extractMode,
      source: "live" as const,
      trace: trace.list(),
      disclaimer,
      assistantMessage: gateMessage,
    };
    return mode.meta.resultKind === "picks"
      ? { ...common, resultKind: "picks", stage: "clarification", clarificationQuestion: base.clarificationQuestion, recommendations: [] }
      : { ...common, resultKind: "plan", stage: "clarification", clarificationQuestion: base.clarificationQuestion };
  }

  // 4a. Picks modes.
  if (mode.meta.resultKind === "picks") {
    const strategies = mode.planStrategies
      ? mode.planStrategies(intent).strategies
      : [{ query: base.searchThemes[0] ?? base.occasion ?? mode.meta.short }];
    const broadenQuery =
      [base.searchThemes[0] ?? base.interests[0] ?? "", base.occasion ?? ""]
        .filter(Boolean)
        .join(" ") || undefined;
    const result = await runPicksPipeline({
      intent: base,
      plan: { strategies, aiMode: "heuristic" },
      trace,
      like: input.like,
      persona: mode.persona,
      noun,
      extraConstraint,
      broadenQuery,
    });
    return {
      ok: true,
      resultKind: "picks",
      stage: "recommendations",
      modeId,
      routeConfidence,
      aiMode: result.aiMode === "ai" || extractMode === "ai" ? "ai" : "heuristic",
      source: result.source,
      recommendations: blockedPatterns
        ? result.recommendations.map((r) => sanitizePick(r, blockedPatterns))
        : result.recommendations,
      limitation: result.limitation,
      trace: trace.list(),
      disclaimer,
      assistantMessage: gateMessage,
    };
  }

  // 4b. Plan modes.
  if (!mode.buildBlueprint) {
    throw new Error(`Mode "${modeId}" is a plan mode but has no blueprint builder.`);
  }

  const requireOptIn = mode.safety?.requireOptIn;

  // Approval gate — show the blueprint before searching. The gate is skipped
  // ONLY when the client submits a concrete approved blueprint; a bare
  // `approved:true` cannot bypass it (defense against a stale/forged flag).
  if (mode.meta.requiresApproval && !(input.approved && input.blueprint)) {
    const { blueprint: built, aiMode: bpMode } = await mode.buildBlueprint(intent);
    const blueprint = prepareBlueprint(built, base, requireOptIn, blockedPatterns);
    return {
      ok: true,
      resultKind: "plan",
      stage: "plan_approval",
      modeId,
      routeConfidence,
      aiMode: bpMode === "ai" || extractMode === "ai" ? "ai" : "heuristic",
      source: "live",
      blueprint,
      trace: trace.list(),
      disclaimer,
      assistantMessage: gateMessage,
    };
  }

  const built = input.blueprint ?? (await mode.buildBlueprint(intent)).blueprint;
  const blueprint = prepareBlueprint(built, base, requireOptIn, blockedPatterns);
  const planResult = await runPlanPipeline({
    intent: base,
    blueprint,
    trace,
    persona: mode.persona,
    noun,
    extraConstraint,
  });
  return {
    ok: true,
    resultKind: "plan",
    stage: "plan",
    modeId,
    routeConfidence,
    aiMode: planResult.aiMode === "ai" || extractMode === "ai" ? "ai" : "heuristic",
    source: planResult.source,
    plan: blockedPatterns ? sanitizePlan(planResult.plan, blockedPatterns) : planResult.plan,
    blueprint,
    trace: trace.list(),
    disclaimer,
    assistantMessage: gateMessage,
  };
}
