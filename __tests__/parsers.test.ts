import fs from 'fs/promises';
import path from 'path';
import yaml from 'yaml';
import { parsers, getParser, isSupported, getSupportedExtensions, ConfigParser } from '../src/auto-cmd/parsers';
import { Config } from '../src/auto-cmd/types';

describe('configParsers', () => {
  const testDir = path.join(process.cwd(), 'local');

  beforeAll(async () => {
    try {
      await fs.mkdir(testDir, { recursive: true });
    } catch {
      // Directory may already exist
    }
  });

  describe('parsers', () => {
    it('should have JSON and YAML parsers', () => {
      expect(parsers.length).toBe(2);

      const extensions = parsers.flatMap(p => p.extensions);
      expect(extensions).toContain('.json');
      expect(extensions).toContain('.yml');
      expect(extensions).toContain('.yaml');
      expect(extensions).not.toContain('.js');
      expect(extensions).not.toContain('.mjs');
    });

    it('should have read and write methods', () => {
      parsers.forEach(parser => {
        expect(typeof parser.read).toBe('function');
        expect(typeof parser.write).toBe('function');
      });
    });
  });

  describe('getParser', () => {
    it('should return JSON parser for .json files', () => {
      const parser = getParser('/test/config.json');
      expect(parser?.extensions).toContain('.json');
    });

    it('should return YAML parser for .yaml files', () => {
      const parser = getParser('/test/config.yaml');
      expect(parser?.extensions).toContain('.yaml');
    });

    it('should return undefined for unsupported extensions', () => {
      const parser = getParser('/test/config.txt');
      expect(parser).toBeUndefined();
    });

    it('should return undefined for .js files', () => {
      const parser = getParser('/test/config.js');
      expect(parser).toBeUndefined();
    });
  });

  describe('isSupported', () => {
    it('should return true for supported extensions', () => {
      expect(isSupported('config.json')).toBe(true);
      expect(isSupported('config.yml')).toBe(true);
      expect(isSupported('config.yaml')).toBe(true);
    });

    it('should return false for unsupported extensions', () => {
      expect(isSupported('config.js')).toBe(false);
      expect(isSupported('config.mjs')).toBe(false);
      expect(isSupported('config.txt')).toBe(false);
      expect(isSupported('config.xml')).toBe(false);
      expect(isSupported('config.csv')).toBe(false);
    });
  });

  describe('getSupportedExtensions', () => {
    it('should return comma-separated list', () => {
      const result = getSupportedExtensions();
      expect(result).toContain('.json');
      expect(result).toContain('.yml');
      expect(result).toContain('.yaml');
      expect(result).not.toMatch(/\.js[, ]/);
      expect(result).not.toMatch(/\.mjs[, ]/);
    });
  });

  describe('JSON parser', () => {
    it('should read and write JSON config', async () => {
      const parser = getParser('test.json')!;
      const testPath = path.join(testDir, 'parser-test.json');
      const testConfig: Config = {
        time: ['10:00', '20:00'],
        mode: 'repeat',
        commands: [{ path: '/test', cmds: ['echo hello'] }]
      };

      await parser.write(testPath, testConfig);
      const readConfig = await parser.read(testPath);

      expect(readConfig.time).toEqual(['10:00', '20:00']);
      expect(readConfig.mode).toBe('repeat');

      // Cleanup
      await fs.unlink(testPath);
    });
  });

  describe('YAML parser', () => {
    it('should read and write YAML config', async () => {
      const parser = getParser('test.yml')!;
      const testPath = path.join(testDir, 'parser-test.yml');
      const testConfig: Config = {
        time: ['09:00', '18:00'],
        mode: 'once',
        commands: []
      };

      await parser.write(testPath, testConfig);
      const readConfig = await parser.read(testPath);

      expect(readConfig.time).toEqual(['09:00', '18:00']);
      expect(readConfig.mode).toBe('once');

      // Cleanup
      try {
        await fs.unlink(testPath);
      } catch {
        // File may not exist
      }
    });
  });
});
