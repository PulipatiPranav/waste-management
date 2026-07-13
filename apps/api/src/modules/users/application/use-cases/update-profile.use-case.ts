import { Inject, Injectable } from '@nestjs/common';

import { ConflictError, NotFoundError } from '@/shared/domain/errors/domain.error';
import { type User } from '../../domain/entities/user';
import { USER_REPOSITORY, type UserRepository } from '../../domain/ports/user.repository';

export interface UpdateProfileCommand {
  userId: string;
  name?: string | undefined;
  email?: string | undefined;
}

@Injectable()
export class UpdateProfileUseCase {
  constructor(@Inject(USER_REPOSITORY) private readonly users: UserRepository) {}

  async execute(command: UpdateProfileCommand): Promise<User> {
    const user = await this.users.findById(command.userId);

    if (user === null) {
      throw new NotFoundError('User not found');
    }

    // Note what is NOT updatable here: `role`, `phone`, `isActive`. Letting a user
    // PATCH their own role is privilege escalation in one line, and it is exactly the
    // kind of thing a permissive `data: { ...dto }` spread introduces by accident.
    // Role changes are an admin operation with an audit trail (Phase 9).
    if (command.email !== undefined) {
      const email = command.email.trim().toLowerCase();
      const existing = await this.users.findByEmail(email);

      if (existing !== null && existing.id !== user.id) {
        throw new ConflictError('That email address is already in use.');
      }

      return this.users.updateProfile(user.id, {
        email,
        ...(command.name !== undefined ? { name: command.name.trim() } : {}),
      });
    }

    return this.users.updateProfile(user.id, {
      ...(command.name !== undefined ? { name: command.name.trim() } : {}),
    });
  }
}
