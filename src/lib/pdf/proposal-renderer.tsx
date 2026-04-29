/**
 * Branded PDF rendering for Henri estimates / proposals.
 *
 * Phase 1.6 Days 4-5 of the post-audit roadmap. Replaces `window.print()`
 * with a server-rendered PDF that the contractor can email or download.
 *
 * ## Architecture
 *
 * Uses `@react-pdf/renderer` (a separate runtime from React DOM —
 * compiles JSX to PDF primitives via a Yoga layout engine). The
 * dynamic `import` is wrapped in try/catch so the build doesn't fail
 * when the dep isn't installed yet. To enable:
 *
 *   pnpm add @react-pdf/renderer
 *
 * Until installed, `renderProposalPdf()` returns null and the
 * Estimate Builder falls back to `window.print()` — graceful-degrade
 * per CLAUDE.md.
 *
 * ## Why React PDF (not Puppeteer / wkhtmltopdf)
 *
 *   - **No headless browser** — Vercel functions don't have one
 *   - **Pure JS** — runs anywhere Node runs
 *   - **React-shaped** — easy to reason about
 *   - **~450KB** added to the server bundle, zero client impact
 *
 * Trade-off: doesn't support arbitrary HTML/CSS. For Henri's needs
 * (logo + line items + tax + terms) this is fine.
 *
 * ## Brand integration
 *
 * Uses the canonical Henri palette per CLAUDE.md:
 *   - Primary: #D4886A
 *   - Heading: Fraunces-equivalent (Times serif fallback)
 *   - Body: DM Sans-equivalent (Helvetica fallback)
 *
 * @react-pdf/renderer doesn't auto-register Google Fonts; we ship
 * with serif/sans-serif fallbacks. A follow-up sprint can register
 * the actual font files.
 */

import type { Buffer } from "node:buffer";

/* ── Public API types ───────────────────────────────────────────────── */

export interface ProposalLineItem {
  material: string;
  quantity: number;
  unit: string;
  unit_price_cents: number;
}

export interface ProposalInput {
  /** Contractor brand info (logo URL skipped for v1; just text). */
  contractor: {
    company_name: string;
    license_number: string | null;
    phone: string | null;
    email: string | null;
    license_state: string | null;
  };
  /** Customer info. */
  customer: {
    name: string;
    address: string;
    city: string | null;
    state: string | null;
    zip: string | null;
  };
  /** Estimate / proposal content. */
  estimate: {
    estimate_id: string;
    project_title: string;
    description: string;
    line_items: ProposalLineItem[];
    /** Tax breakdown from Stripe Tax or ZIP fallback. */
    tax: {
      rate: number;        // e.g. 0.0875
      amount_cents: number;
      label: string;       // e.g. "via Stripe Tax (06106)"
    };
    /** Markup applied to line-item subtotal (decimal, e.g. 1.25 = 25%). */
    tier_multiplier: number;
    /** Free-form notes / terms. */
    terms: string;
    /** Validity period in days from generation. */
    valid_for_days: number;
    generated_at: string;
  };
}

/* ── Renderer ───────────────────────────────────────────────────────── */

/**
 * Render a proposal as a PDF Buffer. Returns null when
 * `@react-pdf/renderer` isn't installed (graceful-degrade — caller
 * falls back to print preview).
 *
 * Pure I/O: no DB, no side effects.
 */
export async function renderProposalPdf(
  input: ProposalInput,
): Promise<Buffer | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let pdfModule: any;
  try {
    // @ts-expect-error — optional dependency, install via `pnpm add @react-pdf/renderer`
    pdfModule = await import("@react-pdf/renderer").catch(() => null);
  } catch {
    return null;
  }
  if (!pdfModule || typeof pdfModule.renderToBuffer !== "function") {
    return null;
  }

  const { Document, Page, Text, View, StyleSheet, renderToBuffer } = pdfModule;

  /* ── Brand styles ──
   * #D4886A is the canonical primary per CLAUDE.md. Font-family
   * fallbacks Times-Roman + Helvetica because @react-pdf/renderer
   * doesn't auto-register Google Fonts.
   */
  const styles = StyleSheet.create({
    page: {
      padding: 48,
      fontFamily: "Helvetica",
      fontSize: 10,
      color: "#1a1a1a",
    },
    header: {
      flexDirection: "row",
      justifyContent: "space-between",
      borderBottomWidth: 2,
      borderBottomColor: "#D4886A",
      paddingBottom: 16,
      marginBottom: 24,
    },
    brandName: {
      fontFamily: "Times-Roman",
      fontSize: 22,
      color: "#D4886A",
    },
    brandTagline: {
      fontSize: 9,
      color: "#6B6B6B",
      marginTop: 2,
    },
    contractorBlock: {
      textAlign: "right",
      fontSize: 9,
      color: "#3a3a3a",
      lineHeight: 1.4,
    },
    sectionTitle: {
      fontFamily: "Times-Roman",
      fontSize: 14,
      color: "#D4886A",
      marginTop: 16,
      marginBottom: 8,
    },
    customerBlock: {
      marginBottom: 20,
      lineHeight: 1.4,
    },
    description: {
      marginBottom: 20,
      padding: 12,
      backgroundColor: "#f5f1ec",
      borderLeftWidth: 3,
      borderLeftColor: "#D4886A",
    },
    table: {
      width: "100%",
      borderTopWidth: 1,
      borderBottomWidth: 1,
      borderColor: "#d4c8be",
    },
    tableHeader: {
      flexDirection: "row",
      backgroundColor: "#f5f1ec",
      paddingVertical: 6,
      borderBottomWidth: 1,
      borderBottomColor: "#d4c8be",
    },
    tableRow: {
      flexDirection: "row",
      paddingVertical: 6,
      borderBottomWidth: 0.5,
      borderBottomColor: "#e8dfd5",
    },
    cellMaterial: { flex: 3, paddingHorizontal: 6 },
    cellQty: { flex: 1, paddingHorizontal: 6, textAlign: "right" },
    cellUnit: { flex: 1, paddingHorizontal: 6 },
    cellPrice: { flex: 1.5, paddingHorizontal: 6, textAlign: "right" },
    cellTotal: { flex: 1.5, paddingHorizontal: 6, textAlign: "right", fontWeight: 700 },
    totalsBlock: {
      marginTop: 16,
      alignSelf: "flex-end",
      width: 240,
    },
    totalsRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      paddingVertical: 4,
    },
    totalsLabel: { color: "#6B6B6B" },
    grandTotal: {
      flexDirection: "row",
      justifyContent: "space-between",
      paddingVertical: 8,
      borderTopWidth: 2,
      borderTopColor: "#D4886A",
      marginTop: 4,
    },
    grandTotalLabel: {
      fontFamily: "Times-Roman",
      fontSize: 13,
      color: "#D4886A",
    },
    grandTotalValue: {
      fontFamily: "Times-Roman",
      fontSize: 16,
      color: "#D4886A",
      fontWeight: 700,
    },
    terms: {
      marginTop: 28,
      paddingTop: 16,
      borderTopWidth: 1,
      borderTopColor: "#e8dfd5",
      fontSize: 9,
      color: "#6B6B6B",
      lineHeight: 1.5,
    },
    footer: {
      position: "absolute",
      bottom: 24,
      left: 48,
      right: 48,
      fontSize: 8,
      color: "#9B9B9B",
      textAlign: "center",
      borderTopWidth: 0.5,
      borderTopColor: "#e8dfd5",
      paddingTop: 8,
    },
  });

  const formatCurrency = (cents: number): string =>
    `$${(cents / 100).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;

  const subtotalCents = input.estimate.line_items.reduce(
    (sum, item) =>
      sum +
      Math.round(item.quantity * item.unit_price_cents * input.estimate.tier_multiplier),
    0,
  );
  const totalCents = subtotalCents + input.estimate.tax.amount_cents;

  /* React-PDF JSX — uses Document, Page, View, Text. NOT React DOM. */
  const doc = (
    <Document>
      <Page size="LETTER" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.brandName}>Henri.</Text>
            <Text style={styles.brandTagline}>
              Permit-driven contractor proposal
            </Text>
          </View>
          <View style={styles.contractorBlock}>
            <Text style={{ fontSize: 11, fontWeight: 700 }}>
              {input.contractor.company_name}
            </Text>
            {input.contractor.license_number && (
              <Text>
                License #{input.contractor.license_number}
                {input.contractor.license_state ? ` (${input.contractor.license_state})` : ""}
              </Text>
            )}
            {input.contractor.phone && <Text>{input.contractor.phone}</Text>}
            {input.contractor.email && <Text>{input.contractor.email}</Text>}
          </View>
        </View>

        {/* Customer */}
        <Text style={styles.sectionTitle}>Prepared for</Text>
        <View style={styles.customerBlock}>
          <Text style={{ fontWeight: 700, fontSize: 11 }}>{input.customer.name}</Text>
          <Text>{input.customer.address}</Text>
          <Text>
            {[input.customer.city, input.customer.state, input.customer.zip]
              .filter(Boolean)
              .join(", ")}
          </Text>
        </View>

        {/* Project description */}
        <Text style={styles.sectionTitle}>Project: {input.estimate.project_title}</Text>
        <View style={styles.description}>
          <Text>{input.estimate.description}</Text>
        </View>

        {/* Line items */}
        <Text style={styles.sectionTitle}>Scope of work</Text>
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={styles.cellMaterial}>Material / labor</Text>
            <Text style={styles.cellQty}>Qty</Text>
            <Text style={styles.cellUnit}>Unit</Text>
            <Text style={styles.cellPrice}>Unit price</Text>
            <Text style={styles.cellTotal}>Total</Text>
          </View>
          {input.estimate.line_items.map((item, idx) => {
            const lineTotal = Math.round(
              item.quantity * item.unit_price_cents * input.estimate.tier_multiplier,
            );
            return (
              <View key={idx} style={styles.tableRow}>
                <Text style={styles.cellMaterial}>{item.material}</Text>
                <Text style={styles.cellQty}>{item.quantity}</Text>
                <Text style={styles.cellUnit}>{item.unit}</Text>
                <Text style={styles.cellPrice}>{formatCurrency(item.unit_price_cents)}</Text>
                <Text style={styles.cellTotal}>{formatCurrency(lineTotal)}</Text>
              </View>
            );
          })}
        </View>

        {/* Totals */}
        <View style={styles.totalsBlock}>
          <View style={styles.totalsRow}>
            <Text style={styles.totalsLabel}>Subtotal</Text>
            <Text>{formatCurrency(subtotalCents)}</Text>
          </View>
          <View style={styles.totalsRow}>
            <Text style={styles.totalsLabel}>
              Tax ({(input.estimate.tax.rate * 100).toFixed(2)}%)
            </Text>
            <Text>{formatCurrency(input.estimate.tax.amount_cents)}</Text>
          </View>
          <Text style={{ fontSize: 8, color: "#9B9B9B", textAlign: "right", marginTop: 2 }}>
            {input.estimate.tax.label}
          </Text>
          <View style={styles.grandTotal}>
            <Text style={styles.grandTotalLabel}>Total</Text>
            <Text style={styles.grandTotalValue}>{formatCurrency(totalCents)}</Text>
          </View>
        </View>

        {/* Terms */}
        {input.estimate.terms && (
          <View style={styles.terms}>
            <Text style={{ fontWeight: 700, marginBottom: 4, color: "#3a3a3a" }}>
              Terms & conditions
            </Text>
            <Text>{input.estimate.terms}</Text>
            <Text style={{ marginTop: 8 }}>
              This estimate is valid for {input.estimate.valid_for_days} days from{" "}
              {new Date(input.estimate.generated_at).toLocaleDateString("en-US")}.
            </Text>
          </View>
        )}

        {/* Footer */}
        <Text style={styles.footer}>
          Estimate ID: {input.estimate.estimate_id} · Generated by Henri. ·
          {" "}
          {new Date(input.estimate.generated_at).toLocaleDateString("en-US")}
        </Text>
      </Page>
    </Document>
  );

  return await renderToBuffer(doc);
}
