/**
 * Curated vibe → seed-color table. Each entry's `keywords` are matched against
 * the user's description (case-insensitive token overlap, Jaccard scored). All
 * seeds are OKLCH so they flow cleanly into `derivePalette`.
 */
export interface VibeEntry {
  keywords: string[];
  seed: string;
  description: string;
}

export const VIBE_TABLE: VibeEntry[] = [
  {
    keywords: ["playful", "joyful", "energetic", "fun", "bright", "happy"],
    seed: "oklch(0.7 0.2 30)",
    description: "warm orange — playful, energetic",
  },
  {
    keywords: ["calm", "serene", "trustworthy", "professional", "corporate", "stable"],
    seed: "oklch(0.55 0.16 240)",
    description: "muted blue — calm, professional",
  },
  {
    keywords: ["nature", "forest", "organic", "fresh", "green", "growth", "earthy"],
    seed: "oklch(0.55 0.15 145)",
    description: "forest green — natural, fresh",
  },
  {
    keywords: ["bold", "dramatic", "powerful", "strong", "intense"],
    seed: "oklch(0.5 0.2 25)",
    description: "deep red — bold, dramatic",
  },
  {
    keywords: ["minimal", "modern", "monochrome", "neutral", "clean", "simple"],
    seed: "oklch(0.3 0 0)",
    description: "near-black — minimal, monochrome",
  },
  {
    keywords: ["luxurious", "premium", "elegant", "rich", "high-end"],
    seed: "oklch(0.5 0.12 285)",
    description: "deep violet — premium, elegant",
  },
  {
    keywords: ["techy", "futuristic", "cyber", "neon", "digital"],
    seed: "oklch(0.7 0.22 200)",
    description: "electric cyan — techy, futuristic",
  },
  {
    keywords: ["soft", "feminine", "romantic", "delicate", "gentle"],
    seed: "oklch(0.75 0.13 5)",
    description: "blush pink — soft, romantic",
  },
  {
    keywords: ["warm", "cozy", "earthy", "rustic", "natural", "autumn"],
    seed: "oklch(0.55 0.13 60)",
    description: "warm amber — cozy, rustic",
  },
  {
    keywords: ["sunny", "optimistic", "cheerful", "warm", "summer"],
    seed: "oklch(0.85 0.17 90)",
    description: "sun yellow — optimistic, cheerful",
  },
  {
    keywords: ["mysterious", "dark", "edgy", "moody", "noir"],
    seed: "oklch(0.25 0.05 280)",
    description: "deep indigo — moody, mysterious",
  },
  {
    keywords: ["fresh", "minty", "spa", "wellness", "aqua"],
    seed: "oklch(0.7 0.13 165)",
    description: "spa mint — fresh, calming",
  },
  {
    keywords: ["royal", "regal", "purple", "majestic"],
    seed: "oklch(0.45 0.18 295)",
    description: "royal purple — regal, majestic",
  },
  {
    keywords: ["scientific", "medical", "clinical", "trusted", "healthcare"],
    seed: "oklch(0.55 0.1 210)",
    description: "clinical teal — trusted, medical",
  },
  {
    keywords: ["startup", "techy", "modern", "developer", "saas"],
    seed: "oklch(0.6 0.18 265)",
    description: "indigo blue — modern saas",
  },
  {
    keywords: ["financial", "money", "banking", "wealth", "growth"],
    seed: "oklch(0.5 0.13 150)",
    description: "money green — finance, wealth",
  },
  {
    keywords: ["news", "journalism", "editorial", "serious"],
    seed: "oklch(0.4 0.1 30)",
    description: "editorial maroon — serious news",
  },
  {
    keywords: ["candy", "sweet", "sugary", "vibrant", "fun"],
    seed: "oklch(0.75 0.2 350)",
    description: "bubblegum pink — sweet, sugary",
  },
  {
    keywords: ["sport", "athletic", "energy", "high-performance"],
    seed: "oklch(0.65 0.22 15)",
    description: "racing red — athletic, high-energy",
  },
  {
    keywords: ["academic", "scholarly", "library", "tradition", "ivy"],
    seed: "oklch(0.4 0.12 145)",
    description: "ivy green — academic, scholarly",
  },
  {
    keywords: ["cosmic", "space", "stars", "infinite", "deep"],
    seed: "oklch(0.3 0.13 280)",
    description: "deep cosmos — vast, cosmic",
  },
  {
    keywords: ["tropical", "summer", "vacation", "beach", "ocean"],
    seed: "oklch(0.7 0.16 200)",
    description: "tropical ocean — vacation, breezy",
  },
  {
    keywords: ["industrial", "concrete", "raw", "brutalist", "utility"],
    seed: "oklch(0.4 0.02 240)",
    description: "concrete gray — industrial, raw",
  },
  {
    keywords: ["coffee", "warm", "comfort", "morning", "cafe"],
    seed: "oklch(0.45 0.07 60)",
    description: "espresso brown — comforting cafe",
  },
  {
    keywords: ["pastel", "soft", "gentle", "spring", "nursery"],
    seed: "oklch(0.85 0.07 290)",
    description: "pastel lavender — soft, gentle",
  },
  {
    keywords: ["vintage", "retro", "70s", "warm", "nostalgic"],
    seed: "oklch(0.6 0.12 75)",
    description: "retro mustard — vintage, nostalgic",
  },
  {
    keywords: ["fitness", "active", "energy", "athletic"],
    seed: "oklch(0.65 0.18 130)",
    description: "lime energy — fitness, active",
  },
  {
    keywords: ["serious", "law", "legal", "authoritative"],
    seed: "oklch(0.3 0.06 250)",
    description: "navy authority — legal, serious",
  },
  {
    keywords: ["festive", "celebration", "party", "festive"],
    seed: "oklch(0.65 0.25 0)",
    description: "festive crimson — celebration",
  },
  {
    keywords: ["zen", "balanced", "harmony", "calm", "meditative"],
    seed: "oklch(0.55 0.08 145)",
    description: "sage zen — balanced, meditative",
  },
];

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

export function scoreVibe(description: string): { entry: VibeEntry; score: number } | null {
  const tokens = new Set(tokenize(description));
  if (tokens.size === 0) return null;

  let best: { entry: VibeEntry; score: number } | null = null;
  for (const entry of VIBE_TABLE) {
    const entryTokens = new Set(entry.keywords);
    let overlap = 0;
    for (const t of tokens) if (entryTokens.has(t)) overlap += 1;
    const union = tokens.size + entryTokens.size - overlap;
    const score = union === 0 ? 0 : overlap / union;
    if (score > 0 && (!best || score > best.score)) best = { entry, score };
  }
  return best;
}
