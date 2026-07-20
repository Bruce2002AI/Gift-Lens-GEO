import "server-only";
import { aiAvailable, structuredCompletion, visionAvailable } from "@/lib/ai/client";
import { TraceCollector } from "@/lib/catalog/trace";
import { isValidCurrencyCode, majorToMinor } from "@/lib/gift/currency";
import { logger } from "@/lib/logger";
import {
  applyFactPatches,
  applyOp,
  detectAndMergeCareFlags,
  ledgerView,
  mergeCareFlags,
  recordConsent,
} from "./ledger";
import { CHARTERS, SHARED_CONTRACT } from "./personas";
import { careFlagDef, EDUCATIONAL_FRAMING, lintOutbound, sniffSupplementConsent } from "./safety";
import { composeFallbackPresentation, runInstantSimilar, topUpBoard } from "./board";
import {
  runGetProducts,
  runSearches,
  resolveProductId,
  runVisionSearches,
  verifyBoardItems,
  type Emit,
} from "./tools";
import { verifyPresentation } from "./truth";
import { analyzeImageForLens, analyzeUploadedOutfit, describeImageRead, describeOutfitRead } from "./vision";
import {
  ActionSchema,
  type AgentAction,
  type AgentSession,
  type ExpertLensId,
  type ExpertRequest,
} from "./types";

/**
 * The Expert Loop (docs/AI-EXPERIENCE-REDESIGN.md §3): per user message, the
 * model chooses one action at a time — say / ask / search / inspect / record /
 * propose / present — until it reaches a terminal action or a code budget.
 * Code enforces truth, care, consent, and spend; it never scripts the flow.
 */

const MAX_ACTIONS = 14;
const MAX_SEARCH_ACTIONS = 6;
const MAX_INVALID_STREAK = 2;
/** Generous: an image-analysis turn spends 15-25s looking before it can shop. */
const MAX_WALL_MS = 175_000;
/** Whole-session question budget: the agent shows products and narrows, it doesn't interview. */
const MAX_QUESTIONS = 4;

// ---------------------------------------------------------------------------
// Soft lens routing (bias hint only — the loop handles hybrids in voice)
// ---------------------------------------------------------------------------

export function routeLens(text: string): ExpertLensId {
  const t = text.toLowerCase();
  if (/\b(skin|acne|serum|cleanser|moisturi[sz]er|spf|sunscreen|routine|breakout|complexion)\b/.test(t)) return "skincare";
  if (/\b(protein|supplement|diet|nutrition|meal|creatine|vitamin|tired all the time|energy crash)\b/.test(t)) return "nutrition";
  if (/\b(outfit|wear|dress|wardrobe|style me|stylist|look for (a|the)|jeans|blazer|saree|kurta)\b/.test(t)) return "style";
  return "gift";
}

// ---------------------------------------------------------------------------
// Deterministic budget sniff — backstop so a stated budget is never unenforced
// ---------------------------------------------------------------------------

const CURRENCY_HINTS: Array<[RegExp, string]> = [
  [/₹|\brs\.?\b|\binr\b|\brupees?\b/i, "INR"],
  [/\$|\busd\b|\bdollars?\b/i, "USD"],
  [/€|\beur\b|\beuros?\b/i, "EUR"],
  [/£|\bgbp\b|\bpounds?\b/i, "GBP"],
];

export function sniffBudget(text: string): { maxMajor: number; currency: string | null } | null {
  const m =
    text.match(/(?:under|below|within|max(?:imum)?|budget(?:\s+of|:|\s+is)?|up\s?to)\s*(?:₹|rs\.?|inr|\$|usd|€|£)?\s*([\d][\d,]*(?:\.\d+)?)/i) ??
    text.match(/(?:₹|rs\.?\s|\$|€|£)\s*([\d][\d,]*(?:\.\d+)?)/i);
  if (!m) return null;
  const major = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(major) || major <= 0) return null;
  const hint = CURRENCY_HINTS.find(([p]) => p.test(text));
  return { maxMajor: major, currency: hint ? hint[1] : null };
}

function applyConstraintPatch(
  session: AgentSession,
  patch: NonNullable<AgentAction["constraints"]>,
): void {
  const c = session.ledger.constraints;
  if (patch.currency && isValidCurrencyCode(patch.currency.toUpperCase())) {
    c.currency = patch.currency.toUpperCase();
  }
  if (patch.budgetMaxMajor != null && patch.budgetMaxMajor > 0) {
    c.budgetMaxMinor = majorToMinor(patch.budgetMaxMajor, c.currency);
  }
  if (patch.budgetMinMajor != null && patch.budgetMinMajor > 0) {
    c.budgetMinMinor = majorToMinor(patch.budgetMinMajor, c.currency);
  }
  if (patch.country) {
    const raw = patch.country.trim();
    const map: Record<string, string> = {
      india: "IN", "united states": "US", usa: "US", "united kingdom": "GB", uk: "GB",
    };
    c.country = map[raw.toLowerCase()] ?? (raw.length === 2 ? raw.toUpperCase() : c.country);
  }
  if (patch.deadline != null) c.deadline = patch.deadline;
  for (const term of patch.exclusionsAdd ?? []) {
    const t = term.trim().toLowerCase();
    if (t && !c.exclusions.includes(t)) c.exclusions.push(t);
  }
}

// ---------------------------------------------------------------------------
// State rendering
// ---------------------------------------------------------------------------

/**
 * Stock openers the model reaches for when it's being stiff. Catching them in
 * code and forcing one rewrite does far more for the voice than a prompt line
 * the model skims past.
 */
const FORMULAIC_OPENER =
  /^\s*(?:[*_#>\s-]*)?(i hear (?:you|that)|i understand (?:you|that|your)|the biggest lever|great choice|got it|i'?m glad you|i'?m happy to|sounds like you|i can (?:hear|see) (?:you|that|how)|absolutely|of course|thanks for (?:sharing|reaching))(?![a-z])/i;

function looksFormulaicOpener(text: string): boolean {
  return FORMULAIC_OPENER.test(text);
}

/** Markdown structure markers: a bullet/numbered line, a blockquote, or bold. */
const HAS_STRUCTURE = /\n\s*[-*+]\s|\n\s*\d+[.)]\s|\n\s*>|\*\*/;

/**
 * A long piece of counsel dumped as one grey paragraph reads worse than the
 * same advice as a scannable list. If a substantial say has no structure at
 * all, push once for a reformat (short replies are left as prose).
 */
function looksUnstructured(text: string): boolean {
  return text.length >= 320 && !HAS_STRUCTURE.test(text);
}

/** Cheap token-set similarity to catch the model re-saying the same thing. */
function saySimilarity(a: string, b: string): number {
  const tok = (s: string) => new Set(s.toLowerCase().split(/\W+/).filter((w) => w.length > 3));
  const ta = tok(a);
  const tb = tok(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let overlap = 0;
  for (const w of ta) if (tb.has(w)) overlap += 1;
  return overlap / Math.min(ta.size, tb.size);
}

function renderState(
  session: AgentSession,
  observations: string[],
  budgets: { actionsLeft: number; searchesLeft: number; spokeThisTurn: boolean; urgent: boolean },
): string {
  const { ledger } = session;
  const lines: string[] = [];
  lines.push(`TURN ${session.turn} — ACTIONS LEFT: ${budgets.actionsLeft}, SEARCH ACTIONS LEFT: ${budgets.searchesLeft}. Converge before the budget runs out.`);
  if (budgets.urgent) {
    lines.push(
      session.evidence.size > 0
        ? `>>> TIME IS ALMOST UP. Your NEXT action MUST be \`present\` using the products you have already verified. Do not search or inspect again. An honest partial answer now beats a perfect one that never arrives.`
        : `>>> TIME IS ALMOST UP and nothing is verified yet. Your NEXT action must be \`ask_user\` or \`present\` with an honest note about what you couldn't find.`,
    );
  }

  const questionsLeft = MAX_QUESTIONS - session.questionCount;
  lines.push(
    questionsLeft > 0
      ? `QUESTION BUDGET: ${questionsLeft} of ${MAX_QUESTIONS} left for the WHOLE conversation. Spend them only where the answer changes the picks — and prefer attaching them to a presentation as followUp so the shopper sees products while they answer.`
      : `QUESTION BUDGET: EXHAUSTED. Do NOT ask anything else — no ask_user, no followUp. Present your best picks, list your assumptions, and let the shopper steer.`,
  );
  if (session.candidates.size > 0) {
    lines.push(
      `You have ${session.candidates.size} candidate product(s) in hand and ${session.evidence.size} verified. SHOW THEM: end this turn with \`present\` (attach any question as presentation.followUp) rather than a bare question.`,
    );
    if (session.evidence.size < 3) {
      lines.push(
        `Only ${session.evidence.size} product(s) are verified — batch-inspect 4-6 promising candidates in ONE get_product call (productIds:[...]) so you can offer a real choice, not a single pick.`,
      );
    }
  } else if (session.turn === 1) {
    lines.push(
      `You have no candidates yet. OPEN WITH REAL COUNSEL (doctrine 1): one \`say\` of natural expert prose that FOLLOWS YOUR LENS CHARTER — read their situation, teach what matters, set honest expectations if their ask implies a promise you can't keep, and say in plain words what you'll look for. Do NOT print a bulleted list of raw search phrases, and do NOT reuse fixed section labels — vary the shape to this person. If your charter says investigate the cause first (skincare/nutrition), investigate and offer only a couple of gentle starting points. THEN run your searches (internally) in one search_catalog call and present provisional picks with your assumptions — never open with a bare question.`,
    );
  }

  lines.push("", "CONVERSATION (latest last):");
  for (const t of session.transcript.slice(-12)) {
    lines.push(`${t.role === "user" ? "USER" : "YOU"}: ${t.content.slice(0, 500)}`);
  }

  lines.push("", "LEDGER FACTS:");
  if (ledger.facts.length === 0) lines.push("(none yet — record what you learn)");
  for (const f of ledger.facts) {
    lines.push(`${f.id} [${f.provenance}] ${f.key} = "${f.value}"${f.quote ? ` (their words: "${f.quote}")` : ""}`);
  }

  const c = ledger.constraints;
  lines.push(
    "",
    `CONSTRAINTS: budget ${c.budgetMaxMinor != null ? `max ${c.budgetMaxMinor} minor units ${c.currency}` : "unstated"}${c.budgetMinMinor != null ? `, min ${c.budgetMinMinor}` : ""}; country ${c.country ?? "unstated"}; deadline ${c.deadline ?? "none"}; exclusions: ${c.exclusions.join(", ") || "none"}`,
  );

  if (ledger.careFlags.length > 0) {
    lines.push("", "CARE FLAGS ACTIVE (sticky):");
    for (const f of ledger.careFlags) {
      lines.push(`- ${f.kind} (${f.label}) — triggered by "${f.matchedText}"`);
      if (f.lastCaredTurn == null && !budgets.spokeThisTurn) {
        lines.push(`  CARE DIRECTIVE: acknowledge this warmly in your own fresh words THIS TURN (once — do not repeat yourself), with professional referral where it applies, then move on to helping.`);
      }
    }
  }

  if (ledger.consents.length > 0) {
    lines.push("", "CONSENTS: " + ledger.consents.map((x) => `${x.category}${x.revoked ? " (REVOKED — respect this)" : ` (their words: "${x.quote}")`}`).join("; "));
  }

  if (session.uploadedImage) {
    lines.push("", "UPLOADED IMAGE: yes. You have NOT seen it and cannot see it. The catalog can match visually similar items (search with useUploadedImage:true) — describe that honestly.");
  }

  const candidates = [...session.candidates.values()].slice(-30);
  if (candidates.length > 0) {
    lines.push("", "CANDIDATES from your searches (id | title | price | category):");
    for (const line of candidates) lines.push(`  ${line}`);
  }

  const evidence = [...session.evidence.values()].slice(-8);
  if (evidence.length > 0) {
    lines.push("", "VERIFIED EVIDENCE (you may only present these products; claims must quote a snippet verbatim, citing its field):");
    for (const e of evidence) {
      lines.push(`- ${e.product.id}: "${e.product.title}"`);
      for (const s of e.snippets.slice(0, 8)) lines.push(`    [${s.field}] "${s.text}"`);
    }
  }

  if (observations.length > 0) {
    lines.push("", "THIS TURN SO FAR:");
    for (const o of observations) lines.push(o);
  }

  lines.push("", "Choose your next action. Reply with EXACTLY ONE action JSON object.");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// The turn runner
// ---------------------------------------------------------------------------

export async function runExpertTurn(
  session: AgentSession,
  input: Pick<ExpertRequest, "message" | "op" | "imageDataUrl">,
  emit: Emit,
  aborted?: () => boolean,
): Promise<void> {
  const startedAt = Date.now();
  const trace = new TraceCollector();
  const charter = CHARTERS[session.lens];
  const system = `${SHARED_CONTRACT}\n\nYOUR LENS CHARTER — ${charter.name}:\n${charter.charter}`;
  session.turn += 1;

  const observations: string[] = [];
  // Set when a photo is genuinely analysed this turn — the model must then TELL
  // the shopper what it saw before it presents (the multimodal payoff).
  let imageAnalyzed = false;

  const pendingCare = () => session.ledger.careFlags.filter((f) => f.lastCaredTurn == null);
  const dischargeCare = () => {
    for (const flag of pendingCare()) {
      const def = careFlagDef(flag.kind);
      emit({
        type: "care",
        text: def?.canonical ?? `This touches on ${flag.label} — a professional's guidance matters more than any product here.`,
        flags: [flag.label],
      });
      flag.lastCaredTurn = session.turn;
    }
  };
  const discloseMock = () => {
    if (session.sawMock && !session.mockAnnounced) {
      session.mockAnnounced = true;
      emit({
        type: "notice",
        tone: "mock",
        text: "Heads up: this session is running on demo catalog data, not live listings.",
      });
    }
  };
  /**
   * A turn that can't finish cleanly should still hand over any products it
   * found, not a dead end. If nothing is verified yet but there are candidates
   * from searches, inspect a batch so there's something real to show; then
   * present a code-built board from the evidence (terminal "present"). Only when
   * there's genuinely nothing to show do we emit the honest degraded notice.
   */
  const degradeOrPresent = async (degradedText: string): Promise<void> => {
    if (aborted?.()) return;
    // Inspect a batch of not-yet-verified candidates so the fallback can draw
    // from EVERYTHING we found (veg / carbs / fats), not just the handful the
    // model happened to inspect (which may all have been screened out).
    const fresh = [...session.candidates.keys()]
      .filter((id) => !session.evidence.has(id))
      .slice(0, 14);
    if (fresh.length > 0) {
      await verifyBoardItems(session, fresh, trace, emit);
      if (aborted?.()) return;
    }
    const fallback = composeFallbackPresentation(session);
    if (fallback) {
      for (const cat of fallback.board) {
        for (const item of cat.items) session.boardedIds.add(item.productId);
      }
      dischargeCare();
      emit({ type: "present", presentation: fallback });
      session.transcript.push({ role: "assistant", content: fallback.message, turn: session.turn });
      emit({ type: "done", terminal: "present" });
      return;
    }
    emit({ type: "notice", tone: "degraded", text: degradedText });
    dischargeCare();
    emit({ type: "done", terminal: "degraded" });
  };

  // Template-owned educational framing — per LENS, not per first turn, so a
  // mid-session switch into skincare/nutrition still gets it.
  if (EDUCATIONAL_FRAMING[session.lens] && !session.framedLenses.includes(session.lens)) {
    session.framedLenses.push(session.lens);
    emit({ type: "notice", tone: "info", text: EDUCATIONAL_FRAMING[session.lens] });
  }

  if (input.imageDataUrl) {
    session.uploadedImage = {
      dataUrl: input.imageDataUrl,
      note: visionAvailable() ? "analysed by the vision model" : "catalog visual similarity only",
    };
    if (visionAvailable()) {
      emit({ type: "trace", kind: "note", label: "Looking at your photo", detail: "vision", ok: true });
      if (session.lens === "style") {
        // Style: the detailed garment-by-garment read drives outfit searches.
        const read = await analyzeUploadedOutfit(input.imageDataUrl);
        if (read) {
          imageAnalyzed = true;
          session.outfitRead = read;
          emit({
            type: "trace",
            kind: "note",
            label: `Saw: ${read.garments
              .slice(0, 3)
              .map((g) => [g.color, g.type].filter(Boolean).join(" "))
              .join(", ")}`,
            detail: read.vibe ?? "",
            ok: true,
          });
          applyFactPatches(
            session,
            read.garments.slice(0, 6).map((g, i) => ({
              key: `image.piece${i + 1}`,
              value: [g.color, g.fit, g.type, g.details?.join(", ")].filter(Boolean).join(" "),
              provenance: "inferred" as const,
            })),
          );
          emit({ type: "ledger", view: ledgerView(session.ledger) });
          observations.push(
            `SYSTEM: you LOOKED at the uploaded photo. ${describeOutfitRead(read)}\nDescribe what you saw in your own words. Material impressions are photo guesses — never state them as listing facts.`,
          );
          const visionResults = await runVisionSearches(session, read, trace, emit);
          if (visionResults) observations.push(visionResults);
        } else {
          observations.push(
            "SYSTEM: the image could not be analysed. Say so honestly; you may still use catalog visual similarity (useUploadedImage:true) or ask them to describe the look.",
          );
        }
      } else {
        // Skincare / gift / nutrition: a lens-tuned read the model can describe
        // and search from. Skincare stays strictly educational — never diagnosis.
        const read = await analyzeImageForLens(input.imageDataUrl, session.lens);
        if (read) {
          imageAnalyzed = true;
          emit({
            type: "trace",
            kind: "note",
            label: `Saw: ${read.summary.slice(0, 60)}`,
            detail: read.concern ? "flagged for care" : "",
            ok: true,
          });
          applyFactPatches(session, [
            { key: "image.read", value: read.summary, provenance: "inferred" as const },
            ...read.observations.slice(0, 4).map((o, i) => ({
              key: `image.detail${i + 1}`,
              value: o,
              provenance: "inferred" as const,
            })),
          ]);
          if (read.concern) {
            observations.push(
              `SYSTEM: the photo shows something worth a gentle professional-referral note: "${read.concern}". Acknowledge it warmly and stay in your educational, non-diagnostic lane.`,
            );
          }
          emit({ type: "ledger", view: ledgerView(session.ledger) });
          observations.push(
            `SYSTEM: you LOOKED at the uploaded photo. ${describeImageRead(read)}\nYour VERY NEXT action MUST be a \`say\` that opens by telling them, warmly and specifically, what you saw in their photo (this is the moment that proves you actually looked) — NOT diagnosing or naming a condition, just describing what's visible. Only after that say do you search/present. Then use the suggested searches plus your own judgement to find products.`,
          );
          // Search from the photo's own suggested phrases so the read reaches the catalog.
          const phrases = (read.searchPhrases ?? [])
            .map((p) => p.trim())
            .filter((p) => p.split(/\s+/).length >= 2)
            .slice(0, 4);
          if (phrases.length > 0) {
            const out = await runSearches(session, phrases.map((query) => ({ query })), trace, emit, 4);
            observations.push(
              `${out}\n\nSYSTEM: those searches came from what you saw in the photo — work from these candidates.`,
            );
          }
        } else {
          observations.push(
            "SYSTEM: the image could not be analysed this time. Say so honestly and ask them to describe what's in it, or proceed from their words.",
          );
        }
      }
    } else {
      observations.push(
        "SYSTEM: the user uploaded an image. You have NOT seen it and no vision model is configured. The catalog can still match visually similar items (useUploadedImage:true) — say so honestly.",
      );
    }
  }

  if (input.op) {
    if (input.op.kind === "more_like") {
      // "Show Similar" is answered by the catalog's own similarity mechanism,
      // entirely in code — the same fast path in every lens. No model turn, no
      // vision pass: the rail lands in seconds or falls through to the loop.
      const seed = session.evidence.get(input.op.productId);
      const title = seed?.product.title ?? input.op.productId;
      emit({
        type: "trace",
        kind: "note",
        label: `More like: ${title.slice(0, 50)}`,
        detail: "catalog similarity",
        ok: true,
      });
      const instant = await runInstantSimilar(session, input.op.productId, trace, emit, aborted);
      // A superseded turn must not mark the mock notice as delivered while its
      // emit is being dropped — check the guard BEFORE disclosing.
      if (aborted?.()) return;
      discloseMock();
      if (instant.presented && !input.message) {
        dischargeCare();
        emit({ type: "done", terminal: "present" });
        return;
      }
      observations.push(instant.observation);
      observations.push(
        instant.presented
          ? `SYSTEM: the shopper tapped "More like this" on "${title}" and the catalog's similar items above were ALREADY shown to them instantly. Build on that: address their message, swap the piece into any look you built, or refine — do NOT re-run the similarity or re-present the same items.`
          : `SYSTEM: the shopper tapped "More like this" on ${input.op.productId} ("${title}") but the catalog's similarity engine returned nothing usable. Find close alternatives yourself: ONE search_catalog call with 2-3 SHORT generic queries (2-4 words) describing the item, then ONE batched get_product, then present 4-6 alternatives on the board under the same category. Do not re-show the original as a pick.`,
      );
    } else {
      observations.push(`SYSTEM: ${applyOp(session, input.op)}`);
      emit({ type: "ledger", view: ledgerView(session.ledger) });
    }
  }

  if (input.message) {
    session.transcript.push({ role: "user", content: input.message, turn: session.turn });
    if (session.transcript.length > 60) {
      session.transcript = session.transcript.slice(-60);
    }
    // Deterministic nets: care flags + consent + budget backstops. Model
    // additions union in — recall never depends on the model alone.
    const added = detectAndMergeCareFlags(session, input.message);
    if (added.length > 0) emit({ type: "ledger", view: ledgerView(session.ledger) });
    const consentSentence = sniffSupplementConsent(input.message);
    if (consentSentence && recordConsent(session, "supplements", consentSentence)) {
      emit({ type: "ledger", view: ledgerView(session.ledger) });
    }
    if (session.ledger.constraints.budgetMaxMinor == null) {
      const sniffed = sniffBudget(input.message);
      if (sniffed) {
        const currency = sniffed.currency ?? session.ledger.constraints.currency;
        session.ledger.constraints.currency = currency;
        session.ledger.constraints.budgetMaxMinor = majorToMinor(sniffed.maxMajor, currency);
        emit({ type: "ledger", view: ledgerView(session.ledger) });
      }
    }
  }

  if (!aiAvailable()) {
    emit({
      type: "notice",
      tone: "degraded",
      text: "The reasoning model is unavailable — the expert consultation can't run. Try again shortly, or use classic mode for a labeled basic search.",
    });
    emit({ type: "done", terminal: "degraded" });
    return;
  }

  let actionsUsed = 0;
  let searchActions = 0;
  let invalidStreak = 0;
  let modelFailures = 0;
  let terminal: "ask" | "present" | "propose" | null = null;
  let consecutiveSays = 0;
  let lastSay = "";
  let bareAskNudges = 0;
  let boardNudges = 0;
  let compositionNudges = 0;
  let emptyPresentNudges = 0;
  let voiceNudges = 0;
  let structureNudges = 0;
  let narrateNudges = 0;
  let saidThisTurn = false;

  while (actionsUsed < MAX_ACTIONS && terminal === null) {
    if (aborted?.()) return;
    if (Date.now() - startedAt > MAX_WALL_MS) {
      await degradeOrPresent(
        "I ran out of thinking time this turn — here's where I got to. Send a message and I'll pick it right up.",
      );
      return;
    }

    let action: AgentAction;
    try {
      action = await structuredCompletion(
        system,
        renderState(session, observations, {
          actionsLeft: MAX_ACTIONS - actionsUsed,
          searchesLeft: MAX_SEARCH_ACTIONS - searchActions,
          spokeThisTurn: consecutiveSays > 0 || lastSay.length > 0,
          urgent:
            MAX_ACTIONS - actionsUsed <= 4 ||
            Date.now() - startedAt > MAX_WALL_MS * 0.55,
        }),
        ActionSchema,
        // Generous ceiling: a full board (4-5 items across several categories)
        // plus featured cards and compositions is a large payload. A touch of
        // temperature keeps the prose from reading rote.
        { maxTokens: 8000, temperature: 0.6, timeoutMs: 90_000 },
      );
    } catch (err) {
      modelFailures += 1;
      logger.warn("expert loop model call failed", {
        error: err instanceof Error ? err.message : String(err),
        failures: modelFailures,
      });
      if (modelFailures >= 2) {
        await degradeOrPresent(
          "I hit a technical snag partway through. Here's what I'd verified so far — send a message to continue and I'll pick up from here.",
        );
        return;
      }
      continue;
    }
    // A turn superseded while the model was thinking must not mutate shared
    // session state (or mark care as delivered) under the new turn.
    if (aborted?.()) return;
    actionsUsed += 1;

    switch (action.action) {
      case "say": {
        const text = lintOutbound(action.text ?? "").text;
        if (!text) {
          invalidStreak += 1;
          observations.push("SYSTEM: your say text was empty after the safety lint — rephrase within policy.");
          break;
        }
        // Loop-pathology guards: repeated or near-duplicate narration gets
        // suppressed with a nudge to act; persistent narration trips the
        // breaker. The streak is only cleared by a say that actually ships.
        if (consecutiveSays >= 2 || (lastSay && saySimilarity(text, lastSay) > 0.7)) {
          consecutiveSays += 1;
          invalidStreak += 1;
          observations.push(
            "SYSTEM: you are repeating yourself — the user heard you. STOP narrating. Your next action must be search_catalog, get_product, update_ledger, ask_user, propose_direction, or present.",
          );
          break;
        }
        // Voice guard: force ONE rewrite of a stiff, stock opener. Not an error
        // (it never touches the invalid streak) — just a push toward a human voice.
        if (voiceNudges < 1 && looksFormulaicOpener(text)) {
          voiceNudges += 1;
          observations.push(
            `SYSTEM: your line opened with a banned stock phrase ("I hear you're…", "The biggest lever…", "Got it", "Great choice", "Absolutely"). Rewrite it in a fresh, human voice — dive straight into the substance, warm and specific, the way a sharp friend would actually talk. No stock acknowledgement, no "the biggest lever is".`,
          );
          break;
        }
        // Structure guard: a long paragraph of counsel must be reformatted into
        // scannable Markdown (the shopper explicitly wants list-style answers).
        if (structureNudges < 2 && looksUnstructured(text)) {
          structureNudges += 1;
          observations.push(
            `SYSTEM: that's a lot of good advice crammed into one grey paragraph — reformat it as SCANNABLE Markdown before you send, SAME content: a short **bold** takeaway line, then a "**Do this:**"-style lead-in and a numbered list (or bullets) where each point starts with a **bold** phrase, indented "  - " sub-bullets for options, and a "> " blockquote for anything they'd actually say or read. Keep it warm; just make it a joy to scan, like a great expert's notes.`,
          );
          break;
        }
        invalidStreak = 0;
        consecutiveSays += 1;
        saidThisTurn = true;
        lastSay = text;
        emit({ type: "say", text });
        session.transcript.push({ role: "assistant", content: text, turn: session.turn });
        observations.push(`YOU SAID: ${text.slice(0, 300)}`);
        break;
      }

      case "ask_user": {
        const text = lintOutbound(action.text ?? "").text;
        if (!text) {
          invalidStreak += 1;
          observations.push("SYSTEM: ask_user needs a non-empty, policy-clean question.");
          break;
        }
        if (session.questionCount >= MAX_QUESTIONS) {
          invalidStreak += 1;
          observations.push(
            "SYSTEM: your question budget is spent. Do not ask again — present your best picks now with your assumptions listed.",
          );
          break;
        }
        // Show-first: never interrogate while holding products you could show.
        if (session.candidates.size > 0 && bareAskNudges < 1) {
          bareAskNudges += 1;
          observations.push(
            "SYSTEM: you already have candidate products. Don't ask without showing — call `present` now and put this question in presentation.followUp so the shopper sees progress while they answer.",
          );
          break;
        }
        invalidStreak = 0;
        dischargeCare();
        session.questionCount += 1;
        session.ledger.askedQuestions.push(text);
        if (session.ledger.askedQuestions.length > 20) session.ledger.askedQuestions.shift();
        session.transcript.push({ role: "assistant", content: text, turn: session.turn });
        // Fork captions and quick replies are user-visible — they lint too.
        const fork = action.fork
          ? {
              ifA: lintOutbound(action.fork.ifA).text,
              thenA: lintOutbound(action.fork.thenA).text,
              ifB: lintOutbound(action.fork.ifB).text,
              thenB: lintOutbound(action.fork.thenB).text,
            }
          : null;
        emit({
          type: "ask",
          text,
          fork: fork && fork.thenA && fork.thenB ? fork : null,
          quickReplies: (action.quickReplies ?? [])
            .map((q) => lintOutbound(q).text)
            .filter(Boolean)
            .slice(0, 4),
        });
        terminal = "ask";
        break;
      }

      case "search_catalog": {
        const specs = (action.queries ?? []).filter((q) => q.query.trim().length > 0);
        if (specs.length === 0) {
          invalidStreak += 1;
          observations.push("SYSTEM: search_catalog needs 1-4 non-empty queries.");
          break;
        }
        if (searchActions >= MAX_SEARCH_ACTIONS) {
          observations.push("SYSTEM: search budget exhausted this turn — work with your candidates or present.");
          break;
        }
        invalidStreak = 0;
        searchActions += 1;
        observations.push(await runSearches(session, specs, trace, emit));
        break;
      }

      case "get_product": {
        const ids = [
          ...new Set([...(action.productIds ?? []), ...(action.productId ? [action.productId] : [])]),
        ].filter((id) => id.trim().length > 0);
        if (ids.length === 0) {
          invalidStreak += 1;
          observations.push("SYSTEM: get_product needs productIds from your candidates.");
          break;
        }
        invalidStreak = 0;
        if (ids.every((id) => session.evidence.has(id))) {
          observations.push(
            `SYSTEM: those are already verified — their snippets are in VERIFIED EVIDENCE. Don't re-fetch; inspect different candidates or present.`,
          );
          break;
        }
        observations.push(await runGetProducts(session, ids, trace, emit));
        break;
      }

      case "update_ledger": {
        const hasContent =
          (action.facts?.length ?? 0) > 0 ||
          action.constraints != null ||
          action.consent != null ||
          action.careFlagAdd != null;
        if (!hasContent) {
          invalidStreak += 1;
          observations.push("SYSTEM: update_ledger had nothing to record.");
          break;
        }
        invalidStreak = 0;
        if (action.facts && action.facts.length > 0) {
          applyFactPatches(session, action.facts);
        }
        if (action.constraints) applyConstraintPatch(session, action.constraints);
        if (action.consent) {
          const ok = recordConsent(session, action.consent.category, action.consent.quote);
          observations.push(
            ok
              ? `SYSTEM: consent recorded for "${action.consent.category}".`
              : `SYSTEM: consent REJECTED — the quote isn't a verbatim substring of the user's words. Ask plainly and quote their exact reply.`,
          );
        }
        if (action.careFlagAdd) {
          const def = careFlagDef(action.careFlagAdd);
          if (!def) {
            observations.push(
              `SYSTEM: unknown care flag "${action.careFlagAdd}" ignored — valid kinds: pregnancy, severe-skin, skin-condition, medical, labs, eating-disorder, minor. Only add one when the conversation genuinely triggers it.`,
            );
          } else {
            mergeCareFlags(session, [
              {
                kind: def.kind,
                label: def.label,
                matchedText: "flagged by the agent",
                turn: session.turn,
                scopeFence: def.scopeFence,
                lastCaredTurn: null,
              },
            ]);
          }
        }
        emit({ type: "ledger", view: ledgerView(session.ledger) });
        observations.push("SYSTEM: ledger updated.");
        break;
      }

      case "propose_direction": {
        const summary = lintOutbound(action.summary ?? "").text;
        if (!summary || !action.sections || action.sections.length === 0) {
          invalidStreak += 1;
          observations.push("SYSTEM: propose_direction needs a summary and sections.");
          break;
        }
        invalidStreak = 0;
        dischargeCare();
        session.transcript.push({ role: "assistant", content: `Proposed direction: ${summary}`, turn: session.turn });
        emit({
          type: "propose",
          summary,
          sections: action.sections
            .map((s) => ({
              title: lintOutbound(s.title).text,
              detail: lintOutbound(s.detail).text,
            }))
            .filter((s) => s.title.length > 0 || s.detail.length > 0),
        });
        terminal = "propose";
        break;
      }

      case "present": {
        if (!action.presentation) {
          invalidStreak += 1;
          observations.push("SYSTEM: present needs a presentation payload.");
          break;
        }
        // If you looked at their photo, you owe them a word about what you saw
        // BEFORE the products — otherwise the whole "I actually looked" moment
        // is lost. Push back once for a describing say.
        if (imageAnalyzed && !saidThisTurn && narrateNudges < 1) {
          narrateNudges += 1;
          observations.push(
            `SYSTEM: you analysed their photo but are about to present without ever telling them what you saw. Your next action must be a \`say\` that describes the photo warmly and specifically first — then present.`,
          );
          break;
        }
        // Never ship prose that promises products with no products attached —
        // an over-long payload can come back with only the message intact.
        const hasAnyProduct =
          action.presentation.sections.some((s) => (s.cards?.length ?? 0) > 0) ||
          (action.presentation.board ?? []).length > 0 ||
          (action.presentation.compositions ?? []).length > 0;
        const hasSteps = action.presentation.sections.some((s) => (s.steps?.length ?? 0) > 0);
        if (!hasAnyProduct && !hasSteps && session.candidates.size > 0 && emptyPresentNudges < 2) {
          emptyPresentNudges += 1;
          observations.push(
            `SYSTEM: that presentation arrived with NO products at all — only prose. Send it again, smaller: at most 2 featured cards, a board of 4-6 items per category with SHORT insights (max 12 words) and SHORT tradeoffs (max 10 words), and your compositions. Products first, prose second.`,
          );
          break;
        }
        // The board is the shopper's main product view: don't let a present
        // ship without it while there are candidates to fill it with.
        const boardCount = (action.presentation.board ?? []).reduce(
          (n, c) => n + c.items.length,
          0,
        );
        // The board is the shopper's MAIN product view and must be RICH, not
        // thin — fires on an empty board, OR on an under-filled one when there
        // are plenty of unused candidates to fill it (the "maximum products so
        // they can choose" goal). A genuinely thin catalog won't trip it.
        const emptyBoard = boardCount === 0 && session.candidates.size >= 3;
        const thinBoard = boardCount < 5 && session.candidates.size >= 8;
        if ((emptyBoard || thinBoard) && boardNudges < 1) {
          boardNudges += 1;
          observations.push(
            `SYSTEM: your board has only ${boardCount} item(s) but you have ${session.candidates.size} verified candidates in hand — the side panel is the shopper's MAIN product view and it looks thin. Re-send this present with a RICH board: group your candidates into your PLAN's components (cleanser / serum / SPF for a routine, protein / carb / veg for a plan, shirts / trousers / shoes for an outfit, gesture / keepsake / experience for a gift), with 5-6 REAL options per component so they can actually choose. Even a minimal recommended routine still lists many options per role — never hide options to keep it simple. Add "compositions" (3-4 combos) too. You do not need to inspect them first.`,
          );
          break;
        }
        // Any answer spanning 2+ components wants ready-made SETS, not just a
        // pile of options — combos/buy-togethers, in every lens.
        const boardCatCount = (action.presentation.board ?? []).length;
        if (
          boardCatCount >= 2 &&
          (action.presentation.compositions ?? []).length < 3 &&
          compositionNudges < 1
        ) {
          compositionNudges += 1;
          const comboWord =
            session.lens === "style"
              ? "complete outfits"
              : session.lens === "skincare"
                ? "complete routines (e.g. gentle-starter, barrier-repair, brightening)"
                : session.lens === "nutrition"
                  ? "buy-together plans (e.g. budget, high-protein, quick-prep)"
                  : "gift combos / buy-togethers (e.g. a romantic set, a practical set, an experience-led set)";
          const haveCombos = (action.presentation.compositions ?? []).length;
          observations.push(
            `SYSTEM: your board spans ${boardCatCount} components but you only assembled ${haveCombos} set(s). The shopper wants ready-made SETS to choose from, not just a pile of options. Re-send this present with "compositions": 3-4 genuinely different ${comboWord} built from your board items (one per component each), each with a one-line rationale for why those pieces belong together. Keep the board exactly as you had it.`,
          );
          break;
        }
        // Auto-verify every board item the agent listed but hasn't inspected —
        // the side panel holds the full shortlist, and code (not the model)
        // pays the cost of proving each one is real.
        const boardIds = [
          ...new Set(
            (action.presentation.board ?? [])
              .flatMap((c) => c.items.map((i) => resolveProductId(session, i.productId)))
              .filter((id) => !session.evidence.has(id)),
          ),
        ];
        if (boardIds.length > 0) {
          emit({
            type: "trace",
            kind: "note",
            label: `Verifying ${boardIds.length} shortlisted product(s)`,
            detail: "board",
            ok: true,
          });
          await verifyBoardItems(session, boardIds, trace, emit);
          // Multi-second await: if a newer turn claimed the session meanwhile,
          // stop before any state mutation (care, questions, transcript).
          if (aborted?.()) return;
        }
        const requestedCards = action.presentation.sections.reduce(
          (n, s) => n + (s.cards?.length ?? 0),
          0,
        );
        const requestedBoard = (action.presentation.board ?? []).reduce(
          (n, c) => n + c.items.length,
          0,
        );
        const { presentation, notes } = verifyPresentation(session, action.presentation);
        const verifiedCards = presentation.sections.reduce((n, s) => n + s.cards.length, 0);
        const verifiedBoardCount = presentation.board.reduce((n, c) => n + c.items.length, 0);
        // A TOTAL wipeout — the model tried to show products (cards OR board)
        // but NONE survived verification — must never ship as a silent empty
        // present. This fires for a board-only present too (e.g. every item was
        // held back for opt-in, currency, or price), not just card presents.
        if (
          verifiedCards === 0 &&
          verifiedBoardCount === 0 &&
          (requestedCards > 0 || requestedBoard > 0)
        ) {
          invalidStreak += 1;
          observations.push(
            `SYSTEM: nothing survived verification — ${notes.join(" | ").slice(0, 500) || "every product was screened out (budget, currency, opt-in, junk price, or unverifiable claims)"}. Present DIFFERENT products that genuinely fit and pass those screens; if there truly aren't any, use note_limitation and say so honestly — do NOT ship an empty present.`,
          );
          break;
        }
        invalidStreak = 0;
        // Thin categories are refilled in code from the same searches that
        // produced them — the model curates the leaders, code fills the shelf.
        const toppedUp = await topUpBoard(session, presentation, trace, emit, aborted);
        if (aborted?.()) return;
        if (toppedUp > 0) {
          emit({
            type: "trace",
            kind: "note",
            label: `Added ${toppedUp} more option(s) from the same searches`,
            detail: "board top-up",
            ok: true,
          });
        }
        dischargeCare();
        // The follow-up is a question: it spends budget, and once the budget is
        // gone the picks stand on their own.
        if (presentation.followUp) {
          if (session.questionCount >= MAX_QUESTIONS) {
            presentation.followUp = null;
          } else {
            session.questionCount += 1;
            session.ledger.askedQuestions.push(presentation.followUp.text);
            if (session.ledger.askedQuestions.length > 20) session.ledger.askedQuestions.shift();
          }
        }
        for (const note of notes) emit({ type: "limitation", text: note });
        emit({ type: "present", presentation });
        // The client's board is add-only across turns — remember what's on it
        // so the top-up never re-adds a product under a second header later.
        for (const cat of presentation.board) {
          for (const item of cat.items) session.boardedIds.add(item.productId);
        }
        session.transcript.push({ role: "assistant", content: presentation.message, turn: session.turn });
        terminal = "present";
        break;
      }

      case "note_limitation": {
        const text = lintOutbound(action.text ?? "").text;
        if (text) emit({ type: "limitation", text });
        observations.push("SYSTEM: limitation noted.");
        break;
      }
    }

    if (action.action !== "say") consecutiveSays = 0;

    // A superseded turn must NOT mark the demo-data notice as delivered while
    // its emit is being dropped (search/inspect cases await without re-checking
    // abort). Check the guard BEFORE disclosing, or the banner is lost forever.
    if (aborted?.()) return;
    // Demo-data disclosure after ANY catalog access (search OR inspect), once
    // per session — a mock fixture reached via get_product must disclose too.
    discloseMock();

    if (invalidStreak >= MAX_INVALID_STREAK) {
      await degradeOrPresent(
        "I tripped over my own output twice — rather than guess, I'm stopping here. Nudge me and I'll continue.",
      );
      return;
    }
  }

  if (terminal === null) {
    // Action budget exhausted without a terminal — hand over what we verified
    // (a code-built board) rather than finishing empty-handed.
    await degradeOrPresent(
      "I used up my step budget before finishing. Tell me to continue and I'll pick up exactly where I stopped.",
    );
    return;
  }

  emit({ type: "done", terminal });
}
