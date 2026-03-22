import { MS_PER_MINUTE, MINUTES_PER_DAY } from './constants';

export function parseTime(timeStr: string): number {
  console.log(`[Auto-Cmd Time] 步骤: 解析时间字符串`);
  console.log(`[Auto-Cmd Time] 配置信息: timeStr = ${timeStr}`);
  
  const [hours, minutes] = timeStr.split(':').map(Number);
  const result = hours * 60 + minutes;
  
  console.log(`[Auto-Cmd Time] 结果: ${timeStr} -> ${result} 分钟 (从00:00开始)`);
  return result;
}

export function getCurrentTimeInMinutes(): number {
  const now = new Date();
  const minutes = now.getHours() * 60 + now.getMinutes();
  return minutes;
}

export function formatTimeFromMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

function parseAndSortTimes(targetTimes: string[]): number[] {
  console.log(`[Auto-Cmd Time] 步骤: 解析并排序时间数组`);
  console.log(`[Auto-Cmd Time] 配置信息: targetTimes = ${JSON.stringify(targetTimes)}`);
  
  const result = targetTimes.map(parseTime).sort((a, b) => a - b);
  
  console.log(`[Auto-Cmd Time] 结果: 排序后的分钟数 = ${JSON.stringify(result)}`);
  return result;
}

export function getNextExecutionTime(targetTimes: string[]): number {
  console.log(`[Auto-Cmd Time] ========== 计算下次执行时间 ==========`);
  console.log(`[Auto-Cmd Time] 步骤: 计算距离下次执行的毫秒数`);
  console.log(`[Auto-Cmd Time] 配置信息: targetTimes = ${JSON.stringify(targetTimes)}`);
  
  const currentMinutes = getCurrentTimeInMinutes();
  const parsedTimes = parseAndSortTimes(targetTimes);
  
  console.log(`[Auto-Cmd Time] 当前时间: ${formatTimeFromMinutes(currentMinutes)} (${currentMinutes}分钟)`);

  for (const time of parsedTimes) {
    if (time > currentMinutes) {
      const delay = (time - currentMinutes) * MS_PER_MINUTE;
      console.log(`[Auto-Cmd Time] 找到今天下一个执行时间: ${formatTimeFromMinutes(time)}`);
      console.log(`[Auto-Cmd Time] 结果: 延迟 ${delay}ms (${Math.round(delay / 60000)}分钟)`);
      return delay;
    }
  }

  const firstTimeTomorrow = parsedTimes[0] + MINUTES_PER_DAY;
  const delay = (firstTimeTomorrow - currentMinutes) * MS_PER_MINUTE;
  
  console.log(`[Auto-Cmd Time] 今天没有剩余执行时间，计算明天第一个时间点`);
  console.log(`[Auto-Cmd Time] 明天第一个执行时间: ${formatTimeFromMinutes(parsedTimes[0])}`);
  console.log(`[Auto-Cmd Time] 结果: 延迟 ${delay}ms (${Math.round(delay / 60000)}分钟)`);
  
  return delay;
}

export function getNextDayFirstTime(targetTimes: string[]): number {
  console.log(`[Auto-Cmd Time] ========== 计算明天首次执行时间 ==========`);
  console.log(`[Auto-Cmd Time] 步骤: 计算距离明天第一个时间点的毫秒数`);
  console.log(`[Auto-Cmd Time] 配置信息: targetTimes = ${JSON.stringify(targetTimes)}`);
  
  const currentMinutes = getCurrentTimeInMinutes();
  const parsedTimes = parseAndSortTimes(targetTimes);

  const firstTimeTomorrow = parsedTimes[0] + MINUTES_PER_DAY;
  const delay = (firstTimeTomorrow - currentMinutes) * MS_PER_MINUTE;
  
  console.log(`[Auto-Cmd Time] 当前时间: ${formatTimeFromMinutes(currentMinutes)}`);
  console.log(`[Auto-Cmd Time] 明天第一个执行时间: ${formatTimeFromMinutes(parsedTimes[0])}`);
  console.log(`[Auto-Cmd Time] 结果: 延迟 ${delay}ms (${Math.round(delay / 60000)}分钟)`);
  
  return delay;
}
