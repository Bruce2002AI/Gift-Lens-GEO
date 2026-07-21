"use client";

import {
  createElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  ArrowRight,
  ChevronDown,
  Clock,
  HeartHandshake,
  ImagePlus,
  Info,
  Loader2,
  PackageSearch,
  Plus,
  Search,
  Send,
  StickyNote,
  X,
} from "lucide-react";
import {
  EXPERT_LENS_IDS,
  type ExpertEvent,
  type ExpertLensId,
  type ExpertRequest,
  type Fork,
  type LedgerView,
  type SubjectSummary,
  type VerifiedBoardCategory,
  type VerifiedBoardItem,
  type VerifiedPresentation,
} from "@/lib/agent/types";
import { MODE_META } from "@/lib/modes/meta";
import { modeIcon } from "@/components/agent/mode-icons";
import { ProductImage } from "@/components/catalog/ProductImage";
import { FilterBar } from "@/components/expert/FilterBar";
import { PresentationView } from "@/components/expert/PresentationView";
import { ProductBoard, type BoardSort } from "@/components/expert/ProductBoard";
import { LooksBoard } from "@/components/expert/LooksBoard";
import { AskCard } from "@/components/expert/AskCard";
import { OutcomePrompt } from "@/components/personalization/OutcomePrompt";
import { PersonalizedBecause } from "@/components/personalization/PersonalizedBecause";
import { type ProfileFactWire } from "@/components/personalization/ProfilePanel";
import { RecipientToken, type HeroRecipient } from "@/components/personalization/RecipientToken";
import { NewProfileModal } from "@/components/personalization/NewProfileModal";
import { ProfileDrawer } from "@/components/personalization/ProfileDrawer";
import { DeliverToChips } from "@/components/personalization/DeliverToChips";
import { countryName } from "@/lib/gift/countries";
import type { PersonalizationSignal } from "@/lib/personalization/ledger-bridge";
import type { Outcome } from "@/lib/personalization/types";
import { RichText } from "@/components/expert/RichText";
import { useHistory } from "@/components/history/HistoryProvider";
import { HistoryMenu } from "@/components/history/HistoryMenu";
import type { HistoryEntry } from "@/lib/history/types";

// ---------------------------------------------------------------------------
// Feed model — every stream event (plus user messages) lands here in order
// ---------------------------------------------------------------------------

type TraceEventPayload = Extract<ExpertEvent, { type: "trace" }>;

type FeedItemBase =
  | { kind: "user"; text: string; imageUrl?: string }
  | { kind: "say"; text: string }
  | { kind: "trace"; trace: TraceEventPayload }
  | { kind: "ask"; text: string; fork: Fork | null; quickReplies: string[] }
  | { kind: "care"; text: string; flags: string[] }
  | { kind: "propose"; summary: string; sections: Array<{ title: string; detail: string }> }
  | { kind: "present"; presentation: VerifiedPresentation }
  | { kind: "limitation"; text: string }
  | { kind: "notice"; tone: "mock" | "degraded" | "info"; text: string }
  | { kind: "error"; text: string };

type FeedItem = FeedItemBase & { id: number };
type TraceItem = Extract<FeedItem, { kind: "trace" }>;

/** Everything needed to visually restore a past search (see history/storage). */
interface ChatSnapshot {
  feed: FeedItem[];
  board: VerifiedBoardCategory[];
  lens: ExpertLensId | null;
  ledger: LedgerView | null;
  signals: PersonalizationSignal[];
  learnedFacts: ProfileFactWire[];
  subjects: SubjectSummary[];
  activeSubjectId: string;
  sort: BoardSort;
  sessionId: string | null;
}

// ---------------------------------------------------------------------------
// Hero lenses — the launch-screen chip row. All ten modes appear (the style
// guide differentiates lenses by icon + label, not hue); the first four run the
// live expert flow, the rest hand off to the classic flow. Plain names on chips,
// Lens names in captions — see docs/shoplens-style-guide.html.
// ---------------------------------------------------------------------------
type HeroLensId = keyof typeof MODE_META;

interface HeroLens {
  id: HeroLensId;
  /** Plain chip label. */
  label: string;
  /** In the first, always-visible row (vs. behind "More lenses"). */
  top: boolean;
  /** Bold lens name shown in the caption. */
  lensName: string;
  /** Caption remainder, following the bold lens name. */
  captionRest: string;
  /** Typed one-at-a-time into the search placeholder. */
  placeholders: string[];
  /** First-person prompt cards under "Try one". */
  wishes: string[];
}

const HERO_LENSES: HeroLens[] = [
  {
    id: "gift",
    label: "Gifts",
    top: true,
    lensName: "Gift Lens",
    captionRest: "· tell us about them, we rank gifts by how well they fit",
    placeholders: [
      "A retirement gift for my dad who loves fishing",
      "A housewarming gift for friends who just moved to Goa",
      "Something thoughtful for my sister's graduation, under ₹2,500",
    ],
    wishes: [
      "An anniversary gift for my partner who loves coffee and pottery, under ₹5,000",
      "A birthday gift for a 10-year-old who is obsessed with space",
      "A wedding gift for colleagues, elegant but under ₹3,000",
      "Something for my mom who loves gardening and morning tea",
    ],
  },
  {
    id: "skincare",
    label: "Skincare",
    top: true,
    lensName: "Routine Lens",
    captionRest: "· a simple AM/PM routine built around your preferences, not a diagnosis",
    placeholders: [
      "A gentle skincare routine for dry, sensitive skin",
      "A minimal morning routine with SPF, under ₹2,000",
      "Something for sudden breakouts before an event next week",
    ],
    wishes: [
      "My skin feels dry and sensitive. A simple routine under ₹3,000, no fragrance",
      "A beginner routine for oily, acne-prone skin",
      "A night routine focused on dark spots and uneven tone",
      "Fragrance-free sunscreen that will not leave a white cast",
    ],
  },
  {
    id: "style",
    label: "Outfits",
    top: true,
    lensName: "Style Lens",
    captionRest: "· an occasion and a vibe, turned into one coordinated look",
    placeholders: [
      "Something like this jacket, but under ₹4,000",
      "A linen shirt for a beach wedding in June",
      "An office wardrobe refresh, minimal and neutral",
    ],
    wishes: [
      "A smart-casual outfit for a first date. Confident, not overdressed, under ₹12,000",
      "Comfortable but polished outfits for work from home video calls",
      "A festive kurta set for Diwali that is not too heavy",
      "White sneakers that go with everything, under ₹5,000",
    ],
  },
  {
    id: "nutrition",
    label: "Nutrition",
    top: true,
    lensName: "Fuel Lens",
    captionRest: "· a grocery basket organized around your goal, food first",
    placeholders: [
      "High-protein vegetarian snacks for the office",
      "A weekly grocery basket for two, around ₹4,000",
      "Clean pre-workout options without too much caffeine",
    ],
    wishes: [
      "An easy vegetarian basket to hit my protein target, around ₹4,500 a week",
      "Healthy office snacks that are not boring, under ₹1,500 a month",
      "A beginner supplement stack for someone starting the gym",
      "Low-sugar breakfast options for a diabetic parent",
    ],
  },
  {
    id: "swap",
    label: "Swaps",
    top: false,
    lensName: "Swap Lens",
    captionRest: "· show us a product, we find a version that fits you better",
    placeholders: [
      "I like this lamp, find something similar under ₹5,000",
      "A cheaper alternative to this jacket that ships to India",
      "This bag, but from a smaller local brand",
    ],
    wishes: [
      "I like this lamp, find something similar under ₹5,000 that ships to India",
      "A more sustainable version of my usual running shoes",
      "This desk chair, but cheaper and available near me",
      "Something with the same look as this watch, different brand",
    ],
  },
  {
    id: "room",
    label: "Rooms",
    top: false,
    lensName: "Space Lens",
    captionRest: "· pick a mood for your room, get the pieces that create it",
    placeholders: [
      "Make my small bedroom feel warmer and more Scandinavian",
      "A cozy reading corner for under ₹10,000",
      "Calm, clutter-free desk setup for a rented flat",
    ],
    wishes: [
      "Make my small bedroom feel warmer and more Scandinavian for under ₹20,000",
      "A balcony makeover with plants and soft lighting, under ₹8,000",
      "A calm work-from-home corner in my living room",
      "Warm lighting for a rented flat, nothing permanent",
    ],
  },
  {
    id: "travel",
    label: "Travel",
    top: false,
    lensName: "Trip Lens",
    captionRest: "· a compact packing kit for exactly where you are going",
    placeholders: [
      "Iceland for 7 days in October, hiking and city",
      "A carry-on only kit for a week in Singapore",
      "Monsoon trek essentials for the Western Ghats",
    ],
    wishes: [
      "Iceland for 7 days in October — compact kit for hiking and city sightseeing",
      "A beach week in the Andamans, carry-on only",
      "First solo trip to Japan in spring, two weeks",
      "Weekend trek gear for the monsoon, under ₹6,000",
    ],
  },
  {
    id: "hobby",
    label: "Hobbies",
    top: false,
    lensName: "Starter Lens",
    captionRest: "· a beginner kit for the hobby you keep putting off",
    placeholders: [
      "Beginner pour-over coffee kit under ₹8,000",
      "Everything to start watercolor painting",
      "A starter home gym in a small space",
    ],
    wishes: [
      "Beginner pour-over coffee kit under ₹8,000",
      "Everything I need to start watercolor painting, essentials only",
      "A starter kit for baking bread at home",
      "Home workout setup for a small apartment, under ₹12,000",
    ],
  },
  {
    id: "lifestage",
    label: "Life changes",
    top: false,
    lensName: "Chapter Lens",
    captionRest: "· a big life change, planned as must-haves now and later",
    placeholders: [
      "Moving into my first apartment with ₹30,000",
      "Setting up a dorm room from scratch",
      "Starting my first office job next month",
    ],
    wishes: [
      "Moving into my first apartment with ₹30,000 for the essentials",
      "Setting up a nursery, must-haves first",
      "Dorm room essentials for college in August",
      "New job wardrobe and desk setup, phased over two months",
    ],
  },
  {
    id: "occasion",
    label: "Occasions",
    top: false,
    lensName: "Ready Lens",
    captionRest: "· one plan that gets you fully ready for the day",
    placeholders: [
      "Get me ready for a beach wedding",
      "Hosting my first dinner party next weekend",
      "A week of festive prep for Diwali at home",
    ],
    wishes: [
      "Get me ready for a beach wedding — outfit, grooming, and a gift",
      "Hosting eight people for dinner, food to table setting",
      "My convocation next month, head to toe",
      "First wedding anniversary dinner at home, everything covered",
    ],
  },
];

/** The four lenses that drive the live expert flow; the rest hand off to classic. */
const isExpertLens = (id: HeroLensId): id is ExpertLensId =>
  (EXPERT_LENS_IDS as readonly string[]).includes(id);

const SELF_SUBJECT: SubjectSummary = {
  subjectId: "self",
  name: "You",
  relationship: null,
  kind: "self",
  createdBy: "user",
};

/** Consecutive trace events render together as one muted chip row. */
type FeedBlock =
  | { key: string; kind: "traces"; traces: TraceItem[] }
  | { key: string; kind: "item"; item: Exclude<FeedItem, { kind: "trace" }> };

const TRACE_ICONS = { search: Search, inspect: PackageSearch, note: StickyNote } as const;

const MOCK_BANNER = "Demo catalog data — not live listings";

/** Data URLs inflate ~33% over the file, and the route caps them at ~4MB. */
const MAX_IMAGE_BYTES = 2_500_000;

/**
 * Folds a turn's board into the accumulated one. A later turn that narrows to
 * two categories must not erase the shirts the shopper is still considering:
 * categories are add-only, and within a category items dedupe by productId with
 * the newest turn's insight winning (fresh picks lead, older options follow).
 */
function mergeBoard(
  prev: VerifiedBoardCategory[],
  next: VerifiedBoardCategory[],
): VerifiedBoardCategory[] {
  if (next.length === 0) return prev;

  const itemsByCategory = new Map<string, VerifiedBoardItem[]>();
  const order: string[] = [];
  for (const category of prev) {
    itemsByCategory.set(category.name, [...category.items]);
    order.push(category.name);
  }

  for (const category of next) {
    const existing = itemsByCategory.get(category.name);
    if (!existing) {
      itemsByCategory.set(category.name, [...category.items]);
      order.push(category.name);
      continue;
    }
    const merged = [...category.items];
    const seen = new Set(merged.map((item) => item.productId));
    for (const item of existing) {
      if (seen.has(item.productId)) continue;
      seen.add(item.productId);
      // The fresh turn's picks are THE picks: carried-over items keep their
      // place but lose the badge, so re-running a rail under new constraints
      // can't accumulate four "AI pick" badges in one category.
      merged.push(item.isPick ? { ...item, isPick: false } : item);
    }
    itemsByCategory.set(category.name, merged);
  }

  return order.map((name) => ({ name, items: itemsByCategory.get(name) ?? [] }));
}

/** Pulls the route's `{ error }` reason off a failed response, if there is one. */
async function readErrorMessage(res: Response): Promise<string> {
  const fallback = `The expert is unavailable right now (HTTP ${res.status}).`;
  try {
    const body: unknown = await res.json();
    if (body && typeof body === "object" && "error" in body) {
      const { error } = body as { error: unknown };
      if (typeof error === "string" && error.trim()) return error;
    }
  } catch {
    // Not JSON (or already consumed) — fall through to the status message.
  }
  return fallback;
}

/** Three bouncing dots — a livelier "the expert is working" than static text. */
function ThinkingDots({ label = "thinking" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1" role="status" aria-label={`${label}…`}>
      <span className="text-ink-soft">{label}</span>
      <span className="ml-0.5 flex gap-0.5" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-1 w-1 rounded-full bg-plum"
            style={{ animation: "dot-bounce 1.2s infinite", animationDelay: `${i * 0.16}s` }}
          />
        ))}
      </span>
    </span>
  );
}

/** Shimmer placeholders shown in the results grid while the first turn streams. */
function ResultsSkeleton() {
  return (
    <section aria-hidden className="space-y-3">
      <div className="h-4 w-32 rounded skeleton" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 2xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="overflow-hidden rounded-xl border border-line bg-white">
            <div className="aspect-square w-full skeleton" />
            <div className="space-y-2 p-2.5">
              <div className="h-2.5 w-2/3 rounded skeleton" />
              <div className="h-3 w-full rounded skeleton" />
              <div className="h-3 w-1/3 rounded skeleton" />
              <div className="h-8 w-full rounded-lg skeleton" />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function ExpertShopPage() {
  const { status: authStatus } = useSession();
  const router = useRouter();
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [lens, setLens] = useState<ExpertLensId | null>(null);
  const [ledger, setLedger] = useState<LedgerView | null>(null);
  const [board, setBoard] = useState<VerifiedBoardCategory[]>([]);
  /** Profile signals the agent remembered — drives the "Personalized because…" strip. */
  const [signals, setSignals] = useState<PersonalizationSignal[]>([]);
  /** Facts the agent learned this session, accumulated so the panel fills live. */
  const [learnedFacts, setLearnedFacts] = useState<ProfileFactWire[]>([]);
  /** The people the shopper has profiles for; "You" is always first. */
  const [subjects, setSubjects] = useState<SubjectSummary[]>([SELF_SUBJECT]);
  /** Whose profile the conversation is currently about. */
  const [activeSubjectId, setActiveSubjectId] = useState<string>("self");
  /** The listing the shopper just opened — we ask one outcome question about it. */
  const [outcomeFor, setOutcomeFor] = useState<VerifiedBoardItem | null>(null);
  const [outcomeBusy, setOutcomeBusy] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [input, setInput] = useState("");
  const [pendingImage, setPendingImage] = useState<{ dataUrl: string; name: string } | null>(null);
  const [sort, setSort] = useState<BoardSort>("picks");

  // --- Hero launch state -------------------------------------------------
  /** Which lens the launch-screen chip row has selected (drives caption/prompts). */
  const [activeHeroLens, setActiveHeroLens] = useState<HeroLensId>("gift");
  /** Whether the "More lenses" row is expanded. */
  const [lensExpanded, setLensExpanded] = useState(false);
  /** Home-screen recipient chosen in the search bar (gift lens) — sent on search. */
  const [heroRecipient, setHeroRecipient] = useState<HeroRecipient | null>(null);
  /** Home-screen ship-to country (code) + PIN, folded into the first search. */
  const [heroCountry, setHeroCountry] = useState<string | null>(null);
  const [heroPostal, setHeroPostal] = useState("");
  /** The "Someone new" profile modal. */
  const [newProfileOpen, setNewProfileOpen] = useState(false);
  /** The "Gift details" profile drawer (opened from the "+ Add details" chip). */
  const [profileDrawerOpen, setProfileDrawerOpen] = useState(false);
  /** The one ambient animation on the page: the search placeholder types itself. */
  const [typedPlaceholder, setTypedPlaceholder] = useState("");

  const idRef = useRef(0);
  /** The active subject the last `subjects` event reported — detects switches. */
  const activeSubjectRef = useRef("self");
  /** Just THIS turn's board, so a mid-turn backstop switch keeps the new
   *  person's picks without the previous subject's accumulated ones. */
  const lastPresentBoardRef = useRef<VerifiedBoardCategory[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const heroInputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  /** Results column — used to scroll to the newest category after "Similar". */
  const productsRef = useRef<HTMLElement>(null);
  /** Set when "Similar" is clicked, so the next board update scrolls into view. */
  const moreLikePendingRef = useRef(false);
  /** Live mirror of `input` so the typing effect can pause without restarting. */
  const inputValueRef = useRef("");

  // --- Search history (DB-backed; localStorage for guests + mirror) ------
  const {
    entries: recentHistory,
    upsert,
    getSnapshot,
    pendingRestoreId,
    consumeRestore,
    newSearchNonce,
  } = useHistory();
  /** Stable id for the current conversation — the history/restore key. */
  const convIdRef = useRef<string | null>(null);
  /** Debounce handle so a burst of state updates saves once. */
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Skip reacting to the initial nonce; only fire on an actual "+" click. */
  const newSearchSeenRef = useRef(newSearchNonce);
  /** First-seen timestamp per conversation, so re-saves keep a stable createdAt. */
  const createdAtRef = useRef<Record<string, string>>({});

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [feed, streaming]);

  /** After a "Similar" turn finishes, bring the newest category into view — its
   *  fresh picks otherwise land silently at the bottom of the results. */
  useEffect(() => {
    if (streaming || !moreLikePendingRef.current) return;
    moreLikePendingRef.current = false;
    const t = setTimeout(() => {
      const sections = productsRef.current?.querySelectorAll("section[aria-label]");
      sections?.[sections.length - 1]?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
    return () => clearTimeout(t);
  }, [streaming, board]);

  /** Grow the composer to fit its text (up to a cap) instead of scrolling it. */
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [input]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  // Keep the typing effect's view of the input current without re-running it.
  useEffect(() => {
    inputValueRef.current = input;
  }, [input]);

  // The one ambient animation on the page: type each lens's example prompts into
  // the search placeholder, one character at a time. Launch screen only, paused
  // while the shopper types, and skipped entirely under reduced motion.
  useEffect(() => {
    if (feed.length > 0) return; // launch screen only
    const lens = HERO_LENSES.find((l) => l.id === activeHeroLens) ?? HERO_LENSES[0];
    const list = lens.placeholders;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      // Static placeholder under reduced motion — no ambient typing.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTypedPlaceholder(list[0]);
      return;
    }
    let wIdx = 0;
    let cIdx = 0;
    let deleting = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      if (inputValueRef.current.length > 0) {
        setTypedPlaceholder("");
        timer = setTimeout(tick, 800);
        return;
      }
      const word = list[wIdx];
      if (!deleting) {
        cIdx += 1;
        setTypedPlaceholder(word.slice(0, cIdx));
        if (cIdx === word.length) {
          deleting = true;
          timer = setTimeout(tick, 2200);
          return;
        }
        timer = setTimeout(tick, 38 + Math.random() * 40);
      } else {
        cIdx -= 3;
        if (cIdx <= 0) {
          cIdx = 0;
          deleting = false;
          wIdx = (wIdx + 1) % list.length;
        }
        setTypedPlaceholder(word.slice(0, Math.max(cIdx, 0)));
        timer = setTimeout(tick, 16);
      }
    };
    tick();
    return () => clearTimeout(timer);
  }, [activeHeroLens, feed.length]);

  /** Compositions reference board products by id — resolve them from here. */
  const boardIndex = useMemo(() => {
    const index = new Map<string, VerifiedBoardItem>();
    for (const category of board) {
      for (const item of category.items) index.set(item.productId, item);
    }
    return index;
  }, [board]);

  /** The most recent turn's composed "looks" — shown as set cards on the right. */
  const latestCompositions = useMemo(() => {
    for (let i = feed.length - 1; i >= 0; i--) {
      const item = feed[i];
      if (item.kind === "present" && item.presentation.compositions.length > 0) {
        return item.presentation.compositions;
      }
    }
    return [];
  }, [feed]);

  const pushItem = useCallback((item: FeedItemBase) => {
    idRef.current += 1;
    const id = idRef.current;
    setFeed((prev) => [...prev, { ...item, id }]);
  }, []);

  /** Wipe the conversation to a blank slate under a fresh id ("+ new search"). */
  const resetConversation = useCallback(() => {
    abortRef.current?.abort();
    convIdRef.current = crypto.randomUUID();
    idRef.current = 0;
    activeSubjectRef.current = "self";
    lastPresentBoardRef.current = [];
    setFeed([]);
    setBoard([]);
    setLens(null);
    setLedger(null);
    setSignals([]);
    setLearnedFacts([]);
    setSubjects([SELF_SUBJECT]);
    setActiveSubjectId("self");
    setSessionId(null);
    setSort("picks");
    setInput("");
    setPendingImage(null);
    setOutcomeFor(null);
  }, []);

  /** Rehydrate the page from a saved snapshot (view + re-engage). */
  const restoreConversation = useCallback((id: string, snap: ChatSnapshot) => {
    abortRef.current?.abort();
    convIdRef.current = id;
    idRef.current = snap.feed.reduce((max, f) => Math.max(max, f.id), 0);
    activeSubjectRef.current = snap.activeSubjectId;
    lastPresentBoardRef.current = [];
    setFeed(snap.feed);
    setBoard(snap.board);
    setLens(snap.lens);
    setLedger(snap.ledger);
    setSignals(snap.signals);
    setLearnedFacts(snap.learnedFacts);
    setSubjects(snap.subjects.length > 0 ? snap.subjects : [SELF_SUBJECT]);
    setActiveSubjectId(snap.activeSubjectId);
    setSort(snap.sort);
    setSessionId(snap.sessionId);
    setOutcomeFor(null);
  }, []);

  // Reopen a past search requested from the navbar history menu.
  useEffect(() => {
    if (!pendingRestoreId) return;
    let cancelled = false;
    (async () => {
      const snap = await getSnapshot(pendingRestoreId);
      if (!cancelled && snap) restoreConversation(pendingRestoreId, snap as ChatSnapshot);
      if (!cancelled) consumeRestore();
    })();
    return () => {
      cancelled = true;
    };
  }, [pendingRestoreId, consumeRestore, restoreConversation, getSnapshot]);

  // Start a blank search when the navbar "+" is clicked.
  useEffect(() => {
    if (newSearchNonce === newSearchSeenRef.current) return;
    newSearchSeenRef.current = newSearchNonce;
    resetConversation();
  }, [newSearchNonce, resetConversation]);

  // The hero's "Recent searches" list reads `recentHistory` from the provider,
  // which owns hydration and keeps it live — no local subscription needed.

  // Persist the conversation once a turn settles (debounced). View-only restore:
  // we snapshot the visible chat + board, not the server session state.
  useEffect(() => {
    if (streaming || feed.length === 0) return;
    const userMsgs = feed
      .filter((f): f is Extract<FeedItem, { kind: "user" }> => f.kind === "user")
      .map((f) => f.text)
      .filter((t): t is string => Boolean(t));
    if (userMsgs.length === 0) return;

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const id = convIdRef.current ?? (convIdRef.current = crypto.randomUUID());
      const productCount = board.reduce((n, c) => n + c.items.length, 0);
      const now = new Date().toISOString();
      // Keep createdAt stable across a conversation's re-saves. Reading from a
      // ref (not the entries list) keeps this effect off the entries dependency,
      // which would otherwise loop: save → entries change → save.
      const createdAt = (createdAtRef.current[id] ??= now);
      const entry: HistoryEntry = {
        id,
        title: userMsgs[0].slice(0, 100),
        subtitle:
          userMsgs.length > 1
            ? userMsgs[userMsgs.length - 1].slice(0, 100)
            : `${productCount} product${productCount === 1 ? "" : "s"} found`,
        lens,
        createdAt,
        updatedAt: now,
        turnCount: userMsgs.length,
        productCount,
        thumbnailUrl: board[0]?.items[0]?.imageUrl ?? null,
      };
      const snapshot: ChatSnapshot = {
        feed,
        board,
        lens,
        ledger,
        signals,
        learnedFacts,
        subjects,
        activeSubjectId,
        sort,
        sessionId,
      };
      upsert(entry, snapshot);
    }, 600);

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [
    streaming,
    feed,
    board,
    lens,
    ledger,
    signals,
    learnedFacts,
    subjects,
    activeSubjectId,
    sort,
    sessionId,
    upsert,
  ]);

  const handleEvent = useCallback(
    (event: ExpertEvent) => {
      switch (event.type) {
        case "session":
          setSessionId(event.sessionId);
          setLens(event.lens);
          break;
        case "subjects": {
          setSubjects(event.list);
          const switched = event.active !== activeSubjectRef.current;
          activeSubjectRef.current = event.active;
          setActiveSubjectId(event.active);
          if (switched) {
            // The previous subject's remembered signals and learned facts no
            // longer apply — reset them, or the "Personalized because…" strip
            // and the form would show the last person's data under the new name.
            setLearnedFacts([]);
            setSignals([]);
            setSort("picks");
            // Board attribution: a PRE-turn switch invalidates the whole
            // accumulated board; a mid-turn BACKSTOP keeps only this turn's picks
            // (which already belong to the newly-named person).
            setBoard(event.staleBoard ? [] : lastPresentBoardRef.current);
          }
          if (event.announce) {
            const { name, subjectId, created } = event.announce;
            pushItem({
              kind: "notice",
              tone: "info",
              text:
                subjectId === "self"
                  ? "Back to your own profile."
                  : created
                    ? `New profile created for ${name} — now shopping for them. Only their profile is open on the right.`
                    : `Now shopping for ${name}. Their profile is open on the right.`,
            });
          }
          break;
        }
        case "ledger":
          setLedger(event.view);
          break;
        case "personalization":
          // Remembered profile signals that shaped this turn.
          setSignals(event.signals);
          break;
        case "profile":
          // Only what changed this turn, so it accumulates — the panel merges
          // these into the profile it fetched rather than replacing it.
          setLearnedFacts((prev) => [...prev, ...event.facts]);
          break;
        case "done":
          break;
        case "say":
          pushItem({ kind: "say", text: event.text });
          break;
        case "trace":
          pushItem({ kind: "trace", trace: event });
          break;
        case "ask":
          pushItem({ kind: "ask", text: event.text, fork: event.fork, quickReplies: event.quickReplies });
          break;
        case "care":
          pushItem({ kind: "care", text: event.text, flags: event.flags });
          break;
        case "propose":
          pushItem({ kind: "propose", summary: event.summary, sections: event.sections });
          break;
        case "present":
          // Remember this turn's board alone, so a mid-turn backstop switch can
          // keep just these picks for the newly-named person.
          lastPresentBoardRef.current = event.presentation.board;
          setBoard((prev) => mergeBoard(prev, event.presentation.board));
          pushItem({ kind: "present", presentation: event.presentation });
          break;
        case "limitation":
          pushItem({ kind: "limitation", text: event.text });
          break;
        case "notice":
          pushItem({ kind: "notice", tone: event.tone, text: event.text });
          break;
        case "board_prune": {
          // The board is otherwise add-only; a tightened constraint (allergy,
          // exclusion, budget cut) removes now-disallowed items live.
          const remove = new Set(event.removeProductIds);
          if (remove.size === 0) break;
          const strip = (cats: VerifiedBoardCategory[]) =>
            cats
              .map((cat) => ({ ...cat, items: cat.items.filter((it) => !remove.has(it.productId)) }))
              .filter((cat) => cat.items.length > 0);
          setBoard((prev) => strip(prev));
          lastPresentBoardRef.current = strip(lastPresentBoardRef.current);
          pushItem({
            kind: "notice",
            tone: "info",
            text: `Removed ${remove.size} item${remove.size === 1 ? "" : "s"} that no longer fit${
              event.reason ? ` — ${event.reason}` : ""
            }.`,
          });
          break;
        }
        case "error":
          pushItem({ kind: "error", text: event.message });
          break;
      }
    },
    [pushItem],
  );

  /**
   * POST to /api/expert and consume the NDJSON stream line by line.
   * A new turn aborts any in-flight one first (mid-turn interruption).
   */
  const stream = useCallback(
    async (request: ExpertRequest) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setStreaming(true);
      // A fresh turn: forget the previous turn's board so a backstop switch this
      // turn can't adopt stale picks (see the `subjects` handler).
      lastPresentBoardRef.current = [];

      const parseLine = (line: string) => {
        try {
          handleEvent(JSON.parse(line) as ExpertEvent);
        } catch {
          // Skip malformed lines rather than killing the whole stream.
        }
      };

      try {
        const res = await fetch("/api/expert", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
          signal: controller.signal,
        });
        if (!res.ok) {
          // The route rejects bad requests with `{ ok:false, error }` JSON —
          // surface that reason instead of a bare status code.
          throw new Error(await readErrorMessage(res));
        }
        if (!res.body) throw new Error("The expert sent an empty response stream.");

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let newline = buffer.indexOf("\n");
          while (newline >= 0) {
            const line = buffer.slice(0, newline).trim();
            buffer = buffer.slice(newline + 1);
            if (line) parseLine(line);
            newline = buffer.indexOf("\n");
          }
        }
        const tail = (buffer + decoder.decode()).trim();
        if (tail) parseLine(tail);
      } catch (err) {
        if (!controller.signal.aborted) {
          pushItem({
            kind: "error",
            text:
              err instanceof Error
                ? err.message
                : "Something went wrong reaching the expert — please try again.",
          });
        }
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
          setStreaming(false);
        }
      }
    },
    [handleEvent, pushItem],
  );

  const sendMessage = useCallback(
    (
      text: string,
      opts?: {
        lens?: ExpertLensId;
        imageDataUrl?: string;
        setSubject?: ExpertRequest["setSubject"];
      },
    ) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      pushItem({ kind: "user", text: trimmed, imageUrl: opts?.imageDataUrl });
      void stream({
        sessionId: sessionId ?? undefined,
        lens: opts?.lens ?? lens ?? undefined,
        message: trimmed,
        imageDataUrl: opts?.imageDataUrl,
        setSubject: opts?.setSubject ?? undefined,
      });
    },
    [lens, pushItem, sessionId, stream],
  );

  const sendOp = useCallback(
    (label: string, op: NonNullable<ExpertRequest["op"]>) => {
      if (!sessionId) return;
      pushItem({ kind: "user", text: label });
      void stream({ sessionId, lens: lens ?? undefined, op });
    },
    [lens, pushItem, sessionId, stream],
  );

  /** "More like this" under a card — a similarity search anchored on it. The
   *  fresh picks land in a new category at the end, so flag a scroll-to. */
  const handleMoreLike = useCallback(
    (productId: string) => {
      moreLikePendingRef.current = true;
      sendOp("More like this →", { kind: "more_like", productId });
    },
    [sendOp],
  );

  /** Switch the active profile from the sidebar — a message-less turn that just
   *  re-points the session and reloads the chosen person's memory. */
  const selectSubject = useCallback(
    (subjectId: string) => {
      if (subjectId === activeSubjectId) return;
      void stream({ sessionId: sessionId ?? undefined, lens: lens ?? undefined, setSubject: { id: subjectId } });
    },
    [activeSubjectId, lens, sessionId, stream],
  );

  /** "New profile" — the shopper adds a person by hand; the agent opens it. */
  const createSubject = useCallback(
    (name: string, relationship: string | null) => {
      void stream({
        sessionId: sessionId ?? undefined,
        lens: lens ?? undefined,
        setSubject: { name, relationship },
      });
    },
    [lens, sessionId, stream],
  );

  /** Load the shopper's saved people once, so the home recipient picker can
   *  offer them before any conversation has started. */
  useEffect(() => {
    if (authStatus !== "authenticated") return;
    let cancelled = false;
    void fetch("/api/personalization/subjects")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { subjects?: SubjectSummary[] } | null) => {
        if (cancelled || !data?.subjects || data.subjects.length === 0) return;
        setSubjects(data.subjects);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [authStatus]);

  /**
   * Opening a listing is the one moment where a single question is genuinely
   * cheap — the shopper has just formed an opinion. Asked once per product,
   * always dismissible, and never blocking.
   *
   * Only for signed-in shoppers: there is nowhere to store an anonymous
   * visitor's answer, and asking a question we intend to discard is worse than
   * not asking.
   */
  const handleOpenProduct = useCallback(
    (item: VerifiedBoardItem) => {
      if (authStatus !== "authenticated") return;
      setOutcomeFor(item);
    },
    [authStatus],
  );

  const handleOutcome = useCallback(
    async (outcome: Outcome) => {
      const item = outcomeFor;
      if (!item || !lens) return;
      setOutcomeBusy(true);
      try {
        const res = await fetch("/api/personalization/outcomes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            lens,
            productId: item.productId,
            productTitle: item.title,
            outcome,
          }),
        });
        if (!res.ok) {
          // Best-effort, but don't pretend it saved.
          console.warn("outcome not recorded", res.status);
        }
      } catch {
        // Learning from outcomes is best-effort — never interrupt shopping.
      } finally {
        setOutcomeBusy(false);
        setOutcomeFor(null);
      }
    },
    [outcomeFor, lens],
  );

  const submitComposer = () => {
    const text = input.trim();
    if (!text) return;
    const image = pendingImage;
    setInput("");
    setPendingImage(null);
    sendMessage(text, { imageDataUrl: image?.dataUrl });
  };

  const prefillComposer = useCallback((text: string) => {
    setInput(text);
    inputRef.current?.focus();
  }, []);

  const focusComposer = useCallback(() => {
    inputRef.current?.focus();
  }, []);

  /** Pick a lens on the launch screen — expert lenses also arm the live flow. */
  const selectHeroLens = useCallback((id: HeroLensId) => {
    setActiveHeroLens(id);
    if (id !== "gift") setHeroRecipient(null);
    if (isExpertLens(id)) setLens(id);
  }, []);

  /**
   * Submit from the launch screen. Expert lenses start the live conversation
   * right here; the other six carry the prompt to the classic flow.
   */
  const submitHero = useCallback(() => {
    const text = input.trim();
    if (!text) return;
    if (isExpertLens(activeHeroLens)) {
      const image = pendingImage;
      // The gift recipient chosen in the search bar rides along on this first
      // turn: an id switches to a saved person, a name creates a new one.
      const setSubject =
        activeHeroLens === "gift" && heroRecipient
          ? heroRecipient.id
            ? { id: heroRecipient.id }
            : { name: heroRecipient.name, relationship: heroRecipient.relationship ?? null }
          : undefined;
      // Fold the chosen ship-to location + PIN into the message so the agent
      // reads them into the ledger's shipping constraints on this first turn.
      const where = heroCountry
        ? ` (ship to ${countryName(heroCountry)}${heroPostal ? `, PIN ${heroPostal}` : ""})`
        : "";
      setInput("");
      setPendingImage(null);
      setHeroRecipient(null);
      sendMessage(`${text}${where}`, {
        lens: activeHeroLens,
        imageDataUrl: image?.dataUrl,
        setSubject,
      });
    } else {
      const params = new URLSearchParams({ mode: activeHeroLens, q: text });
      router.push(`/shop/classic?${params.toString()}`);
    }
  }, [activeHeroLens, heroCountry, heroPostal, heroRecipient, input, pendingImage, router, sendMessage]);

  /** Tap a prompt card — fill the search box (the shopper still hits go). */
  const pickWish = useCallback((text: string) => {
    setInput(text);
    // Focus and drop the caret at the end AFTER the value commits, so the text
    // isn't left highlighted (a stray selection) in the field.
    requestAnimationFrame(() => {
      const el = heroInputRef.current;
      if (!el) return;
      el.focus();
      const end = el.value.length;
      el.setSelectionRange(end, end);
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const onPickImage = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > MAX_IMAGE_BYTES) {
      pushItem({
        kind: "notice",
        tone: "info",
        text: `That photo is ${(file.size / 1_000_000).toFixed(1)}MB — I can only take images under 2.5MB. Try a smaller one or a screenshot.`,
      });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setPendingImage({ dataUrl: reader.result, name: file.name });
      }
    };
    reader.readAsDataURL(file);
  };

  const blocks = useMemo<FeedBlock[]>(() => {
    const out: FeedBlock[] = [];
    for (const item of feed) {
      if (item.kind === "trace") {
        const last = out[out.length - 1];
        if (last && last.kind === "traces") last.traces.push(item);
        else out.push({ key: `t${item.id}`, kind: "traces", traces: [item] });
      } else {
        out.push({ key: `i${item.id}`, kind: "item", item });
      }
    }
    return out;
  }, [feed]);

  const accentClass =
    lens && MODE_META[lens].accent === "gold" ? "border-l-gold/70" : "border-l-plum/70";

  const renderItem = (item: Exclude<FeedItem, { kind: "trace" }>) => {
    switch (item.kind) {
      case "user":
        return (
          <div className="ml-auto max-w-[86%] rounded-[18px] rounded-br-[4px] bg-plum-wash px-[15px] py-[11px] text-sm leading-[1.5] text-ink">
            <p className="whitespace-pre-wrap">{item.text}</p>
            {item.imageUrl && (
              <ProductImage
                src={item.imageUrl}
                alt="Photo you attached"
                className="mt-2 h-24 w-24 rounded-lg"
              />
            )}
          </div>
        );
      case "say":
        // The agent speaks as plain prose (no bubble) — emphasis via **bold**.
        return (
          <div className="max-w-[95%] text-sm leading-[1.6] text-ink-soft [&_strong]:font-semibold [&_strong]:text-ink">
            <RichText text={item.text} />
          </div>
        );
      case "ask":
        return (
          <AskCard
            text={item.text}
            fork={item.fork}
            quickReplies={item.quickReplies}
            onReply={(reply) => sendMessage(reply)}
          />
        );
      case "care":
        return (
          <div
            role="note"
            className="max-w-[95%] rounded-2xl border border-gold/40 bg-gold-wash px-4 py-3 text-sm leading-relaxed text-ink"
          >
            <span className="mb-1.5 inline-flex items-center gap-1 rounded-full border border-gold/50 bg-white/70 px-2 py-0.5 text-[11px] font-medium text-gold">
              <HeartHandshake size={11} aria-hidden />
              care mode{item.flags.length > 0 ? `: ${item.flags.join(" · ")}` : ""}
            </span>
            <p className="whitespace-pre-wrap">{item.text}</p>
          </div>
        );
      case "propose":
        return (
          <div className="card max-w-[95%] p-4">
            <h3 className="font-(family-name:--font-display) text-base font-semibold">
              {item.summary}
            </h3>
            {item.sections.length > 0 && (
              <ul className="mt-2 space-y-2">
                {item.sections.map((section, i) => (
                  <li key={i} className="rounded-lg bg-sand/50 px-3 py-2">
                    <p className="text-sm font-medium text-ink">{section.title}</p>
                    <p className="text-xs leading-relaxed text-ink-soft">{section.detail}</p>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-primary !py-2 text-sm"
                onClick={() => sendMessage("Go ahead with this plan.")}
              >
                Sounds right — go ahead
              </button>
              <button type="button" className="btn-secondary !py-2 text-sm" onClick={focusComposer}>
                Adjust
              </button>
            </div>
          </div>
        );
      case "present":
        return (
          <PresentationView
            presentation={item.presentation}
            onPrefill={prefillComposer}
            onMoreLike={handleMoreLike}
            onSend={(text) => sendMessage(text)}
            compact
          />
        );
      case "limitation":
        return (
          <div className="max-w-[90%] rounded-2xl border border-line bg-white px-4 py-2.5 text-sm italic leading-relaxed text-ink-soft">
            {item.text}
          </div>
        );
      case "notice":
        if (item.tone === "mock") {
          return (
            <div role="note" className="rounded-xl border border-warn/40 bg-warn/10 px-4 py-2.5 text-sm text-ink">
              <p className="font-semibold">{MOCK_BANNER}</p>
              {item.text && item.text !== MOCK_BANNER && (
                <p className="mt-0.5 text-ink-soft">{item.text}</p>
              )}
            </div>
          );
        }
        if (item.tone === "degraded") {
          return (
            <div role="note" className="rounded-xl border border-line bg-sand px-4 py-2.5 text-sm text-ink-soft">
              {item.text}
            </div>
          );
        }
        return (
          <p className="flex items-start gap-1.5 px-1 text-xs text-ink-soft">
            <Info size={13} className="mt-0.5 shrink-0" aria-hidden />
            {item.text}
          </p>
        );
      case "error":
        return (
          <p role="alert" className="rounded-xl bg-danger/10 px-4 py-2.5 text-sm text-danger">
            {item.text}
          </p>
        );
    }
  };

  const hasStarted = feed.length > 0;
  const totalItems = board.reduce((n, category) => n + category.items.length, 0);

  const composer = (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        submitComposer();
      }}
    >
      {pendingImage && (
        <div className="flex items-start gap-3 rounded-xl border border-line bg-sand/50 p-2">
          <ProductImage
            src={pendingImage.dataUrl}
            alt={`Preview of ${pendingImage.name}`}
            className="h-14 w-14 shrink-0 rounded-lg"
          />
          <p className="flex-1 text-xs leading-relaxed text-ink-soft">
            {"I can't see photos on this setup — the catalog will match visually similar items."}
          </p>
          <button
            type="button"
            aria-label="Remove photo"
            onClick={() => setPendingImage(null)}
            className="rounded p-1 text-ink-soft hover:text-danger"
          >
            <X size={14} aria-hidden />
          </button>
        </div>
      )}

      {/* One unified input surface: the textarea and its actions share a single
          rounded container that lifts and highlights when focused. */}
      <div className="rounded-2xl border border-line bg-white px-3 pb-2 pt-2.5 shadow-(--shadow-card) transition-colors focus-within:border-plum focus-within:ring-2 focus-within:ring-plum/15">
        <label htmlFor="expert-input" className="sr-only">
          Describe what you need
        </label>
        <textarea
          id="expert-input"
          ref={inputRef}
          rows={1}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submitComposer();
            }
          }}
          placeholder={lens ? MODE_META[lens].examplePrompt : "e.g. A retirement gift for my dad…"}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          className="block max-h-[140px] min-h-[24px] w-full resize-none bg-transparent text-sm leading-relaxed text-ink placeholder:text-ink-soft/50 focus:outline-none"
        />
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPickImage} />
        <div className="mt-2 flex items-center justify-between">
          <button
            type="button"
            aria-label="Attach a photo"
            title="Attach a photo — the catalog matches visually similar items"
            onClick={() => fileRef.current?.click()}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-sand hover:text-plum active:scale-90"
          >
            <ImagePlus size={17} aria-hidden />
          </button>
          <div className="flex items-center gap-2">
            <span className="hidden text-[11px] text-ink-soft/70 sm:inline">
              {input.trim() ? "Enter to send · Shift+Enter for a new line" : ""}
            </span>
            <button
              type="submit"
              disabled={!input.trim()}
              aria-label={streaming ? "Interrupt and send" : "Send"}
              title={streaming ? "Sends now — the expert will adjust mid-thought" : undefined}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-plum text-white transition-all hover:bg-plum-dark active:scale-90 disabled:cursor-not-allowed disabled:bg-line disabled:text-ink-soft/50"
            >
              <Send size={16} aria-hidden />
            </button>
          </div>
        </div>
      </div>
    </form>
  );

  // ---------------------------------------------------------------------------
  // Launch state — a focused hero: nothing but the composer until the shopper
  // starts. The split results view only appears once there's a conversation.
  // ---------------------------------------------------------------------------
  if (!hasStarted) {
    const heroLens = HERO_LENSES.find((l) => l.id === activeHeroLens) ?? HERO_LENSES[0];
    const HeroIcon = modeIcon(MODE_META[heroLens.id].icon);

    return (
      <div className="relative">
        <NewProfileModal
          open={newProfileOpen}
          onClose={() => setNewProfileOpen(false)}
          onCreate={(name, relationship, interests) => {
            setHeroRecipient({ id: null, name, relationship });
            if (interests) {
              setInput((prev) => (prev.trim() ? prev : `A gift for ${name} who loves ${interests}`));
            }
            requestAnimationFrame(() => heroInputRef.current?.focus());
          }}
        />
        {/* One soft glow behind the hero — blue with a butter highlight. */}
        <div
          aria-hidden
          className="pointer-events-none fixed left-1/2 top-[-340px] -z-10 h-[1000px] w-[1560px] -translate-x-1/2"
          style={{
            background:
              "radial-gradient(ellipse 58% 55% at 40% 40%, rgba(45,91,255,.11), transparent 68%), radial-gradient(ellipse 48% 50% at 66% 34%, rgba(255,216,77,.20), transparent 68%)",
          }}
        />

        <main className="relative z-[1] mx-auto max-w-[960px] px-6 pb-20 pt-11 text-center sm:pt-16">
          <h1 className="animate-rise font-(family-name:--font-display) text-[clamp(38px,6vw,58px)] font-semibold leading-[1.08] tracking-[-0.02em]">
            What are you
            <br />
            looking for?
          </h1>
          <p className="mx-auto mt-[18px] text-[17px] leading-[1.55] text-ink-soft sm:whitespace-nowrap">
            Describe it in your words. We find real products that ship to you.
          </p>

          {/* Console — lens chips, caption, and search grouped in one card. */}
          <div className="mt-11 rounded-[32px] border border-line bg-white px-[30px] pb-[22px] pt-7 shadow-[0_2px_6px_rgba(28,34,48,.03),0_24px_60px_-24px_rgba(45,91,255,.18)]">
          {/* Lens chips — exactly one active, and it's the only butter object. */}
          <div
            className="flex flex-wrap items-center justify-center gap-2.5"
            role="tablist"
            aria-label="Lenses"
          >
            {HERO_LENSES.map((l) => {
              const active = l.id === activeHeroLens;
              if (!l.top && !lensExpanded && !active) return null;
              const Icon = modeIcon(MODE_META[l.id].icon);
              return (
                <button
                  key={l.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => selectHeroLens(l.id)}
                  className={`inline-flex items-center gap-2.5 rounded-full border px-[22px] py-3 text-[15px] transition-all ${
                    active
                      ? "border-transparent bg-butter font-semibold text-ink shadow-[0_6px_18px_-5px_rgba(255,195,20,.55)]"
                      : "border-line bg-white font-medium text-ink shadow-(--shadow-card) hover:-translate-y-px hover:shadow-(--shadow-hover)"
                  }`}
                >
                  <Icon
                    size={17}
                    strokeWidth={1.9}
                    aria-hidden
                    className={active ? "opacity-100" : "opacity-70"}
                  />
                  {l.label}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setLensExpanded((open) => !open)}
              className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-line bg-transparent px-[22px] py-3 text-[15px] font-medium text-ink-soft transition-colors hover:border-ink-faint hover:text-ink"
            >
              <Plus
                size={14}
                strokeWidth={2.4}
                aria-hidden
                className={`transition-transform ${lensExpanded ? "rotate-45" : ""}`}
              />
              {lensExpanded ? "Fewer lenses" : "More lenses"}
            </button>
          </div>

          <p className="mt-3.5 min-h-[20px] text-[13.5px] text-ink-faint">
            <strong className="font-semibold text-ink-soft">{heroLens.lensName}</strong>{" "}
            {heroLens.captionRest}
          </p>

          {/* Search — flat inside the console, with a focus ring. */}
          <div className="mt-5">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                submitHero();
              }}
              className="flex items-center gap-1.5 rounded-[24px] border-[1.5px] border-line bg-white py-2.5 pl-3 pr-2.5 text-left transition-all focus-within:border-plum focus-within:shadow-[0_0_0_4px_var(--color-plum-wash)]"
            >
              {activeHeroLens === "gift" && (
                <RecipientToken
                  subjects={subjects}
                  value={heroRecipient}
                  onSelect={setHeroRecipient}
                  onNew={() => setNewProfileOpen(true)}
                />
              )}
              <input
                id="hero-search"
                ref={heroInputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={typedPlaceholder}
                aria-label="Describe what you are looking for"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                className="min-w-0 flex-1 border-none bg-transparent py-3 text-[17px] text-ink outline-none placeholder:text-ink-faint"
              />
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={onPickImage}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="inline-flex shrink-0 items-center gap-2 rounded-full px-3.5 py-2.5 text-[14px] font-medium text-ink-soft transition-colors hover:bg-plum-wash hover:text-plum-dark"
              >
                <ImagePlus size={18} aria-hidden />
                <span className="hidden sm:inline">Add a photo</span>
              </button>
              <button
                type="submit"
                aria-label="Search"
                className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-plum text-white transition-all hover:scale-105 hover:bg-plum-dark"
              >
                <ArrowRight size={19} strokeWidth={2.2} aria-hidden />
              </button>
            </form>

            {/* Deliver-to: where it ships + PIN, folded into the first search. */}
            <div className="mt-3.5">
              <DeliverToChips
                country={heroCountry}
                postal={heroPostal}
                onCountry={setHeroCountry}
                onPostal={setHeroPostal}
              />
            </div>

            {pendingImage ? (
              <div className="mx-auto mt-3 flex max-w-sm items-center gap-2 rounded-full border border-line bg-white px-3 py-1.5 text-[13px] text-ink-soft">
                <ImagePlus size={14} aria-hidden className="shrink-0 text-plum" />
                <span className="truncate">{pendingImage.name}</span>
                <button
                  type="button"
                  aria-label="Remove photo"
                  onClick={() => setPendingImage(null)}
                  className="ml-auto rounded-full p-0.5 text-ink-faint hover:text-danger"
                >
                  <X size={14} aria-hidden />
                </button>
              </div>
            ) : (
              <p className="mt-2.5 text-[13.5px] text-ink-faint">
                Seen something you love? Add a photo, we will find it for you.
              </p>
            )}
          </div>
          </div>

          {recentHistory.length > 0 && (
            <div className="mt-11">
              <p className="text-[12.5px] font-semibold uppercase tracking-[0.12em] text-ink-faint">
                Recent searches
              </p>
              <div className="mt-3.5 flex flex-wrap justify-center gap-2.5">
                {recentHistory.slice(0, 4).map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={async () => {
                      const snap = await getSnapshot(entry.id);
                      if (snap) restoreConversation(entry.id, snap as ChatSnapshot);
                    }}
                    className="inline-flex max-w-full items-center gap-2 rounded-full border border-line bg-white px-4 py-2 text-[14px] text-ink shadow-(--shadow-card) transition-all hover:-translate-y-px hover:shadow-(--shadow-hover)"
                  >
                    <Clock size={14} aria-hidden className="shrink-0 text-ink-faint" />
                    <span className="truncate">{entry.title}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Prompt cards — first person, always with a concrete constraint. */}
          <p className="mt-14 text-[12.5px] font-semibold uppercase tracking-[0.12em] text-ink-faint">
            Try one
          </p>
          <div className="mt-[18px] grid grid-cols-1 gap-3 text-left sm:grid-cols-2">
            {heroLens.wishes.map((wish) => (
              <button
                key={wish}
                type="button"
                onClick={() => pickWish(wish)}
                className="flex items-start gap-3.5 rounded-[18px] border border-line bg-white px-5 py-[18px] text-left text-[15px] leading-[1.5] text-ink transition-all hover:-translate-y-0.5 hover:border-transparent hover:shadow-(--shadow-hover)"
              >
                <span className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[10px] bg-butter-soft">
                  <HeroIcon size={17} strokeWidth={1.8} aria-hidden className="text-ink opacity-75" />
                </span>
                <span className="pt-[3px]">{wish}</span>
              </button>
            ))}
          </div>
        </main>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Active state — chat rail (left) + product results page (right).
  // Below 1280px the two columns stack, so the page never scrolls sideways.
  // ---------------------------------------------------------------------------
  return (
    <div className="mx-auto w-full max-w-[1500px] px-4 py-6 sm:px-6">
      <div className="grid gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
        {/* Chat rail */}
        <section aria-label="Conversation" className="min-w-0">
          <div className="card flex max-h-[65vh] flex-col p-4 xl:sticky xl:top-[4.5rem] xl:h-[calc(100vh-6rem)] xl:max-h-none">
            <div className="mb-3 flex items-center justify-between gap-2 border-b border-line pb-3">
              {lens ? <LensBadge lens={lens} /> : <span />}
              <HistoryMenu />
            </div>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1 scroll-fade" aria-live="polite">
              {blocks.map((block) =>
                block.kind === "traces" ? (
                  <div key={block.key} className="animate-rise flex flex-wrap items-center gap-1.5 pl-1">
                    {block.traces.map((t) => {
                      const Icon = TRACE_ICONS[t.trace.kind];
                      return (
                        <span
                          key={t.id}
                          title={t.trace.detail}
                          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${
                            t.trace.ok === false
                              ? "border-warn/40 bg-warn/10 text-warn"
                              : "border-line bg-white text-ink-soft"
                          }`}
                        >
                          <Icon size={11} aria-hidden />
                          {t.trace.label}
                        </span>
                      );
                    })}
                  </div>
                ) : (
                  <div key={block.key} className="animate-rise">
                    {renderItem(block.item)}
                  </div>
                ),
              )}

              {streaming && (
                <WorkingIndicator
                  lensName={lens ? MODE_META[lens].name : null}
                  accentClass={accentClass}
                />
              )}
              <div ref={endRef} />
            </div>

            <div className="mt-3">{composer}</div>
          </div>
        </section>

        {/* Results page */}
        <section ref={productsRef} aria-label="Products" className="min-w-0 space-y-4">
          {/* Toolbar — count + sort. */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-(family-name:--font-display) text-xl font-semibold">
                {totalItems > 0 ? (
                  <>
                    {totalItems} product{totalItems === 1 ? "" : "s"}
                    <span className="ml-2 text-sm font-normal text-ink-soft">
                      across {board.length} categor{board.length === 1 ? "y" : "ies"}
                    </span>
                  </>
                ) : (
                  "Finding products…"
                )}
              </h2>
              {totalItems > 0 && (
                <label className="inline-flex items-center gap-2 text-sm">
                  <span className="text-ink-soft">Sort</span>
                  <span className="relative">
                    <select
                      value={sort}
                      onChange={(e) => setSort(e.target.value as BoardSort)}
                      className="cursor-pointer appearance-none rounded-full border border-line bg-white py-1.5 pl-3 pr-8 text-sm text-ink transition-colors hover:border-plum focus:border-plum focus:outline-none"
                    >
                      <option value="picks">Picks first</option>
                      <option value="price-asc">Price: low to high</option>
                      <option value="price-desc">Price: high to low</option>
                    </select>
                    <ChevronDown
                      size={14}
                      aria-hidden
                      className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-soft"
                    />
                  </span>
                </label>
              )}
            </div>

          </div>

          {/* The single "Shopping with" card — recipient, constraints, interests,
              and "+ Add details", merged from the old filter/subject/portrait rows. */}
          <FilterBar
            view={ledger}
            busy={streaming}
            onRefine={(message) => sendMessage(message)}
            subjects={subjects}
            activeSubjectId={activeSubjectId}
            onSelectSubject={selectSubject}
            onNewProfile={() => setNewProfileOpen(true)}
            onRemoveFact={(factId, value) =>
              sendOp(`Remove: ${value}`, { kind: "correct_fact", factId, remove: true })
            }
            onAddDetails={lens ? () => setProfileDrawerOpen(true) : undefined}
          />

          {/* Someone-new profile modal (also reachable from the recipient chip). */}
          <NewProfileModal
            open={newProfileOpen}
            onClose={() => setNewProfileOpen(false)}
            onCreate={(name, relationship) => createSubject(name, relationship)}
          />

          {/* One dismissible question about the listing just opened. */}
          {outcomeFor && (
            <OutcomePrompt
              productTitle={outcomeFor.title}
              onOutcome={handleOutcome}
              onDismiss={() => setOutcomeFor(null)}
              busy={outcomeBusy}
            />
          )}

          {/* The profile now lives in a right-side drawer, opened by the
              "+ Add details" chip in the Shopping-with bar. */}
          <ProfileDrawer
            open={profileDrawerOpen}
            onClose={() => setProfileDrawerOpen(false)}
            lens={lens}
            learned={learnedFacts}
            subjectId={activeSubjectId}
            onSaveRefresh={() => {
              setProfileDrawerOpen(false);
              sendMessage("Refresh the picks using my saved profile details.");
            }}
          />

          {/* What the agent remembered about this shopper, and why it mattered.
              Renders nothing for a shopper with no stored profile. "Manage"
              opens the profile drawer in place rather than leaving for the
              personalization page. */}
          <PersonalizedBecause
            signals={signals}
            onManage={() => setProfileDrawerOpen(true)}
          />

          {/* Composed "looks" as buyable sets, above the individual products. */}
          {latestCompositions.length > 0 && (
            <LooksBoard
              compositions={latestCompositions}
              boardIndex={boardIndex}
              board={board}
            />
          )}

          {board.length === 0 ? (
            streaming ? (
              <ResultsSkeleton />
            ) : (
              <div className="card p-6 text-sm leading-relaxed text-ink-soft">
                Everything the expert finds lands here — grouped by category, with why each one made
                the list.
              </div>
            )
          ) : (
            <ProductBoard
              board={board}
              busy={streaming}
              onMoreLike={handleMoreLike}
              onOpenProduct={handleOpenProduct}
              layout="grid"
              sort={sort}
              showHeading={false}
            />
          )}
        </section>
      </div>
    </div>
  );
}

/**
 * The "expert is working" indicator — three dots that pulse in sequence,
 * lens-aware, styled to match the agent's own message bubbles so the wait
 * reads as active work rather than a stalled spinner.
 */
/** The active lens as a butter pill badge in the chat-rail header. */
function LensBadge({ lens }: { lens: ExpertLensId }) {
  const meta = MODE_META[lens];
  return (
    <span className="inline-flex items-center gap-2 rounded-full bg-butter px-3.5 py-1.5 text-[13.5px] font-semibold text-ink">
      {createElement(modeIcon(meta.icon), { size: 15, strokeWidth: 1.9, "aria-hidden": true })}
      {meta.name}
    </span>
  );
}

function WorkingIndicator({
  lensName,
  accentClass,
}: {
  lensName: string | null;
  accentClass: string;
}) {
  return (
    <div className="pl-1" role="status" aria-live="polite">
      <div
        className={`inline-flex items-center gap-2.5 rounded-2xl border-l-2 bg-sand px-4 py-2.5 ${accentClass}`}
      >
        <span className="flex items-end gap-1" aria-hidden>
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="h-1.5 w-1.5 rounded-full bg-plum"
              style={{ animation: "dot 1s ease-in-out infinite", animationDelay: `${i * 160}ms` }}
            />
          ))}
        </span>
        <span className="text-sm text-ink-soft">
          {lensName
            ? `${lensName} is searching & verifying…`
            : "Searching & verifying live products…"}
        </span>
      </div>
    </div>
  );
}

/** Placeholder product grid shown while the first verified picks are loading. */
function SkeletonBoard() {
  return (
    <div>
      <p className="mb-3 flex items-center gap-2 text-sm text-ink-soft" role="status">
        <Loader2 size={14} className="animate-spin text-plum" aria-hidden />
        Searching the catalog — verified products appear here as they&apos;re confirmed.
      </p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-hidden>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="card overflow-hidden">
            <div className="skeleton h-44 w-full rounded-none" />
            <div className="space-y-2.5 p-4">
              <div className="skeleton h-3 w-1/3" />
              <div className="skeleton h-4 w-4/5" />
              <div className="skeleton h-3 w-1/2" />
              <div className="mt-3 flex gap-2">
                <div className="skeleton h-8 flex-1 rounded-full" />
                <div className="skeleton h-8 flex-1 rounded-full" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
