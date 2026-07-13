import { Inject, Injectable } from '@nestjs/common';

import { NotFoundError } from '@/shared/domain/errors/domain.error';
import { type User } from '../../domain/entities/user';
import { USER_REPOSITORY, type UserRepository } from '../../domain/ports/user.repository';

@Injectable()
export class GetProfileUseCase {
  constructor(@Inject(USER_REPOSITORY) private readonly users: UserRepository) {}

  async execute(userId: string): Promise<User> {
    const user = await this.users.findById(userId);

    if (user === null) {
      throw new NotFoundError('User not found');
    }

    return user;
  }
}
