export function log(message: string): void {
  const timestamp = new Date().toISOString().replace('T', ' ').replace('Z', '');
  process.stdout.write(`[${timestamp}] ${message}\n`);
}

export function logError(message: string): void {
  const timestamp = new Date().toISOString().replace('T', ' ').replace('Z', '');
  process.stderr.write(`[${timestamp}] ERROR: ${message}\n`);
}
