import { Injectable } from '@nestjs/common';

import { PrismaService } from '@/shared/infrastructure/persistence/prisma/prisma.service';
import { Address, type AddressOwner } from '../../domain/entities/address';
import { type AddressData, type AddressRepository } from '../../domain/ports/address.repository';

interface AddressRow {
  id: string;
  label: string | null;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  pincode: string;
  country: string;
  landmark: string | null;
  isDefault: boolean;
  userId: string | null;
  apartmentId: string | null;
  businessId: string | null;
  createdAt: Date;
}

@Injectable()
export class PrismaAddressRepository implements AddressRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(owner: AddressOwner, data: AddressData): Promise<Address> {
    const row = await this.prisma.address.create({
      data: { ...data, ...this.ownerColumns(owner) },
    });

    return this.toDomain(row);
  }

  async findById(id: string): Promise<Address | null> {
    const row = await this.prisma.address.findUnique({ where: { id } });
    return row === null ? null : this.toDomain(row);
  }

  async listForUser(userId: string): Promise<Address[]> {
    const rows = await this.prisma.address.findMany({
      where: { userId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });

    return rows.map((row) => this.toDomain(row));
  }

  async update(id: string, data: Partial<AddressData>): Promise<Address> {
    const row = await this.prisma.address.update({ where: { id }, data });
    return this.toDomain(row);
  }

  async delete(id: string): Promise<void> {
    await this.prisma.address.delete({ where: { id } });
  }

  /**
   * Clear-then-set, inside one transaction.
   *
   * Without the transaction, a crash between the two statements leaves the owner with
   * NO default address, and the next pickup has nowhere to go. Doing it in the other
   * order would transiently leave two defaults, which is just as bad for any query
   * that does `findFirst({ where: { isDefault: true } })`.
   */
  async setAsDefault(owner: AddressOwner, addressId: string): Promise<void> {
    const scope = this.ownerColumns(owner);

    await this.prisma.$transaction([
      this.prisma.address.updateMany({
        where: { ...scope, id: { not: addressId } },
        data: { isDefault: false },
      }),
      this.prisma.address.update({
        where: { id: addressId },
        data: { isDefault: true },
      }),
    ]);
  }

  private ownerColumns(owner: AddressOwner): {
    userId: string | null;
    apartmentId: string | null;
    businessId: string | null;
  } {
    return {
      userId: owner.kind === 'user' ? owner.id : null,
      apartmentId: owner.kind === 'apartment' ? owner.id : null,
      businessId: owner.kind === 'business' ? owner.id : null,
    };
  }

  private toDomain(row: AddressRow): Address {
    return Address.fromPersistence({
      id: row.id,
      label: row.label,
      line1: row.line1,
      line2: row.line2,
      city: row.city,
      state: row.state,
      pincode: row.pincode,
      country: row.country,
      landmark: row.landmark,
      isDefault: row.isDefault,
      owner: this.toOwner(row),
      createdAt: row.createdAt,
    });
  }

  private toOwner(row: AddressRow): AddressOwner {
    if (row.userId !== null) return { kind: 'user', id: row.userId };
    if (row.apartmentId !== null) return { kind: 'apartment', id: row.apartmentId };
    if (row.businessId !== null) return { kind: 'business', id: row.businessId };

    // Unreachable: the `addresses_exactly_one_owner` check constraint makes an
    // ownerless row impossible to insert. If this ever throws, that constraint was
    // dropped — and silently defaulting to some owner would be far worse than failing.
    throw new Error(`Address ${row.id} has no owner; the check constraint must be missing.`);
  }
}
