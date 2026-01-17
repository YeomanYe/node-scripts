import { setConfigPath, getConfigPath } from '../src/auto-cmd/config';

describe('config module', () => {
  describe('setConfigPath and getConfigPath', () => {
    it('should set and get config path', () => {
      const testPath = '/test/path/config.json';
      setConfigPath(testPath);
      expect(getConfigPath()).toBe(testPath);
    });
  });
});
