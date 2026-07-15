import { type PaperType } from '@/modules/wallet/domain/money';

/**
 * THE conversion factors, and the ONLY place they live.
 *
 * ============================================================================
 * READ THIS BEFORE CHANGING A NUMBER, AND BEFORE MAKING ANY EXTERNAL CLAIM.
 * ============================================================================
 *
 * Every impact figure this platform shows a customer, an apartment, a business, or an ESG
 * auditor is `recycled kilograms × a coefficient below`. When someone asks "where did this
 * number come from" — and for a business buying this for their CSR report, someone WILL —
 * the answer has to be a citation, not a shrug. So each factor carries its source inline.
 *
 * Two tiers of rigour, and they are labelled honestly because conflating them is how a
 * sustainability platform ends up in a greenwashing complaint:
 *
 *   • CO2e avoided — from the US EPA WARM model (Waste Reduction Model), the recognised
 *     methodology regulators and auditors accept. This is the defensible one.
 *
 *   • Water, trees, energy — widely-published paper-recycling figures whose primary
 *     provenance is weaker than WARM's. They are INDUSTRY-COMMONLY-CITED ESTIMATES, marked
 *     as such, and every label built on them says "estimated". They are useful for customer
 *     motivation; they are NOT audit-grade, and the code never pretends they are.
 *
 * These coefficients MUST be re-verified against the CURRENT published WARM version before
 * any figure derived from them is put in front of a paying business customer or an auditor.
 * They live in exactly one constant, with tests locking every value, precisely so that
 * re-verification is a single reviewed edit and cannot silently drift.
 *
 * Sources:
 *   - EPA WARM: https://www.epa.gov/warm  (Documentation Chapters, "Containers, Packaging,
 *     and Non-Durable Good Materials" — recycling vs landfilling net GHG factors).
 *   - Paper-recycling water/tree/energy figures: long-standing US EPA / paper-industry
 *     public-education figures ("1 ton recycled paper saves ~17 trees, ~7,000 gallons of
 *     water, ~4,000 kWh"). Provenance is diffuse; treated as estimates.
 *
 * Values below are per KILOGRAM of recycled paper, converted from the per-short-ton
 * (907.18 kg) figures in the sources. Conservative where sources disagree.
 */

/** Which methodology each metric rests on. Surfaced in the API so a reader can judge it. */
export const IMPACT_METHODOLOGY = {
  co2eAvoidedKg: {
    source: 'US EPA WARM (Waste Reduction Model), recycling vs landfilling net GHG factor',
    url: 'https://www.epa.gov/warm',
    rigour: 'MODELLED',
    note: 'Recognised methodology accepted by regulators and ESG auditors. Re-verify against the current WARM version before external use.',
  },
  waterSavedLitres: {
    source: 'Industry-commonly-cited paper-recycling figures (~7,000 US gal / short ton)',
    url: 'https://www.epa.gov/recycle',
    rigour: 'ESTIMATE',
    note: 'Widely published, weaker primary provenance than the CO2 figure. Not audit-grade.',
  },
  treesEquivalent: {
    source:
      'Industry-commonly-cited paper-recycling figures (~17 trees / short ton of virgin paper avoided)',
    url: 'https://www.epa.gov/recycle',
    rigour: 'ESTIMATE',
    note: 'A trees-EQUIVALENT for intuition, not a claim that specific trees were saved. Not audit-grade.',
  },
  energySavedKwh: {
    source: 'Industry-commonly-cited paper-recycling figures (~4,000 kWh / short ton)',
    url: 'https://www.epa.gov/recycle',
    rigour: 'ESTIMATE',
    note: 'Widely published, weaker primary provenance than the CO2 figure. Not audit-grade.',
  },
  landfillDivertedKg: {
    source: 'Definitional: mass recycled is mass not landfilled',
    url: '',
    rigour: 'MEASURED',
    note: 'The most defensible figure here — it is simply the confirmed recycled weight, 1:1. No coefficient.',
  },
} as const;

const KG_PER_SHORT_TON = 907.18474;

/**
 * Per-kilogram coefficients, by paper type.
 *
 * WARM and the industry figures differentiate grades. Where a grade is not separately
 * published (magazines, "other"), the conservative mixed-paper figure is used and noted.
 */
interface PaperFactor {
  /** kg CO2e avoided per kg recycled. EPA WARM. */
  co2eAvoidedKgPerKg: number;
  /** Litres of water saved per kg recycled. Estimate. */
  waterSavedLitresPerKg: number;
  /** kWh of energy saved per kg recycled. Estimate. */
  energySavedKwhPerKg: number;
  /** Trees-equivalent per kg recycled. Estimate; an equivalence, not a count of real trees. */
  treesEquivalentPerKg: number;
}

/**
 * Derived from published per-short-ton figures. Kept as explicit per-ton comments so the
 * conversion is auditable rather than a bare decimal.
 *
 * Water:  ~7,000 US gal/ton  = 26,498 L / 907.18 kg ≈ 29.2 L/kg   (uniform across grades)
 * Energy: ~4,000 kWh/ton     = 4,000 / 907.18 kg     ≈  4.41 kWh/kg (uniform across grades)
 * Trees:  ~17 trees/ton      = 17 / 907.18 kg        ≈  0.01874 /kg (uniform across grades)
 *
 * CO2e (EPA WARM, kg CO2e avoided per short ton recycled vs landfilled, then /907.18):
 *   Newspaper           ≈  800 kg/ton → 0.88 kg/kg   (conservative lower end of WARM range)
 *   Corrugated (card)   ≈  900 kg/ton → 0.99 kg/kg
 *   Office paper        ≈ 1,100 kg/ton → 1.21 kg/kg
 *   Mixed / magazine    ≈  850 kg/ton → 0.94 kg/kg
 *
 * The CO2 values are the CONSERVATIVE (landfill-methane-avoidance-weighted) end of the WARM
 * range, deliberately, so the platform under-claims rather than over-claims. Documented as
 * such so the choice is visible and defensible.
 */
const WATER_L_PER_KG = 26_498 / KG_PER_SHORT_TON;
const ENERGY_KWH_PER_KG = 4_000 / KG_PER_SHORT_TON;
const TREES_PER_KG = 17 / KG_PER_SHORT_TON;

const FACTORS: Readonly<Record<PaperType, PaperFactor>> = {
  NEWSPAPER: {
    co2eAvoidedKgPerKg: 800 / KG_PER_SHORT_TON,
    waterSavedLitresPerKg: WATER_L_PER_KG,
    energySavedKwhPerKg: ENERGY_KWH_PER_KG,
    treesEquivalentPerKg: TREES_PER_KG,
  },
  CARDBOARD: {
    co2eAvoidedKgPerKg: 900 / KG_PER_SHORT_TON,
    waterSavedLitresPerKg: WATER_L_PER_KG,
    energySavedKwhPerKg: ENERGY_KWH_PER_KG,
    treesEquivalentPerKg: TREES_PER_KG,
  },
  OFFICE_PAPER: {
    co2eAvoidedKgPerKg: 1_100 / KG_PER_SHORT_TON,
    waterSavedLitresPerKg: WATER_L_PER_KG,
    energySavedKwhPerKg: ENERGY_KWH_PER_KG,
    treesEquivalentPerKg: TREES_PER_KG,
  },
  // No separately-published grade — conservative mixed-paper figure.
  MAGAZINE: {
    co2eAvoidedKgPerKg: 850 / KG_PER_SHORT_TON,
    waterSavedLitresPerKg: WATER_L_PER_KG,
    energySavedKwhPerKg: ENERGY_KWH_PER_KG,
    treesEquivalentPerKg: TREES_PER_KG,
  },
  // Catch-all — conservative mixed-paper figure.
  OTHER: {
    co2eAvoidedKgPerKg: 850 / KG_PER_SHORT_TON,
    waterSavedLitresPerKg: WATER_L_PER_KG,
    energySavedKwhPerKg: ENERGY_KWH_PER_KG,
    treesEquivalentPerKg: TREES_PER_KG,
  },
};

/** Recycled weight, in grams, per paper type. The input to every impact figure. */
export type RecycledGramsByType = Partial<Record<PaperType, number>>;

/**
 * Every figure is prefixed "estimated" in the API layer, and the type name says so here.
 * There is no field called `carbonNegative`, `carbonNeutral`, `certified`, or `offset`, and
 * there never should be — none of those claims is supported by the methodology above, and a
 * sustainability platform that makes an unsupported claim is not a rounding error, it is a
 * regulatory and reputational incident.
 */
export interface EstimatedImpact {
  recycledKg: number;
  /** Mass diverted from landfill. Definitional, 1:1 — the most defensible figure here. */
  landfillDivertedKg: number;
  estimatedCo2eAvoidedKg: number;
  estimatedWaterSavedLitres: number;
  estimatedEnergySavedKwh: number;
  /** A trees-EQUIVALENT for intuition. Not a claim that N specific trees were saved. */
  estimatedTreesEquivalent: number;
}

const GRAMS_PER_KG = 1000;

/**
 * Converts recycled grams-by-type into estimated environmental impact.
 *
 * A pure function of the factors above and nothing else, so the tests can assert
 * `output === constant × input` and lock the coefficients against silent drift — which is
 * exactly the failure the brief calls out: someone tweaks the service later and every
 * historical impact number quietly changes.
 *
 * Linear and additive by construction: the impact of a batch is the sum of its items'
 * impacts, so per-user, per-org and per-platform totals all reconcile against each other.
 */
export function calculateImpact(gramsByType: RecycledGramsByType): EstimatedImpact {
  let recycledKg = 0;
  let co2e = 0;
  let water = 0;
  let energy = 0;
  let trees = 0;

  for (const [paperType, grams] of Object.entries(gramsByType)) {
    if (grams === undefined || grams === 0) continue;

    if (!Number.isFinite(grams) || grams < 0) {
      throw new RangeError(`recycled grams for ${paperType} must be a non-negative number`);
    }

    const factor = FACTORS[paperType as PaperType];
    const kg = grams / GRAMS_PER_KG;

    recycledKg += kg;
    co2e += kg * factor.co2eAvoidedKgPerKg;
    water += kg * factor.waterSavedLitresPerKg;
    energy += kg * factor.energySavedKwhPerKg;
    trees += kg * factor.treesEquivalentPerKg;
  }

  // FULL PRECISION. No rounding here, on purpose — the same discipline as money-in-paise.
  //
  // Rounding inside the calc would break two properties the rest of the system relies on:
  // exact linearity (2×round(x) ≠ round(2×x)) and additivity (summing many rounded per-user
  // impacts drifts away from the platform total). Rounding happens ONCE, at the presentation
  // edge (the DTO mapper), so aggregates always reconcile.
  return {
    recycledKg,
    // Definitional: what was recycled is what was not landfilled.
    landfillDivertedKg: recycledKg,
    estimatedCo2eAvoidedKg: co2e,
    estimatedWaterSavedLitres: water,
    estimatedEnergySavedKwh: energy,
    estimatedTreesEquivalent: trees,
  };
}

/** Exposed so the factor tests can assert the exact published coefficient per grade. */
export const __FACTORS_FOR_TEST = FACTORS;
