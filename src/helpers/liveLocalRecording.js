// Start before Parakeet's first 30-second decode. Short clips use the saved
// recording directly and never send individual chunks across IPC.
const START_AFTER_MS = 24000;
const WRITE_BYTES = 256 * 1024;
const MAX_QUEUED_BYTES = 4 * 1024 * 1024;
// Main remembers the last ID for this renderer to reject late writes after cancel.
let lastRecordingId = 0;

export function createLiveLocalRecording(chunks, startedAt, api) {
  let nextChunk = 0;
  let queuedBytes = 0;
  let queuedWrites = 0;
  let pending = Promise.resolve();
  let id = null;
  let closed = false;
  const cancelled = Promise.withResolvers();

  function cancel() {
    if (closed) return;
    closed = true;
    cancelled.resolve(null);
    if (id) void api.cancelLocalRecording(id).catch(() => {});
  }

  return {
    cancel,
    update(source) {
      // A cancelled MediaRecorder can still emit a last chunk after a new start.
      if (closed || source !== chunks || Date.now() - startedAt < START_AFTER_MS) return;
      if (nextChunk === chunks.length) return;
      const audio = new Blob(chunks.slice(nextChunk));
      nextChunk = chunks.length;
      queuedBytes += audio.size;
      if (++queuedWrites > 16 || queuedBytes > MAX_QUEUED_BYTES) {
        cancel();
        return;
      }
      pending = pending.then(async () => {
        try {
          for (let offset = 0; !closed && offset < audio.size; offset += WRITE_BYTES) {
            const bytes = await audio.slice(offset, offset + WRITE_BYTES).arrayBuffer();
            if (closed) return;
            id ??= ++lastRecordingId;
            if (!(await api.writeLocalRecordingChunk(id, bytes))) cancel();
          }
        } catch {
          cancel();
        } finally {
          queuedBytes -= audio.size;
          queuedWrites--;
        }
      });
    },
    async finish() {
      if (closed || !nextChunk) return null;
      // A stalled renderer-to-worker call must still release to the saved file.
      // Only the last window normally remains, even for a long recording.
      const timeout = setTimeout(cancel, 15000);
      try {
        const finish = pending.then(() => (closed ? null : api.finishLocalRecording(id)));
        const result = await Promise.race([finish, cancelled.promise]);
        if (result) closed = true;
        return result;
      } catch {
        return null;
      } finally {
        clearTimeout(timeout);
        cancel();
      }
    },
  };
}
