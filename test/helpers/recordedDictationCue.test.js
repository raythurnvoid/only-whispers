const test = require("node:test");
const assert = require("node:assert/strict");
const cues = require("../../src/config/dictationCues.json");
const { removeRecordedDictationCues } = require("../../src/helpers/recordedDictationCue");

function addTone(samples, start, frequency, duration = cues.noteDurationSeconds) {
  const offset = Math.round(start * 16000);
  for (let i = 0; i < Math.round(duration * 16000); i++) {
    samples[offset + i] += 0.05 * Math.sin((2 * Math.PI * frequency * i) / 16000);
  }
}

for (const [name, notes] of [
  ["start", cues.startNotes],
  ["stop", cues.stopNotes],
]) {
  test(`removes the recorded ${name} cue and preserves quiet audio beside it`, () => {
    const samples = new Float32Array(16000).fill(0.0001);
    addTone(samples, 0.2, notes[0]);
    addTone(samples, 0.2 + cues.noteDurationSeconds + cues.noteGapSeconds, notes[1]);
    addTone(samples, 0.47, 180);
    const before = samples.slice();
    removeRecordedDictationCues(samples, name === "start", name === "stop");
    assert.ok(
      samples.subarray(3500, 4300).every((x) => x === 0),
      "first cue note"
    );
    assert.ok(
      samples.subarray(5300, 6200).every((x) => x === 0),
      "second cue note"
    );
    assert.deepEqual(samples.subarray(7000), before.subarray(7000));
  });
}

test("a single note, a pair with the wrong timing, and a cue inside a long recording are kept", () => {
  const samples = new Float32Array(16000);
  addTone(samples, 0.2, cues.startNotes[0]);
  addTone(samples, 0.65, cues.startNotes[1]);
  const before = samples.slice();
  removeRecordedDictationCues(samples, true, true);
  assert.deepEqual(samples, before);

  addTone(samples, 0.315, cues.startNotes[1]);
  const middle = samples.slice();
  removeRecordedDictationCues(samples, false, false);
  assert.deepEqual(samples, middle);
});
