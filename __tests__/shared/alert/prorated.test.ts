import { checkProrated } from '../../../src/shared/alert/prorated';

const DAY = 24 * 60 * 60 * 1000;

describe('checkProrated', () => {
  test('at window start: expected ≈ 0', () => {
    const now = 1_700_000_000_000;
    const result = checkProrated({
      utilization: 0,
      resetsAtMs: now + 7 * DAY,
      windowMs: 7 * DAY,
      nowMs: now,
    });
    expect(result.expected).toBeCloseTo(0, 5);
    expect(result.breached).toBe(false);
    expect(result.overBy).toBeCloseTo(0, 5);
  });

  test('half-way through window: expected ≈ 50', () => {
    const now = 1_700_000_000_000;
    const result = checkProrated({
      utilization: 40,
      resetsAtMs: now + 3.5 * DAY,
      windowMs: 7 * DAY,
      nowMs: now,
    });
    expect(result.expected).toBeCloseTo(50, 5);
    expect(result.breached).toBe(false);
    expect(result.overBy).toBeCloseTo(-10, 5);
  });

  test('breach: utilization > expected', () => {
    const now = 1_700_000_000_000;
    const result = checkProrated({
      utilization: 60,
      resetsAtMs: now + 3.5 * DAY,
      windowMs: 7 * DAY,
      nowMs: now,
    });
    expect(result.expected).toBeCloseTo(50, 5);
    expect(result.breached).toBe(true);
    expect(result.overBy).toBeCloseTo(10, 5);
  });

  test('user example: day 1 of 7, 15% used, expected ≈ 14.28 → breached', () => {
    const now = 1_700_000_000_000;
    const result = checkProrated({
      utilization: 15,
      resetsAtMs: now + 6 * DAY,
      windowMs: 7 * DAY,
      nowMs: now,
    });
    expect(result.expected).toBeCloseTo(100 / 7, 2);
    expect(result.breached).toBe(true);
  });

  test('near reset: expected ≈ 100', () => {
    const now = 1_700_000_000_000;
    const result = checkProrated({
      utilization: 99,
      resetsAtMs: now + 60_000,
      windowMs: 7 * DAY,
      nowMs: now,
    });
    expect(result.expected).toBeGreaterThan(99.9);
    expect(result.breached).toBe(false);
  });

  test('windowMs <= 0 throws', () => {
    expect(() =>
      checkProrated({ utilization: 0, resetsAtMs: 0, windowMs: 0, nowMs: 0 })
    ).toThrow(/windowMs/);
  });

  test('clamps expected to [0, 100]', () => {
    const now = 1_700_000_000_000;
    const past = checkProrated({
      utilization: 50,
      resetsAtMs: now - 60_000,
      windowMs: 7 * DAY,
      nowMs: now,
    });
    expect(past.expected).toBe(100);
    const future = checkProrated({
      utilization: 50,
      resetsAtMs: now + 30 * DAY,
      windowMs: 7 * DAY,
      nowMs: now,
    });
    expect(future.expected).toBe(0);
  });
});
