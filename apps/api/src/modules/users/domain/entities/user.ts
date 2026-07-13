import { type Role } from '@/modules/auth/domain/value-objects/role';

export interface UserProps {
  id: string;
  phone: string;
  email: string | null;
  name: string | null;
  role: Role;
  passwordHash: string | null;
  phoneVerifiedAt: Date | null;
  isActive: boolean;
  createdAt: Date;
}

export class User {
  private constructor(private readonly props: UserProps) {}

  static fromPersistence(props: UserProps): User {
    return new User(props);
  }

  get id(): string {
    return this.props.id;
  }

  get phone(): string {
    return this.props.phone;
  }

  get email(): string | null {
    return this.props.email;
  }

  get name(): string | null {
    return this.props.name;
  }

  get role(): Role {
    return this.props.role;
  }

  get passwordHash(): string | null {
    return this.props.passwordHash;
  }

  get phoneVerifiedAt(): Date | null {
    return this.props.phoneVerifiedAt;
  }

  get isActive(): boolean {
    return this.props.isActive;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  /** A customer has no password; only staff do. Guards password login. */
  canLoginWithPassword(): boolean {
    return this.props.passwordHash !== null;
  }

  /**
   * The safe projection. Anything leaving the API goes through this — never the
   * entity itself, or `passwordHash` ends up in a JSON response the first time
   * someone returns a user object directly from a controller.
   */
  toPublic(): {
    id: string;
    phone: string;
    email: string | null;
    name: string | null;
    role: Role;
    isActive: boolean;
    createdAt: Date;
  } {
    return {
      id: this.props.id,
      phone: this.props.phone,
      email: this.props.email,
      name: this.props.name,
      role: this.props.role,
      isActive: this.props.isActive,
      createdAt: this.props.createdAt,
    };
  }
}
