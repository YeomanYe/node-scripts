import fs from 'fs/promises';
import path from 'path';

// 锁文件路径
let LOCK_PATH = '';

// 锁过期时间（毫秒）- 5分钟
const LOCK_EXPIRY = 5 * 60 * 1000;

// 设置锁文件路径
function setLockPath(configPath: string): void {
  LOCK_PATH = `${configPath}.lock`;
}

// 检查锁是否过期
async function isLockExpired(): Promise<boolean> {
  try {
    const stats = await fs.stat(LOCK_PATH);
    const now = Date.now();
    // 检查锁文件创建时间是否超过过期时间
    return now - stats.birthtimeMs > LOCK_EXPIRY;
  } catch (error) {
    // 锁文件不存在，或无法读取，认为锁不存在/过期
    return true;
  }
}

// 获取锁
async function acquireLock(): Promise<boolean> {
  try {
    // 检查锁是否过期
    const expired = await isLockExpired();
    if (expired) {
      // 锁过期，删除旧锁文件
      try {
        await fs.unlink(LOCK_PATH);
      } catch {
        // 忽略删除失败
      }
    }
    
    // 尝试创建锁文件，如果文件已存在则失败
    await fs.open(LOCK_PATH, 'wx');
    return true;
  } catch (error) {
    return false;
  }
}

// 释放锁
async function releaseLock(): Promise<void> {
  try {
    await fs.unlink(LOCK_PATH);
  } catch {
    // 锁文件不存在，忽略错误
  }
}

// 等待并获取锁
async function waitForLock(timeout: number = 5000): Promise<boolean> {
  const start = Date.now();
  let acquired = false;
  
  while (!acquired && Date.now() - start < timeout) {
    acquired = await acquireLock();
    if (!acquired) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  
  return acquired;
}

export {
  setLockPath,
  acquireLock,
  releaseLock,
  waitForLock
};
