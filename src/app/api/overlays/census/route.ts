import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/utils/rate-limit";
import { logger } from "@/lib/logger";

const CENSUS_ACS_API = "https://api.census.gov/data/2022/acs/acs5";

// Key ACS variables for demographic/economic data relevant to contractors
const ACS_VARIABLES = [
  "B01003_001E", // Total population
  "B19013_001E", // Median household income
  "B25001_001E", // Total housing units
  "B25002_002E", // Occupied housing units
  "B25002_003E", // Vacant housing units
  "B25035_001E", // Median year structure built
  "B25077_001E", // Median home value
].join(",");

export async function GET(request: NextRequest) {
  // Dashboard-map overlay — the browser fetches it same-origin with
  // cookies. Require a session + rate-limit per IP so the route can't
  // be used as an anonymous proxy relay to the upstream API.
  const ip = getClientIp(request);
  const rl = checkRateLimit(`overlays.census:${ip}`, {
    maxRequests: 60,
    windowMs: 60_000,
  });
  if (!rl.allowed) return rateLimitResponse(rl);

  const authClient = await createClient();
  const {
    data: { user },
  } = await authClient.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const zip = searchParams.get("zip");
    const state = searchParams.get("state");
    const county = searchParams.get("county");

    const apiKey = process.env.CENSUS_API_KEY;
    const keyParam = apiKey ? `&key=${apiKey}` : "";

    let url: string;

    if (zip) {
      // Query by ZIP code tabulation area
      url = `${CENSUS_ACS_API}?get=NAME,${ACS_VARIABLES}&for=zip%20code%20tabulation%20area:${zip}${keyParam}`;
    } else if (state && county) {
      // Query by state + county FIPS
      url = `${CENSUS_ACS_API}?get=NAME,${ACS_VARIABLES}&for=county:${county}&in=state:${state}${keyParam}`;
    } else if (state) {
      // Query all counties in a state
      url = `${CENSUS_ACS_API}?get=NAME,${ACS_VARIABLES}&for=county:*&in=state:${state}${keyParam}`;
    } else {
      return NextResponse.json(
        { error: "Either zip or state parameter is required" },
        { status: 400 }
      );
    }

    // Reject obviously invalid ZIPs client-side before calling out —
    // saves a round-trip and skips the 400 we'd get back from Census.
    if (zip && !/^\d{5}$/.test(zip)) {
      return NextResponse.json({ data: [] });
    }

    // Use node-fetch semantics (no Next Data Cache) because the Census
    // upstream returns 204 No Content with an empty body for ZIPs that
    // don't map to a ZCTA, and Next's `next: {revalidate}` caching layer
    // was eating the status-code check and surfacing the empty-body
    // parse error as a 500. We cache downstream via HTTP Cache-Control
    // on our own response instead.
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
    } catch {
      // Upstream unreachable — don't blow up the overlay, just return empty.
      return NextResponse.json({ data: [] });
    }

    // ANY non-2xx from Census = "no data for this ZIP" from the app's
    // perspective. Empty-body 200 also lands here via the text-parse
    // guard below. We never throw — Census outages would otherwise
    // cascade a 500 storm into our server logs.
    if (response.status !== 200) {
      return NextResponse.json({ data: [] });
    }

    const text = await response.text();
    if (!text.trim()) {
      return NextResponse.json({ data: [] });
    }
    let raw: string[][];
    try {
      raw = JSON.parse(text) as string[][];
    } catch {
      return NextResponse.json({ data: [] });
    }

    if (!raw || raw.length < 2) {
      return NextResponse.json({ data: [] });
    }

    const headers = raw[0];
    const rows = raw.slice(1);

    const data = rows.map((row) => {
      const record: Record<string, string | number | null> = {};
      headers.forEach((header, i) => {
        const value = row[i];
        record[header] = value && !isNaN(Number(value)) ? Number(value) : value;
      });
      return {
        name: record["NAME"],
        population: record["B01003_001E"],
        median_household_income: record["B19013_001E"],
        total_housing_units: record["B25001_001E"],
        occupied_housing_units: record["B25002_002E"],
        vacant_housing_units: record["B25002_003E"],
        median_year_built: record["B25035_001E"],
        median_home_value: record["B25077_001E"],
      };
    });

    return NextResponse.json({ data });
  } catch (err) {
    logger.error("Error fetching Census data", { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json(
      { error: "Failed to fetch Census demographic data" },
      { status: 500 }
    );
  }
}
