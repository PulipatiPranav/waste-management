import { gramsToKg } from '@/modules/wallet/domain/money';
import { type ImpactReport } from '../application/impact.use-cases';
import { type EstimatedImpact } from '../domain/sustainability-factors';

/**
 * THE rounding point for impact, and the only one.
 *
 * The domain calc is full precision so that aggregates reconcile; display rounding happens
 * here, once, at the edge — the same discipline the money code uses. Three decimal places is
 * plenty for kg/litres and honest about the underlying uncertainty (these are estimates, not
 * measurements to the gram of CO2).
 */
function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export interface ImpactMetricsDto {
  recycledKg: number;
  landfillDivertedKg: number;
  estimatedCo2eAvoidedKg: number;
  estimatedWaterSavedLitres: number;
  estimatedEnergySavedKwh: number;
  estimatedTreesEquivalent: number;
}

function toMetrics(impact: EstimatedImpact): ImpactMetricsDto {
  return {
    recycledKg: round3(impact.recycledKg),
    landfillDivertedKg: round3(impact.landfillDivertedKg),
    estimatedCo2eAvoidedKg: round3(impact.estimatedCo2eAvoidedKg),
    estimatedWaterSavedLitres: round3(impact.estimatedWaterSavedLitres),
    estimatedEnergySavedKwh: round3(impact.estimatedEnergySavedKwh),
    estimatedTreesEquivalent: round3(impact.estimatedTreesEquivalent),
  };
}

export interface ImpactReportDto {
  lifetime: ImpactMetricsDto;
  monthly: {
    yearMonth: string;
    recycledKg: number;
    metrics: ImpactMetricsDto;
  }[];
  /**
   * Reads honestly: the figures are "as of" the last nightly refresh, and are estimates, not
   * measurements. This copy is deliberate — it is the difference between a defensible
   * sustainability figure and a greenwashing claim.
   */
  disclaimer: string;
  computedAt: string | null;
  methodology: ImpactReport['methodology'];
}

const DISCLAIMER =
  'These are ESTIMATED environmental figures, derived from confirmed-recycled weight using ' +
  'published conversion factors (see `methodology`). CO2 uses the EPA WARM model; water, ' +
  'energy and trees are widely-cited industry estimates and are not audit-grade. Figures are ' +
  'as of the last nightly refresh. This is not a certified carbon offset or an emissions claim.';

export function toImpactReportDto(report: ImpactReport): ImpactReportDto {
  return {
    lifetime: toMetrics(report.lifetime),
    monthly: report.monthly.map((month) => ({
      yearMonth: month.yearMonth,
      recycledKg: round3(
        Object.values(month.recycledGramsByType).reduce((sum, grams) => sum + (grams ?? 0), 0) /
          1000,
      ),
      metrics: toMetrics(month.impact),
    })),
    disclaimer: DISCLAIMER,
    computedAt: report.computedAt?.toISOString() ?? null,
    methodology: report.methodology,
  };
}

export { gramsToKg };
