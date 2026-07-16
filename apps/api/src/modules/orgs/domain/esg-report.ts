import {
  type EstimatedImpact,
  IMPACT_METHODOLOGY,
} from '@/modules/impact/domain/sustainability-factors';

/**
 * The DATA of an ESG report, assembled independently of how it is rendered.
 *
 * A pure structure so the numbers can be tested exhaustively without generating a PDF, and so
 * the renderer (PDFKit today, a microservice or an HTML export tomorrow) is a swappable
 * adapter that never touches the figures. What a business puts in their CSR filing has to be
 * correct first and pretty second.
 */
export interface EsgReport {
  orgName: string;
  orgKind: 'APARTMENT' | 'BUSINESS';
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  generatedAt: string;

  memberCount: number;

  totals: EstimatedImpact;
  monthly: { yearMonth: string; recycledKg: number; estimatedCo2eAvoidedKg: number }[];

  /** The provenance of every figure — carried into the report so it is defensible on its face. */
  methodology: typeof IMPACT_METHODOLOGY;

  /**
   * The honesty statement, printed prominently. This is the line between a defensible ESG
   * disclosure and a greenwashing claim, and it appears on the document itself, not just in an
   * API field a report consumer never sees.
   */
  disclaimer: string;
}

export const ESG_DISCLAIMER =
  'These are ESTIMATED environmental figures derived from confirmed-recycled paper weight ' +
  'using published conversion factors (see Methodology). CO2 uses the US EPA WARM model; ' +
  'water, energy and tree figures are widely-cited industry estimates and are not audit-grade. ' +
  'This document is a good-faith estimate to support the organisation’s own sustainability ' +
  'reporting. It is NOT a certified carbon offset, an emissions certificate, or a guarantee, ' +
  'and it makes no claim of carbon neutrality.';

export interface EsgReportInput {
  orgName: string;
  orgKind: 'APARTMENT' | 'BUSINESS';
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  generatedAt: string;
  memberCount: number;
  totals: EstimatedImpact;
  monthly: { yearMonth: string; recycledKg: number; estimatedCo2eAvoidedKg: number }[];
}

export function assembleEsgReport(input: EsgReportInput): EsgReport {
  return {
    ...input,
    methodology: IMPACT_METHODOLOGY,
    disclaimer: ESG_DISCLAIMER,
  };
}

/**
 * Renders an assembled report to bytes. A port, so the impact/data code never imports a PDF
 * library and the renderer can be swapped (a PDF microservice, an HTML or CSV export) without
 * touching a single figure.
 */
export interface EsgReportRenderer {
  render(report: EsgReport): Promise<{ contentType: string; extension: string; body: Buffer }>;
}

export const ESG_REPORT_RENDERER = Symbol('ESG_REPORT_RENDERER');
