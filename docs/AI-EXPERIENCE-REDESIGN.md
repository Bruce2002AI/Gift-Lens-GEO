# ShopLens AI Experience Redesign — The Expert Loop

**Scope:** the four flagship lenses — Gift Wingman, Skincare Assistant, Fashion Stylist, Nutrition Assistant.
**Status:** design, pre-implementation. This document defines the experience and the architecture that produces it; it deliberately does not sequence the build.

**Method note:** this design was produced by an adversarial panel — a 44-finding audit of where the current system is static, four independent redesigns (agentic-runtime, consultation-craft, wow-artifacts, trust-boundaries), and three judges (founder bar, shipability, safety). What follows is the synthesis: the winning runtime with the best mechanics from every design grafted in, and every judge-confirmed gap addressed.

> **⚠ Two deliberate departures from the brief — flagged for sign-off, not decided silently:**
> 1. **Instagram profile URLs are refused, never crawled.** The brief's first gift input is "share the recipient's Instagram profile." Automated profile analysis violates Instagram's ToS, is login-walled even for public profiles, and breaks constantly — building it would put the product's honesty posture on a scraper. The designed replacement (§6): a warm in-voice redirect to **screenshots** (the brief's own private-account path, which covers public profiles identically) plus the **describe-the-feed** fallback that works today. If direct profile analysis is a hard requirement, the only legitimate route is Meta's official APIs (user-consented, own-account-oriented — they do not cover browsing a third party's profile), which is why this design treats screenshots as the real feature, not a fallback.
> 2. **Lab reports are not parsed in v1.** The brief lists medical/blood-test reports as nutrition inputs. v1 refuses the file warmly and works from "what your doctor said, in their words" (§6). Interpreting a person's lab values crosses the educational boundary this product commits to; even echo-without-interpretation invites the user to read interpretation into product picks. A future version may OCR-and-echo values verbatim with interpretation still refused in code — but the safe v1 is the refusal, and that trade-off is the founder's to overrule.

---

## 1. The thesis

Today the LLM sits *inside* a pipeline that makes every decision for it. `runAgent()` hard-sequences route → extract-once → clarify (max 2, one question) → blueprint → search-once-per-slot → explain, and the agent's only possible free text to the user is a pre-written safety gate string. The model never chooses what to do next, never speaks in its own voice, never reformulates a search, and every "plan" is the same 3–7-row grid. That is why everything feels templated — because it is.

The redesign inverts control:

> **One agentic loop. The model holds the conversation and chooses every next action — search, look closer, ask, think out loud, update its understanding, present — until it decides it's ready. Code stops being the script and becomes the truth layer: it verifies evidence, enforces the medical-educational boundary, records consent, does the budget math, and labels sources. Freedom lives in the loop; trust lives at the edges.**

The four lenses stop being four pipeline configurations and become **four expert personas over one runtime**: a warm co-conspirator (Gift), a calm consultation-first educator (Skincare), a decisive stylist (Style), a pragmatic food-first coach (Nutrition). Lens choice is a bias hint, not a box — hybrid requests ("a 'new chapter' care package for my sister, and her skin is stress-breaking-out") are handled by one agent with both personas' knowledge and both safety postures active.

The wow the founder asked for — *"this AI actually understands what I'm trying to achieve"* — is engineered as a loop of its own:

> **Show what I understood → let you correct it → visibly use the correction.** Understanding is proven *before* commerce begins.

---

## 2. What dies

The audit found 44 places the current system is structurally incapable of feeling intelligent. The headline deletions:

| Template tell (today) | Replacement |
|---|---|
| Agent has no voice — `assistantMessage` is only ever the canned gate string | The agent speaks every turn: acknowledges, reacts, narrates, self-corrects |
| One intent schema (14 fields) flattens every consultation | A free-shape, provenance-tagged **Session Ledger** the agent writes as it learns |
| One clarification question, `clarifyMax=2`, then plow ahead forever | The **Fork Test** + **show-then-ask** doctrine (§4) — ask exactly when it matters, never interrogate |
| `heuristicPlan()` template queries ("unique thoughtful object") and keyword-overlap ranking presented as curation | Model-authored queries, visible reformulation, model judgment over real candidate evidence |
| Fixed Best/Delight/Safe trio and fixed blueprint grid | The model chooses the presentation: one perfect thing argued hard, a shortlist by emotional register, a plan whose steps can be *non-purchases* |
| "Chosen from catalog data for this step." filler stamped across cards | Revise-with-evidence loop; a claim that can't be grounded is dropped, never replaced with filler |
| Silent heuristic fallback impersonating the AI when the model is down | Honest degradation: labeled "basic catalog search," `degraded` badge, in-voice admission |
| Router silently defaults ambiguity to Gift at confidence 0.25 | Low confidence produces a real question in the agent's voice |

Two **verified bugs** in the current safety layer are fixed by this design regardless of anything else:
1. `gateOptIn` counts a mere *mention* of a supplement term in interests/searchThemes as consent (engine.ts:76–84). Replaced by the consent ledger (§7.3).
2. Red flags can silently fall out of context between turns (per-turn detection, no persistence). Replaced by sticky care flags (§7.2).

---

## 3. The runtime — one loop, code at the edges

### 3.1 The loop

Per user message, a server-side loop runs in `src/lib/agent/`. Each iteration is **one `structuredCompletion` call returning one typed Action** — a Zod discriminated union. This is deliberate: gpt-oss:120b has no proven native tool-calling, so *the structured output IS the tool call*, riding the existing validated-JSON + repair machinery that already works in production today. No new model capability is bet on for v1.

**The action union:**

| Action | What it does | Terminal? |
|---|---|---|
| `say {text}` | Streamed commentary in the agent's voice while work continues | no |
| `ask_user {text, fork?, quickReplies?}` | A question, ideally carrying its fork (§4.1) | yes |
| `search_catalog {queries[1–4], filters, rationale}` | Code runs searches concurrently, returns compacted candidate cards | no |
| `get_product {productId, rationale}` | Full evidence fields + quote-picker snippets; **required** before any product can be presented | no |
| `update_ledger {patch, note}` | Writes facts/flags/consents to the Session Ledger with provenance | no |
| `propose_direction {summary, sections}` | Lightweight agent-initiated check-in before an expensive multi-search plan (the approval gate, reborn as conversation) | yes |
| `present {layout, sections, message}` | The model composes; code notarizes (§7.1) and renders | yes |
| `note_limitation {text}` | Honest scope/coverage admission attached to the turn | no |
| `analyze_image {imageRef, question}` | **Only present in the union when a vision provider is configured** (§6) | no |

**Budgets (code, not vibes):** max 16 actions/turn, max 12 catalog searches/turn, 2 consecutive invalid actions → degraded finalize, wall clock ~90s hard cap. A quick complete brief resolves in 4–6 actions; a deep consult uses 10–16. These caps are tuned from trace telemetry, not intuition — a mis-tuned cap is how the loop quietly becomes a pipeline again.

### 3.2 The Session Ledger (state)

Server-persisted per conversation, replacing both the 14-field intent schema and "no memory beyond the conversation array":

- `facts[]` — everything learned, each entry tagged `{provenance: "said" | "inferred" | "assumed", source: turnRef | imageRef, confidence}`. **The user's own words are stored as quotes** for anything load-bearing.
- `constraints[]` — budget, exclusions, destination, **deadline/urgency**; the input to `checkHardConstraints`, which survives unchanged. Urgency is a first-class constraint the agent reasons with, never promises against: it tightens the consultation (fewer questions, act sooner), enters trade-offs in voice ("the listing states ships in 6–9 days — cutting it close for the 14th; here's the safer-timing pick"), and shapes which alternatives are surfaced — while the no-delivery-guarantee lint (§7.4) keeps every date claim quoted from the listing and hedged, never asserted.
- `careFlags[]` — **sticky, add-only** (§7.2).
- `consents[]` — recorded speech acts with the user's quoted words (§7.3).
- `evidence` — per-product `get_product` payloads; the *only* permissible source of product-fact claims, timestamped for staleness labeling.
- `searchLedger`, `askedQuestions` — dedup guards; a repeated query returns cached results with a "you already ran this" note.

The gift lens's Recipient Portrait, the Skin Profile, the Style Read, and the Nutrition Snapshot are **views over the ledger** rendered in the UI (§5) — not separate stores.

### 3.3 Latency, streaming, and the sanitize-before-stream rule

The API becomes SSE/NDJSON. Doctrine: the first action after any user message is `say` or `ask_user`, so the screen is never silent. While the loop works, the UI shows **real trace chips** — actual model-authored queries with actual self-correction (`"linen apron cross-back" came back too twee — trying "canvas work apron leather straps"`). Visible reformulation is the one behavior a template cannot fake; it converts 20 seconds of latency into 20 seconds of trust.

**Streaming discipline (safety-critical):** streamed text cannot be un-said. Output streams **per cleared segment**, not per token — a `say` segment is buffered, run through the outbound lint (§7.4), and only then flushed. Segment-level hold latency (~sub-second per segment) is the accepted cost of the guarantee.

### 3.4 Honest degradation

- Mid-loop model failure → one retry → **degraded finalize**: present whatever the ledger actually verified, badged `aiMode: "degraded"`, with an in-voice admission ("I hit a technical snag partway — here's what I'd verified so far").
- Model down entirely → the product says so and offers an explicitly labeled **"basic catalog search"** button. The heuristic path survives only under that label — never dressed as the expert. Canned copy cosplaying as consultation is an honesty bug, and this design deletes it.
- Catalog tool failure → returned to the model as an observation; *it* decides to retry, reformulate, or tell the user.
- **Mock mode:** beyond per-card badges, when a session runs on mock catalog data, code injects a mock-mode statement into the agent's opening prose. An enthusiastic personalized narrative wrapped around tiny "demo" badges would still mislead.
- **Mid-turn interruption:** a new user message while the loop is in flight aborts at the next action boundary; completed ledger writes and verified evidence are kept, un-presented work is discarded, and the new turn opens with the agent reconciling ("hold that thought — adjusting for what you just said").

---

## 4. The conversation doctrine

Five rules. None is a script; each has a mechanical backstop.

### 4.1 The Fork Test — ask only when the answer changes the recommendation

A question should carry its fork: *the two different recommendations that hinge on the answer*. The `ask_user` action has an optional `fork` field; the UI renders it as a caption under the question:

> "Is he filling retirement with projects, or nervous about the open time?"
> *asking because: project-bound → I gift into the project; adrift → I gift a morning ritual.*

The user watches the expert's decision tree branch in real time — asking itself becomes a wow. **Enforcement is doctrine + evals, not a hard schema mandate**: Zod-rejecting every fork-less question would breed formulaic ifA/thenA boilerplate (the panel's own template-risk finding). Instead: persona doctrine requires forks; the offline eval suite fails any lens whose questions routinely lack them or whose median questions-before-first-recommendation exceeds 3.

### 4.2 Show-then-ask

After at most **two questions**, the agent must *show something provisional* — carrying a tappable **"Assumptions I'm making"** strip ("assuming: sentimental type · budget is per-gift · needed before the 14th"), each assumption correctable. This is the structural antidote to interrogation drift: the escape hatch is built into the artifact, not offered as a chat aside. A user with a complete brief ("gentle cleanser under ₹1200, fragrance-free") gets zero questions and immediate action.

### 4.3 Mirror before money

Before the first product appears, the agent reads back its understanding — including **one earned inference the user never stated**:

> "Here's my read of Ananya: 27, your college roommate, moving cities — this gift is partly a goodbye. Sentimental but allergic to clutter; film photography and third-wave coffee; would never spend on herself for anything 'frivolous but beautiful.' Did I get her right? Tap any line to correct me."

Corrections patch the ledger with `said` provenance, and the agent acknowledges the delta ("noted — practical it is; that kills two of my ideas and strengthens one").

### 4.4 Rhythm, not caps

No `clarifyMax`. No lifetime question budget. The cadence is: acknowledge + read back + at most 2 questions per turn; every questioning turn ends with an escape hatch ("or say 'run with it' and I'll go on my best read — I'll flag what I assumed"). One circuit breaker remains in code, as a boundary rather than a script: 4 consecutive question-turns with zero searches injects a system nudge to act on stated assumptions. Crucially, the agent **may ask again after searching** — when a catalog slice comes back thin, it returns with a real trade-off question ("nothing under ₹1,500 survived fragrance-free in sunscreens — stretch ₹150, or relax the night-cream slot?") where today's system emits "No in-budget match cleared the constraints." and ships a plan with a hole.

### 4.5 Narrated delivery — the recommendation is an argument

Results are never silent cards. Each pick carries: the claim, the ledger citations ("because she rereads *Persuasion* every winter and you said she keeps ticket stubs"), the honest trade-off, and **the runner-up autopsy** — what was rejected and why, citing the user's own words ("the tea set lost because you said clutter stresses her"). Naming what lost is the cheapest, strongest proof the pick was *reasoned*, not retrieved. Where it earns its place, a **"What I left out on purpose"** block lists items considered and rejected with reasons — experts are defined by what they don't sell you.

---

## 5. The understanding surface — the Living Portrait

The single most important UI element in the redesign: a side panel rendering the ledger as a living document — **Recipient Portrait / Skin Profile / Style Read / Nutrition Snapshot** — that assembles chip by chip as the conversation progresses.

- Every chip carries a **provenance badge**: *you said* (with the quote) / *my guess* (with the source — "3 of 8 screenshots show the same orange cat") / *assumed*.
- Inferred chips render visually distinct (dotted underline) with hedged phrasing. A **certainty-language lint** rejects any ledger patch tagged `inferred` whose text asserts certainty — "she hates clutter" must be written "reading her as clutter-averse" until confirmed.
- Every chip is **tap-to-correct**. A correction triggers a targeted re-plan of only affected picks — and the agent says so ("good to know — dropping the memory-print idea, the multi-tool maps to the camping posts instead").
- Recommendations may only cite ledger fields + catalog evidence, which makes personalization *auditable* rather than asserted.

The Portrait is the wow engine: watching your friend get *understood*, correctly, with sources, before a single product appears — that is the moment the founder described.

**Third-party data mechanics (not a risk-list gesture):** portraits describe real people who are not the user. Session-scoped by default; screenshots are session-only and purged; saving a portrait ("keep this for her birthday in November") is explicit opt-in with a visible delete affordance and a stated retention window. A code-side **sensitive-attribute blocklist** forbids inferring health conditions, religion, sexuality, or relationship status from images regardless of what a vision pass returns.

---

## 6. Input modes — honest feasibility, designed rather than ignored

| Input | Feasibility | Design |
|---|---|---|
| **Text conversation** | Works today | The primary mode. The entire consultation design runs on the current text-only model — the wow is not gated on new capabilities. |
| **Instagram profile URL** | Not feasible (ToS-restricted, login-walled). Never scraped; a code-level fetch blocklist backs the refusal. | The paste-a-URL moment is *designed*: "Instagram doesn't let me browse profiles — screenshot her grid and a few posts and drop them here; six to ten is plenty. Or just describe her feed — you've seen it, I haven't." The **describe-the-feed** path works today and is underrated: people narrate a friend's aesthetic beautifully when prompted well. |
| **Screenshots / inspiration images / outfit photos** | Requires a vision-capable model; gpt-oss:120b is text-only. The plumbing exists (`src/lib/ai/client.ts` already forwards base64 images on both provider paths). | Vision runs as a **single-shot, schema-typed preprocessor** — not an in-loop tool: each image type (grid screenshot, outfit, owned garment, supplement label) has an extraction schema producing an *Observation Doc* (`{claim, confidence, visual_basis}`) written into the ledger as `inferred` facets the user confirms before they become load-bearing. Clean seam, swappable provider, honestly degradable. |
| **Catalog visual similarity** | **Works today, without LLM vision** — `searchCatalog`'s `like.imageDataUrl` is already in `src/lib/catalog/client.ts`. | The honest workhorse for "find something like this" and outfit recreation on the current stack — always labeled *"the catalog matched visually similar items — I haven't seen your photo myself,"* never framed as model vision. |
| **Structural capability honesty** | — | When no vision provider is configured, `analyze_image` is **absent from the action union itself** — the model cannot even pretend. Upload affordances disable with the reason stated. A silently ignored image the agent "answers around" would be exactly the dishonesty the constraints forbid. |
| **Lab reports / medical documents** | A medical boundary, not a parsing problem. | **v1 refuses the file at intake** — warmly: "a lab report needs your doctor, not a shopping assistant. Tell me what they flagged, in their words, and I'll build the grocery half of the plan around it." The user's summary is stored with `said` provenance ("I'm taking your word, not reading the report"). Simpler is safer; ship the refusal. |
| **Supplement-list or label photo** | Vision-tier, low-risk. | OCR-style extraction into the supplement-inventory facet; the agent reasons about redundancy in educational language only. |

**Injection defense (applies to all of the above and to the catalog itself):** any text arriving from an image (OCR of captions, bios, DMs) **and any merchant-written listing text** (descriptions, features) is sandboxed as quoted, untrusted content with no instruction authority. Listing text is an injection surface every prior design missed — the loop context wraps it the same way it wraps OCR output.

---

## 7. The trust layer — boundaries on outputs, not scripts on flow

The model gains total freedom over *process* and zero freedom over *truth claims*. Every pixel the user sees crosses one code-owned emission boundary.

### 7.1 The two-strata card — no invented product facts, mechanically

Recast from regex-scrubbing to a **type distinction**:

- **`claims[]`** — product facts (material, ingredients, price, rating). Each claim carries an evidence pointer into a real `NormalizedProduct` field, and its quote must be a **verbatim substring** of that field (after whitespace/entity/HTML normalization). Deterministic, cheap entailment — no NLI model. The `get_product` payload returns candidate snippets as a quote-picker so the model quotes accurately instead of paraphrasing.
- **`interpretation[]`** — the creative stratum: "why this is *her* gift," styling logic, vibe reads. Visually separate, grounded in ledger facts it may quote, and **barred from stating product attributes**: a lexeme lint on material/ingredient/nutrition vocabulary nudges any smuggled fact ("feels like real leather") into the claims stratum or out.

A violation returns to the loop as a tool error ("claim 2: no evidence in description — revise or drop"), max 2 revisions, then the card is **dropped, never filled with filler** — and the agent acknowledges the gap in voice ("I had a third pick but couldn't verify its materials"). Tap any card to flip it: the exact listing fields each claim quotes, user-verifiable in one tap.

Products reach the UI only through the server-side presenter, which resolves productIds against the evidence store — a product without a `get_product` fetch **has no render path**. Evidence is timestamped; presentations carry an "as of" label and re-validate on click-through, because a price cited from turn-2 evidence can be wrong at the turn-9 click — staleness is an invented-fact violation too.

### 7.2 Care flags — sticky, unioned, fenced, and warm

- **Detection:** LLM extraction **UNIONed with the deterministic keyword nets** on every inbound message — recall never drops below today's. The nets gain dedicated entries for the two highest-severity classes the current system misses: **age signals** (a teen asking for strong actives) and **eating-disorder patterns** (extreme restriction, compensatory framing).
- **Persistence:** flags are **sticky and add-only** in the ledger — a turn-2 pregnancy mention still governs turn 9. Only an explicit, logged user correction retires one.
- **Scope fences at retrieval:** a flag constrains what can be *shown*, not just how the agent talks — pregnancy applies a retinoid/high-dose-exfoliant denylist inside the constraint check itself.
- **Disposition obligation:** a flagged-topic turn cannot be released without a care segment. **The words are the model's, fresh each time** ("that sounds genuinely painful — cystic acne responds to prescription options a dermatologist can give you and I can't; here's the gentle, non-medicated part I *can* help with while you book that"); the *presence* is verified mechanically, and the canonical referral sentence is appended if the model dropped it. Obligations fire on topic-relevant turns with a per-flag cooldown, so care never reads as boilerplate.
- **Interaction claims:** drug/supplement interaction concerns may only be voiced as **deferral** ("worth asking your pharmacist about combining these"), never asserted as fact — being wrong in either direction is harmful, and no catalog field can evidence it.
- A small **"care mode: pregnancy"** chip shows the boundary is *active*, not a disclaimer footer.

### 7.3 Consent as a recorded speech act

Supplements (and future opt-in categories) render only against a `consents[]` ledger entry **quoting the user's own words with turn provenance** — set when the agent asks in voice ("want supplement options, or keep this food-only?") and the user affirms. Rendered as a visible, revocable chip: *"supplements: opted in — your words: 'sure, show me creatine.'"* This replaces `gateOptIn`'s substring sniff and fixes its verified false-consent bug. Compliance becomes a trust feature the user can see and reverse.

### 7.4 Outbound lint — topic-keyed, rewrite-first

- Blocked-claim patterns (diagnose/cure/treat, delivery-date and ranking guarantees, body-attractiveness judgments) run over **all** outbound text including `say` — keyed to **detected topic, not active lens**, so a skincare gift set inside a gift conversation still gets the medical-boundary treatment.
- On a hit: one rewrite pass with the violation named, then drop — never silent substitution, never the old filler sentence. Every strip is logged and treated as a prompt bug.
- Educational framing on skincare/nutrition artifacts is **template-owned chrome** the model never generates and cannot omit.
- Honest limitation: every net here is an English lexical net, and the market is ₹/India. Hinglish evades it. v1 states the boundary (English-first enforcement) rather than pretending coverage; multilingual nets are future work, tracked, not hand-waved.

### 7.5 Disputed evidence

When the user contradicts a listing ("that's wrong — the listing shows parfum"), the evidence store demotes that field for the session, affected presented claims get flagged and re-hedged in the agent's next message, and user testimony is recorded with `said` provenance. The catalog is the source of product facts, but it is not infallible, and the agent must not argue for a listing against the human holding the product.

---

## 8. The four experts

### 8.1 Gift Wingman

**Persona:** an emotionally intelligent friend with impeccable taste. Doctrine forbids opening with product questions — the conversation starts with the *person*: relationship, the occasion's emotional stakes, practical↔sentimental, a shared memory, "what would she never buy for herself?" (themes, never a script; the Charter bans verbatim reuse of example questions).

**Signature beats:**
- The **Portrait read-back** with one earned inference (§4.3) — understanding proven before commerce.
- **Insight-driven search:** ledger fact "keeps her grandmother's recipe cards" becomes queries like *"recipe card box walnut engraved"*, *"brass cookbook stand vintage"* — streamed with real reformulations.
- **Gift narratives** with the connection line citing the specific facet and the facet citing its source ("this ties to the Ladakh trip in her March posts").
- **The "she'd never buy this for herself" shelf** — the founder's question as a visible product category.
- **The card-note draft:** "For all the mornings the train got you — the next thousand are yours." Zero catalog risk, maximal proof of memory.
- **The runner-up autopsy** on every pick.
- Presentation is judgment: one perfect thing argued hard, or a shortlist by emotional register ("safe and lovely" / "a little daring" / "the one she'd never buy herself") — never a forced trio.

**Example (the bar):**
> **User:** Gift for my dad, he's retiring next month.
> **Agent:** A retirement gift for your dad — that's a big one; it's less "happy birthday" and more "your work mattered, and here's to what's next." Two things would change what I hunt for. Is he the kind of man who'll fill retirement immediately — golf, travel, a project — or quietly nervous about the open time? *(project-bound → I gift into the project; adrift → I gift a morning ritual.)* And is there something he's muttered about for years but never bought himself?
> **User:** Honestly he's nervous. He's talked about grinding his own coffee forever but says it's a waste of money.
> **Agent:** Then we don't buy him a retirement gift — we buy him a 7am ritual to replace the commute. The "waste of money" line is the tell: that's exactly the category a gift is *for*. Give me a minute — I'm hunting a hand grinder and single-origin starter set, and separately a pour-over kit, so you can choose between "craft he masters" and "comfort he enjoys."

### 8.2 Skincare Assistant

**Persona:** a calm educator who thinks like a dermatologist and says out loud that it isn't one — the boundary woven into voice, not stamped as a footer.

**Prime directive: investigate before products.** "I have acne" gets zero products in turn one — it gets two genuinely clinical-feeling questions (duration/trajectory, skin feel by afternoon, pain/depth, current routine verbatim, **stress, sleep, diet**, climate, prior treatments and reactions — fork-gated themes, not a sequence; lifestyle factors are weighed as context, never medicalized). The most common expert finding is *over-cleansing and irritant stacking* — so the recommendation is often to **remove** products: "retinol every night plus an acid toner is a lot of exfoliation — that alone can look like what you're describing."

**The Skin Story** presentation vocabulary (available shapes, not a mandated skeleton — a fixed six-section template would be the old disease in better clothes): what I heard → what's probably going on (educational pattern-language only) → **before we buy anything** (zero-cost changes as first-class plan steps: sleep, stress load, diet patterns, pillowcase cadence, "stop the scrub for two weeks," SPF habit) → a deliberately minimal routine (the agent is charged to recommend *fewer* products than users expect) → what to expect week-by-week → see-a-professional-if (code-owned, expanded when a flag fired). "Products are part of the solution, not the whole solution" is structural: a skincare plan can legitimately be five behavioral steps and two purchases. Ingredient claims quote catalog ingredient fields or they don't ship; a listing without an ingredient list says exactly that.

**Example:**
> **User:** I have acne, recommend a serum.
> **Agent:** I can help you shop for one — but a serum picked blind is a coin flip, so let me earn the pick with two questions. How long has this been going on, and does your skin feel oily by mid-afternoon or tight after washing? *(oily + recent → a light gel routine; tight + long-term → your current routine may be stripping you, and the fix starts with a gentler cleanser, not another active.)* Quick honesty note: I'm an educational shopping assistant, not a dermatologist — and if any of these are painful under the skin, that's a see-a-professional situation, not a serum situation.

The consultation that ends with *fewer* products — "stop two things you're using, buy one; here's the one" — is the strongest expert signal in the product.

### 8.3 Fashion Stylist

**Persona:** decisive, visual, a little playful. Zero body judgment — fit talk is framed strictly as the user's stated preferences; body-evaluative phrasing is a lint category, not just a norm.

**The interview extracts four things fast:** occasion + formality stakes; vibe in the user's words, mirrored back sharpened ("'put-together but not trying' — elevated-casual: structured over sloppy, matte over shiny"); constraints (weather, comfort non-negotiables, refused colors); **wardrobe anchors** — the highest-leverage question a real stylist asks and today's schema can't hold.

**The Recreation Board** (image tier): left panel — the inspiration photo decomposed into a numbered, *correctable* component manifest (type, color swatches, silhouette, layering, accessories, inferred materials explicitly hedged: "reads as wool-blend — tap to correct"), plus an aesthetic caption ("quiet-luxury autumn: camel + cream + gold, long lines"). Right panel — the shoppable recreation, one column per component, keep-the-vibe alternates, color-harmony notes tying each pick to the palette, and a **live total-vs-budget bar** recalculating as alternates swap in. **"Keep the vibe, halve the price"** re-runs only price-sensitive components with the aesthetic constraints held — proof it reasons about the *look*, not keyword-matched titles. **Owned items pin as non-shoppable components the outfit is built around.**

**Multiple inspiration images** are synthesized, not recreated three times: each image gets its own extraction, then the agent surfaces the **common thread** in voice — "all three of these are doing high-contrast monochrome with one structured piece; that's the thing you're drawn to" — and boards *the synthesis*, with the shared palette and silhouette logic as the constraints. Divergences between the images become questions or labeled alternate lanes, never silent averaging.

**Two-strata rule at its sharpest:** "your photo reads as ribbed merino — could be acrylic, photos lie. This pick's listing says 100% merino — their words, not mine."

**Text-only tier (today):** no upload affordance is faked; "describe the outfit or paste the caption — I'll rebuild it from your description" genuinely works, and catalog visual similarity (`like.imageDataUrl`) anchors recreation honestly. Signature riff: **"one anchor, three ways"** — three occasions composed around a piece the user owns; unreachable by search, impossible without the ledger.

### 8.4 Nutrition Assistant

**Persona:** a pragmatic coach — evidence-aware, budget-honest, food-first, allergic to supplement maximalism.

**Triage arc:** the goal in outcome terms; **a day of eating as actually lived** (the single most informative question, read like a coach: "so breakfast is chai and whatever's around — that 4pm crash isn't a mystery"); constraints (allergies `said`-provenance only, cooking reality, budget as a hard number); red flags wired like skincare's.

**The Priority Ladder:** food-first is the **default doctrine with a code-enforced presumption, not a hardcoded mandate** — the brief says diet before supplements *when appropriate*, and "when appropriate" is the expert's judgment, not a constant. Mechanically: a plan that leads with a supplement is rejected and regenerated *unless* it carries an explicit justification referencing ledger facts (recorded consent **plus** a `said`-provenance reason the food route can't practically cover — e.g. "you told me your doctor flagged low B12 and you're fully plant-based"). The presumption keeps supplement maximalism out; the justification path keeps the plan reasoned rather than hardcoded. Rung contents, narration, and length are the model's. Rung 0: free changes. Rung 1: highest-impact within budget — which may be *foods* before pills — each item carrying the gap it addresses (facet-ref), an evidence-strength tag explicitly labeled "general nutrition knowledge, not from the catalog," and **cost-per-day computed in code** from catalog price/serving fields. Rung 2: strictly opt-in (§7.3) — without consent it renders as named categories with a "want me to look?" affordance, no products. Below: **"Why this order"** and **"What I left out on purpose."**

**Example:**
> **User:** I'm tired all the time, what supplements should I take?
> **Agent:** Before we spend money on capsules — "tired all the time" has a dozen boring causes and a few that need a doctor, and I can't tell them apart; if this is new, worsening, or comes with other symptoms, that's a checkup, genuinely. What I *can* do well: walk me through yesterday's food, first bite to last, and roughly what you sleep. *(carbs-early-nothing-till-3pm → the fix is structural and nearly free; solid diet → then we talk about what a supplement could and couldn't do — as education, and your doctor gets the final word.)*

The budget triage IS the wow: "₹1,300 of food fixes most of this. I'm deliberately not suggesting powder yet — your gap is cheaper to close with eggs."

---

## 9. The anti-template immune system

The founder's complaint will regrow inside *this* design unless actively prevented. Mechanisms, not intentions:

1. **Charter rule:** example dialogues live in design docs as *themes*; verbatim reuse of example questions in prompts is banned.
2. **Convergence evals:** periodic cross-session n-gram overlap measurement on questions, read-backs, and card notes — flag any lens converging on scripts.
3. **Question-quality evals:** median questions-before-first-recommendation ≤ 3 per lens; fork presence and specificity scored offline.
4. **Adversarial-transcript CI** as a launch gate for the guardrail layer: late-turn red flags (pregnancy at turn 7), opt-in trickery and reversals, consent revocation, mock-source moments, question-loop pathologies, injection attempts via listing text and OCR.
5. **Wow metrics** — making the founder's claim falsifiable: read-back correction/acceptance rate, assumptions-strip edit rate, portrait-chip correction usage, session completion → product click-through, refinement depth, repeat usage. If users never correct the Portrait, it isn't being read; if they always correct it, the inferences are bad.
6. **Cost/abuse controls:** the loop is ~10× today's inference. Per-session and per-user daily budgets in code, anonymous-traffic throttling, and a designed quota-exhaustion experience in the agent's voice ("I've hit today's thinking budget for this session — here's basic search, or come back tomorrow") — never a silent downgrade.

---

## 10. What survives from today's system

The truth layer is largely *already built* — this design repositions it from pipeline slots to emission boundaries:

- `searchCatalog` / `getProduct` / `lookupCatalog` and the source-labeling contract — unchanged, still the only product-fact sources.
- `checkHardConstraints` (incl. currency logic), `dedupeProducts`, budget math (`allocateBudget`, minor-units) — unchanged, invoked by validators.
- The structured-completion + Zod repair harness in `src/lib/ai/client.ts` — becomes the loop's engine.
- Blocked-claim regex sets — become the final backstop tier of the outbound lint (rewrite-first in front of them).
- The keyword red-flag nets — become the deterministic half of the care-flag union.
- `TraceCollector` — feeds the visible trace chips.
- The GEO Lens and the six non-flagship lenses continue on the existing engine untouched; the four flagship lenses move to the loop. (Sequencing, flags, and migration are deliberately out of scope here.)

## 11. Open risks (the honest list)

1. **Latency is the tax on agency** — 4–16 sequential 120B calls; streamed voice and trace chips are load-bearing UX, not polish. P95 must be a tracked SLO; the degraded-finalize path is the pressure valve.
2. **Action-schema reliability** on gpt-oss:120b is the biggest bet — mitigated by riding the proven repair harness, the 2-invalid-actions breaker, and a provider upgrade path if quality demands it.
3. **Loop pathologies** (search thrash, question loops, ledger bloat) — contained by ledgers and caps; every cap is a small rigidity that needs telemetry-driven tuning or the loop becomes a slower pipeline.
4. **Verbatim-quote strictness** vs messy listing HTML — normalization + the quote-picker are required, or the revise-loop burns turns.
5. **Removing the blocking approval modal** trades a spend control for `propose_direction` doctrine + search caps — must be tested as such.
6. **Visible honesty about degradation** converts invisible failures into visible ones. That is the right trade, decided here, explicitly: fake consultation is worse than admitted downtime.
7. **Portrait creepiness** — wrong or over-intimate inferences about a real third party sour the exact moment meant to wow; provenance chips, hedging lints, the sensitive-attribute blocklist, and correctability are the mitigations, and they need real-user testing.
