const cues = require("../config/dictationCues.json");

// Parakeet receives mono audio at 16 kHz. A frame covers 10 ms.
const FRAME = 160;
const NOTE_SPACING = Math.round((cues.noteDurationSeconds + cues.noteGapSeconds) * 100);
const NOTE_LENGTH = Math.round(cues.noteDurationSeconds * 100);

// The Goertzel filter measures the share of a frame's energy at one frequency.
function toneFrames(samples, frequency) {
  const frames = new Float32Array(Math.floor(samples.length / FRAME));
  const coefficient = 2 * Math.cos((2 * Math.PI * frequency) / 16000);
  for (let i = 0; i < frames.length; i++) {
    let previous = 0;
    let older = 0;
    let energy = 0;
    for (let j = i * FRAME; j < (i + 1) * FRAME; j++) {
      const value = samples[j];
      const next = value + coefficient * previous - older;
      older = previous;
      previous = next;
      energy += value * value;
    }
    const power = previous * previous + older * older - coefficient * previous * older;
    frames[i] = energy ? (2 * power) / (FRAME * energy) : 0;
  }
  return frames;
}

function removeNotePair(samples, notes) {
  const first = toneFrames(samples, notes[0]);
  const second = toneFrames(samples, notes[1]);
  for (let i = 0; i + NOTE_SPACING + 1 < first.length; i++) {
    const j = i + NOTE_SPACING;
    if (Math.min(first[i], first[i + 1], second[j], second[j + 1]) < 0.8) continue;
    // Once both notes match, mute only frames dominated by the cue or its room echo.
    for (const [at, tone] of [
      [i, first],
      [j, second],
    ]) {
      const begin = Math.max(0, at - NOTE_LENGTH);
      const end = Math.min(tone.length, at + NOTE_LENGTH + 5);
      for (let k = begin; k < end; k++) {
        if (tone[k] > 0.5) samples.fill(0, k * FRAME, (k + 1) * FRAME);
      }
    }
    return;
  }
}

function removeRecordedDictationCues(samples, isStart, isEnd) {
  // Allow for microphone pre-roll at the start. Stop cues can only be near the end.
  if (isStart) removeNotePair(samples.subarray(0, 3 * 16000), cues.startNotes);
  if (isEnd) removeNotePair(samples.subarray(Math.max(0, samples.length - 16000)), cues.stopNotes);
}

module.exports = { removeRecordedDictationCues };
