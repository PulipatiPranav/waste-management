import { type Address, type AddressOwner } from '../entities/address';

export interface AddressData {
  label: string | null;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  pincode: string;
  country: string;
  landmark: string | null;
  isDefault: boolean;
}

export interface AddressRepository {
  create(owner: AddressOwner, data: AddressData): Promise<Address>;

  findById(id: string): Promise<Address | null>;

  listForUser(userId: string): Promise<Address[]>;

  update(id: string, data: Partial<AddressData>): Promise<Address>;

  delete(id: string): Promise<void>;

  /**
   * Sets one address as the owner's default and clears the flag on the rest, in a
   * single transaction. Two addresses both marked default means the pickup job has to
   * pick one arbitrarily, and the van turns up at the wrong door.
   */
  setAsDefault(owner: AddressOwner, addressId: string): Promise<void>;
}

export const ADDRESS_REPOSITORY = Symbol('ADDRESS_REPOSITORY');
