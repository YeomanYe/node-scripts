import { setLogDir, getLogDir, writeLog } from '../src/auto-cmd/log';
import fs from 'fs/promises';

// Mock fs module
jest.mock('fs/promises', () => ({
  access: jest.fn().mockResolvedValue(undefined),
  mkdir: jest.fn().mockResolvedValue(undefined),
  appendFile: jest.fn().mockResolvedValue(undefined)
}));

// Mock console.log
jest.spyOn(console, 'log').mockImplementation(() => {});

describe('log module', () => {
  describe('setLogDir and getLogDir', () => {
    it('should set and get log directory', () => {
      const testDir = '/test/path/logs';
      setLogDir(testDir);
      expect(getLogDir()).toBe(testDir);
    });
  });

  describe('writeLog', () => {
    beforeEach(() => {
      jest.clearAllMocks();
      // 设置固定的时间，方便测试
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-01-19T13:45:30.123Z'));
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should format time correctly as YYYY-MM-DD HH:mm:ss.ssss', async () => {
      await writeLog('Test message');
      
      // 验证console.log被调用，且时间格式正确
      // JavaScript Date只支持3位毫秒，padStart(4, '0')后变成0123
      expect(console.log).toHaveBeenCalledWith('[2026-01-19 21:45:30.0123] Test message');
    });

    it('should append message to log file with correct format', async () => {
      await writeLog('Test message');
      
      // 验证fs.appendFile被调用，且日志消息格式正确
      expect(fs.appendFile).toHaveBeenCalledWith(
        expect.any(String),
        '[2026-01-19 21:45:30.0123] Test message\n',
        'utf8'
      );
    });

    it('should ensure log directory exists before writing', async () => {
      // 模拟目录不存在
      (fs.access as jest.Mock).mockRejectedValue(new Error('Directory not found'));
      
      await writeLog('Test message');
      
      // 验证fs.access被调用
      expect(fs.access).toHaveBeenCalled();
      // 验证fs.mkdir被调用
      expect(fs.mkdir).toHaveBeenCalled();
      // 验证fs.appendFile最终被调用
      expect(fs.appendFile).toHaveBeenCalled();
    });
  });
});
