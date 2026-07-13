import { type Role } from '@/modules/auth/domain/value-objects/role';
import { type User } from '../entities/user';

export interface UpdateUserProfileInput {
  name?: string | undefined;
  email?: string | null | undefined;
}

export interface UserRepository {
  findById(id: string): Promise<User | null>;
  findByPhone(phone: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;

  /**
   * Returns the existing user for this phone, or creates one.
   *
   * A single upsert rather than find-then-create: two OTP verifications racing for a
   * brand-new phone number would both see "no user" and both insert, and the unique
   * index would fail one of them with a 500 at the worst possible moment — the user's
   * very first login.
   */
  findOrCreateByPhone(phone: string, role: Role, verifiedAt: Date): Promise<User>;

  updateProfile(id: string, input: UpdateUserProfileInput): Promise<User>;

  markPhoneVerified(id: string, at: Date): Promise<void>;
}

export const USER_REPOSITORY = Symbol('USER_REPOSITORY');
