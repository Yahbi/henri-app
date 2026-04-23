export type PermitType =
  | "residential"
  | "commercial"
  | "demolition"
  | "renovation"
  | "new_construction"
  | "addition"
  | "repair"
  | "other";

export type PermitStatus =
  | "submitted"
  | "approved"
  | "issued"
  | "final"
  | "expired"
  | "revoked";

export type Urgency = "hot" | "warm" | "cool" | "cold";

export interface Permit {
  id: string;
  source_id: string;
  city: string;
  state: string;
  permit_type: PermitType;
  status: PermitStatus;
  description: string | null;
  address: string | null;
  zip: string | null;
  latitude: number | null;
  longitude: number | null;
  issue_date: string | null;
  estimated_value: number | null;
  raw_data: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface ScoredPermit extends Permit {
  score: number;
  reasoning: string;
  urgency: Urgency;
}

export interface ScrapeResult {
  inserted: number;
  updated: number;
  errors: number;
}
