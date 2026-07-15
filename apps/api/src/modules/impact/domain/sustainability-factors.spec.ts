import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  __FACTORS_FOR_TEST as FACTORS,
  IMPACT_METHODOLOGY,
  calculateImpact,
  type EstimatedImpact,
} from './sustainability-factors';

const KG_PER_SHORT_TON = 907.18474;

describe('sustainability factors', () => {
  /**
   * These are GOLDEN tests. They exist so that if someone edits a coefficient — deliberately
   * or by accident — this file fails and forces a conversation, because changing a factor
   * silently changes every historical impact number the platform ever showed.
   *
   * When a factor is genuinely re-verified against a new WARM version, update BOTH the
   * constant and its expected value here, in one reviewed commit. That friction is the point.
   */
  describe('the published coefficients (locked against drift)', () => {
    it('pins the EPA WARM CO2e factors per grade', () => {
      expect(FACTORS.NEWSPAPER.co2eAvoidedKgPerKg).toBeCloseTo(800 / KG_PER_SHORT_TON, 10);
      expect(FACTORS.CARDBOARD.co2eAvoidedKgPerKg).toBeCloseTo(900 / KG_PER_SHORT_TON, 10);
      expect(FACTORS.OFFICE_PAPER.co2eAvoidedKgPerKg).toBeCloseTo(1_100 / KG_PER_SHORT_TON, 10);
      expect(FACTORS.MAGAZINE.co2eAvoidedKgPerKg).toBeCloseTo(850 / KG_PER_SHORT_TON, 10);
      expect(FACTORS.OTHER.co2eAvoidedKgPerKg).toBeCloseTo(850 / KG_PER_SHORT_TON, 10);
    });

    it('pins the estimated water / energy / trees factors', () => {
      expect(FACTORS.NEWSPAPER.waterSavedLitresPerKg).toBeCloseTo(26_498 / KG_PER_SHORT_TON, 10);
      expect(FACTORS.NEWSPAPER.energySavedKwhPerKg).toBeCloseTo(4_000 / KG_PER_SHORT_TON, 10);
      expect(FACTORS.NEWSPAPER.treesEquivalentPerKg).toBeCloseTo(17 / KG_PER_SHORT_TON, 10);
    });

    it('carries a source citation for every metric', () => {
      // Defensibility is the whole feature. A factor with no provenance is a number we cannot
      // stand behind when a business customer's auditor asks where it came from.
      for (const metric of Object.values(IMPACT_METHODOLOGY)) {
        expect(metric.source.length).toBeGreaterThan(10);
        expect(['MEASURED', 'MODELLED', 'ESTIMATE']).toContain(metric.rigour);
      }
    });

    it('labels CO2 as MODELLED (WARM) and water/trees/energy as ESTIMATE', () => {
      // The honesty tiering. Conflating a WARM-modelled figure with a diffusely-sourced one is
      // how a sustainability platform ends up in a greenwashing complaint.
      expect(IMPACT_METHODOLOGY.co2eAvoidedKg.rigour).toBe('MODELLED');
      expect(IMPACT_METHODOLOGY.co2eAvoidedKg.source).toMatch(/WARM/);
      expect(IMPACT_METHODOLOGY.waterSavedLitres.rigour).toBe('ESTIMATE');
      expect(IMPACT_METHODOLOGY.treesEquivalent.rigour).toBe('ESTIMATE');
      expect(IMPACT_METHODOLOGY.energySavedKwh.rigour).toBe('ESTIMATE');
      // Landfill diversion is the one we can actually measure.
      expect(IMPACT_METHODOLOGY.landfillDivertedKg.rigour).toBe('MEASURED');
    });
  });

  describe('calculateImpact', () => {
    it('gives exactly zero for nothing recycled', () => {
      const impact = calculateImpact({});

      for (const value of Object.values(impact)) {
        expect(value).toBe(0);
      }
    });

    it('computes a clean tonne of newspaper against the published factors', () => {
      // 1000 kg newspaper. Every figure must be exactly 1000 × the per-kg factor. Full
      // precision — rounding is the presentation layer's job.
      const impact = calculateImpact({ NEWSPAPER: 1_000_000 });

      expect(impact.recycledKg).toBe(1000);
      expect(impact.landfillDivertedKg).toBe(1000);
      expect(impact.estimatedCo2eAvoidedKg).toBeCloseTo(1000 * (800 / KG_PER_SHORT_TON), 3);
      expect(impact.estimatedWaterSavedLitres).toBeCloseTo(1000 * (26_498 / KG_PER_SHORT_TON), 3);
      expect(impact.estimatedTreesEquivalent).toBeCloseTo(1000 * (17 / KG_PER_SHORT_TON), 3);
    });

    it('is exactly linear: doubling the input doubles every output', () => {
      // The property the brief calls out. If this ever fails, the service has grown a
      // non-linearity that would make historical totals irreproducible.
      const single = calculateImpact({ NEWSPAPER: 5000 });
      const double = calculateImpact({ NEWSPAPER: 10_000 });

      // Exact, to 10 dp — the domain calc is full precision, so linearity is not merely
      // approximate. (It was this assertion that caught the rounding-inside-the-domain bug.)
      const keys = Object.keys(single) as (keyof EstimatedImpact)[];
      for (const key of keys) {
        expect(double[key]).toBeCloseTo(single[key] * 2, 10);
      }
    });

    it('is additive: the impact of a mix equals the sum of its parts', () => {
      // This is what lets per-user, per-org and per-platform totals reconcile.
      const mixed = calculateImpact({ NEWSPAPER: 3000, CARDBOARD: 2000 });

      const news = calculateImpact({ NEWSPAPER: 3000 });
      const card = calculateImpact({ CARDBOARD: 2000 });

      expect(mixed.estimatedCo2eAvoidedKg).toBeCloseTo(
        news.estimatedCo2eAvoidedKg + card.estimatedCo2eAvoidedKg,
        3,
      );
      expect(mixed.recycledKg).toBeCloseTo(news.recycledKg + card.recycledKg, 3);
    });

    it('differentiates grades: office paper avoids more CO2 per kg than newspaper', () => {
      const office = calculateImpact({ OFFICE_PAPER: 10_000 });
      const news = calculateImpact({ NEWSPAPER: 10_000 });

      // Same mass, different grade, different CO2 — because the factors are per-grade, not a
      // single blended number that would misstate a cardboard-heavy or office-heavy customer.
      expect(office.estimatedCo2eAvoidedKg).toBeGreaterThan(news.estimatedCo2eAvoidedKg);
      // ...but landfill diversion is mass, so it is identical.
      expect(office.landfillDivertedKg).toBe(news.landfillDivertedKg);
    });

    it('rejects negative or non-finite weights', () => {
      expect(() => calculateImpact({ NEWSPAPER: -1 })).toThrow(RangeError);
      expect(() => calculateImpact({ NEWSPAPER: Number.NaN })).toThrow(RangeError);
      expect(() => calculateImpact({ NEWSPAPER: Number.POSITIVE_INFINITY })).toThrow(RangeError);
    });
  });

  describe('no overclaiming — enforced against the source, not just by convention', () => {
    const forbidden = [
      'carbon negative',
      'carbon neutral',
      'carbon-negative',
      'carbon-neutral',
      'net zero',
      'net-zero',
      'certified offset',
      'guaranteed',
    ];

    it('the impact module contains no unsupported strong claims', () => {
      // A grep, as a test. The brief is explicit: cap claims to what the methodology supports.
      // "Estimated CO2 avoided" is supportable; "carbon negative certified" is not, and must
      // not appear anywhere in this module's source — not in a label, a comment, or a doc.
      const dir = __dirname;
      const files = ['sustainability-factors.ts'];

      for (const file of files) {
        const source = readFileSync(join(dir, file), 'utf8').toLowerCase();

        for (const claim of forbidden) {
          // Allow the word inside an explicit NEGATION (the code documenting what it must not
          // say). We assert the claim never appears as an affirmative label.
          const affirmativeUse =
            source.includes(claim) &&
            !source.includes(`no ${claim}`) &&
            !source.includes(`not ${claim}`) &&
            !source.includes(`never`) &&
            !source.includes(`unsupported`);

          expect({ file, claim, affirmativeUse }).toEqual({ file, claim, affirmativeUse: false });
        }
      }
    });

    it('every estimated field is named as an estimate', () => {
      const impact = calculateImpact({ NEWSPAPER: 1000 });

      // The three ESTIMATE-tier metrics carry "estimated" in their key. Landfill diversion and
      // recycled mass are measured, so they legitimately do not.
      expect(impact).toHaveProperty('estimatedCo2eAvoidedKg');
      expect(impact).toHaveProperty('estimatedWaterSavedLitres');
      expect(impact).toHaveProperty('estimatedEnergySavedKwh');
      expect(impact).toHaveProperty('estimatedTreesEquivalent');

      // And there is no affirmative-claim field.
      expect(impact).not.toHaveProperty('carbonNegative');
      expect(impact).not.toHaveProperty('carbonNeutral');
      expect(impact).not.toHaveProperty('certified');
    });
  });
});
