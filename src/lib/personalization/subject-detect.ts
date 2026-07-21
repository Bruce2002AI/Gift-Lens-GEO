/**
 * Deterministic detection of WHO a message is about.
 *
 * The agent can name people, but — like every other extraction in this system —
 * relying on the model alone is the weak link. So code reads the shopper's own
 * words for a subject switch: "a gift for my dad Rajesh", "Priya's skincare
 * routine", "actually it's for me". This is what makes the promise real:
 * naming someone re-points the whole conversation at their profile.
 *
 * Pure and DB-free (unit-testable). The caller resolves a detected name/
 * relationship against stored subjects and creates one when it's new.
 */

export type SubjectMention =
  | { target: "self" }
  | { target: "person"; name: string; relationship: string | null }
  | { target: "relationship"; relationship: string };

/** Relationship words → a normalized label shown in the switcher. */
const RELATIONSHIPS: Record<string, string> = {
  dad: "dad", father: "dad", papa: "dad", daddy: "dad",
  mom: "mum", mum: "mum", mother: "mum", mummy: "mum", mommy: "mum",
  sister: "sister", sis: "sister", brother: "brother", bro: "brother",
  wife: "wife", husband: "husband", partner: "partner", spouse: "partner",
  girlfriend: "girlfriend", boyfriend: "boyfriend",
  fiance: "fiancé", fiancee: "fiancée",
  son: "son", daughter: "daughter", kid: "child", child: "child", baby: "baby",
  friend: "friend", bestie: "friend", buddy: "friend", mate: "friend",
  colleague: "colleague", coworker: "colleague",
  boss: "boss", manager: "manager", client: "client", mentor: "mentor", teacher: "teacher",
  cousin: "cousin", uncle: "uncle", aunt: "aunt", auntie: "aunt",
  grandmother: "grandmother", grandma: "grandmother", granny: "grandmother", nani: "grandmother", dadi: "grandmother",
  grandfather: "grandfather", grandpa: "grandfather", nana: "grandfather", dada: "grandfather",
  nephew: "nephew", niece: "niece", neighbour: "neighbour", neighbor: "neighbour", roommate: "roommate",
};

/** Multi-word relationships, matched before single words. */
const MULTI_WORD_RELATIONSHIPS: Array<[RegExp, string]> = [
  [/\bbest\s+friend\b/i, "friend"],
  [/\bco-?worker\b/i, "colleague"],
  [/\bmother[-\s]in[-\s]law\b/i, "mother-in-law"],
  [/\bfather[-\s]in[-\s]law\b/i, "father-in-law"],
  [/\bsister[-\s]in[-\s]law\b/i, "sister-in-law"],
  [/\bbrother[-\s]in[-\s]law\b/i, "brother-in-law"],
  [/\bkid\s+brother\b/i, "brother"],
  [/\bkid\s+sister\b/i, "sister"],
];

/**
 * Relationship-phrase alternation for the "my <rel> <Name>" match — multi-word
 * phrases FIRST so "best friend" wins over "friend" and "mother-in-law" isn't
 * cut to "mother". Fed straight into a regex, so the multi-word source strings
 * carry their own flexible whitespace/hyphen matching.
 */
const REL_PHRASE_ALT = [
  "best\\s+friend",
  "mother[-\\s]in[-\\s]law",
  "father[-\\s]in[-\\s]law",
  "sister[-\\s]in[-\\s]law",
  "brother[-\\s]in[-\\s]law",
  "co-?worker",
  "kid\\s+brother",
  "kid\\s+sister",
  ...Object.keys(RELATIONSHIPS).sort((a, b) => b.length - a.length),
].join("|");

const REL_ALTERNATION = Object.keys(RELATIONSHIPS)
  .sort((a, b) => b.length - a.length)
  .join("|");

/** Map any matched relationship phrase (single or multi-word) to its label. */
function normalizeRel(raw: string): string | null {
  const r = raw.trim().toLowerCase();
  for (const [re, label] of MULTI_WORD_RELATIONSHIPS) if (re.test(r)) return label;
  const first = r.split(/[\s-]+/)[0];
  return RELATIONSHIPS[r] ?? RELATIONSHIPS[first] ?? null;
}

/** Strip a trailing possessive so "Sarah's" is captured as the name "Sarah". */
function stripPossessive(token: string): string {
  return token.replace(/['’]s?$/u, "");
}

/**
 * Words that can follow "for" but are never a person — occasions, generic
 * nouns, times, pronouns. Keeps "a gift for Christmas" / "for work" from
 * minting a profile named "Christmas".
 */
const NOT_A_NAME = new Set([
  "christmas", "diwali", "holi", "eid", "hanukkah", "thanksgiving", "easter", "halloween",
  "birthday", "birthdays", "anniversary", "wedding", "housewarming", "graduation", "valentine",
  "valentines", "festival", "new", "year", "years", "work", "office", "home", "school", "college",
  "gym", "travel", "trip", "vacation", "holiday", "holidays", "party", "dinner", "lunch",
  "summer", "winter", "spring", "autumn", "fall", "monday", "tuesday", "wednesday", "thursday",
  "friday", "saturday", "sunday", "january", "february", "march", "april", "may", "june", "july",
  "august", "september", "october", "november", "december", "today", "tomorrow", "tonight",
  "now", "this", "that", "it", "them", "her", "him", "us", "everyone", "someone", "anyone",
  "myself", "me", "my", "the", "a", "an", "some", "any", "our", "his", "hers", "their", "your",
  "you", "kids", "children", "family", "everybody", "people", "sale", "cheap", "under",
  "each", "both", "two", "three", "here", "fun", "gifting", "reference", "context", "example",
  // Common possessive/for-object nouns that are never a person.
  "inspiration", "ideas", "idea", "something", "anything", "options", "option", "advice",
  "help", "gifts", "presents", "present", "week", "weekend", "month", "morning", "evening",
  "night", "day", "moment", "men", "women", "mens", "womens", "ladies", "everyone's",
  "occasion", "event", "budget", "myself", "ourselves",
  // Contraction stems and sentence openers — a possessive check on "What's",
  // "Let's", "He's", "There's" etc. must never mint a person named "What".
  "what", "whats", "let", "lets", "there", "theres", "where", "wheres", "how", "hows",
  "who", "whos", "whose", "when", "whens", "why", "whys", "he", "she", "they", "we",
  "one", "ones", "world", "worlds", "life", "lifes", "company", "brand", "store",
  "market", "somebody", "nobody", "which", "whatever",
]);

/** Self-reference phrases — switch the profile back to the account owner. */
const SELF_RE =
  /\b(for (myself|me)\b|it'?s for me\b|these? are for me\b|for my own\b|treat myself\b|switch (back )?to (me|myself|my profile)\b|back to (me|my profile|myself)\b|my own (profile|self)\b|shopping for myself\b)/i;

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/** A token that could plausibly be a first name. */
function isNameLike(token: string): boolean {
  const t = token.trim();
  if (t.length < 2 || t.length > 20) return false;
  const lower = t.toLowerCase();
  if (NOT_A_NAME.has(lower)) return false;
  if (lower in RELATIONSHIPS) return false;
  // Letters (incl. unicode), optional internal apostrophe/hyphen. No digits.
  return /^[\p{L}][\p{L}'’-]*$/u.test(t);
}

/**
 * Read a message for a subject switch. `knownNames` are the shopper's existing
 * people; a bare mention of one of them (e.g. "what about Priya?") switches to
 * them even without a "for" cue. Priority: explicit self → known name →
 * relationship+name → for/possessive name → relationship-only.
 */
export function detectSubjectMention(
  message: string,
  knownNames: readonly string[] = [],
): SubjectMention | null {
  const text = message.normalize("NFC");
  if (!text.trim()) return null;

  const mentionsRelationship =
    new RegExp(`\\bmy\\s+(?:${REL_ALTERNATION})\\b`, "i").test(text) ||
    matchMultiWordRelationship(text) != null;

  // 1. Explicit "it's for me" — but a competing "my <relationship>" in the same
  //    message ("something for me and my sister") means they're not the subject.
  if (SELF_RE.test(text) && !mentionsRelationship) {
    return { target: "self" };
  }

  // 2. A known person named anywhere — the strongest, least ambiguous signal.
  for (const name of knownNames) {
    const clean = name.trim();
    if (clean.length < 2) continue;
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(clean)}([^\\p{L}\\p{N}]|$)`, "iu");
    if (re.test(text)) {
      return { target: "person", name: clean, relationship: relationshipNear(text, clean) };
    }
  }

  // 3. "(for) my <relationship> <Name>" — capture both, including multi-word
  //    relationships ("my best friend Alex", "my mother-in-law Susan"). The
  //    name must be Capitalized so a verb ("my mom NEEDS a gift") can't be
  //    mistaken for a name, and a trailing possessive is stripped ("Sarah's").
  const relNameRe = new RegExp(
    `\\b(?:for\\s+)?(?:my|his|her|their)\\s+(${REL_PHRASE_ALT})\\b[\\s,]+([\\p{L}][\\p{L}'’-]{1,19})`,
    "iu",
  );
  const relName = text.match(relNameRe);
  if (relName) {
    const candidate = stripPossessive(relName[2]);
    if (/^[\p{Lu}]/u.test(candidate) && isNameLike(candidate)) {
      return { target: "person", name: titleCase(candidate), relationship: normalizeRel(relName[1]) };
    }
  }

  // 4. "gift/present/shopping/buy … for <Name>" — needs a shopping cue before
  //    "for", so "a gift for Christmas" (occasion, stop-listed) can't slip
  //    through and neither can an incidental "looking for inspiration".
  const forNameRe =
    /\b(?:gift|present|something|shopping|shop|buy|buying|get|getting|surprise|pick|picking|treat)\b[^.?!]{0,40}?\bfor\s+([\p{L}][\p{L}'’-]{1,19})/iu;
  const forName = text.match(forNameRe);
  if (forName && !mentionsRelationship) {
    const candidate = stripPossessive(forName[1]);
    if (isNameLike(candidate)) {
      return { target: "person", name: titleCase(candidate), relationship: null };
    }
  }

  // 5. "<Name>'s <thing>" — weakly anchored, so require the name be Capitalized
  //    in the original text. Catches "Priya's routine" without firing on
  //    "today's deal", "this week's", or contractions like "What's"/"Let's".
  const possessive = text.match(/\b([\p{L}][\p{L}'’-]{1,19})['’]s\b/u);
  if (possessive && /^[\p{Lu}]/u.test(possessive[1]) && isNameLike(possessive[1])) {
    return { target: "person", name: titleCase(possessive[1]), relationship: null };
  }

  // 6. A relationship with no name ("a gift for my sister"): the caller resolves
  //    it against known people or opens a relationship-labelled profile.
  const relOnly =
    matchMultiWordRelationship(text) ??
    (text.match(new RegExp(`\\b(?:for\\s+)?my\\s+(${REL_ALTERNATION})\\b`, "i"))?.[1] ?? null);
  if (relOnly) {
    return { target: "relationship", relationship: normalizeRel(relOnly) ?? relOnly.toLowerCase() };
  }

  return null;
}

function matchMultiWordRelationship(text: string): string | null {
  for (const [re, label] of MULTI_WORD_RELATIONSHIPS) {
    if (re.test(text)) return label;
  }
  return null;
}

/** If a relationship word sits within a few tokens of a name, tag it. */
function relationshipNear(text: string, name: string): string | null {
  const re = new RegExp(
    `\\bmy\\s+(${REL_ALTERNATION})\\b[\\s,]+(?:${escapeRegExp(name)})|(?:${escapeRegExp(name)})[\\s,]+my\\s+(${REL_ALTERNATION})\\b`,
    "iu",
  );
  const m = text.match(re);
  if (m) return normalizeRel(m[1] ?? m[2] ?? "");
  return null;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
