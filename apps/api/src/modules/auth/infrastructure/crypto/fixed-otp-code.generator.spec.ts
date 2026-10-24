import { FixedOtpCodeGenerator } from './fixed-otp-code.generator';

describe('FixedOtpCodeGenerator', () => {
  it('returns all zeros at the requested length', () => {
    const generator = new FixedOtpCodeGenerator();
    expect(generator.generate(6)).toBe('000000');
    expect(generator.generate(4)).toBe('0000');
  });
});
