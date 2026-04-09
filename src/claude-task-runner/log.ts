/**
 * 带时间戳的日志输出
 * @param message - 日志消息
 */
export function log(message: string): void {
  const timestamp = new Date().toISOString().replace('T', ' ').replace('Z', '');
  process.stdout.write(`[${timestamp}] ${message}\n`);
}

/**
 * 带时间戳的错误日志输出
 * @param message - 错误消息
 */
export function logError(message: string): void {
  const timestamp = new Date().toISOString().replace('T', ' ').replace('Z', '');
  process.stderr.write(`[${timestamp}] ERROR: ${message}\n`);
}
