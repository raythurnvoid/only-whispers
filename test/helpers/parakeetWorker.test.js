const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { EventEmitter, once } = require("node:events");
const { PassThrough } = require("node:stream");
const { runInNewContext } = require("node:vm");

test("the live worker decodes a full segment before release and keeps the batch cut points", async () => {
  const worker = new EventEmitter();
  const decoded = [];
  const replies = new EventEmitter();
  const samples = Buffer.alloc(32 * 16000 * 4);
  worker.argv = ["node", "worker", "/model"];
  worker.send = (reply) => replies.emit("reply", reply);
  const modules = {
    os: require("node:os"),
    path: require("node:path"),
    child_process: {
      spawn(_ffmpeg, args) {
        const child = new EventEmitter();
        child.stdin = new PassThrough();
        child.stdout = new PassThrough();
        child.kill = () => {};
        child.stdout.once("end", () => child.emit("close", 0));
        if (args.includes("pipe:0")) child.stdin.pipe(child.stdout);
        else child.stdout.end(samples);
        return child;
      },
    },
    "sherpa-onnx-node": {
      OfflineRecognizer: class {
        createStream() {
          return {
            acceptWaveform({ samples }) {
              this.length = samples.length;
            },
          };
        }
        decode(stream) {
          decoded.push(stream.length);
        }
        getResult(stream) {
          return { text: String(stream.length) };
        }
      },
    },
    "./recordedDictationCue": require("../../src/helpers/recordedDictationCue"),
  };
  runInNewContext(readFileSync(require.resolve("../../src/helpers/parakeetWorker"), "utf8"), {
    require: (name) => modules[name],
    process: worker,
    Buffer,
  });

  const batch = once(replies, "reply");
  worker.emit("message", { input: "recording.webm", ffmpeg: "ffmpeg" });
  const [expected] = await batch;
  assert.deepEqual(decoded, [416800, 95200]);
  decoded.length = 0;
  worker.emit("message", { live: true, ffmpeg: "ffmpeg" });
  const written = once(replies, "reply");
  worker.emit("message", { chunk: samples });
  assert.equal((await written)[0].written, true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(decoded, [416800], "the first window must decode while the mic is open");
  const finished = once(replies, "reply");
  worker.emit("message", { finish: true });
  const [result] = await finished;
  assert.equal(result.text, expected.text);
  assert.deepEqual(decoded, [416800, 95200]);
});

test("the worker uses half the logical cores, from 4 up to 8 threads", () => {
  const threads = (cores) => {
    let config;
    runInNewContext(readFileSync(require.resolve("../../src/helpers/parakeetWorker"), "utf8"), {
      require: (name) =>
        ({
          os: { availableParallelism: () => cores },
          path: require("node:path"),
          child_process: {},
          "sherpa-onnx-node": {
            OfflineRecognizer: class {
              constructor(value) {
                config = value;
              }
            },
          },
          "./recordedDictationCue": {},
        })[name],
      process: { argv: ["node", "worker", "/model"], on() {} },
      Buffer,
    });
    return config.modelConfig.numThreads;
  };
  assert.equal(threads(32), 8);
  assert.equal(threads(12), 6);
  assert.equal(threads(8), 4);
  assert.equal(threads(2), 4);
});
