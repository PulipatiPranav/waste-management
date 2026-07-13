import { Injectable } from '@nestjs/common';
import { type Role as PrismaRole } from '@prisma/client';

import { type Role } from '@/modules/auth/domain/value-objects/role';
import { PrismaService } from '@/shared/infrastructure/persistence/prisma/prisma.service';
import { User } from '../../domain/entities/user';
import {
  type UpdateUserProfileInput,
  type UserRepository,
} from '../../domain/ports/user.repository';

@Injectable()
export class PrismaUserRepository implements UserRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<User | null> {
    const row = await this.prisma.user.findUnique({ where: { id } });
    return row === null ? null : this.toDomain(row);
  }

  async findByPhone(phone: string): Promise<User | null> {
    const row = await this.prisma.user.findUnique({ where: { phone } });
    return row === null ? null : this.toDomain(row);
  }

  async findByEmail(email: string): Promise<User | null> {
    const row = await this.prisma.user.findUnique({ where: { email } });
    return row === null ? null : this.toDomain(row);
  }

  /**
   * Upsert, not find-then-create.
   *
   * Two OTP verifications racing for a brand-new number would both see "no user" and
   * both INSERT, and the unique index on `phone` would blow one of them up with a 500
   * on the user's very first login. `upsert` pushes that race down to Postgres, which
   * resolves it correctly.
   */
  async findOrCreateByPhone(phone: string, role: Role, verifiedAt: Date): Promise<User> {
    const row = await this.prisma.user.upsert({
      where: { phone },
      // Existing user: touch nothing. Their role and profile are not ours to reset —
      // an OPS_STAFF member logging in by OTP must not be demoted to CUSTOMER.
      update: {},
      create: {
        phone,
        role: role,
        phoneVerifiedAt: verifiedAt,
      },
    });

    return this.toDomain(row);
  }

  async updateProfile(id: string, input: UpdateUserProfileInput): Promise<User> {
    const row = await this.prisma.user.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.email !== undefined ? { email: input.email } : {}),
      },
    });

    return this.toDomain(row);
  }

  async markPhoneVerified(id: string, at: Date): Promise<void> {
    await this.prisma.user.update({
      where: { id },
      data: { phoneVerifiedAt: at },
    });
  }

  private toDomain(row: {
    id: string;
    phone: string;
    email: string | null;
    name: string | null;
    role: PrismaRole;
    passwordHash: string | null;
    phoneVerifiedAt: Date | null;
    isActive: boolean;
    createdAt: Date;
  }): User {
    return User.fromPersistence({
      id: row.id,
      phone: row.phone,
      email: row.email,
      name: row.name,
      role: row.role,
      passwordHash: row.passwordHash,
      phoneVerifiedAt: row.phoneVerifiedAt,
      isActive: row.isActive,
      createdAt: row.createdAt,
    });
  }
}
