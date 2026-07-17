import { paiseToRupees } from '../domain/pricing';
import {
  type CartRecord,
  type OrderRecord,
  type ProductRecord,
  type SellerRecord,
  type VariantRecord,
} from '../domain/ports/marketplace.repository';
import {
  type CartDto,
  type OrderDto,
  type ProductDto,
  type SellerDto,
  type VariantDto,
} from './dto/marketplace.dto';

export const toVariantDto = (v: VariantRecord): VariantDto => ({
  id: v.id,
  sku: v.sku,
  name: v.name,
  pricePaise: v.pricePaise,
  priceRupees: paiseToRupees(v.pricePaise),
  stock: v.stock,
  isActive: v.isActive,
});

export const toProductDto = (p: ProductRecord): ProductDto => ({
  id: p.id,
  sellerName: p.sellerName,
  name: p.name,
  slug: p.slug,
  description: p.description,
  recycledContent: p.recycledContent,
  status: p.status,
  variants: p.variants.map(toVariantDto),
});

export const toSellerDto = (s: SellerRecord): SellerDto => ({
  id: s.id,
  name: s.name,
  status: s.status,
  gstin: s.gstin,
  contactName: s.contactName,
  contactPhone: s.contactPhone,
  city: s.city,
  state: s.state,
});

export const toCartDto = (c: CartRecord): CartDto => ({
  lines: c.lines.map((line) => ({
    ...line,
    lineTotalRupees: paiseToRupees(line.lineTotalPaise),
  })),
  subtotalPaise: c.subtotalPaise,
  subtotalRupees: paiseToRupees(c.subtotalPaise),
});

export const toOrderDto = (o: OrderRecord): OrderDto => ({
  id: o.id,
  status: o.status,
  subtotalPaise: o.subtotalPaise,
  totalPaise: o.totalPaise,
  totalRupees: paiseToRupees(o.totalPaise),
  walletAppliedPaise: o.walletAppliedPaise,
  gatewayAmountPaise: o.gatewayAmountPaise,
  failureReason: o.failureReason,
  items: o.items.map((item) => ({
    sku: item.sku,
    productName: item.productName,
    variantName: item.variantName,
    unitPricePaise: item.unitPricePaise,
    quantity: item.quantity,
    lineTotalPaise: item.lineTotalPaise,
  })),
  payment:
    o.payment === null
      ? null
      : {
          provider: o.payment.provider,
          gatewayOrderId: o.payment.gatewayOrderId,
          gatewayPaymentId: o.payment.gatewayPaymentId,
          amountPaise: o.payment.amountPaise,
          status: o.payment.status,
        },
  createdAt: o.createdAt.toISOString(),
});
