import { gramsToKg, paiseToRupees } from '@/modules/wallet/domain/money';
import { type PickupRecord, type RateCardRecord } from '../domain/ports/pickup.repository';
import { type PickupDto, type PickupItemDto, type RateCardDto } from './dto/pickup.dto';

export function toPickupItemDto(item: {
  paperType: string;
  weightGrams: number;
  ratePerKgPaise: number;
  amountPaise: number;
}): PickupItemDto {
  return {
    paperType: item.paperType,
    weightGrams: item.weightGrams,
    weightKg: gramsToKg(item.weightGrams),
    ratePerKgPaise: item.ratePerKgPaise,
    amountPaise: item.amountPaise,
    amountRupees: paiseToRupees(item.amountPaise),
  };
}

/**
 * @param includeQrToken only for the OWNING customer. The token authorises a partner to
 * weigh paper against this customer's wallet, so it must not appear in any list a third
 * party can read.
 */
export function toPickupDto(pickup: PickupRecord, includeQrToken: boolean): PickupDto {
  const items = pickup.items.map((item) =>
    toPickupItemDto({
      paperType: item.paperType,
      weightGrams: item.weightGrams,
      ratePerKgPaise: item.ratePerKgPaiseAtPickup,
      amountPaise: item.amountPaise,
    }),
  );

  const totalPaise = items.reduce((sum, item) => sum + item.amountPaise, 0);

  return {
    id: pickup.id,
    addressId: pickup.addressId,
    scheduledDate: pickup.scheduledDate.toString(),
    windowStartHour: pickup.windowStartHour,
    windowEndHour: pickup.windowEndHour,
    status: pickup.status,
    qrToken: includeQrToken ? pickup.qrToken : null,
    items,
    totalPaise,
    totalRupees: paiseToRupees(totalPaise),
    completedAt: pickup.completedAt?.toISOString() ?? null,
  };
}

export function toRateCardDto(card: RateCardRecord): RateCardDto {
  return {
    id: card.id,
    name: card.name,
    isActive: card.isActive,
    rates: card.rates.map((rate) => ({
      paperType: rate.paperType,
      ratePerKgPaise: rate.ratePerKgPaise,
      ratePerKgRupees: paiseToRupees(rate.ratePerKgPaise),
    })),
  };
}
