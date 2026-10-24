import { InvalidPhoneNumberError } from '@/modules/auth/domain/errors/auth.errors';
import { NotFoundError } from '@/shared/domain/errors/domain.error';
import { type UserRepository } from '../../domain/ports/user.repository';
import { FindUserByPhoneUseCase } from './find-user-by-phone.use-case';

describe('FindUserByPhoneUseCase', () => {
  const user = { id: 'u1' };
  const findByPhone = jest.fn((phone: string) =>
    Promise.resolve(phone === '+919876543210' ? user : null),
  );
  const useCase = new FindUserByPhoneUseCase({ findByPhone } as unknown as UserRepository);

  it('normalises the number before looking it up', async () => {
    await expect(useCase.execute('98765 43210')).resolves.toBe(user);
    expect(findByPhone).toHaveBeenCalledWith('+919876543210');
  });

  it('throws NotFound for an unknown number', async () => {
    await expect(useCase.execute('+919000000999')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects input that is not a phone number', async () => {
    await expect(useCase.execute('not-a-phone')).rejects.toBeInstanceOf(InvalidPhoneNumberError);
  });
});
