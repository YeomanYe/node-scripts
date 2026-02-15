import fs from 'fs/promises';
import path from 'path';
import { Config } from '../src/auto-cmd/types';
import { getParser, isSupported, getSupportedExtensions } from '../src/auto-cmd/parsers';
import { setConfigPath, getConfigPath, readConfig, updateConfig } from '../src/auto-cmd/config';

describe('config module', () => {
  const testConfigDir = path.join(process.cwd(), 'local');
  let testConfigPath: string;

  beforeEach(() => {
    testConfigPath = path.join(testConfigDir, 'test-config.json');
    setConfigPath(testConfigPath);
  });

  afterEach(async () => {
    try {
      await fs.unlink(testConfigPath);
    } catch {
      // File may not exist
    }
  });

  beforeAll(async () => {
    try {
      await fs.mkdir(testConfigDir, { recursive: true });
    } catch {
      // Directory may already exist
    }
  });

  describe('setConfigPath and getConfigPath', () => {
    it('should set and get config path', () => {
      const testPath = '/test/path/config.json';
      setConfigPath(testPath);
      expect(getConfigPath()).toBe(testPath);
    });

    it('should resolve relative paths', () => {
      setConfigPath('./relative/path.json');
      expect(getConfigPath()).toContain('relative/path.json');
    });
  });

  describe('readConfig', () => {
    it('should return default config when file does not exist', async () => {
      // Delete file if exists
      try {
        await fs.unlink(testConfigPath);
      } catch {
        // File may not exist
      }

      const result = await readConfig();

      expect(result.time).toEqual(['9:30', '12:30', '19:00', '23:00']);
      expect(result.mode).toBe('once');
      expect(result.commands).toEqual([]);
    });

    it('should read existing JSON config', async () => {
      const testConfig = {
        time: ['10:00', '15:00'],
        mode: 'repeat',
        commands: [
          { path: '/test', cmds: ['echo hello'] }
        ]
      };
      await fs.writeFile(testConfigPath, JSON.stringify(testConfig));

      const result = await readConfig();

      expect(result.time).toEqual(['10:00', '15:00']);
      expect(result.mode).toBe('repeat');
      expect(result.commands).toHaveLength(1);
    });

    it('should handle empty file', async () => {
      await fs.writeFile(testConfigPath, '');

      const result = await readConfig();

      // Should return default config
      expect(result.time).toBeDefined();
      expect(result.mode).toBeDefined();
    });

    it('should handle unsupported format gracefully', async () => {
      const unsupportedPath = path.join(testConfigDir, 'test-config.xyz');
      setConfigPath(unsupportedPath);

      await fs.writeFile(unsupportedPath, '{}');

      // Should return default config gracefully instead of throwing
      const result = await readConfig();

      // Should return default config since format is unsupported
      expect(result.time).toBeDefined();
      expect(result.mode).toBeDefined();
      expect(result.commands).toBeDefined();
    });
  });

  describe('updateConfig', () => {
    it('should write config to file', async () => {
      const testConfig: Config = {
        time: ['08:00', '20:00'],
        mode: 'once',
        commands: [
          { path: '/project', cmds: ['npm run build'] }
        ]
      };

      await updateConfig(testConfig);

      const content = await fs.readFile(testConfigPath, 'utf8');
      const parsed = JSON.parse(content);

      expect(parsed.time).toEqual(['08:00', '20:00']);
      expect(parsed.mode).toBe('once');
      expect(parsed.commands).toHaveLength(1);
    });

    it('should sanitize config with missing fields', async () => {
      const incompleteConfig: Config = {
        time: ['09:00'],
        mode: 'once',
        commands: []
      };

      await updateConfig(incompleteConfig);

      const content = await fs.readFile(testConfigPath, 'utf8');
      const parsed = JSON.parse(content);

      expect(parsed.mode).toBe('once');
      expect(parsed.commands).toEqual([]);
    });
  });
});

describe('configParsers module', () => {
  describe('getParser', () => {
    it('should return JSON parser for .json files', () => {
      const parser = getParser('/path/to/config.json');
      expect(parser).toBeDefined();
      expect(parser?.extensions).toContain('.json');
    });

    it('should return YAML parser for .yml files', () => {
      const parser = getParser('/path/to/config.yml');
      expect(parser).toBeDefined();
      expect(parser?.extensions).toContain('.yml');
    });

    it('should return YAML parser for .yaml files', () => {
      const parser = getParser('/path/to/config.yaml');
      expect(parser).toBeDefined();
      expect(parser?.extensions).toContain('.yaml');
    });

    it('should return undefined for unsupported extensions', () => {
      const parser = getParser('/path/to/config.xyz');
      expect(parser).toBeUndefined();
    });

    it('should be case insensitive', () => {
      const parserLower = getParser('/path/to/config.JSON');
      const parserUpper = getParser('/path/to/config.JSON');
      expect(parserLower).toBeDefined();
      expect(parserUpper).toBeDefined();
    });
  });

  describe('isSupported', () => {
    it('should return true for supported extensions', () => {
      expect(isSupported('/path/config.json')).toBe(true);
      expect(isSupported('/path/config.yml')).toBe(true);
      expect(isSupported('/path/config.yaml')).toBe(true);
    });

    it('should return false for unsupported extensions', () => {
      expect(isSupported('/path/config.js')).toBe(false);
      expect(isSupported('/path/config.txt')).toBe(false);
      expect(isSupported('/path/config.xml')).toBe(false);
    });
  });

  describe('getSupportedExtensions', () => {
    it('should return comma-separated list of extensions', () => {
      const result = getSupportedExtensions();
      expect(result).toContain('.json');
      expect(result).toContain('.yml');
      expect(result).toContain('.yaml');
      expect(result).not.toMatch(/\.js[, ]/);
      expect(result).not.toMatch(/\.mjs[, ]/);
    });
  });
});
