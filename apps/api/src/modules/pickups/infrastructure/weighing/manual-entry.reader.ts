import { Injectable } from '@nestjs/common';

import { InvariantViolationError } from '@/shared/domain/errors/domain.error';
import {
  type RawWeightInput,
  type WeighingDeviceReader,
  type WeightReading,
} from '../../domain/ports/weighing-device.port';

/**
 * A plausible weight for one paper type in one household pickup.
 *
 * 200 kg is not a bundle of newspapers, it is a fat finger — a partner typing grams into
 * a field labelled kg, or 50000 instead of 5000. Catching it here costs nothing; not
 * catching it credits a customer ₹3,000 for a month of newspapers and someone has to
 * unwind it from an append-only ledger with a visible correcting entry.
 *
 * Deliberately generous: a genuine 100 kg office-paper pickup should go through. It is a
 * sanity bound, not a business rule.
 */
const MAX_PLAUSIBLE_GRAMS = 200_000; // 200 kg

@Injectable()
export class ManualEntryWeighingReader implements WeighingDeviceReader {
  /**
   * Validates weights a partner typed in.
   *
   * The validation, not the entry, is the point. When the Bluetooth scale arrives, its
   * reader will run the same checks — a scale on a flaky BLE link reports nonsense too,
   * and a nonsense weight is money.
   */
  read(inputs: readonly RawWeightInput[]): Promise<WeightReading[]> {
    return Promise.resolve(
      inputs.map((input) => {
        if (!Number.isInteger(input.weightGrams)) {
          throw new InvariantViolationError(
            `Weight must be a whole number of grams; got ${input.weightGrams}. ` +
              'Send grams, not kilograms.',
          );
        }

        if (input.weightGrams <= 0) {
          // A zero-weight line is not a pickup of nothing, it is a mistake. If the customer
          // had no cardboard, the partner should not send a CARDBOARD line at all.
          throw new InvariantViolationError(
            `Weight must be greater than zero for ${input.paperType}. Omit the line instead.`,
          );
        }

        if (input.weightGrams > MAX_PLAUSIBLE_GRAMS) {
          throw new InvariantViolationError(
            `${input.weightGrams} g (${(input.weightGrams / 1000).toFixed(1)} kg) of ` +
              `${input.paperType} is implausible for one pickup. Check the units — grams, not kilograms.`,
          );
        }

        return {
          paperType: input.paperType,
          weightGrams: input.weightGrams,
          source: 'MANUAL' as const,
        };
      }),
    );
  }
}
