// 解析时间，返回分钟数
export function parseTime(timeStr: string): number {
  const [hours, minutes] = timeStr.split(':').map(Number);
  return hours * 60 + minutes;
}

// 计算当前时间的分钟数
export function getCurrentTimeInMinutes(): number {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

// 计算距离下次执行的时间（毫秒）
export function getNextExecutionTime(targetTimes: string[]): number {
  const currentMinutes = getCurrentTimeInMinutes();
  const parsedTimes = targetTimes.map(parseTime).sort((a, b) => a - b);
  
  for (const time of parsedTimes) {
    if (time > currentMinutes) {
      return (time - currentMinutes) * 60 * 1000;
    }
  }
  
  // 如果当天没有剩余时间，计算明天第一个时间点
  const firstTimeTomorrow = parsedTimes[0] + 24 * 60;
  return (firstTimeTomorrow - currentMinutes) * 60 * 1000;
}

// 计算距离明天最早执行时间的毫秒数
export function getNextDayFirstTime(targetTimes: string[]): number {
  const currentMinutes = getCurrentTimeInMinutes();
  const parsedTimes = targetTimes.map(parseTime).sort((a, b) => a - b);
  const firstTimeTomorrow = parsedTimes[0] + 24 * 60;
  return (firstTimeTomorrow - currentMinutes) * 60 * 1000;
}
