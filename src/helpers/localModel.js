const fs = require("fs");
const path = require("path");
const { createHash, randomUUID } = require("crypto");
const { fork } = require("child_process");
const { pipeline } = require("stream/promises");
const { getFFmpegPath } = require("./ffmpegUtils");
const { getSafeTempDir } = require("./safeTempDir");

// NVIDIA Parakeet TDT 0.6B v3 (CC BY 4.0), quantized by the sherpa-onnx project.
// The revision identifies the files on disk across app updates.
const MODEL = "parakeet-tdt-0.6b-v3";
const REVISION = "ed5d745623472f97cfc2e6c2916ee248798fc5a8";
const SOURCE = "https://huggingface.co/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8";
const FILES = [
  [
    "encoder.int8.onnx",
    652282294,
    "1afbe69c1ffdabee94755f42e4daf1d93549131a3da11356bda84fcef0f2c479",
  ],
  [
    "decoder.int8.onnx",
    11845274,
    "0222a86147299d4dee90edf95b6d13827edb42ad8b7c9cf0b2582f030937c0b5",
  ],
  ["joiner.int8.onnx", 6355277, "cbd02f3696e9944970111fb439d9c3fd365a80374565f13f2b9c7007d253fc98"],
  ["tokens.txt", 93939, "d58544679ea4bc6ac563d1f545eb7d474bd6cfa467f0a6e2c1dc1c7d37e3c35d"],
];
const RELEASE = { model: MODEL, revision: REVISION, files: FILES };
const ENGINE = "sherpa-nemo-transducer-v1";

class LocalSpeechModel {
  constructor(userDataPath, release = RELEASE) {
    this.release = release;
    this.root = path.join(userDataPath, "speech-model");
    this.directory = path.join(this.root, release.revision);
    this.totalBytes = release.files.reduce((sum, [, size]) => sum + size, 0);
    this.downloadedBytes = 0;
    this.queue = Promise.resolve();
  }

  async isInstalled(directory = this.directory, files = this.release.files) {
    for (const [file, size] of files) {
      const stat = await fs.promises.stat(path.join(directory, file)).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
      if (!stat?.isFile() || stat.size !== size) return false;
    }
    return true;
  }

  async installedModel() {
    if (await this.isInstalled()) return { directory: this.directory, model: this.release.model };
    // An offline app update can still use the last verified model when its
    // files work with this decoder. Ignore partial and unrelated directories.
    const entries = await fs.promises.readdir(this.root).catch((error) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
    for (const revision of entries) {
      if (revision === this.release.revision || !/^[a-f0-9]{40}$/.test(revision)) continue;
      const directory = path.join(this.root, revision);
      const receipt = await fs.promises
        .readFile(path.join(directory, "installed.json"), "utf8")
        .then(JSON.parse)
        .catch(() => null);
      if (receipt?.engine !== ENGINE || typeof receipt.model !== "string") continue;
      const files = this.release.files.map(([name]) => [name, receipt.sizes?.[name]]);
      if (await this.isInstalled(directory, files)) return { directory, model: receipt.model };
    }
    return null;
  }

  async getStatus() {
    const state = this.installing
      ? "downloading"
      : this.error
        ? "error"
        : (await this.isInstalled())
          ? "ready"
          : "missing";
    return {
      state,
      name: "Parakeet TDT 0.6B v3",
      totalBytes: this.totalBytes,
      downloadedBytes: state === "ready" ? this.totalBytes : this.downloadedBytes,
      ...(this.error && { error: this.error }),
    };
  }

  async install() {
    if (!this.installing) {
      this.error = null;
      this.downloadedBytes = 0;
      this.installing = this.installFiles()
        .catch((error) => {
          this.error = error.message;
          throw error;
        })
        .finally(() => {
          this.installing = null;
        });
    }
    await this.installing;
    return this.getStatus();
  }

  async installFiles() {
    if (await this.isInstalled()) return;
    const staging = this.directory + ".partial";
    await fs.promises.mkdir(staging, { recursive: true });
    const { revision, files } = this.release;
    for (const [file, size, checksum] of files) {
      const target = path.join(staging, file);
      // Only verified files get their final name, so retry can reuse them.
      const saved = await fs.promises.stat(target).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
      if (saved?.size === size) {
        this.downloadedBytes += size;
        continue;
      }
      const response = await fetch(`${SOURCE}/resolve/${revision}/${file}`);
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`Could not download ${file} (HTTP ${response.status}).`);
      }
      const hash = createHash("sha256");
      let bytes = 0;
      const self = this;
      await pipeline(
        response.body,
        async function* (chunks) {
          for await (const chunk of chunks) {
            bytes += chunk.length;
            if (bytes > size) throw new Error(`Wrong download size for ${file}.`);
            hash.update(chunk);
            self.downloadedBytes += chunk.length;
            yield chunk;
          }
        },
        fs.createWriteStream(target + ".download")
      );
      if (bytes !== size || hash.digest("hex") !== checksum) {
        throw new Error(`The download of ${file} did not pass its checksum.`);
      }
      await fs.promises.rename(target + ".download", target);
    }
    // Keep the previous revision until every new file passes its checksum.
    const receipt = {
      engine: ENGINE,
      model: this.release.model,
      sizes: Object.fromEntries(files.map(([name, size]) => [name, size])),
    };
    await fs.promises.writeFile(path.join(staging, "installed.json"), JSON.stringify(receipt));
    await fs.promises.rm(this.directory, { recursive: true, force: true });
    await fs.promises.rename(staging, this.directory);
    // Let a dictation using the previous revision finish before removing its files.
    const cleanup = this.queue.then(() => this.removeOldModels());
    this.queue = cleanup.catch(() => {});
    await cleanup;
  }

  async retireWorker(directory) {
    if (this.worker && this.workerDirectory !== directory) {
      const worker = this.worker;
      this.worker = null;
      await new Promise((resolve) => {
        worker.ref();
        worker.once("exit", resolve);
        worker.kill();
      });
    }
  }

  async removeOldModels() {
    await this.retireWorker(this.directory);
    for (const entry of await fs.promises.readdir(this.root)) {
      if (entry !== this.release.revision && /^[a-f0-9]{40}(\.partial)?$/.test(entry)) {
        await fs.promises.rm(path.join(this.root, entry), { recursive: true, force: true });
      }
    }
  }

  getWorker(directory) {
    if (this.worker) return this.worker;
    const unpack = (file) => file.replace(/app\.asar([/\\])/, "app.asar.unpacked$1");
    const platform = process.platform === "win32" ? "win" : process.platform;
    const libs = unpack(
      path.dirname(require.resolve(`sherpa-onnx-${platform}-${process.arch}/package.json`))
    );
    const libPath = process.platform === "darwin" ? "DYLD_LIBRARY_PATH" : "LD_LIBRARY_PATH";
    const worker = fork(unpack(path.join(__dirname, "parakeetWorker.js")), [directory], {
      execArgv: [],
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        [libPath]: [libs, process.env[libPath]].filter(Boolean).join(path.delimiter),
      },
      stdio: ["ignore", "ignore", "inherit", "ipc"],
    });
    const clearWorker = () => {
      if (this.worker === worker) this.worker = null;
    };
    worker.once("exit", clearWorker);
    worker.once("error", clearWorker);
    worker.unref();
    worker.channel?.unref();
    this.workerDirectory = directory;
    this.worker = worker;
    return worker;
  }

  warm() {
    // The child loads its weights while the mic records. The first clip can
    // reach the same worker as soon as the key is released.
    const result = this.queue.then(async () => {
      const installed = await this.installedModel();
      if (!installed) return false;
      await this.retireWorker(installed.directory);
      this.getWorker(installed.directory);
      return true;
    });
    this.queue = result.catch(() => {});
    return result;
  }

  transcribe(audio, { signal } = {}) {
    const result = this.queue.then(() => this.run(audio, signal));
    this.queue = result.catch(() => {});
    return result;
  }

  async run(audio, signal) {
    signal?.throwIfAborted();
    const installed = await this.installedModel();
    if (!installed) throw new Error("Download the local speech model in Settings.");
    await this.retireWorker(installed.directory);
    const ffmpeg = getFFmpegPath();
    if (!ffmpeg) throw new Error("FFmpeg is missing. Reinstall Only Whispers.");
    const temp =
      typeof audio === "string"
        ? null
        : path.join(getSafeTempDir(), `only-whispers-${randomUUID()}.audio`);
    try {
      if (temp) await fs.promises.writeFile(temp, audio, { mode: 0o600 });
      signal?.throwIfAborted();
      const worker = this.getWorker(installed.directory);
      const text = await new Promise((resolve, reject) => {
        worker.ref();
        worker.channel.ref();
        const onMessage = (reply) => {
          cleanup();
          if (reply.error) reject(new Error(reply.error));
          else resolve(reply.text);
        };
        const onExit = () => onError(new Error("The local speech engine stopped."));
        const onAbort = () => {
          this.worker = null;
          worker.kill();
          onError(signal.reason);
        };
        const cleanup = () => {
          worker.off("message", onMessage);
          worker.off("exit", onExit);
          worker.off("error", onError);
          signal?.removeEventListener("abort", onAbort);
          worker.channel?.unref();
          worker.unref();
        };
        const onError = (error) => {
          cleanup();
          reject(error);
        };
        worker.once("message", onMessage);
        worker.once("exit", onExit);
        worker.once("error", onError);
        signal?.addEventListener("abort", onAbort, { once: true });
        worker.send({ input: temp || audio, ffmpeg }, (error) => {
          if (error) onError(error);
        });
      });
      return { text, model: installed.model, modelRevision: path.basename(installed.directory) };
    } finally {
      // On Windows, FFmpeg can hold this file briefly after cancellation kills the worker.
      if (temp) await fs.promises.rm(temp, { force: true, recursive: true, maxRetries: 8 });
    }
  }
}

let model;
function getModel() {
  model ??= new LocalSpeechModel(require("electron").app.getPath("userData"));
  return model;
}

module.exports = {
  LocalSpeechModel,
  getLocalModelStatus: () => getModel().getStatus(),
  canTranscribeLocalAudio: async () => !!(await getModel().installedModel()),
  warmLocalModel: () => getModel().warm(),
  downloadLocalModel: () => getModel().install(),
  transcribeLocalAudio: (audio, options) => getModel().transcribe(audio, options),
};
