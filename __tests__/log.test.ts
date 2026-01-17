import { setLogDir, getLogDir } from '../src/auto-cmd/log';

describe('log module', () => {
  describe('setLogDir and getLogDir', () => {
    it('should set and get log directory', () => {
      const testDir = '/test/path/logs';
      setLogDir(testDir);
      expect(getLogDir()).toBe(testDir);
    });
  });
});
