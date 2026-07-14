import { existsSync } from "node:fs";
import { appendFile, mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";
import type { LabeledSnapshot, ResolvedLabel } from "@kalshi-terminal/shared/analytics.js";
import { config } from "./config.js";

function utcDateStr(tsMs: number): string {
  return new Date(tsMs).toISOString().slice(0, 10); // YYYY-MM-DD
}

interface OpenFile {
  date: string;
  path: string;
}

/**
 * Append-only JSONL writer. Two logs per market, deliberately different
 * retention priorities (see the plan's storage section / future.md):
 *
 * - raw/{ticker}/{date}.jsonl(.gz): everything as received off the wire.
 *   Larger, lower priority, pruned oldest-first under disk pressure.
 * - labeled/{ticker}/{date}.jsonl(.gz): 1Hz feature snapshots plus their
 *   later-resolved forward-outcome labels (joinable by snapshotId) -- this
 *   *is* the training set, never pruned by this class.
 *
 * Each day's file is plain (uncompressed) while "hot" -- simple appends,
 * crash/restart-safe, no partial-gzip-member corruption risk -- and gzipped
 * in one shot (then removed) once the UTC day rolls over.
 */
export class DataStore {
  private rawOpenFiles = new Map<string, OpenFile>();
  private labeledOpenFiles = new Map<string, OpenFile>();

  private async rotateIfNeeded(
    open: Map<string, OpenFile>,
    subdir: string,
    ticker: string,
    nowMs: number,
  ): Promise<string> {
    const date = utcDateStr(nowMs);
    const current = open.get(ticker);
    if (current && current.date === date) return current.path;

    if (current) await this.compressAndRemove(current.path);

    const dir = path.join(config.outputDir, subdir, ticker);
    await mkdir(dir, { recursive: true });
    const filePath = path.join(dir, `${date}.jsonl`);
    open.set(ticker, { date, path: filePath });
    return filePath;
  }

  private async compressAndRemove(filePath: string): Promise<void> {
    if (!existsSync(filePath)) return;
    const contents = await readFile(filePath);
    if (contents.length === 0) {
      await rm(filePath, { force: true });
      return;
    }
    await appendFile(`${filePath}.gz`, gzipSync(contents));
    await rm(filePath, { force: true });
  }

  async appendRawEvent(
    ticker: string,
    type: string,
    payload: unknown,
    nowMs = Date.now(),
  ): Promise<void> {
    const filePath = await this.rotateIfNeeded(this.rawOpenFiles, "raw", ticker, nowMs);
    await appendFile(filePath, JSON.stringify({ tsMs: nowMs, type, payload }) + "\n");
  }

  async appendLabeledSnapshot(labeled: LabeledSnapshot, nowMs = Date.now()): Promise<void> {
    const ticker = labeled.snapshot.marketTicker;
    const filePath = await this.rotateIfNeeded(this.labeledOpenFiles, "labeled", ticker, nowMs);
    await appendFile(filePath, JSON.stringify({ kind: "snapshot", ...labeled }) + "\n");
  }

  async appendResolvedLabels(
    ticker: string,
    labels: ResolvedLabel[],
    nowMs = Date.now(),
  ): Promise<void> {
    if (labels.length === 0) return;
    const filePath = await this.rotateIfNeeded(this.labeledOpenFiles, "labeled", ticker, nowMs);
    const lines = labels.map((l) => JSON.stringify({ kind: "label", ...l }) + "\n").join("");
    await appendFile(filePath, lines);
  }

  /** Deletes the oldest compressed raw-log days across all markets until
   * total raw-log size is back under config.maxRawLogGb. Never touches the
   * labeled-snapshot log -- that's the priority artifact and stays small by
   * construction (1Hz, ~25-30 fields/row) relative to raw ticks. */
  async pruneRawLogIfOverBudget(): Promise<void> {
    const rawDir = path.join(config.outputDir, "raw");
    if (!existsSync(rawDir)) return;

    const files: { path: string; sizeBytes: number; mtimeMs: number }[] = [];
    for (const ticker of await readdir(rawDir)) {
      const tickerDir = path.join(rawDir, ticker);
      for (const name of await readdir(tickerDir)) {
        const filePath = path.join(tickerDir, name);
        const s = await stat(filePath);
        files.push({ path: filePath, sizeBytes: s.size, mtimeMs: s.mtimeMs });
      }
    }

    let totalBytes = files.reduce((a, f) => a + f.sizeBytes, 0);
    const budgetBytes = config.maxRawLogGb * 1024 ** 3;
    if (totalBytes <= budgetBytes) return;

    files.sort((a, b) => a.mtimeMs - b.mtimeMs); // oldest first
    for (const f of files) {
      if (totalBytes <= budgetBytes) break;
      await rm(f.path, { force: true });
      totalBytes -= f.sizeBytes;
    }
  }
}
