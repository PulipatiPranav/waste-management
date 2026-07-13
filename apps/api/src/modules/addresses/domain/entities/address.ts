export type AddressOwner =
  | { kind: 'user'; id: string }
  | { kind: 'apartment'; id: string }
  | { kind: 'business'; id: string };

export interface AddressProps {
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
  owner: AddressOwner;
  createdAt: Date;
}

export class Address {
  private constructor(private readonly props: AddressProps) {}

  static fromPersistence(props: AddressProps): Address {
    return new Address(props);
  }

  get id(): string {
    return this.props.id;
  }

  get owner(): AddressOwner {
    return this.props.owner;
  }

  get isDefault(): boolean {
    return this.props.isDefault;
  }

  /**
   * The single authorisation question for this resource.
   *
   * Every read, update and delete goes through it, so "can user A touch user B's
   * address?" is answered in one place rather than re-derived (and eventually got
   * wrong) in each use case. Phase 14's IDOR sweep should find nothing here.
   */
  isOwnedByUser(userId: string): boolean {
    return this.props.owner.kind === 'user' && this.props.owner.id === userId;
  }

  toPublic(): Omit<AddressProps, 'owner'> & { owner: AddressOwner } {
    return { ...this.props };
  }
}
