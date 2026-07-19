import type {
  NormalizedProduct,
  NormalizedVariant,
} from "@/lib/catalog/types";

/**
 * Mock catalog fixtures in the normalized internal shape.
 * All merchants, URLs, and checkout links are fictional placeholders.
 * These are ONLY served in mock mode, which the UI labels persistently.
 */

interface VariantSeed {
  id: string;
  title: string;
  priceMinor: number;
  available: boolean;
  options?: Array<{ name: string; label: string }>;
  runningLow?: boolean;
  sku?: string;
}

interface ProductSeed {
  id: string;
  title: string;
  description: string;
  merchant: { id: string; name: string; domain: string };
  categories: string[];
  priceMinor: [number, number];
  currency?: string;
  rating?: { value: number; count: number } | null;
  optionNames?: string[];
  variants: VariantSeed[];
  features?: string[];
  specs?: string[];
  usps?: string[];
  imageCount?: number;
  missingAltText?: boolean;
  noPolicyLinks?: boolean;
  requiresShipping?: boolean;
  keywords: string[];
}

function buildProduct(seed: ProductSeed): NormalizedProduct & {
  keywords: string[];
} {
  const currency = seed.currency ?? "INR";
  const slug = seed.id.replace(/^mock:/, "");
  const seller = {
    id: `mock-seller:${seed.merchant.id}`,
    name: seed.merchant.name,
    url: `https://${seed.merchant.domain}`,
    domain: seed.merchant.domain,
    policyLinks: seed.noPolicyLinks
      ? []
      : [
          { type: "refund", url: `https://${seed.merchant.domain}/policies/refund` },
          { type: "shipping", url: `https://${seed.merchant.domain}/policies/shipping` },
        ],
  };
  const variants: NormalizedVariant[] = seed.variants.map((v) => ({
    id: v.id,
    title: v.title,
    url: `https://${seed.merchant.domain}/products/${slug}`,
    sku: v.sku ?? null,
    priceMinor: v.priceMinor,
    currency,
    available: v.available,
    availabilityStatus: v.available ? "in_stock" : "out_of_stock",
    runningLow: v.runningLow ?? false,
    checkoutUrl: v.available
      ? `https://${seed.merchant.domain}/checkout/demo/${slug}`
      : null,
    nativeCheckoutEligible: v.available,
    requiresShipping: seed.requiresShipping ?? true,
    imageUrl: `/demo/${slug}.svg`,
    options: v.options ?? [],
    seller,
  }));

  const optionNames =
    seed.optionNames ??
    Array.from(new Set(variants.flatMap((v) => v.options.map((o) => o.name))));

  return {
    id: seed.id,
    title: seed.title,
    description: seed.description,
    url: `https://${seed.merchant.domain}/products/${slug}`,
    categories: seed.categories.map((value) => ({ value })),
    images: Array.from({ length: seed.imageCount ?? 3 }, (_, i) => ({
      url: `/demo/${slug}.svg`,
      altText: seed.missingAltText ? null : `${seed.title} — view ${i + 1}`,
    })),
    priceRange: {
      minMinor: seed.priceMinor[0],
      maxMinor: seed.priceMinor[1],
      currency,
    },
    options: optionNames.map((name) => ({
      name,
      values: Array.from(
        new Map(
          variants
            .flatMap((v) => v.options.filter((o) => o.name === name))
            .map((o) => [o.label, o]),
        ).values(),
      ).map((o) => ({
        label: o.label,
        exists: true,
        available: variants.some(
          (v) =>
            v.available &&
            v.options.some((vo) => vo.name === name && vo.label === o.label),
        ),
      })),
    })),
    variants,
    rating: seed.rating
      ? { value: seed.rating.value, scaleMax: 5, count: seed.rating.count }
      : { value: null, scaleMax: null, count: null },
    metadata: {
      techSpecs: seed.specs ?? [],
      topFeatures: seed.features ?? [],
      uniqueSellingPoints: seed.usps ?? [],
    },
    rawMessages: [],
    keywords: seed.keywords,
  };
}

export const MOCK_PRODUCTS: Array<NormalizedProduct & { keywords: string[] }> = [
  buildProduct({
    id: "mock:nordhem-pourover-set",
    title: "Nordhem Ceramic Pour-Over Coffee Set — Two-Cup Dripper with Carafe",
    description:
      "A matte ceramic pour-over dripper and 500 ml carafe in a muted sand glaze. Scandinavian silhouette, stackable footprint, and a reusable stainless micro-mesh filter — no paper waste. Dishwasher safe. A calm morning ritual in one compact box, ready for gifting.",
    merchant: { id: "nordhem", name: "Nordhem Studio", domain: "nordhem-studio.example.com" },
    categories: ["Home & Garden > Kitchen & Dining > Coffee Makers", "Gifts"],
    priceMinor: [345000, 345000],
    rating: { value: 4.8, count: 214 },
    variants: [
      {
        id: "mock:nordhem-pourover-set:sand",
        title: "Sand",
        priceMinor: 345000,
        available: true,
        options: [{ name: "Color", label: "Sand" }],
        sku: "NH-PO-SAND",
      },
      {
        id: "mock:nordhem-pourover-set:charcoal",
        title: "Charcoal",
        priceMinor: 345000,
        available: true,
        options: [{ name: "Color", label: "Charcoal" }],
        sku: "NH-PO-CHAR",
      },
    ],
    features: [
      "Reusable stainless micro-mesh filter",
      "Stackable two-piece design saves counter space",
      "Gift-ready recycled packaging",
    ],
    specs: ["Ceramic, 500 ml carafe", "Dishwasher safe"],
    usps: ["Zero-waste brewing", "Scandinavian design studio"],
    keywords: [
      "coffee", "pour-over", "pour over", "ceramic", "scandinavian", "minimalist",
      "housewarming", "kitchen", "brew", "dripper", "design", "nordic", "gift",
    ],
  }),
  buildProduct({
    id: "mock:ritual-pourover",
    title: "The Ritual",
    description: "Start your day right. Beautifully made. You deserve this.",
    merchant: { id: "ritualware", name: "Ritualware", domain: "ritualware.example.com" },
    categories: [],
    priceMinor: [289000, 312000],
    rating: null,
    imageCount: 1,
    missingAltText: true,
    noPolicyLinks: true,
    variants: [
      {
        id: "mock:ritual-pourover:default",
        title: "Default",
        priceMinor: 289000,
        available: false,
      },
      {
        id: "mock:ritual-pourover:large",
        title: "Large",
        priceMinor: 312000,
        available: true,
        options: [{ name: "Size", label: "Large" }],
      },
    ],
    keywords: ["coffee", "pour-over", "ceramic", "ritual", "brew"],
  }),
  buildProduct({
    id: "mock:brewcraft-grinder",
    title: "BrewCraft Compact Manual Coffee Grinder — Stainless Burr, 40 Clicks",
    description:
      "A palm-sized manual burr grinder with 40 external click settings, CNC-machined stainless conical burr, and a frosted glass catch jar. Grinds for pour-over, AeroPress, and French press. Small enough for a drawer or a carry-on.",
    merchant: { id: "brewcraft", name: "BrewCraft", domain: "brewcraft.example.com" },
    categories: ["Home & Garden > Kitchen & Dining > Coffee Grinders"],
    priceMinor: [265000, 265000],
    rating: { value: 4.6, count: 892 },
    variants: [
      {
        id: "mock:brewcraft-grinder:steel",
        title: "Brushed Steel",
        priceMinor: 265000,
        available: true,
        options: [{ name: "Finish", label: "Brushed Steel" }],
        sku: "BC-GR-ST",
      },
      {
        id: "mock:brewcraft-grinder:black",
        title: "Matte Black",
        priceMinor: 265000,
        available: true,
        options: [{ name: "Finish", label: "Matte Black" }],
        sku: "BC-GR-BK",
        runningLow: true,
      },
    ],
    features: ["40-click external adjustment", "Fits inside an AeroPress"],
    specs: ["Stainless conical burr", "35 g capacity"],
    usps: ["Travel-friendly", "No batteries, no noise"],
    keywords: [
      "coffee", "grinder", "manual", "burr", "compact", "travel", "brew",
      "minimalist", "kitchen", "small", "gift",
    ],
  }),
  buildProduct({
    id: "mock:fjord-serving-board",
    title: "Fjord & Pine Oak Serving Board — Hand-Finished Scandinavian Oak, 35 cm",
    description:
      "A hand-sanded solid oak serving board with a leather hanging loop. Food-safe oil finish, subtle grain, and a silhouette that looks at home on open shelving. Made in small batches; each board's grain is unique.",
    merchant: { id: "fjordpine", name: "Fjord & Pine", domain: "fjordpine.example.com" },
    categories: ["Home & Garden > Kitchen & Dining > Serveware"],
    priceMinor: [298000, 298000],
    rating: { value: 4.9, count: 156 },
    variants: [
      {
        id: "mock:fjord-serving-board:35",
        title: "35 cm",
        priceMinor: 298000,
        available: true,
        options: [{ name: "Size", label: "35 cm" }],
      },
      {
        id: "mock:fjord-serving-board:45",
        title: "45 cm",
        priceMinor: 372000,
        available: false,
        options: [{ name: "Size", label: "45 cm" }],
      },
    ],
    features: ["Food-safe oil finish", "Leather hanging loop for open shelves"],
    specs: ["Solid oak, 35 cm × 20 cm"],
    usps: ["Small-batch, unique grain"],
    keywords: [
      "serving board", "oak", "wood", "scandinavian", "kitchen", "housewarming",
      "cheese", "minimalist", "design", "nordic", "entertaining", "gift",
    ],
  }),
  buildProduct({
    id: "mock:solvei-candle-set",
    title: "Solvei Aromatherapy Candle Trio — Fig, Cedar & Sea Salt, Soy Wax",
    description:
      "Three 120 g soy-wax candles in reusable frosted glass jars: Fig Leaf, Cedarwood, and Sea Salt. 28-hour burn each, cotton wicks, no paraffin. Ships in a linen-wrapped gift box with a matchbook.",
    merchant: { id: "solvei", name: "Solvei Home", domain: "solvei-home.example.com" },
    categories: ["Home & Garden > Decor > Candles"],
    priceMinor: [189000, 189000],
    rating: { value: 4.5, count: 431 },
    variants: [
      {
        id: "mock:solvei-candle-set:trio",
        title: "Trio Gift Box",
        priceMinor: 189000,
        available: true,
      },
    ],
    features: ["Gift box with matchbook included", "Reusable frosted jars"],
    specs: ["3 × 120 g soy wax", "28-hour burn per candle"],
    usps: ["Ready to gift — no wrapping needed"],
    keywords: [
      "candle", "aromatherapy", "soy", "cozy", "housewarming", "relaxing",
      "safe", "minimalist", "home", "decor", "gift", "sentimental",
    ],
  }),
  buildProduct({
    id: "mock:terra-coffee-sampler",
    title: "Terra Roast Single-Origin Coffee Sampler — 4 × 100 g Whole Bean Gift Box",
    description:
      "Four single-origin whole-bean coffees — Chikmagalur, Coorg, Araku Valley, and a seasonal guest lot — roasted to order in 100 g resealable tins. Tasting cards included. A tour of Indian coffee growing regions in one letterpressed box.",
    merchant: { id: "terraroast", name: "Terra Roast Co.", domain: "terraroast.example.com" },
    categories: ["Food & Beverage > Coffee"],
    priceMinor: [149000, 149000],
    rating: { value: 4.7, count: 1043 },
    variants: [
      {
        id: "mock:terra-coffee-sampler:whole",
        title: "Whole Bean",
        priceMinor: 149000,
        available: true,
        options: [{ name: "Grind", label: "Whole Bean" }],
      },
      {
        id: "mock:terra-coffee-sampler:ground",
        title: "Ground for Pour-Over",
        priceMinor: 149000,
        available: true,
        options: [{ name: "Grind", label: "Ground for Pour-Over" }],
      },
    ],
    features: ["Roasted to order", "Tasting cards for each origin"],
    specs: ["4 × 100 g resealable tins"],
    usps: ["Tour of Indian coffee regions"],
    keywords: [
      "coffee", "beans", "single-origin", "sampler", "tasting", "gift box",
      "consumable", "foodie", "india", "safe", "gift",
    ],
  }),
  buildProduct({
    id: "mock:linnea-table-runner",
    title: "Linnea Stonewashed Linen Table Runner — Natural Flax, 180 cm",
    description:
      "A stonewashed 100% European flax linen runner in undyed natural. Gets softer with every wash. Understated texture that suits both weeknight tables and dinner parties. OEKO-TEX certified.",
    merchant: { id: "linnea", name: "Linnea Textiles", domain: "linnea-textiles.example.com" },
    categories: ["Home & Garden > Linens > Table Linens"],
    priceMinor: [225000, 225000],
    rating: { value: 4.4, count: 89 },
    variants: [
      {
        id: "mock:linnea-table-runner:natural",
        title: "Natural Flax",
        priceMinor: 225000,
        available: true,
        options: [{ name: "Color", label: "Natural Flax" }],
      },
      {
        id: "mock:linnea-table-runner:sage",
        title: "Sage",
        priceMinor: 225000,
        available: true,
        options: [{ name: "Color", label: "Sage" }],
      },
    ],
    features: ["Softens with every wash", "OEKO-TEX certified"],
    specs: ["100% European flax, 180 × 40 cm"],
    usps: ["Understated, clutter-free decor"],
    keywords: [
      "linen", "table runner", "textile", "scandinavian", "minimalist",
      "housewarming", "dining", "natural", "home", "decor",
    ],
  }),
  buildProduct({
    id: "mock:vandra-daypack",
    title: "Vandra 20L Hiking Daypack — Recycled Ripstop, Trail-Ready",
    description:
      "A 20-litre technical daypack in recycled ripstop nylon with a ventilated back panel, dual bottle pockets, rain cover, and a 2 kg carry weight rating that disappears on your shoulders. Built for day hikes and airport sprints alike.",
    merchant: { id: "vandra", name: "Vandra Outdoor", domain: "vandra-outdoor.example.com" },
    categories: ["Sporting Goods > Outdoor Recreation > Backpacks"],
    priceMinor: [379000, 379000],
    rating: { value: 4.6, count: 517 },
    variants: [
      {
        id: "mock:vandra-daypack:moss",
        title: "Moss Green",
        priceMinor: 379000,
        available: true,
        options: [{ name: "Color", label: "Moss Green" }],
      },
      {
        id: "mock:vandra-daypack:slate",
        title: "Slate Grey",
        priceMinor: 379000,
        available: true,
        options: [{ name: "Color", label: "Slate Grey" }],
      },
    ],
    features: ["Included rain cover", "Ventilated back panel"],
    specs: ["20 L, 540 g", "Recycled ripstop nylon"],
    usps: ["Trail-to-travel versatility"],
    keywords: [
      "hiking", "backpack", "daypack", "outdoor", "trail", "trekking",
      "adventure", "travel", "birthday", "gift",
    ],
  }),
  buildProduct({
    id: "mock:kaja-titanium-mug",
    title: "Kaja Titanium Camp Mug — Ultralight 450 ml with Lid",
    description:
      "A 118 g pure-titanium camp mug with foldable handles and a sip-through lid. Survives campfires, looks good on a desk. Laser-etched contour lines of the Western Ghats on the base.",
    merchant: { id: "kaja", name: "Kaja Gear", domain: "kaja-gear.example.com" },
    categories: ["Sporting Goods > Outdoor Recreation > Camp Kitchen"],
    priceMinor: [219000, 219000],
    rating: { value: 4.7, count: 264 },
    variants: [
      {
        id: "mock:kaja-titanium-mug:450",
        title: "450 ml",
        priceMinor: 219000,
        available: true,
      },
    ],
    features: ["Foldable handles", "Sip-through lid"],
    specs: ["Pure titanium, 118 g, 450 ml"],
    usps: ["Western Ghats contour etching"],
    keywords: [
      "camping", "mug", "titanium", "hiking", "outdoor", "ultralight",
      "trail", "unique", "coffee", "gift",
    ],
  }),
  buildProduct({
    id: "mock:mesa-cheese-board",
    title: "Mesa Marble & Acacia Cheese Board Set with 3 Knives",
    description:
      "A reversible serving board — cool white marble on one side, warm acacia on the other — with three brass-finished cheese knives in a magnetic drawer. Arrives in a rigid two-piece gift box.",
    merchant: { id: "mesa", name: "Mesa Table", domain: "mesa-table.example.com" },
    categories: ["Home & Garden > Kitchen & Dining > Serveware"],
    priceMinor: [412000, 412000],
    rating: { value: 4.5, count: 328 },
    variants: [
      {
        id: "mock:mesa-cheese-board:set",
        title: "Board + 3 Knives",
        priceMinor: 412000,
        available: true,
      },
    ],
    features: ["Magnetic knife drawer", "Rigid gift box"],
    specs: ["Marble + acacia, 30 cm round"],
    usps: ["Classic crowd-pleaser for couples"],
    keywords: [
      "cheese board", "marble", "wedding", "couple", "entertaining", "serveware",
      "safe", "classic", "housewarming", "gift",
    ],
  }),
  buildProduct({
    id: "mock:cloudnine-swaddle",
    title: "CloudNine Organic Muslin Swaddle Set — 3 Breathable Cotton Wraps",
    description:
      "Three 120 × 120 cm swaddle wraps in GOTS-certified organic cotton muslin, pre-washed for softness. Prints: Sandstone Dots, Fern, and Plain Oat. Doubles as a burp cloth, stroller shade, and play mat. Machine washable.",
    merchant: { id: "cloudnine", name: "CloudNine Baby", domain: "cloudnine-baby.example.com" },
    categories: ["Baby & Toddler > Nursing & Feeding > Swaddles"],
    priceMinor: [165000, 165000],
    rating: { value: 4.8, count: 763 },
    variants: [
      {
        id: "mock:cloudnine-swaddle:set3",
        title: "Set of 3",
        priceMinor: 165000,
        available: true,
      },
    ],
    features: ["GOTS-certified organic cotton", "Pre-washed for softness"],
    specs: ["3 × 120 cm² muslin wraps"],
    usps: ["Multi-use: swaddle, burp cloth, shade"],
    keywords: [
      "baby", "swaddle", "muslin", "organic", "new parent", "newborn",
      "practical", "soft", "shower", "gift",
    ],
  }),
  buildProduct({
    id: "mock:hygge-throw",
    title: "Hygge House Chunky Knit Wool Throw — Oatmeal, 130 × 170 cm",
    description:
      "A chunky hand-knit throw in undyed oatmeal wool blend. Heavy enough to feel intentional, neutral enough to live on any sofa. The kind of gift that gets used every single evening.",
    merchant: { id: "hygge", name: "Hygge House", domain: "hygge-house.example.com" },
    categories: ["Home & Garden > Linens > Throws"],
    priceMinor: [389000, 389000],
    rating: { value: 4.6, count: 205 },
    variants: [
      {
        id: "mock:hygge-throw:oatmeal",
        title: "Oatmeal",
        priceMinor: 389000,
        available: true,
        options: [{ name: "Color", label: "Oatmeal" }],
      },
      {
        id: "mock:hygge-throw:charcoal",
        title: "Charcoal",
        priceMinor: 389000,
        available: false,
        options: [{ name: "Color", label: "Charcoal" }],
      },
    ],
    features: ["Hand-knit chunky weave"],
    specs: ["Wool blend, 130 × 170 cm"],
    usps: ["Everyday-use sentimental gift"],
    keywords: [
      "throw", "blanket", "wool", "cozy", "hygge", "scandinavian", "sofa",
      "housewarming", "sentimental", "warm", "home",
    ],
  }),
  buildProduct({
    id: "mock:walnut-french-press",
    title: "Åsen Walnut French Press — 600 ml Borosilicate Glass & Walnut",
    description:
      "A 600 ml borosilicate French press wrapped in hand-turned walnut with a brushed steel plunger. A slower, quieter way to make coffee that looks like a design object between brews.",
    merchant: { id: "asen", name: "Åsen Design", domain: "asen-design.example.com" },
    categories: ["Home & Garden > Kitchen & Dining > Coffee Makers"],
    priceMinor: [455000, 455000],
    rating: { value: 4.9, count: 98 },
    variants: [
      {
        id: "mock:walnut-french-press:600",
        title: "600 ml",
        priceMinor: 455000,
        available: true,
        runningLow: true,
      },
    ],
    features: ["Hand-turned walnut sleeve"],
    specs: ["Borosilicate glass, 600 ml"],
    usps: ["Premium heirloom feel"],
    keywords: [
      "coffee", "french press", "walnut", "premium", "design", "luxurious",
      "scandinavian", "kitchen", "brew", "gift",
    ],
  }),
  buildProduct({
    id: "mock:sip-egift",
    title: "Terra Roast 3-Month Coffee Subscription — Digital Gift Card",
    description:
      "A digital gift: three months of freshly roasted single-origin coffee delivered to the recipient's door. Emailed instantly with a personal note; the recipient picks grind, roast level, and delivery cadence.",
    merchant: { id: "terraroast", name: "Terra Roast Co.", domain: "terraroast.example.com" },
    categories: ["Food & Beverage > Coffee", "Gift Cards"],
    priceMinor: [299000, 299000],
    rating: { value: 4.8, count: 342 },
    requiresShipping: false,
    variants: [
      {
        id: "mock:sip-egift:3mo",
        title: "3 Months",
        priceMinor: 299000,
        available: true,
        options: [{ name: "Duration", label: "3 Months" }],
      },
      {
        id: "mock:sip-egift:6mo",
        title: "6 Months",
        priceMinor: 549000,
        available: true,
        options: [{ name: "Duration", label: "6 Months" }],
      },
    ],
    features: ["Emailed instantly with a personal note", "Recipient controls grind & cadence"],
    specs: ["Digital delivery, no shipping"],
    usps: ["Zero clutter — consumable gift"],
    keywords: [
      "coffee", "subscription", "digital", "gift card", "consumable",
      "clutter-free", "no clutter", "instant", "deadline", "gift",
    ],
  }),
];

export function findMockProduct(id: string): NormalizedProduct | undefined {
  return MOCK_PRODUCTS.find((p) => p.id === id || p.url?.includes(id));
}
