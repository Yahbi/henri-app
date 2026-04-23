import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchAllTerritoryZips } from "@/lib/territories/fetch-all";

/* ─── ZIP prefix (first 3 digits) → state code mapping ─── */
const ZIP_PREFIX_TO_STATE: Record<string, string> = {
  /* New York */
  "100": "NY", "101": "NY", "102": "NY", "103": "NY", "104": "NY",
  "110": "NY", "111": "NY", "112": "NY", "113": "NY", "114": "NY",
  /* New Jersey */
  "070": "NJ", "071": "NJ", "072": "NJ", "073": "NJ", "074": "NJ",
  "075": "NJ", "076": "NJ", "077": "NJ", "078": "NJ", "079": "NJ",
  "080": "NJ", "081": "NJ", "082": "NJ", "083": "NJ", "084": "NJ",
  "085": "NJ", "086": "NJ", "087": "NJ", "088": "NJ", "089": "NJ",
  /* California */
  "900": "CA", "901": "CA", "902": "CA", "903": "CA", "904": "CA",
  "905": "CA", "906": "CA", "907": "CA", "908": "CA", "910": "CA",
  "911": "CA", "912": "CA", "913": "CA", "914": "CA", "915": "CA",
  "916": "CA", "917": "CA", "918": "CA", "919": "CA", "920": "CA",
  "921": "CA", "922": "CA", "923": "CA", "924": "CA", "925": "CA",
  "926": "CA", "927": "CA", "928": "CA", "930": "CA", "931": "CA",
  "932": "CA", "933": "CA", "934": "CA", "935": "CA", "936": "CA",
  "937": "CA", "938": "CA", "939": "CA", "940": "CA", "941": "CA",
  "942": "CA", "943": "CA", "944": "CA", "945": "CA", "946": "CA",
  "947": "CA", "948": "CA", "949": "CA", "950": "CA", "951": "CA",
  "952": "CA", "953": "CA", "954": "CA", "955": "CA", "956": "CA",
  "957": "CA", "958": "CA", "959": "CA", "960": "CA", "961": "CA",
  /* Illinois */
  "600": "IL", "601": "IL", "602": "IL", "603": "IL", "604": "IL",
  "605": "IL", "606": "IL", "607": "IL", "608": "IL", "609": "IL",
  "610": "IL", "611": "IL", "612": "IL", "613": "IL", "614": "IL",
  "615": "IL", "616": "IL", "617": "IL", "618": "IL", "619": "IL",
  /* Texas */
  "750": "TX", "751": "TX", "752": "TX", "753": "TX", "754": "TX",
  "755": "TX", "756": "TX", "757": "TX", "758": "TX", "759": "TX",
  "760": "TX", "761": "TX", "762": "TX", "763": "TX", "764": "TX",
  "765": "TX", "766": "TX", "767": "TX", "768": "TX", "769": "TX",
  "770": "TX", "771": "TX", "772": "TX", "773": "TX", "774": "TX",
  "775": "TX", "776": "TX", "777": "TX", "778": "TX", "779": "TX",
  "780": "TX", "781": "TX", "782": "TX", "783": "TX", "784": "TX",
  "785": "TX", "786": "TX", "787": "TX", "788": "TX", "789": "TX",
  "790": "TX", "791": "TX", "792": "TX", "793": "TX", "794": "TX",
  "795": "TX", "796": "TX", "797": "TX", "798": "TX", "799": "TX",
  /* Georgia */
  "300": "GA", "301": "GA", "302": "GA", "303": "GA", "304": "GA",
  "305": "GA", "306": "GA", "307": "GA", "308": "GA", "309": "GA",
  "310": "GA", "311": "GA", "312": "GA", "313": "GA", "314": "GA",
  "315": "GA", "316": "GA", "317": "GA", "318": "GA", "319": "GA",
  /* Arizona */
  "850": "AZ", "851": "AZ", "852": "AZ", "853": "AZ", "855": "AZ",
  "856": "AZ", "857": "AZ",
  /* Massachusetts */
  "010": "MA", "011": "MA", "012": "MA", "013": "MA", "014": "MA",
  "015": "MA", "016": "MA", "017": "MA", "018": "MA", "019": "MA",
  "020": "MA", "021": "MA", "022": "MA", "023": "MA", "024": "MA",
  "025": "MA", "026": "MA", "027": "MA",
  /* Florida */
  "320": "FL", "321": "FL", "322": "FL", "323": "FL", "324": "FL",
  "325": "FL", "326": "FL", "327": "FL", "328": "FL", "329": "FL",
  "330": "FL", "331": "FL", "332": "FL", "333": "FL", "334": "FL",
  "335": "FL", "336": "FL", "337": "FL", "338": "FL", "339": "FL",
  "340": "FL", "341": "FL", "342": "FL", "344": "FL", "346": "FL",
  "347": "FL", "349": "FL",
  /* Washington */
  "980": "WA", "981": "WA", "982": "WA", "983": "WA", "984": "WA",
  "985": "WA", "986": "WA", "988": "WA", "989": "WA", "990": "WA",
  "991": "WA", "992": "WA", "993": "WA", "994": "WA",
  /* Pennsylvania */
  "150": "PA", "151": "PA", "152": "PA", "153": "PA", "154": "PA",
  "155": "PA", "156": "PA", "157": "PA", "158": "PA", "159": "PA",
  "160": "PA", "161": "PA", "162": "PA", "163": "PA", "164": "PA",
  "165": "PA", "166": "PA", "167": "PA", "168": "PA", "169": "PA",
  "170": "PA", "171": "PA", "172": "PA", "173": "PA", "174": "PA",
  "175": "PA", "176": "PA", "177": "PA", "178": "PA", "179": "PA",
  "180": "PA", "181": "PA", "182": "PA", "183": "PA", "184": "PA",
  "185": "PA", "186": "PA", "187": "PA", "188": "PA", "189": "PA",
  "190": "PA", "191": "PA",
  /* Ohio */
  "430": "OH", "431": "OH", "432": "OH", "433": "OH", "434": "OH",
  "435": "OH", "436": "OH", "437": "OH", "438": "OH", "439": "OH",
  "440": "OH", "441": "OH", "442": "OH", "443": "OH", "444": "OH",
  "445": "OH", "446": "OH", "447": "OH", "448": "OH", "449": "OH",
  "450": "OH", "451": "OH", "452": "OH", "453": "OH", "454": "OH",
  "455": "OH", "456": "OH", "457": "OH", "458": "OH",
  /* Michigan */
  "480": "MI", "481": "MI", "482": "MI", "483": "MI", "484": "MI",
  "485": "MI", "486": "MI", "487": "MI", "488": "MI", "489": "MI",
  "490": "MI", "491": "MI", "492": "MI", "493": "MI", "494": "MI",
  "495": "MI", "496": "MI", "497": "MI", "498": "MI", "499": "MI",
  /* Colorado */
  "800": "CO", "801": "CO", "802": "CO", "803": "CO", "804": "CO",
  "805": "CO", "806": "CO", "807": "CO", "808": "CO", "809": "CO",
  "810": "CO", "811": "CO", "812": "CO", "813": "CO", "814": "CO",
  "815": "CO", "816": "CO",
  /* Virginia */
  "220": "VA", "221": "VA", "222": "VA", "223": "VA", "224": "VA",
  "225": "VA", "226": "VA", "227": "VA", "228": "VA", "229": "VA",
  "230": "VA", "231": "VA", "232": "VA", "233": "VA", "234": "VA",
  "235": "VA", "236": "VA", "237": "VA", "238": "VA", "239": "VA",
  "240": "VA", "241": "VA", "242": "VA", "243": "VA", "244": "VA",
  "245": "VA", "246": "VA",
  /* North Carolina */
  "270": "NC", "271": "NC", "272": "NC", "273": "NC", "274": "NC",
  "275": "NC", "276": "NC", "277": "NC", "278": "NC", "279": "NC",
  "280": "NC", "281": "NC", "282": "NC", "283": "NC", "284": "NC",
  "285": "NC", "286": "NC", "287": "NC", "288": "NC", "289": "NC",
  /* Tennessee */
  "370": "TN", "371": "TN", "372": "TN", "373": "TN", "374": "TN",
  "375": "TN", "376": "TN", "377": "TN", "378": "TN", "379": "TN",
  "380": "TN", "381": "TN", "382": "TN", "383": "TN", "384": "TN",
  "385": "TN",
  /* Maryland */
  "206": "MD", "207": "MD", "208": "MD", "209": "MD", "210": "MD",
  "211": "MD", "212": "MD", "214": "MD", "215": "MD", "216": "MD",
  "217": "MD", "218": "MD", "219": "MD",
  /* Oregon */
  "970": "OR", "971": "OR", "972": "OR", "973": "OR", "974": "OR",
  "975": "OR", "976": "OR", "977": "OR", "978": "OR", "979": "OR",
  /* Nevada */
  "889": "NV", "890": "NV", "891": "NV", "893": "NV", "894": "NV",
  "895": "NV", "897": "NV", "898": "NV",
  /* Louisiana */
  "700": "LA", "701": "LA", "703": "LA", "704": "LA", "705": "LA",
  "706": "LA", "707": "LA", "708": "LA", "710": "LA", "711": "LA",
  "712": "LA", "713": "LA", "714": "LA",
  /* Minnesota */
  "550": "MN", "551": "MN", "553": "MN", "554": "MN", "555": "MN",
  "556": "MN", "557": "MN", "558": "MN", "559": "MN", "560": "MN",
  "561": "MN", "562": "MN", "563": "MN", "564": "MN", "565": "MN",
  "566": "MN", "567": "MN",
  /* Indiana */
  "460": "IN", "461": "IN", "462": "IN", "463": "IN", "464": "IN",
  "465": "IN", "466": "IN", "467": "IN", "468": "IN", "469": "IN",
  "470": "IN", "471": "IN", "472": "IN", "473": "IN", "474": "IN",
  "475": "IN", "476": "IN", "477": "IN", "478": "IN", "479": "IN",
  /* Missouri */
  "630": "MO", "631": "MO", "633": "MO", "634": "MO", "635": "MO",
  "636": "MO", "637": "MO", "638": "MO", "639": "MO", "640": "MO",
  "641": "MO", "644": "MO", "645": "MO", "646": "MO", "647": "MO",
  "648": "MO", "649": "MO", "650": "MO", "651": "MO", "652": "MO",
  "653": "MO", "654": "MO", "655": "MO", "656": "MO", "657": "MO",
  "658": "MO",
  /* Wisconsin */
  "530": "WI", "531": "WI", "532": "WI", "534": "WI", "535": "WI",
  "537": "WI", "538": "WI", "539": "WI", "540": "WI", "541": "WI",
  "542": "WI", "543": "WI", "544": "WI", "545": "WI", "546": "WI",
  "547": "WI", "548": "WI", "549": "WI",
  /* Connecticut */
  "060": "CT", "061": "CT", "062": "CT", "063": "CT", "064": "CT",
  "065": "CT", "066": "CT", "067": "CT", "068": "CT", "069": "CT",
  /* South Carolina */
  "290": "SC", "291": "SC", "292": "SC", "293": "SC", "294": "SC",
  "295": "SC", "296": "SC", "297": "SC", "298": "SC", "299": "SC",
  /* Alabama */
  "350": "AL", "351": "AL", "352": "AL", "354": "AL", "355": "AL",
  "356": "AL", "357": "AL", "358": "AL", "359": "AL", "360": "AL",
  "361": "AL", "362": "AL", "363": "AL", "364": "AL", "365": "AL",
  "366": "AL", "367": "AL", "368": "AL", "369": "AL",
  /* DC */
  "200": "DC", "202": "DC", "203": "DC", "204": "DC", "205": "DC",
};

/* ─── Weather-relevant event keywords ─── */
const WEATHER_KEYWORDS = [
  "storm",
  "thunder",
  "severe",
  "tornado",
  "hurricane",
  "tropical",
  "flood",
  "flash flood",
  "wind",
  "hail",
  "blizzard",
  "ice",
  "winter",
  "freeze",
  "frost",
  "snow",
  "fire weather",
  "red flag",
  "heat",
  "excessive heat",
  "dust",
  "fog",
  "lightning",
  "waterspout",
  "coastal flood",
  "surge",
  "cyclone",
];

/* ─── In-memory cache ─── */
interface CacheEntry {
  data: NWSAlert[];
  fetched_at: string;
}

interface NWSAlert {
  id: string;
  event: string;
  severity: string;
  urgency: string;
  headline: string;
  description: string;
  onset: string | null;
  expires: string | null;
  area: string;
}

const alertCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

const NWS_API_BASE = "https://api.weather.gov";
const NWS_USER_AGENT = "(Henri App, contact@henri.app)";

/* ─── Helpers ─── */

function zipPrefixToState(zip: string): string | null {
  const prefix = zip.slice(0, 3);
  return ZIP_PREFIX_TO_STATE[prefix] ?? null;
}

function isWeatherRelevant(event: string): boolean {
  const lower = event.toLowerCase();
  return WEATHER_KEYWORDS.some((kw) => lower.includes(kw));
}

function isCacheValid(entry: CacheEntry): boolean {
  const age = Date.now() - new Date(entry.fetched_at).getTime();
  return age < CACHE_TTL_MS;
}

async function fetchAlertsForState(state: string): Promise<NWSAlert[]> {
  /* Check cache first */
  const cached = alertCache.get(state);
  if (cached && isCacheValid(cached)) {
    return cached.data;
  }

  try {
    const response = await fetch(
      `${NWS_API_BASE}/alerts/active?area=${encodeURIComponent(state)}`,
      {
        headers: {
          Accept: "application/geo+json",
          "User-Agent": NWS_USER_AGENT,
        },
      }
    );

    if (!response.ok) {
      console.error(
        `NWS API error for state ${state}: ${response.status} ${response.statusText}`
      );
      return [];
    }

    const data = await response.json();

    const alerts: NWSAlert[] = (data.features ?? [])
      .map((feature: Record<string, unknown>) => {
        const props = feature.properties as Record<string, unknown>;
        return {
          id: props.id as string,
          event: props.event as string,
          severity: props.severity as string,
          urgency: props.urgency as string,
          headline: (props.headline as string) ?? "",
          description: (props.description as string) ?? "",
          onset: (props.onset as string) ?? null,
          expires: (props.expires as string) ?? null,
          area: (props.areaDesc as string) ?? "",
        };
      })
      .filter((alert: NWSAlert) => isWeatherRelevant(alert.event));

    /* Store in cache */
    const now = new Date().toISOString();
    alertCache.set(state, { data: alerts, fetched_at: now });

    return alerts;
  } catch (err) {
    console.error(`Failed to fetch NWS alerts for state ${state}:`, err);
    return [];
  }
}

/* ─── GET /api/storm — weather alerts for contractor territories ─── */
export async function GET() {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    /* Verify the user is a contractor */
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (!profile || profile.role !== "contractor") {
      return NextResponse.json(
        { error: "Contractor access required" },
        { status: 403 }
      );
    }

    /* Fetch contractor's active territories (paginated — PostgREST caps
     * unbounded .select() at 1000 rows; god-mode founder has 5,601). */
    const zips = await fetchAllTerritoryZips(supabase, user.id, { activeOnly: true });

    if (zips.length === 0) {
      return NextResponse.json({
        alerts: [],
        territories: [],
        fetched_at: new Date().toISOString(),
        message: "No active territories",
      });
    }

    /* Derive unique states from ZIP prefixes */
    const stateSet = new Set<string>();
    for (const zip of zips) {
      const state = zipPrefixToState(zip);
      if (state) {
        stateSet.add(state);
      }
    }

    const states = Array.from(stateSet);

    if (states.length === 0) {
      return NextResponse.json({
        alerts: [],
        territories: zips,
        fetched_at: new Date().toISOString(),
        message: "Could not map ZIP codes to states",
      });
    }

    /* Fetch alerts for each state in parallel */
    const alertArrays = await Promise.all(
      states.map((state) => fetchAlertsForState(state))
    );

    /* Deduplicate alerts by ID (same alert can appear in multiple states) */
    const seenIds = new Set<string>();
    const allAlerts: NWSAlert[] = [];

    for (const stateAlerts of alertArrays) {
      for (const alert of stateAlerts) {
        if (!seenIds.has(alert.id)) {
          seenIds.add(alert.id);
          allAlerts.push(alert);
        }
      }
    }

    /* Sort by severity: Extreme > Severe > Moderate > Minor > Unknown */
    const severityOrder: Record<string, number> = {
      Extreme: 0,
      Severe: 1,
      Moderate: 2,
      Minor: 3,
      Unknown: 4,
    };

    allAlerts.sort(
      (a, b) =>
        (severityOrder[a.severity] ?? 5) - (severityOrder[b.severity] ?? 5)
    );

    return NextResponse.json({
      alerts: allAlerts,
      territories: zips,
      fetched_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error("Error fetching storm alerts:", err);
    return NextResponse.json(
      { error: "Failed to fetch storm alerts" },
      { status: 500 }
    );
  }
}
