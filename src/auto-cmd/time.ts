import { MS_PER_MINUTE, MINUTES_PER_DAY } from './constants';

/**
 * 解析时间字符串，返回分钟数
 * @param timeStr - 时间字符串，格式为 "HH:MM"
 * @returns 从 00:00 开始的分钟数
 */
export function parseTime(timeStr: string): number {
  const [hours, minutes] = timeStr.split(':').map(Number);
  return hours * 60 + minutes;
}

/**
 * 获取当前时间的分钟数
 * @returns 从 00:00 开始的当前分钟数 (0-1439)
 */
export function getCurrentTimeInMinutes(): number {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

/**
 * 解析并排序时间数组
 * @param targetTimes - 时间字符串数组
 * @returns 排序后的分钟数数组
 */
function parseAndSortTimes(targetTimes: string[]): number[] {
  return targetTimes.map(parseTime).sort((a, b) => a - b);
}

/**
 * 计算距离下次执行的时间
 * @param targetTimes - 目标时间数组
 * @returns 距离下次执行的毫秒数
 */
export function getNextExecutionTime(targetTimes: string[]): number {
  const currentMinutes = getCurrentTimeInMinutes();
  const parsedTimes = parseAndSortTimes(targetTimes);

  for (const time of parsedTimes) {
    if (time > currentMinutes) {
      return (time - currentMinutes) * MS_PER_MINUTE;
    }
  }

  // 如果当天没有剩余时间，计算明天第一个时间点
  const firstTimeTomorrow = parsedTimes[0] + MINUTES_PER_DAY;
  return (firstTimeTomorrow - currentMinutes) * MS_PER_MINUTE;
}

/**
 * 计算距离明天最早执行时间的毫秒数
 * @param targetTimes - 目标时间数组
 * @returns 距离明天第一个时间点的毫秒数
 */
export function getNextDayFirstTime(targetTimes: string[]): number {
  const currentMinutes = getCurrentTimeInMinutes();
  const parsedTimes = parseAndSortTimes(targetTimes);

  const firstTimeTomorrow = parsedTimes[0] + MINUTES_PER_DAY;
  return (firstTimeTomorrow - currentMinutes) * MS_PER_MINUTE;
}
