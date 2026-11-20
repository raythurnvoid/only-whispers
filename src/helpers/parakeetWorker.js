// The native model stays warm between recordings. A native failure in this
// process cannot take down the app or lose a recording from history.
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { OfflineRecognizer } = require("sherpa-onnx-node");
const { removeRecordedDictationCues } = require("./recordedDictationCue");

const directory = process.argv[2];
const recognizer = new OfflineRecognizer({
  featConfig: { sampleRate: 16000, featureDim: 80 },
  modelConfig: {
    transducer: {
      encoder: path.join(directory, "encoder.int8.onnx"),
      decoder: path.join(directory, "decoder.int8.onnx"),
      joiner: path.join(directory, "joiner.int8.onnx"),
    },
    tokens: path.join(directory, "tokens.txt"),
    modelType: "nemo_transducer",
    provider: "cpu",
    // 8 threads decoded 24% faster than 4 on a 32-thread CPU, with the same text.
    // Half the logical cores keeps 4 on smaller machines.
    numThreads: Math.min(8, Math.max(4, Math.floor(os.availableParallelism() / 2))),
  },
  decodingMethod: "greedy_search",
});

const BYTES_PER_SECOND = 16000 * 4;

// Find the quietest 100 ms near the end, so a long recording usually
// splits between words. Keep all samples on both sides of the cut.
function pauseCut(pcm) {
  const frame = BYTES_PER_SECOND / 10;
  let quietest = Infinity;
  let cut = pcm.length;
  for (let start = pcm.length - 4 * BYTES_PER_SECOND; start < pcm.length; start += frame) {
    let energy = 0;
    for (let i = start; i < start + frame; i += 4) {
      energy += pcm.readFloatLE(i) ** 2;
    }
    if (energy < quietest) {
      quietest = energy;
      cut = start + frame / 2;
    }
  }
  return cut;
}

function decode(pcm, isStart, isEnd) {
  if (!pcm.length) return "";
  const stream = recognizer.createStream();
  const samples = new Float32Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.length / 4));
  removeRecordedDictationCues(samples, isStart, isEnd);
  stream.acceptWaveform({ samples, sampleRate: 16000 });
  recognizer.decode(stream);
  return recognizer.getResult(stream).text.trim();
}

let liveInput;

async function transcribe(input, ffmpeg, live) {
  const child = spawn(
    ffmpeg,
    [
      "-nostdin",
      "-loglevel",
      "error",
      "-protocol_whitelist",
      "file,pipe",
      "-i",
      live ? "pipe:0" : input,
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-f",
      "f32le",
      "pipe:1",
    ],
    { windowsHide: true, stdio: [live ? "pipe" : "ignore", "pipe", "ignore"] }
  );
  if (live) {
    liveInput = child.stdin;
    // FFmpeg may reject the container before the next input write finishes.
    // Its exit status below reports the failure to the recording.
    liveInput.on("error", () => {});
  }
  const closed = new Promise((resolve) => {
    child.once("error", (error) => resolve(error.message));
    child.once("close", (code) =>
      resolve(code === 0 ? null : "FFmpeg could not read this recording.")
    );
  });
  const pcm = Buffer.alloc(30 * BYTES_PER_SECOND);
  let used = 0;
  const words = [];
  try {
    for await (const chunk of child.stdout) {
      let offset = 0;
      while (offset < chunk.length) {
        const count = chunk.copy(pcm, used, offset);
        used += count;
        offset += count;
        if (used === pcm.length) {
          const cut = pauseCut(pcm);
          words.push(decode(pcm.subarray(0, cut), words.length === 0, false));
          used = pcm.copy(pcm, 0, cut);
        }
      }
    }
    const error = await closed;
    if (error) throw new Error(error);
    if (live && !liveInput.writableEnded) throw new Error("The live audio stream ended early.");
    words.push(decode(pcm.subarray(0, used), words.length === 0, true));
    return words.filter(Boolean).join(" ");
  } finally {
    liveInput = null;
    child.kill();
  }
}

process.on("disconnect", () => process.exit());
process.on("message", async ({ input, ffmpeg, live, chunk, finish }) => {
  if (chunk) {
    liveInput?.write(chunk, (error) => {
      if (!error) process.send({ written: true });
    });
    return;
  }
  if (finish) {
    liveInput?.end();
    return;
  }
  try {
    process.send({ text: await transcribe(input, ffmpeg, live) });
  } catch (error) {
    process.send({ error: error.message });
  }
});
