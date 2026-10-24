import { Inject, Injectable } from '@nestjs/common';

import { PhoneNumber } from '@/modules/auth/domain/value-objects/phone-number';
import { NotFoundError } from '@/shared/domain/errors/domain.error';
import { type User } from '../../domain/entities/user';
import { USER_REPOSITORY, type UserRepository } from '../../domain/ports/user.repository';

/**
 * Support lookup by phone: a customer calling in gives their number, not their user id.
 * The input is normalised to E.164 first, so `98765 43210` and `+919876543210` find the
 * same account.
 */
@Injectable()
export class FindUserByPhoneUseCase {
  constructor(@Inject(USER_REPOSITORY) private readonly users: UserRepository) {}

  /** @throws {InvalidPhoneNumberError} on input that is not a phone number. */
  async execute(rawPhone: string): Promise<User> {
    const phone = PhoneNumber.create(rawPhone);
    const user = await this.users.findByPhone(phone.e164);

    if (user === null) {
      throw new NotFoundError('User not found');
    }

    return user;
  }
}
