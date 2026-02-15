import fs from 'fs/promises';
import path from 'path';
import {
  getStateFilePath,
  readExecutionState,
  writeExecutionState,
  getTodayDateString,
  isExecutedToday,
  updateExecutionState
} from '../src/auto-cmd/state';

describe('state module', () => {
  const testStateDir = path.join(process.cwd(), 'local');
  const testStateFile = path.join(testStateDir, 'auto-cmd-state.json');

  beforeAll(async () => {
    try {
      await fs.mkdir(testStateDir, { recursive: true });
    } catch {
      // Directory may already exist
    }
  });

  afterEach(async () => {
    try {
      await fs.unlink(testStateFile);
    } catch {
      // File may not exist
    }
  });

  describe('getStateFilePath', () => {
    it('should return correct path', () => {
      const result = getStateFilePath();
      expect(result).toContain('auto-cmd-state.json');
    });
  });

  describe('getTodayDateString', () => {
    it('should return today\'s date in YYYY-MM-DD format', () => {
      const result = getTodayDateString();
      const regex = /^\d{4}-\d{2}-\d{2}$/;
      expect(regex.test(result)).toBe(true);
    });

    it('should pad single digit months and days', () => {
      const result = getTodayDateString();
      const parts = result.split('-');
      expect(parts[1].length).toBe(2);
      expect(parts[2].length).toBe(2);
    });
  });

  describe('readExecutionState', () => {
    it('should return default state when file does not exist', async () => {
      const result = await readExecutionState();
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

      const result = await readExecutionState();
      expect(result).toEqual(testState);
    });

    it('should handle invalid JSON gracefully', async () => {
      await fs.writeFile(testStateFile, 'invalid json');

      const result = await readExecutionState();
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

      await writeExecutionState(testState);

      const content = await fs.readFile(testStateFile, 'utf8');
      expect(JSON.parse(content)).toEqual(testState);
    });

    it('should create directory if it does not exist', async () => {
      const testState = {
        lastExecutedDate: '2024-01-15',
        executed: true
      };

      // Delete directory first
      try {
        await fs.rm(testStateDir, { recursive: true });
      } catch {
        // Directory may not exist
      }

      await writeExecutionState(testState);

      const exists = await fs.access(testStateDir).then(() => true).catch(() => false);
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

      const result = await isExecutedToday();
      expect(result).toBe(false);
    });

    it('should return true when executed today', async () => {
      const today = getTodayDateString();
      const todayState = {
        lastExecutedDate: today,
        executed: true
      };
      await fs.writeFile(testStateFile, JSON.stringify(todayState));

      const result = await isExecutedToday();
      expect(result).toBe(true);
    });

    it('should return false when executed is false', async () => {
      const today = getTodayDateString();
      const state = {
        lastExecutedDate: today,
        executed: false
      };
      await fs.writeFile(testStateFile, JSON.stringify(state));

      const result = await isExecutedToday();
      expect(result).toBe(false);
    });
  });

  describe('updateExecutionState', () => {
    it('should update state with today\'s date', async () => {
      await updateExecutionState(true);

      const content = await fs.readFile(testStateFile, 'utf8');
      const state = JSON.parse(content);

      expect(state.lastExecutedDate).toBe(getTodayDateString());
      expect(state.executed).toBe(true);
    });

    it('should update executed to false', async () => {
      await updateExecutionState(false);

      const content = await fs.readFile(testStateFile, 'utf8');
      const state = JSON.parse(content);

      expect(state.executed).toBe(false);
    });
  });
});
