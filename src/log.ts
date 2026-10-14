export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEntry {
  time: number;
  level: LogLevel;
  message: string;
}

/** Fixed-size in-memory log, mirrored to stdout so `docker logs` shows it too. */
export class Logger {
  private entries: LogEntry[] = [];

  constructor(private readonly prefix: string, private readonly capacity = 300) {}

  info(message: string): void {
    this.push('info', message);
  }

  warn(message: string): void {
    this.push('warn', message);
  }

  error(message: string): void {
    this.push('error', message);
  }

  recent(limit = 100): LogEntry[] {
    return this.entries.slice(-limit);
  }

  private push(level: LogLevel, message: string): void {
    const entry = { time: Date.now(), level, message };
    this.entries.push(entry);
    if (this.entries.length > this.capacity) this.entries.shift();
    const line = `${new Date(entry.time).toISOString()} [${level}] [${this.prefix}] ${message}`;
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
  }
}

export const appLog = new Logger('app');
