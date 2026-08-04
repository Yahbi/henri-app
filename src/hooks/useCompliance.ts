"use client";

import { useState, useEffect, useCallback } from "react";

export interface ComplianceLicense {
  number: string;
  state: string;
  type: string;
  expiry: string;
  verified: boolean;
  verified_at: string | null;
}

export interface ComplianceTerritory {
  id: string;
  zip: string;
  contractor_id: string;
  status: string;
  slot_number: number;
  active: boolean;
  claimed_at: string;
  released_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ComplianceData {
  license: ComplianceLicense | null;
  insurance_expiry: string | null;
  territories: ComplianceTerritory[];
  permits: Array<{ id: string; permit_number: string | null; status: string; created_at: string }>;
  complianceScore: number;
  warnings: string[];
}

interface UpdateLicenseData {
  number?: string;
  state?: string;
  type?: string;
  expiry?: string;
}

interface UseComplianceReturn {
  license: ComplianceLicense | null;
  insuranceExpiry: string | null;
  territories: ComplianceTerritory[];
  permits: Array<{ id: string; permit_number: string | null; status: string; created_at: string }>;
  complianceScore: number;
  warnings: string[];
  isLoading: boolean;
  error: string | null;
  updateLicense: (data: UpdateLicenseData) => Promise<{ success: boolean; error?: string }>;
  refresh: () => Promise<void>;
}

export function useCompliance(): UseComplianceReturn {
  const [license, setLicense] = useState<ComplianceLicense | null>(null);
  const [insuranceExpiry, setInsuranceExpiry] = useState<string | null>(null);
  const [territories, setTerritories] = useState<ComplianceTerritory[]>([]);
  const [permits, setPermits] = useState<Array<{ id: string; permit_number: string | null; status: string; created_at: string }>>([]);
  const [complianceScore, setComplianceScore] = useState(0);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCompliance = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const res = await fetch("/api/compliance");

      if (!res.ok) {
        // Fetch failure — surface it so a transient error isn't shown as a
        // real 0-score / "no license on file" (which reads as non-compliance).
        setLicense(null);
        setInsuranceExpiry(null);
        setTerritories([]);
        setPermits([]);
        setComplianceScore(0);
        setWarnings([]);
        setError("Couldn't load compliance status.");
        setIsLoading(false);
        return;
      }

      const data = await res.json();
      setLicense(data.license ?? null);
      setInsuranceExpiry(data.insurance_expiry ?? null);
      setTerritories(data.territories ?? []);
      setPermits(data.permits ?? []);
      setComplianceScore(data.compliance_score ?? 0);
      setWarnings(data.warnings ?? []);
    } catch {
      // Network/parse error — surface it rather than a false non-compliant read.
      setLicense(null);
      setInsuranceExpiry(null);
      setTerritories([]);
      setPermits([]);
      setComplianceScore(0);
      setWarnings([]);
      setError("Couldn't load compliance status.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCompliance();
  }, [fetchCompliance]);

  const updateLicense = useCallback(
    async (data: UpdateLicenseData): Promise<{ success: boolean; error?: string }> => {
      try {
        const res = await fetch("/api/compliance", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });

        if (!res.ok) {
          const result = await res.json();
          return { success: false, error: result.error ?? "Failed to update license" };
        }

        await fetchCompliance();
        return { success: true };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : "Network error",
        };
      }
    },
    [fetchCompliance]
  );

  return {
    license,
    insuranceExpiry,
    territories,
    permits,
    complianceScore,
    warnings,
    isLoading,
    error,
    updateLicense,
    refresh: fetchCompliance,
  };
}
