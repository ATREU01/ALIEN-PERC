/**
 * ALIENTOR VANITY ADDRESS GRINDER
 *
 * Mines Solana keypairs to find addresses matching a custom pattern.
 * Uses multi-threaded workers for parallel mining.
 *
 * Part of the Alienator Protocol launchpad.
 */

import { Keypair } from "@solana/web3.js";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { cpus } from "node:os";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ═══════════════════════════════════════════════════════════════════
// DATA DIRECTORY
// ═══════════════════════════════════════════════════════════════════
const DATA_DIR = process.env.RAILWAY_ENVIRONMENT
  ? "/app/data"
  : join(__dirname, "data");

if (isMainThread && !existsSync(DATA_DIR)) {
  try { mkdirSync(DATA_DIR, { recursive: true }); } catch (e) { /* ignore */ }
}

const CONFIG = {
  OUTPUT_FILE: join(DATA_DIR, ".vanity-keys.json"),
  PROGRESS_INTERVAL: 5000,
};

// ═══════════════════════════════════════════════════════════════════
// WORKER THREAD CODE
// ═══════════════════════════════════════════════════════════════════

if (!isMainThread) {
  const { prefix, suffix, caseSensitive } = workerData;
  let checked = 0;
  let lastReport = Date.now();
  const normalize = (str) => (caseSensitive ? str : str.toLowerCase());
  const prefixNorm = normalize(prefix || "");
  const suffixNorm = normalize(suffix || "");

  while (true) {
    const keypair = Keypair.generate();
    const address = keypair.publicKey.toBase58();
    const addressNorm = normalize(address);
    checked++;

    const prefixMatch = !prefixNorm || addressNorm.startsWith(prefixNorm);
    const suffixMatch = !suffixNorm || addressNorm.endsWith(suffixNorm);

    if (prefixMatch && suffixMatch) {
      parentPort.postMessage({
        type: "found",
        address,
        secretKey: Array.from(keypair.secretKey),
        checked,
      });
      break;
    }

    if (Date.now() - lastReport > 1000) {
      parentPort.postMessage({ type: "progress", checked });
      lastReport = Date.now();
      checked = 0;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// MAIN THREAD - VANITY GRINDER CLASS
// ═══════════════════════════════════════════════════════════════════

export class VanityGrinder {
  constructor(options = {}) {
    this.prefix = options.prefix || "";
    this.suffix = options.suffix || "";
    this.caseSensitive = options.caseSensitive || false;
    this.numWorkers = options.workers || cpus().length;
    this.workers = [];
    this.totalChecked = 0;
    this.startTime = null;
    this.found = null;
  }

  estimateDifficulty() {
    const patternLength = (this.prefix?.length || 0) + (this.suffix?.length || 0);
    if (patternLength === 0) return { attempts: 1, time: "< 1 second" };

    const charProbability = this.caseSensitive ? 58 : 34;
    const attempts = Math.pow(charProbability, patternLength);
    const attemptsPerSecond = 100000 * this.numWorkers;
    const seconds = attempts / attemptsPerSecond;

    let timeEstimate;
    if (seconds < 60) timeEstimate = `~${Math.round(seconds)} seconds`;
    else if (seconds < 3600) timeEstimate = `~${Math.round(seconds / 60)} minutes`;
    else if (seconds < 86400) timeEstimate = `~${Math.round(seconds / 3600)} hours`;
    else if (seconds < 604800) timeEstimate = `~${Math.round(seconds / 86400)} days`;
    else timeEstimate = `~${Math.round(seconds / 604800)} weeks`;

    return {
      patternLength,
      attempts: attempts.toLocaleString(),
      probability: `1 in ${attempts.toLocaleString()}`,
      timeEstimate,
      workers: this.numWorkers,
    };
  }

  start() {
    return new Promise((resolve, reject) => {
      console.log("\n" + "=".repeat(50));
      console.log("ALIENTOR VANITY ADDRESS GRINDER");
      console.log("=".repeat(50));

      if (this.prefix) console.log(`Prefix: ${this.prefix}`);
      if (this.suffix) console.log(`Suffix: ${this.suffix}`);
      console.log(`Workers: ${this.numWorkers}`);

      const estimate = this.estimateDifficulty();
      console.log(`Difficulty: ${estimate.probability}`);
      console.log(`Expected time: ${estimate.timeEstimate}`);
      console.log("=".repeat(50) + "\n");

      this.startTime = Date.now();

      const progressInterval = setInterval(() => {
        const elapsed = (Date.now() - this.startTime) / 1000;
        const rate = Math.round(this.totalChecked / elapsed);
        console.log(
          `[GRIND] ${this.totalChecked.toLocaleString()} checked | ${rate.toLocaleString()}/sec | ${Math.round(elapsed)}s`,
        );
      }, CONFIG.PROGRESS_INTERVAL);

      for (let i = 0; i < this.numWorkers; i++) {
        const worker = new Worker(__filename, {
          workerData: {
            prefix: this.prefix,
            suffix: this.suffix,
            caseSensitive: this.caseSensitive,
          },
        });

        worker.on("message", (msg) => {
          if (msg.type === "progress") {
            this.totalChecked += msg.checked;
          } else if (msg.type === "found") {
            this.totalChecked += msg.checked;
            this.found = {
              address: msg.address,
              secretKey: Uint8Array.from(msg.secretKey),
            };

            this.workers.forEach((w) => w.terminate());
            clearInterval(progressInterval);

            const elapsed = (Date.now() - this.startTime) / 1000;
            console.log("\n" + "=".repeat(50));
            console.log("FOUND!");
            console.log("=".repeat(50));
            console.log(`Address: ${this.found.address}`);
            console.log(`Time: ${elapsed.toFixed(1)}s`);
            console.log("=".repeat(50) + "\n");

            this.saveResult();
            resolve(this.found);
          }
        });

        worker.on("error", (err) => {
          console.error(`Worker ${i} error:`, err);
        });

        this.workers.push(worker);
      }
    });
  }

  saveResult() {
    if (!this.found) return;
    // We only store the public address for pool management
    // Secret key is returned to caller, never persisted at rest
    const result = {
      address: this.found.address,
      foundAt: new Date().toISOString(),
      pattern: { prefix: this.prefix, suffix: this.suffix },
      stats: { totalChecked: this.totalChecked, timeSeconds: (Date.now() - this.startTime) / 1000 },
    };

    let existing = [];
    try {
      if (existsSync(CONFIG.OUTPUT_FILE)) {
        existing = JSON.parse(readFileSync(CONFIG.OUTPUT_FILE, "utf8"));
      }
    } catch (e) { /* ignore */ }

    existing.push(result);
    writeFileSync(CONFIG.OUTPUT_FILE, JSON.stringify(existing, null, 2));
  }

  stop() {
    this.workers.forEach((w) => w.terminate());
  }
}

// ═══════════════════════════════════════════════════════════════════
// VANITY POOL MANAGEMENT (for server-side pre-mining)
// ═══════════════════════════════════════════════════════════════════

export class VanityPool {
  constructor(options = {}) {
    this.targetSize = options.targetSize || 10;
    this.minSize = options.minSize || 5;
    this.pool = [];
    this.generating = false;
  }

  /** Generate a single keypair (no pattern, just random - for basic mint keypairs) */
  generateKeypair() {
    const keypair = Keypair.generate();
    return {
      publicKey: keypair.publicKey.toBase58(),
      secretKey: keypair.secretKey,
    };
  }

  /** Get a pre-mined keypair or generate a fresh one */
  getKeypair() {
    if (this.pool.length > 0) {
      return this.pool.shift();
    }
    return this.generateKeypair();
  }

  get status() {
    return {
      poolSize: this.pool.length,
      targetSize: this.targetSize,
      ready: this.pool.length >= this.minSize,
    };
  }
}
