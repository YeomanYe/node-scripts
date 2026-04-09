import { validateResponse, transformResponse, isValidUsageItem, fetchUsage } from '../../src/claude-usage/api';
import { RawUsageResponse } from '../../src/claude-usage/types';

describe('claude-usage/api', () => {
  describe('isValidUsageItem', () => {
    it('should return true for valid usage item', () => {
      expect(isValidUsageItem({ utilization: 42.5, resets_at: '2026-04-10T00:00:00Z' })).toBe(true);
    });

    it('should return false for null', () => {
      expect(isValidUsageItem(null)).toBe(false);
    });

    it('should return false for non-object', () => {
      expect(isValidUsageItem('string')).toBe(false);
      expect(isValidUsageItem(123)).toBe(false);
    });

    it('should return false when utilization is missing', () => {
      expect(isValidUsageItem({ resets_at: '2026-04-10T00:00:00Z' })).toBe(false);
    });

    it('should return false when resets_at is missing', () => {
      expect(isValidUsageItem({ utilization: 42.5 })).toBe(false);
    });

    it('should return false when utilization is not a number', () => {
      expect(isValidUsageItem({ utilization: '42.5', resets_at: '2026-04-10T00:00:00Z' })).toBe(false);
    });
  });

  describe('validateResponse', () => {
    const validFiveHour = { utilization: 20, resets_at: '2026-04-10T05:00:00Z' };
    const validSevenDay = { utilization: 35, resets_at: '2026-04-15T00:00:00Z' };

    it('should validate a minimal valid response with required fields only', () => {
      const data = {
        five_hour: validFiveHour,
        seven_day: validSevenDay,
      };

      const result = validateResponse(data);

      expect(result.five_hour).toEqual(validFiveHour);
      expect(result.seven_day).toEqual(validSevenDay);
      expect(result.seven_day_sonnet).toBeNull();
      expect(result.seven_day_opus).toBeNull();
      expect(result.seven_day_cowork).toBeNull();
      expect(result.extra_usage).toBeNull();
    });

    it('should validate a full response with all optional fields', () => {
      const sonnet = { utilization: 10, resets_at: '2026-04-15T00:00:00Z' };
      const opus = { utilization: 5, resets_at: '2026-04-15T00:00:00Z' };
      const cowork = { utilization: 8, resets_at: '2026-04-15T00:00:00Z' };
      const extraUsage = {
        is_enabled: true,
        monthly_limit: 100,
        used_credits: 25,
        utilization: 25,
      };

      const data = {
        five_hour: validFiveHour,
        seven_day: validSevenDay,
        seven_day_sonnet: sonnet,
        seven_day_opus: opus,
        seven_day_cowork: cowork,
        extra_usage: extraUsage,
      };

      const result = validateResponse(data);

      expect(result.seven_day_sonnet).toEqual(sonnet);
      expect(result.seven_day_opus).toEqual(opus);
      expect(result.seven_day_cowork).toEqual(cowork);
      expect(result.extra_usage).toEqual(extraUsage);
    });

    it('should handle null optional fields gracefully', () => {
      const data = {
        five_hour: validFiveHour,
        seven_day: validSevenDay,
        seven_day_sonnet: null,
        seven_day_opus: null,
        seven_day_cowork: null,
        extra_usage: null,
      };

      const result = validateResponse(data);

      expect(result.seven_day_sonnet).toBeNull();
      expect(result.seven_day_opus).toBeNull();
      expect(result.seven_day_cowork).toBeNull();
      expect(result.extra_usage).toBeNull();
    });

    it('should throw on non-object input', () => {
      expect(() => validateResponse(null)).toThrow('不是对象');
      expect(() => validateResponse('string')).toThrow('不是对象');
      expect(() => validateResponse(123)).toThrow('不是对象');
    });

    it('should throw when five_hour is missing', () => {
      expect(() => validateResponse({ seven_day: validSevenDay })).toThrow('five_hour');
    });

    it('should throw when seven_day is missing', () => {
      expect(() => validateResponse({ five_hour: validFiveHour })).toThrow('seven_day');
    });

    it('should throw when five_hour has invalid structure', () => {
      expect(() => validateResponse({
        five_hour: { utilization: 'bad' },
        seven_day: validSevenDay,
      })).toThrow('five_hour');
    });
  });

  describe('transformResponse', () => {
    it('should transform raw response to UsageData', () => {
      const raw: RawUsageResponse = {
        five_hour: { utilization: 20, resets_at: '2026-04-10T05:00:00Z' },
        seven_day: { utilization: 35, resets_at: '2026-04-15T00:00:00Z' },
        seven_day_sonnet: { utilization: 10, resets_at: '2026-04-15T00:00:00Z' },
        seven_day_opus: null,
        seven_day_cowork: null,
        extra_usage: null,
      };

      const result = transformResponse(raw);

      expect(result.fiveHour.utilization).toBe(20);
      expect(result.fiveHour.resetsAt).toBe('2026-04-10T05:00:00Z');
      expect(result.sevenDay.utilization).toBe(35);
      expect(result.sevenDaySonnet).not.toBeNull();
      expect(result.sevenDaySonnet!.utilization).toBe(10);
      expect(result.sevenDayOpus).toBeNull();
      expect(result.sevenDayCowork).toBeNull();
      expect(result.extraUsage).toBeNull();
    });

    it('should transform extra_usage when present', () => {
      const raw: RawUsageResponse = {
        five_hour: { utilization: 20, resets_at: '2026-04-10T05:00:00Z' },
        seven_day: { utilization: 35, resets_at: '2026-04-15T00:00:00Z' },
        seven_day_sonnet: null,
        seven_day_opus: null,
        seven_day_cowork: null,
        extra_usage: {
          is_enabled: true,
          monthly_limit: 100,
          used_credits: 25,
          utilization: 25,
        },
      };

      const result = transformResponse(raw);

      expect(result.extraUsage).not.toBeNull();
      expect(result.extraUsage!.isEnabled).toBe(true);
      expect(result.extraUsage!.monthlyLimit).toBe(100);
      expect(result.extraUsage!.usedCredits).toBe(25);
      expect(result.extraUsage!.utilization).toBe(25);
    });
  });

  describe('fetchUsage', () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it('should fetch and return transformed usage data', async () => {
      const mockResponse = {
        five_hour: { utilization: 20, resets_at: '2026-04-10T05:00:00Z' },
        seven_day: { utilization: 35, resets_at: '2026-04-15T00:00:00Z' },
      };

      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await fetchUsage('test-token');

      expect(result.fiveHour.utilization).toBe(20);
      expect(result.sevenDay.utilization).toBe(35);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('usage'),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token',
          }),
        }),
      );
    });

    it('should throw on non-200 response', async () => {
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: () => Promise.resolve('Invalid token'),
      });

      await expect(fetchUsage('bad-token')).rejects.toThrow('401');
    });

    it('should throw on invalid JSON structure', async () => {
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ invalid: 'data' }),
      });

      await expect(fetchUsage('test-token')).rejects.toThrow('five_hour');
    });
  });
});
