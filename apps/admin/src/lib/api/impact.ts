/**
 * The impact report shape. Declared by hand (not from the generated types) because the impact
 * endpoints return an untyped object in the OpenAPI spec — they predate a response DTO. If a
 * response DTO is added to the API later, replace this with the generated `Schemas['...']`.
 */
export interface ImpactMetrics {
  recycledKg: number;
  landfillDivertedKg: number;
  estimatedCo2eAvoidedKg: number;
  estimatedWaterSavedLitres: number;
  estimatedEnergySavedKwh: number;
  estimatedTreesEquivalent: number;
}

export interface ImpactReport {
  lifetime: ImpactMetrics;
  monthly: { yearMonth: string; recycledKg: number; metrics: ImpactMetrics }[];
  disclaimer: string;
  computedAt: string | null;
}
