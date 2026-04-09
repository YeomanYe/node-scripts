import { parseCredentials } from '../../src/claude-usage/credentials';

describe('claude-usage/credentials', () => {
  describe('parseCredentials', () => {
    it('should parse valid credentials with all fields', () => {
      const raw = {
        claudeAiOauth: {
          accessToken: 'sk-ant-test-token-123',
          subscriptionType: 'pro',
          rateLimitTier: 'tier4',
        },
      };

      const result = parseCredentials(raw);

      expect(result.accessToken).toBe('sk-ant-test-token-123');
      expect(result.subscriptionType).toBe('pro');
      expect(result.rateLimitTier).toBe('tier4');
    });

    it('should default subscriptionType to unknown when missing', () => {
      const raw = {
        claudeAiOauth: {
          accessToken: 'sk-ant-test-token-123',
        },
      };

      const result = parseCredentials(raw);

      expect(result.subscriptionType).toBe('unknown');
    });

    it('should default rateLimitTier to unknown when missing', () => {
      const raw = {
        claudeAiOauth: {
          accessToken: 'sk-ant-test-token-123',
        },
      };

      const result = parseCredentials(raw);

      expect(result.rateLimitTier).toBe('unknown');
    });

    it('should default subscriptionType to unknown when not a string', () => {
      const raw = {
        claudeAiOauth: {
          accessToken: 'sk-ant-test-token-123',
          subscriptionType: 42,
          rateLimitTier: true,
        },
      };

      const result = parseCredentials(raw);

      expect(result.subscriptionType).toBe('unknown');
      expect(result.rateLimitTier).toBe('unknown');
    });

    it('should throw when input is not an object', () => {
      expect(() => parseCredentials(null)).toThrow('不是对象');
      expect(() => parseCredentials('string')).toThrow('不是对象');
      expect(() => parseCredentials(123)).toThrow('不是对象');
    });

    it('should throw when claudeAiOauth is missing', () => {
      expect(() => parseCredentials({})).toThrow('claudeAiOauth');
      expect(() => parseCredentials({ other: 'field' })).toThrow('claudeAiOauth');
    });

    it('should throw when claudeAiOauth is null', () => {
      expect(() => parseCredentials({ claudeAiOauth: null })).toThrow('claudeAiOauth');
    });

    it('should throw when claudeAiOauth is not an object', () => {
      expect(() => parseCredentials({ claudeAiOauth: 'string' })).toThrow('claudeAiOauth');
    });

    it('should throw when accessToken is missing', () => {
      expect(() => parseCredentials({ claudeAiOauth: {} })).toThrow('accessToken');
    });

    it('should throw when accessToken is empty string', () => {
      expect(() => parseCredentials({
        claudeAiOauth: { accessToken: '' },
      })).toThrow('accessToken');
    });

    it('should throw when accessToken is not a string', () => {
      expect(() => parseCredentials({
        claudeAiOauth: { accessToken: 12345 },
      })).toThrow('accessToken');
    });

    it('should extract subscriptionType and rateLimitTier from claudeAiOauth', () => {
      const raw = {
        claudeAiOauth: {
          accessToken: 'token',
          subscriptionType: 'max',
          rateLimitTier: 'tier5',
        },
        otherField: 'ignored',
      };

      const result = parseCredentials(raw);

      expect(result.subscriptionType).toBe('max');
      expect(result.rateLimitTier).toBe('tier5');
    });
  });
});
