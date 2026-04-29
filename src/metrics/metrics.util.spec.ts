import { calculateRevpar } from './metrics.util';

describe('calculateRevpar', () => {
  it('returns rounded revenue per available room', () => {
    expect(calculateRevpar(10000, 87)).toBe(114.94);
  });

  it('returns zero when total rooms is zero', () => {
    expect(calculateRevpar(10000, 0)).toBe(0);
  });
});
