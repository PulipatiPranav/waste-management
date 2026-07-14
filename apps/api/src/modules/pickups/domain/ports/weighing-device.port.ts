import { type PaperType } from '@/modules/wallet/domain/money';

export interface WeightReading {
  paperType: PaperType;
  /** INTEGER GRAMS. Never a float kilogram — see the money convention. */
  weightGrams: number;
  /** How this number got here. Stored nowhere yet; it is the audit trail Phase 14 wants. */
  source: 'MANUAL' | 'BLUETOOTH_SCALE';
}

export interface RawWeightInput {
  paperType: PaperType;
  weightGrams: number;
}

/**
 * Reads weights from a scale.
 *
 * An interface because the real thing is a Bluetooth digital scale paired to the
 * partner's phone, and that is a hardware-dependent phase we are not in. The manual-entry
 * implementation below is what ships now; a `BluetoothScaleReader` later is a new class
 * and one line of module wiring, with no use case changes.
 *
 * The point of the abstraction is not "we might swap it" — it is that the VALIDATION of a
 * weight (is it a positive integer? is it plausible?) belongs in one place regardless of
 * where the number came from. A scale can report garbage over a flaky BLE link just as a
 * human can fat-finger 50 kg instead of 5.
 */
export interface WeighingDeviceReader {
  read(inputs: readonly RawWeightInput[]): Promise<WeightReading[]>;
}

export const WEIGHING_DEVICE_READER = Symbol('WEIGHING_DEVICE_READER');
