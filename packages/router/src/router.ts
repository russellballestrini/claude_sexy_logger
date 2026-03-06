import { watch, type FSWatcher } from 'fs';
import { RouterConfig, loadCursors, saveCursors } from './config';
import { findJsonlFiles, readNewLines } from './scanner';
import { sendBatch } from './sender';

export class Router {
  private config: RouterConfig;
  private cursors: Record<string, number>;
  private watchers: FSWatcher[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private pendingLines: string[] = [];
  private sending = false;
  private totalSent = 0;
  private totalErrors = 0;

  constructor(config: RouterConfig) {
    this.config = config;
    this.cursors = loadCursors();
  }

  start() {
    // Initial scan — pick up anything new since last run
    this.scan();

    // Watch for changes
    for (const watchPath of this.config.watch_paths) {
      try {
        const w = watch(watchPath, { recursive: true }, (_event, filename) => {
          if (filename && filename.endsWith('.jsonl')) {
            this.scan();
          }
        });
        this.watchers.push(w);
        log(`watching ${watchPath}`);
      } catch (err) {
        log(`failed to watch ${watchPath}: ${err}`);
      }
    }

    // Periodic flush
    this.flushTimer = setInterval(() => this.flush(), this.config.flush_interval_ms);

    // Save cursors on exit
    const cleanup = () => {
      saveCursors(this.cursors);
      process.exit(0);
    };
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);

    log(`router started — endpoint: ${this.config.endpoint}`);
    log(`batch_size: ${this.config.batch_size}, flush_interval: ${this.config.flush_interval_ms}ms`);
  }

  stop() {
    for (const w of this.watchers) w.close();
    this.watchers = [];
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    saveCursors(this.cursors);
  }

  private scan() {
    const files = findJsonlFiles(this.config.watch_paths);

    for (const file of files) {
      const cursor = this.cursors[file] ?? 0;
      const { lines, newCursor } = readNewLines(file, cursor);

      if (lines.length > 0) {
        this.pendingLines.push(...lines);
        this.cursors[file] = newCursor;
      }
    }

    // Auto-flush if we hit batch size
    if (this.pendingLines.length >= this.config.batch_size) {
      this.flush();
    }
  }

  private async flush() {
    if (this.sending || this.pendingLines.length === 0) return;
    this.sending = true;

    // Drain pending into a batch (up to batch_size)
    const batch = this.pendingLines.splice(0, this.config.batch_size);

    try {
      const result = await sendBatch(
        this.config.endpoint,
        this.config.api_key,
        batch
      );

      this.totalSent += result.accepted;
      this.totalErrors += result.errors;

      if (result.statusCode === 401) {
        log(`ERROR: invalid API key (401). Check api_key in ~/.unfirehose.json`);
        this.stop();
        process.exit(1);
      }

      if (result.accepted > 0) {
        log(`sent ${result.accepted} events (total: ${this.totalSent})`);
      }
      if (result.errors > 0) {
        log(`${result.errors} errors in batch`);
      }

      // Save cursors after successful send
      saveCursors(this.cursors);
    } catch (err) {
      // Put lines back for retry
      this.pendingLines.unshift(...batch);
      log(`send failed, ${batch.length} events queued for retry: ${err}`);
    }

    this.sending = false;

    // If there are more pending, flush again
    if (this.pendingLines.length >= this.config.batch_size) {
      this.flush();
    }
  }
}

function log(msg: string) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${msg}`);
}
