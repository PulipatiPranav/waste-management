import { InvariantViolationError } from '@/shared/domain/errors/domain.error';
import { OutOfStockError, remainingAfterFulfilment } from './inventory';

describe('remainingAfterFulfilment', () => {
  it('returns the stock left after taking the quantity', () => {
    expect(remainingAfterFulfilment(10, 3, 'SKU-1')).toBe(7);
    expect(remainingAfterFulfilment(1, 1, 'SKU-1')).toBe(0);
  });

  it('throws OutOfStockError when the quantity exceeds stock', () => {
    expect(() => remainingAfterFulfilment(2, 3, 'SKU-9')).toThrow(OutOfStockError);
  });

  it('carries the sku and the numbers on the error, for a useful 409', () => {
    try {
      remainingAfterFulfilment(0, 1, 'NOTEBOOK-A5');
      fail('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(OutOfStockError);
      const e = error as OutOfStockError;
      expect(e.sku).toBe('NOTEBOOK-A5');
      expect(e.requested).toBe(1);
      expect(e.available).toBe(0);
      expect(e.code).toBe('OUT_OF_STOCK');
    }
  });

  it('rejects malformed inputs', () => {
    expect(() => remainingAfterFulfilment(-1, 1, 'S')).toThrow(InvariantViolationError);
    expect(() => remainingAfterFulfilment(5, 0, 'S')).toThrow(InvariantViolationError);
    expect(() => remainingAfterFulfilment(5, 1.5, 'S')).toThrow(InvariantViolationError);
  });
});
