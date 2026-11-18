const test = require("node:test");
const assert = require("node:assert/strict");
const { createDb } = require("./harness/db");

const stt = { text: "the pears", provider: "parakeet", model: "test-model", latencyMs: 250 };
const audio = { hasAudio: 1, audioDurationMs: 1100, provider: stt.provider, model: stt.model };

test("a retry preserves the first speech result and the listener's reference", (t) => {
  const db = createDb(t);
  if (!db) return;
  const { id } = db.saveTranscription("The pears.", stt.text, { stt });
  assert.equal(
    db.getTranscriptionById(id).stt_raw_text,
    null,
    "an unattached clip has no baseline"
  );
  db.updateTranscriptionAudio(id, { ...audio, stt });
  db.setTranscriptionReference(id, "the pairs");
  db.updateTranscriptionText(id, "the bears", "the bears");
  db.updateTranscriptionAudio(id, { ...audio, provider: "mistral", model: "other-model" });
  const row = db.getTranscriptionById(id);
  assert.equal(row.raw_text, "the bears");
  assert.equal(row.reference_text, "the pairs");
  assert.equal(row.stt_raw_text, "the pears");
  assert.equal(row.stt_provider, "parakeet");
  assert.equal(row.stt_model, "test-model");
  assert.equal(row.stt_latency_ms, 250);
  assert.equal(row.stt_app_version, "0.0.0-test");
  assert.equal(db.setTranscriptionReference(id, "").reference_text, "");
  assert.equal(db.setTranscriptionReference(id, null).reference_text, null);
});

test("legacy audio can be reviewed without inventing first-pass data", (t) => {
  const db = createDb(t);
  if (!db) return;
  db.db.exec(`
    DROP TRIGGER clear_transcription_review;
    DROP INDEX idx_transcriptions_reviewed;
    ALTER TABLE transcriptions DROP COLUMN stt_raw_text;
    ALTER TABLE transcriptions DROP COLUMN stt_provider;
    ALTER TABLE transcriptions DROP COLUMN stt_model;
    ALTER TABLE transcriptions DROP COLUMN stt_latency_ms;
    ALTER TABLE transcriptions DROP COLUMN stt_app_version;
    ALTER TABLE transcriptions DROP COLUMN reference_text;
    INSERT INTO transcriptions (id, text, raw_text, has_audio) VALUES (7, 'existing', 'words', 1);
  `);
  db.db.close();
  db.initDatabase();
  const row = db.setTranscriptionReference(7, "spoken words");
  assert.equal(row.reference_text, "spoken words");
  assert.equal(row.raw_text, "words");
  assert.equal(row.stt_raw_text, null);
  assert.equal(row.stt_provider, null);
  assert.equal(row.stt_latency_ms, null);
  assert.equal(row.stt_app_version, null);
});

test("deleting a synced recording or expiring its audio removes its review", (t) => {
  const db = createDb(t);
  if (!db) return;
  for (const action of ["delete", "expire"]) {
    const { id } = db.saveTranscription("A pear.", stt.text);
    assert.equal(db.setTranscriptionReference(id, "a pair"), undefined);
    db.updateTranscriptionAudio(id, { ...audio, stt });
    db.setTranscriptionReference(id, "a pair");
    if (action === "delete") {
      db.db.prepare("UPDATE transcriptions SET cloud_id = 'test' WHERE id = ?").run(id);
      db.deleteTranscription(id);
    } else {
      db.clearAudioFlags([id]);
    }
    const row = db.getTranscriptionById(id);
    assert.equal(row.reference_text, null);
    assert.equal(row.stt_raw_text, null);
    assert.equal(row.stt_app_version, null);
    assert.equal(db.setTranscriptionReference(id, "late review"), undefined);
  }
});
