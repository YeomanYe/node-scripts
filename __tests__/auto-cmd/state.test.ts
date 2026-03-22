import fs from 'fs/promises';
import os from 'os';
import path from 'path';

describe('state module', () => {
  let testRoot: string;
  let testStateFile: string;
  let stateModule: typeof import('../../src/auto-cmd/state');

  beforeAll(async () => {
    testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'auto-cmd-state-'));
    testStateFile = path.join(testRoot, 'auto-cmd-state.json');
  });

  afterAll(async () => {
    await fs.rm(testRoot, { recursive: true, force: true });
  });

  beforeEach(async () => {
    jest.resetModules();
    process.env.AUTO_CMD_STATE_FILE = testStateFile;
    stateModule = await import('../../src/auto-cmd/state');
  });

  afterEach(async () => {
    delete process.env.AUTO_CMD_STATE_FILE;
    try {
      await fs.unlink(testStateFile);
    } catch {
      // File may not exist
    }
  });

  describe('getStateFilePath', () => {
    it('should return correct path', () => {
      const result = stateModule.getStateFilePath();
      expect(result).toBe(testStateFile);
    });
  });

  describe('getTodayDateString', () => {
    it('should return today\'s date in YYYY-MM-DD format', () => {
      const result = stateModule.getTodayDateString();
      const regex = /^\d{4}-\d{2}-\d{2}$/;
      expect(regex.test(result)).toBe(true);
    });

    it('should pad single digit months and days', () => {
      const result = stateModule.getTodayDateString();
      const parts = result.split('-');
      expect(parts[1].length).toBe(2);
      expect(parts[2].length).toBe(2);
    });
  });

  describe('readExecutionState', () => {
    it('should return default state when file does not exist', async () => {
      const result = await stateModule.readExecutionState();
      expect(result).toEqual({
        lastExecutedDate: '',
        executed: false
      });
    });

    it('should read existing state file', async () => {
      const testState = {
        lastExecutedDate: '2024-01-15',
        executed: true
      };
      await fs.writeFile(testStateFile, JSON.stringify(testState));

      const result = await stateModule.readExecutionState();
      expect(result).toEqual(testState);
    });

    it('should handle invalid JSON gracefully', async () => {
      await fs.writeFile(testStateFile, 'invalid json');

      const result = await stateModule.readExecutionState();
      expect(result).toEqual({
        lastExecutedDate: '',
        executed: false
      });
    });
  });

  describe('writeExecutionState', () => {
    it('should write state to file', async () => {
      const testState = {
        lastExecutedDate: '2024-01-15',
        executed: true
      };

      await stateModule.writeExecutionState(testState);

      const content = await fs.readFile(testStateFile, 'utf8');
      expect(JSON.parse(content)).toEqual(testState);
    });

    it('should create directory if it does not exist', async () => {
      const testState = {
        lastExecutedDate: '2024-01-15',
        executed: true
      };

      const isolatedTestDir = path.join(testRoot, 'isolated-nested', 'deep');
      const isolatedStateFile = path.join(isolatedTestDir, 'auto-cmd-state.json');

      process.env.AUTO_CMD_STATE_FILE = isolatedStateFile;
      jest.resetModules();
      const freshModule = await import('../../src/auto-cmd/state');

      await freshModule.writeExecutionState(testState);

      const exists = await fs.access(isolatedTestDir).then(() => true).catch(() => false);
      expect(exists).toBe(true);
    });
  });

  describe('isExecutedToday', () => {
    it('should return false when not executed today', async () => {
      const yesterdayState = {
        lastExecutedDate: '2020-01-01',
        executed: true
      };
      await fs.writeFile(testStateFile, JSON.stringify(yesterdayState));

      const result = await stateModule.isExecutedToday();
      expect(result).toBe(false);
    });

    it('should return true when executed today', async () => {
      const today = stateModule.getTodayDateString();
      const todayState = {
        lastExecutedDate: today,
        executed: true
      };
      await fs.writeFile(testStateFile, JSON.stringify(todayState));

      const result = await stateModule.isExecutedToday();
      expect(result).toBe(true);
    });

    it('should return false when executed is false', async () => {
      const today = stateModule.getTodayDateString();
      const state = {
        lastExecutedDate: today,
        executed: false
      };
      await fs.writeFile(testStateFile, JSON.stringify(state));

      const result = await stateModule.isExecutedToday();
      expect(result).toBe(false);
    });
  });

  describe('updateExecutionState', () => {
    it('should update state with today\'s date', async () => {
      await stateModule.updateExecutionState(true);

      const content = await fs.readFile(testStateFile, 'utf8');
      const state = JSON.parse(content);

      expect(state.lastExecutedDate).toBe(stateModule.getTodayDateString());
      expect(state.executed).toBe(true);
    });

    it('should update executed to false', async () => {
      await stateModule.updateExecutionState(false);

      const content = await fs.readFile(testStateFile, 'utf8');
      const state = JSON.parse(content);

      expect(state.executed).toBe(false);
    });
  });
});
