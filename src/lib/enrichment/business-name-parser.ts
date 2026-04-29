/**
 * Heuristic parser for business-style `contractor_name` / `applicant_name` /
 * `owner_name` strings.
 *
 * We have ~28,610 permits with a populated `contractor_name` (or the like)
 * that looks like: "JOHN SMITH ROOFING LLC", "ACME Plumbing Inc",
 * "Smith & Sons Construction", "1 Fulton Street Llc", "Wohrer, Dominique A".
 *
 * For a meaningful chunk of these we can pull out a real first + last name
 * purely from string-munging — no API calls, no cost, safe to run against
 * the entire catalog. Pure business names (REITs, street-number LLCs) don't
 * yield a person; we return `confidence` low and let the caller drop them.
 *
 * This module is intentionally conservative: better to return `confidence`
 * below the caller's threshold than to invent a fake homeowner.
 *
 * Used by `src/lib/ingest/extract-contact.ts` as a fallback when the direct
 * first/last key lookup turns up nothing.
 */

export interface ParsedBusinessName {
  /** Parsed first name, titlecased, or null if we couldn't identify one. */
  first: string | null;
  /** Parsed last name, titlecased, or null if we couldn't identify one. */
  last: string | null;
  /** The non-name portion of the input — e.g. "Roofing", "Plumbing Inc". */
  company: string | null;
  /** Detected legal entity suffix. "individual" if the input looks like a bare person. */
  entity_type:
    | "llc"
    | "inc"
    | "corp"
    | "co"
    | "ltd"
    | "trust"
    | "individual"
    | "unknown";
  /** 0..1 — callers typically accept >= 0.6 before writing the result. */
  confidence: number;
  /** True when we're confident the parsed first+last names name a real person. */
  disambiguated: boolean;
}

/* ── suffix + trade keyword dictionaries ───────────────────────────────────── */

/** Legal entity suffixes. Order matters only for display — matching is
 *  case-insensitive whole-token, so "LLC" and "L.L.C." both hit.
 *  Keys map to the `entity_type` discriminator on the returned object. */
const ENTITY_SUFFIX_MAP: Record<string, ParsedBusinessName["entity_type"]> = {
  llc: "llc",
  "l.l.c.": "llc",
  "l.l.c": "llc",
  inc: "inc",
  incorporated: "inc",
  corp: "corp",
  corporation: "corp",
  co: "co",
  company: "co",
  ltd: "ltd",
  limited: "ltd",
  trust: "trust",
};

/** Trade / generic business words that tell us the token stream is a company
 *  name, not a personal one. Matched case-insensitive against whole tokens.
 *  If a trade word appears, everything after it (up through the entity
 *  suffix) is "company" text, not part of the person's name. */
const TRADE_KEYWORDS = new Set<string>([
  "roofing",
  "plumbing",
  "electric",
  "electrical",
  "hvac",
  "solar",
  "landscaping",
  "landscape",
  "construction",
  "contracting",
  "contractor",
  "contractors",
  "services",
  "service",
  "builders",
  "builder",
  "building",
  "renovation",
  "renovations",
  "remodeling",
  "remodel",
  "design",
  "development",
  "properties",
  "property",
  "management",
  "realty",
  "real",
  "estate",
  "investments",
  "investment",
  "holdings",
  "holding",
  "group",
  "associates",
  "partners",
  "enterprises",
  "enterprise",
  "industries",
  "industry",
  "gc",
  "general",
  "carpentry",
  "masonry",
  "painting",
  "flooring",
  "tile",
  "concrete",
  "drywall",
  "mechanical",
  "heating",
  "cooling",
  "refrigeration",
  "windows",
  "doors",
  "siding",
  "fencing",
  "pool",
  "pools",
]);

/** Two-word trade phrases we treat as a single stop-token. Matched before
 *  the single-word scan, so "Real Estate" doesn't leak "Real" through as
 *  part of the name. */
const TRADE_PHRASES: string[][] = [
  ["real", "estate"],
  ["general", "contractor"],
  ["general", "contracting"],
];

/* ── tokenization helpers ──────────────────────────────────────────────────── */

/** Conservative titlecase: "JOHN SMITH" → "John Smith". Keeps existing
 *  mixed-case strings untouched (so "McBride" stays "McBride"). */
function titlecaseToken(token: string): string {
  if (!token) return token;
  if (/[a-z]/.test(token)) return token;
  return token[0].toUpperCase() + token.slice(1).toLowerCase();
}

/** Titlecase every whitespace-separated word, honoring the same
 *  "leave mixed case alone" rule used elsewhere in the pipeline. */
function titlecase(s: string): string {
  return s
    .split(/\s+/)
    .filter(Boolean)
    .map(titlecaseToken)
    .join(" ");
}

/** Strip punctuation noise we don't care about — commas, periods outside
 *  abbreviations, etc. Keeps `&` (used in "John & Jane") and `'` (used in
 *  names like "O'Brien"). */
function cleanToken(token: string): string {
  // Strip a trailing period ("Inc.") but keep internal periods ("L.L.C.").
  return token.replace(/^[,.\-]+|[,.\-]+$/g, "");
}

/** True when the token is a legal entity suffix (LLC, Inc, Corp, etc.). */
function isEntitySuffix(token: string): boolean {
  return Object.prototype.hasOwnProperty.call(
    ENTITY_SUFFIX_MAP,
    token.toLowerCase().replace(/\.+$/, ""),
  );
}

/** True when the token is a trade / generic-business word. */
function isTradeWord(token: string): boolean {
  return TRADE_KEYWORDS.has(token.toLowerCase());
}

/** True when the token is purely numeric (e.g. "1" in "1 Fulton Street LLC"
 *  or a street number). Used to reject inputs that start with a number
 *  as personal-name candidates. */
function isNumeric(token: string): boolean {
  return /^\d+(?:st|nd|rd|th)?$/i.test(token);
}

/** True for common street-type words that, when present, strongly suggest
 *  the input is an address-holding LLC ("1 Fulton Street LLC"). */
const STREET_WORDS = new Set<string>([
  "street", "st", "avenue", "ave", "road", "rd", "boulevard", "blvd",
  "drive", "dr", "lane", "ln", "place", "pl", "court", "ct", "parkway",
  "pkwy", "way", "terrace", "ter", "circle", "cir", "highway", "hwy",
  "suite", "ste", "unit", "apt", "floor", "fl",
]);

function hasStreetWord(tokens: string[]): boolean {
  return tokens.some((t) => STREET_WORDS.has(t.toLowerCase()));
}

/* ── parser ────────────────────────────────────────────────────────────────── */

/** Empty return used for null / garbage input. */
function emptyResult(): ParsedBusinessName {
  return {
    first: null,
    last: null,
    company: null,
    entity_type: "unknown",
    confidence: 0,
    disambiguated: false,
  };
}

/** Detect + consume trailing entity suffix. Returns `{ stripped, entity }`
 *  where `stripped` is the token list with the suffix removed (if any) and
 *  `entity` is the detected entity_type (or "unknown" if none). */
function stripEntitySuffix(tokens: string[]): {
  stripped: string[];
  entity: ParsedBusinessName["entity_type"];
} {
  if (!tokens.length) return { stripped: tokens, entity: "unknown" };
  const last = tokens[tokens.length - 1]
    .toLowerCase()
    .replace(/\.+$/, "");
  if (Object.prototype.hasOwnProperty.call(ENTITY_SUFFIX_MAP, last)) {
    return {
      stripped: tokens.slice(0, -1),
      entity: ENTITY_SUFFIX_MAP[last],
    };
  }
  return { stripped: tokens, entity: "unknown" };
}

/** Walk the token list and return the index of the first trade word /
 *  trade phrase we encounter, or -1 if none.
 *
 *  Detecting trade phrases first lets "REAL ESTATE HOLDINGS" collapse to a
 *  single stop point at "real", not at "real estate" separately. */
function findTradeBoundary(tokens: string[]): number {
  for (let i = 0; i < tokens.length; i++) {
    const lower = tokens[i].toLowerCase();
    // Check two-word phrases first.
    if (i + 1 < tokens.length) {
      const next = tokens[i + 1].toLowerCase();
      for (const phrase of TRADE_PHRASES) {
        if (phrase[0] === lower && phrase[1] === next) return i;
      }
    }
    if (TRADE_KEYWORDS.has(lower)) return i;
  }
  return -1;
}

/** Handle the "Last, First M" comma-inverted form up front because the
 *  comma flips the usual first/last positioning. Returns null if the
 *  input doesn't look like that shape. */
function tryCommaInverted(raw: string): ParsedBusinessName | null {
  const commaIdx = raw.indexOf(",");
  if (commaIdx < 0) return null;

  const before = raw.slice(0, commaIdx).trim();
  const after = raw.slice(commaIdx + 1).trim();
  if (!before || !after) return null;

  // Reject the comma-inverted form for obvious companies on either side.
  const beforeTokens = before.split(/\s+/).map(cleanToken).filter(Boolean);
  const afterTokens = after.split(/\s+/).map(cleanToken).filter(Boolean);
  if (!beforeTokens.length || !afterTokens.length) return null;
  if (beforeTokens.some(isEntitySuffix) || afterTokens.some(isEntitySuffix)) {
    return null;
  }
  if (beforeTokens.some(isTradeWord) || afterTokens.some(isTradeWord)) {
    return null;
  }
  // Numbers / street words on the left imply this isn't a surname.
  if (beforeTokens.some(isNumeric) || hasStreetWord(beforeTokens)) return null;

  // "Last" side should be a single word or hyphenated surname; "First" side
  // is first name plus optional middle initial ("Dominique A", "Eric J").
  if (beforeTokens.length > 2) return null;
  if (afterTokens.length > 3) return null;

  const lastName = titlecase(beforeTokens.join(" "));
  // Drop a trailing single-letter middle initial from the "first" side.
  const afterFiltered = afterTokens.filter(
    (t, i) => !(i > 0 && t.length === 1),
  );
  const firstName = titlecase(afterFiltered.join(" "));
  if (!firstName || !lastName) return null;

  return {
    first: firstName,
    last: lastName,
    company: null,
    entity_type: "individual",
    confidence: 0.8,
    disambiguated: true,
  };
}

/** Pattern: "John & Jane Smith" — a shared-surname couple. We preserve
 *  both first names joined by `&` so the caller can show both on the card. */
function tryAmpersandCouple(
  tokens: string[],
): ParsedBusinessName | null {
  const ampIdx = tokens.findIndex((t) => t === "&" || t.toLowerCase() === "and");
  if (ampIdx <= 0 || ampIdx >= tokens.length - 1) return null;

  const before = tokens.slice(0, ampIdx);
  const after = tokens.slice(ampIdx + 1);
  // "John & Jane Smith" → before=[John], after=[Jane, Smith]
  if (before.length !== 1) return null;
  if (after.length < 2) return null;
  // Reject if the second half looks like a company.
  if (after.some(isTradeWord) || after.some(isEntitySuffix)) return null;
  // Reject if the second half looks like "Sons Plumbing" — a family-name
  // company. Heuristic: if any tail token looks like a generic plural
  // ("Sons", "Brothers", "Associates"), this isn't a couple.
  const genericPlurals = new Set(["sons", "brothers", "bros", "daughters", "family"]);
  if (after.some((t) => genericPlurals.has(t.toLowerCase()))) return null;

  const first = `${titlecase(before[0])} & ${titlecase(after[0])}`;
  const last = titlecase(after.slice(1).join(" "));
  if (!last) return null;

  return {
    first,
    last,
    company: null,
    entity_type: "individual",
    confidence: 0.6,
    disambiguated: true,
  };
}

/** Pattern: "Smith & Sons Plumbing" — a family-name-led company. We keep
 *  the first token as the surname so at least one person hook survives. */
function tryFamilyNameCompany(
  tokens: string[],
  entity: ParsedBusinessName["entity_type"],
  company: string | null,
): ParsedBusinessName | null {
  // Need "<Name> & Sons/Brothers/Family …" shape, no further processing.
  const ampIdx = tokens.findIndex((t) => t === "&" || t.toLowerCase() === "and");
  if (ampIdx !== 1) return null;
  const first = tokens[0];
  if (!first || isNumeric(first)) return null;

  const genericPlurals = new Set(["sons", "brothers", "bros", "daughters", "family"]);
  const second = tokens[ampIdx + 1]?.toLowerCase();
  if (!second || !genericPlurals.has(second)) return null;

  return {
    first: null,
    last: titlecase(first),
    company,
    entity_type: entity !== "unknown" ? entity : "unknown",
    confidence: 0.6,
    disambiguated: false,
  };
}

/** Core parser: takes the token list (entity suffix already stripped) and
 *  decides whether the leading tokens name a real person.
 *
 *  Rules of thumb:
 *    - "First Last" (2 tokens, alpha) → individual, high confidence
 *    - "First M Last" (3 tokens, middle single letter) → high confidence
 *    - "First Last <trade-word>…" → the trade boundary tells us the name
 *      ends right before the trade word. Confidence scales with how many
 *      pure-alpha tokens precede the boundary.
 *    - All-numeric start or street-word present → company, no person name.
 *    - 1 token → can't split first/last safely; treat as company name.
 */
function parsePersonFromTokens(
  tokens: string[],
  entity: ParsedBusinessName["entity_type"],
  rawCompany: string | null,
): ParsedBusinessName {
  if (!tokens.length) {
    return {
      first: null,
      last: null,
      company: rawCompany,
      entity_type: entity,
      confidence: 0.2,
      disambiguated: false,
    };
  }

  // Early rejection: starts with a number, or has street words. This is an
  // address-holding company name, not a person.
  if (isNumeric(tokens[0]) || hasStreetWord(tokens)) {
    return {
      first: null,
      last: null,
      company: rawCompany,
      entity_type: entity,
      confidence: 0.2,
      disambiguated: false,
    };
  }

  // Couple pattern before trade detection: "John & Jane Smith".
  const couple = tryAmpersandCouple(tokens);
  if (couple) return { ...couple, entity_type: entity !== "unknown" ? entity : couple.entity_type };

  // "Smith & Sons Plumbing" — keep the surname, drop first.
  const family = tryFamilyNameCompany(tokens, entity, rawCompany);
  if (family) return family;

  // Find trade boundary. Everything before it is the name, everything
  // after (up to entity suffix already stripped) is company text.
  const boundary = findTradeBoundary(tokens);
  const nameTokens = boundary >= 0 ? tokens.slice(0, boundary) : tokens.slice();
  const tailTokens = boundary >= 0 ? tokens.slice(boundary) : [];

  // If nothing before the trade word, we've got a pure trade company
  // ("Roofing Pros LLC" style — rare but possible).
  if (!nameTokens.length) {
    return {
      first: null,
      last: null,
      company: rawCompany ?? titlecase(tokens.join(" ")),
      entity_type: entity,
      confidence: 0.2,
      disambiguated: false,
    };
  }

  // Single token — can't split into first+last. Could be a surname-only
  // company ("Smith Construction") which we've already sliced off above,
  // or a single-name business ("Apollo LLC"). Either way, don't invent
  // a first name.
  if (nameTokens.length === 1) {
    // Boundary present means a trade word followed — "Smith Roofing". That
    // surname is usable as a last name, but we can't fabricate a first.
    // Confidence low because no real person was identified.
    return {
      first: null,
      last: boundary >= 0 ? titlecase(nameTokens[0]) : null,
      company: rawCompany ?? titlecase([...nameTokens, ...tailTokens].join(" ")),
      entity_type: entity,
      confidence: boundary >= 0 ? 0.35 : 0.2,
      disambiguated: false,
    };
  }

  // Two tokens → "First Last". Strong signal.
  if (nameTokens.length === 2) {
    const [f, l] = nameTokens;
    if (!isAlphaName(f) || !isAlphaName(l)) {
      return {
        first: null,
        last: null,
        company: rawCompany ?? titlecase(tokens.join(" ")),
        entity_type: entity,
        confidence: 0.2,
        disambiguated: false,
      };
    }
    // Reject initialisms masquerading as first names — "SL GREEN REALTY
    // CORP" should not produce first=SL last=Green.
    if (looksLikeInitialism(f)) {
      return {
        first: null,
        last: null,
        company: rawCompany ?? titlecase(tokens.join(" ")),
        entity_type: entity,
        confidence: 0.2,
        disambiguated: false,
      };
    }
    // Confidence: 0.9 if bare "First Last", 0.85 if entity suffix stripped,
    // 0.7 if trade boundary had to be used to cut the name out.
    let confidence = 0.9;
    if (entity !== "unknown") confidence = 0.85;
    if (boundary >= 0) confidence = 0.7;

    return {
      first: titlecase(f),
      last: titlecase(l),
      company: rawCompany,
      entity_type: entity !== "unknown" ? entity : boundary >= 0 ? "individual" : "individual",
      confidence,
      disambiguated: true,
    };
  }

  // Three tokens — look for "First M Last" (middle initial) or
  // "First Middle Last".
  if (nameTokens.length === 3) {
    const [f, m, l] = nameTokens;
    if (!isAlphaName(f) || !isAlphaName(l)) {
      // Probably not a real name — fall through to the ">3" branch.
    } else if (isMiddleInitial(m)) {
      let confidence = 0.85;
      if (entity !== "unknown") confidence = 0.8;
      if (boundary >= 0) confidence = 0.65;
      return {
        first: titlecase(f),
        last: titlecase(l),
        company: rawCompany,
        entity_type: entity !== "unknown" ? entity : "individual",
        confidence,
        disambiguated: true,
      };
    } else if (isAlphaName(m)) {
      // "First Middle Last" — treat Middle as middle name, keep first+last.
      let confidence = 0.75;
      if (entity !== "unknown") confidence = 0.7;
      if (boundary >= 0) confidence = 0.6;
      return {
        first: titlecase(f),
        last: titlecase(l),
        company: rawCompany,
        entity_type: entity !== "unknown" ? entity : "individual",
        confidence,
        disambiguated: true,
      };
    }
  }

  // 4+ tokens with no trade boundary → too long to be a personal name.
  // Treat as a company and don't split out a person.
  return {
    first: null,
    last: null,
    company: rawCompany ?? titlecase(tokens.join(" ")),
    entity_type: entity,
    confidence: 0.2,
    disambiguated: false,
  };
}

/** True for tokens that are pure alphabetic (optionally with `'` / `-`
 *  which appear in legitimate surnames like "O'Brien", "Smith-Jones").
 *  Punctuation-only or mixed-digit tokens fail. */
function isAlphaName(token: string): boolean {
  return /^[A-Za-z][A-Za-z'\-]*$/.test(token);
}

/** True when the token is a short all-caps initialism like "SL", "AMC",
 *  "KB" that's almost certainly a company prefix, not a first name.
 *  Real first names are at least 2 characters and contain a vowel; this
 *  catches 2-3 letter all-uppercase tokens without vowels, AND any 2-3
 *  letter all-caps token whose length suggests it's an abbreviation. */
function looksLikeInitialism(token: string): boolean {
  // Must be all uppercase in the original casing.
  if (token !== token.toUpperCase()) return false;
  // 1 letter isn't a name either way; 2-3 letters all-caps is usually
  // a company initialism (SL, AMC, KB, SLG, JLL).
  if (token.length <= 3) {
    // "JO" / "ED" / "AL" are legitimate short names — whitelist those by
    // requiring the token to contain no vowels for the rejection to fire.
    // That way "ED" passes as a name but "SL" / "KB" don't.
    if (!/[AEIOUY]/.test(token)) return true;
    // 2-letter tokens with a vowel but matching known initialisms like
    // "BP" would slip through — we accept that risk. The rare collision
    // is preferable to blacklisting every short name.
  }
  return false;
}

/** True when the token looks like a middle initial: "A" or "A." (one
 *  letter, optionally trailed by a period). */
function isMiddleInitial(token: string): boolean {
  return /^[A-Za-z]\.?$/.test(token);
}

/** Top-level entry point — parse `raw` and return the split result. */
export function parseBusinessName(raw: string): ParsedBusinessName {
  if (!raw || typeof raw !== "string") return emptyResult();
  const trimmed = raw.trim();
  if (!trimmed) return emptyResult();

  // Comma-inverted form gets handled first so "Wohrer, Dominique A" doesn't
  // fall through to the normal left-to-right tokenizer.
  const inverted = tryCommaInverted(trimmed);
  if (inverted) return inverted;

  // Tokenize on whitespace; drop empties and strip edge punctuation.
  const tokens = trimmed
    .split(/\s+/)
    .map(cleanToken)
    .filter(Boolean);
  if (!tokens.length) return emptyResult();

  // Pull the trailing entity suffix (LLC/Inc/…) off the end of the list
  // before name detection, so "John Smith LLC" → name=[John, Smith].
  const { stripped, entity } = stripEntitySuffix(tokens);

  // Build the company string — everything that isn't a clean "First Last".
  // We'll set it to null for bare "Anthony Domino" style inputs.
  const companyGuess = (() => {
    // If the input contains a trade word or an entity suffix, treat the
    // full (titlecased) input minus personal-name tokens as the company.
    if (entity !== "unknown" || findTradeBoundary(stripped) >= 0) {
      return titlecase(trimmed);
    }
    return null;
  })();

  return parsePersonFromTokens(stripped, entity, companyGuess);
}
