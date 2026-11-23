const fs = require("fs");
const path = require("path");
const { createHash, randomUUID } = require("crypto");
const { fork } = require("child_process");
const { PassThrough } = require("stream");
const { pipeline } = require("stream/promises");
const { getFFmpegPath } = require("./ffmpegUtils");
const { getSafeTempDir } = require("./safeTempDir");

// NVIDIA Parakeet TDT 0.6B v2 (CC BY 4.0), quantized by the sherpa-onnx project.
// v2 is English only. v3 guesses among 25 languages and has no way to fix one,
// so it sometimes wrote English speech as German or Dutch.
// The revision identifies the files on disk across app updates.
const MODEL = "parakeet-tdt-0.6b-v2";
const REVISION = "84b478d541cdbf0c296a7ab5f1e20a6f8f998114";
const SOURCE = "https://huggingface.co/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8";
const FILES = [
  [
    "encoder.int8.onnx",
    652282309,
    "92a10bd9c23936ea0566c29f963bc57c2a5df4261b6a8921c39abea66557ca8b",
  ],
  [
    "decoder.int8.onnx",
    7257753,
    "4d097bae3bac5c96018d5293ba39f1b657296102b142affda40378f38b020f41",
  ],
  ["joiner.int8.onnx", 1739080, "77a29f3e5ac7d37074e0af465391b80f314015d5b97f0f90c6c7767f1d56f428"],
  ["tokens.txt", 9384, "ec182b70dd42113aff6c5372c75cac58c952443eb22322f57bbd7f53977d497d"],
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
      name: "Parakeet TDT 0.6B v2",
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
      serialization: "advanced",
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

  startRecording() {
    const input = new PassThrough({ highWaterMark: 64 * 1024 });
    const controller = new AbortController();
    // Cancel immediately, even when a file transcription still owns the worker.
    const result = Promise.race([
      this.transcribe(input, { signal: controller.signal }),
      new Promise((_resolve, reject) => input.once("error", reject)),
    ]);
    result.catch((error) => input.destroy(error));
    const cancel = (error) => {
      controller.abort(error);
      input.destroy(controller.signal.reason);
    };
    return {
      write(chunk) {
        if (input.destroyed || input.writableEnded) {
          return Promise.reject(input.errored || new Error("Local recording has ended."));
        }
        // If the worker cannot keep up, use the complete recording kept by the mic.
        if (input.readableLength + input.writableLength + chunk.length > 1024 * 1024) {
          const error = new Error("Local recording input is full.");
          cancel(error);
          return Promise.reject(error);
        }
        return new Promise((resolve, reject) => {
          // A write waiting for the reader may never get its callback after destroy().
          input.once("error", reject);
          input.write(chunk, (error) => {
            input.off("error", reject);
            if (error) reject(error);
            else resolve();
          });
        });
      },
      finish() {
        input.end();
        return result;
      },
      cancel: () => cancel(),
    };
  }

  async run(audio, signal) {
    signal?.throwIfAborted();
    const installed = await this.installedModel();
    if (!installed) throw new Error("Download the local speech model in Settings.");
    await this.retireWorker(installed.directory);
    const ffmpeg = getFFmpegPath();
    if (!ffmpeg) throw new Error("FFmpeg is missing. Reinstall Only Whispers.");
    const live = audio instanceof PassThrough;
    const temp =
      live || typeof audio === "string"
        ? null
        : path.join(getSafeTempDir(), `only-whispers-${randomUUID()}.audio`);
    try {
      if (temp) await fs.promises.writeFile(temp, audio, { mode: 0o600 });
      signal?.throwIfAborted();
      const worker = this.getWorker(installed.directory);
      const text = await new Promise((resolve, reject) => {
        worker.ref();
        worker.channel.ref();
        let settled = false;
        let written;
        const onMessage = (reply) => {
          if (reply.written) {
            written?.();
            return;
          }
          cleanup();
          if (reply.error) reject(new Error(reply.error));
          else resolve(reply.text);
        };
        const onExit = () => onError(new Error("The local speech engine stopped."));
        const onAbort = () => onError(signal.reason);
        const cleanup = () => {
          settled = true;
          written?.();
          worker.off("message", onMessage);
          worker.off("exit", onExit);
          worker.off("error", onError);
          signal?.removeEventListener("abort", onAbort);
          worker.channel?.unref();
          worker.unref();
        };
        const onError = (error) => {
          if (settled) return;
          cleanup();
          // A broken pipe or a cancelled input may leave FFmpeg waiting for bytes.
          if (this.worker === worker) {
            this.worker = null;
            worker.kill();
          }
          reject(error);
        };
        worker.on("message", onMessage);
        worker.once("exit", onExit);
        worker.once("error", onError);
        signal?.addEventListener("abort", onAbort, { once: true });
        const onSend = (error) => {
          if (error) onError(error);
        };
        worker.send({ input: live ? undefined : temp || audio, ffmpeg, live }, onSend);
        if (live) {
          const sendAudio = async () => {
            for await (const chunk of audio) {
              if (settled) return;
              // Only one chunk is in flight until FFmpeg accepts the bytes.
              await new Promise((accept) => {
                written = accept;
                worker.send({ chunk }, onSend);
              });
            }
            if (!settled) worker.send({ finish: true }, onSend);
          };
          sendAudio().catch(onError);
        }
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
  startLocalRecording: () => getModel().startRecording(),
  downloadLocalModel: () => getModel().install(),
  transcribeLocalAudio: (audio, options) => getModel().transcribe(audio, options),
};
