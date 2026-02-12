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

// 解析并排序时间数组
function parseAndSortTimes(targetTimes: string[]): number[] {
  return targetTimes.map(parseTime).sort((a, b) => a - b);
}

// 计算距离下次执行的时间（毫秒）
export function getNextExecutionTime(targetTimes: string[]): number {
  const currentMinutes = getCurrentTimeInMinutes();
  const parsedTimes = parseAndSortTimes(targetTimes);

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
  const parsedTimes = parseAndSortTimes(targetTimes);

  // 如果当前时间已经超过今天最后一个时间点，返回明天第一个时间点
  if (currentMinutes >= parsedTimes[parsedTimes.length - 1]) {
    const firstTimeTomorrow = parsedTimes[0] + 24 * 60;
    return (firstTimeTomorrow - currentMinutes) * 60 * 1000;
  }

  // 否则返回明天的第一个时间点（不管今天是否还有时间点）
  const firstTimeTomorrow = parsedTimes[0] + 24 * 60;
  return (firstTimeTomorrow - currentMinutes) * 60 * 1000;
}
