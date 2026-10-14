import { config } from './config';
import { appLog } from './log';
import { manager } from './manager';
import { dropPrivileges } from './privileges';
import { store } from './store';
import { createServer } from './web';

dropPrivileges();
store.load();
const server = createServer().listen(config.port, config.host, () => {
  appLog.info(`Web UI listening on http://${config.host}:${config.port}`);
});
manager.init();

function shutdown(signal: string): void {
  appLog.info(`Received ${signal}, shutting down`);
  manager.shutdown();
  try {
    store.flush();
  } catch (err) {
    appLog.error(`Could not save state: ${(err as Error).message}`);
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (err) => appLog.error(`Unhandled rejection: ${String((err as Error)?.stack ?? err)}`));
