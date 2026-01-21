import fs from 'fs/promises';
import path from 'path';

// 日志目录
let LOG_DIR = path.join(process.cwd(), 'logs');

// 设置日志目录
export function setLogDir(logDir: string): void {
  LOG_DIR = path.resolve(logDir);
}

// 获取日志目录
export function getLogDir(): string {
  return LOG_DIR;
}

// 确保日志目录存在
export async function ensureLogDir(): Promise<void> {
  try {
    await fs.access(LOG_DIR);
  } catch {
    await fs.mkdir(LOG_DIR, { recursive: true });
  }
}

// 写入日志
export async function writeLog(message: string): Promise<void> {
  await ensureLogDir();
  const date = new Date();
  const logFileName = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}.log`;
  const logPath = path.join(LOG_DIR, logFileName);
  
  // 格式化时间为YYYY-MM-DD HH:mm:ss.ssss
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  const milliseconds = String(date.getMilliseconds()).padStart(4, '0').slice(0, 4);
  const formattedDate = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${milliseconds}`;
  
  const logMessage = `[${formattedDate}] ${message}\n`;
  await fs.appendFile(logPath, logMessage, 'utf8');
  console.log(logMessage.trim());
}
