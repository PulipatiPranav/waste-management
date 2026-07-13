import { Inject, Injectable } from '@nestjs/common';

import { NotFoundError } from '@/shared/domain/errors/domain.error';
import { type Address } from '../domain/entities/address';
import {
  ADDRESS_REPOSITORY,
  type AddressData,
  type AddressRepository,
} from '../domain/ports/address.repository';

export type CreateAddressCommand = { userId: string } & Omit<AddressData, 'isDefault'> & {
    isDefault?: boolean;
  };

export interface UpdateAddressCommand {
  userId: string;
  addressId: string;
  data: Partial<Omit<AddressData, 'isDefault'>> & { isDefault?: boolean };
}

@Injectable()
export class AddressUseCases {
  constructor(@Inject(ADDRESS_REPOSITORY) private readonly addresses: AddressRepository) {}

  async create(command: CreateAddressCommand): Promise<Address> {
    const { userId, isDefault, ...rest } = command;

    const existing = await this.addresses.listForUser(userId);

    // The first address a user adds is their default whether they asked or not —
    // otherwise their very first pickup has no address to go to.
    const shouldBeDefault = isDefault ?? existing.length === 0;

    const address = await this.addresses.create(
      { kind: 'user', id: userId },
      { ...rest, isDefault: shouldBeDefault },
    );

    if (shouldBeDefault) {
      await this.addresses.setAsDefault({ kind: 'user', id: userId }, address.id);
    }

    return address;
  }

  list(userId: string): Promise<Address[]> {
    return this.addresses.listForUser(userId);
  }

  async get(userId: string, addressId: string): Promise<Address> {
    return this.loadOwned(userId, addressId);
  }

  async update(command: UpdateAddressCommand): Promise<Address> {
    await this.loadOwned(command.userId, command.addressId);

    const { isDefault, ...rest } = command.data;
    const updated = await this.addresses.update(command.addressId, {
      ...rest,
      ...(isDefault !== undefined ? { isDefault } : {}),
    });

    if (isDefault === true) {
      await this.addresses.setAsDefault({ kind: 'user', id: command.userId }, command.addressId);
    }

    return updated;
  }

  async remove(userId: string, addressId: string): Promise<void> {
    await this.loadOwned(userId, addressId);
    await this.addresses.delete(addressId);
  }

  /**
   * Load-then-authorise, in ONE place that every mutating path must go through.
   *
   * A 404 — not a 403 — when the address exists but belongs to somebody else. A 403
   * would confirm the id is real, letting an attacker enumerate valid address ids by
   * watching which ones come back "forbidden" instead of "not found".
   */
  private async loadOwned(userId: string, addressId: string): Promise<Address> {
    const address = await this.addresses.findById(addressId);

    if (!address?.isOwnedByUser(userId)) {
      throw new NotFoundError('Address not found');
    }

    return address;
  }
}
