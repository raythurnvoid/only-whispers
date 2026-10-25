const WebSocket = require("ws");
const debugLogger = require("./debugLogger");

// Mistral Voxtral live transcription. One socket carries one dictation: the
// session is fixed by session.update before the first audio, and
// input_audio.end closes the stream with one transcription.done.
const MISTRAL_REALTIME_MODEL = "voxtral-mini-transcribe-realtime-3";
const CONNECT_TIMEOUT_MS = 10000;
// transcription.done came 0.4-0.8 s after input_audio.end in tests.
const FINAL_TIMEOUT_MS = 4000;
// On real mic audio 480 ms misheard the first words; 1200 ms got them right
// with the same final latency. The app shows no live preview, so slower
// partials cost nothing.
const STREAMING_DELAY_MS = 1200;
const COLD_START_BUFFER_MAX = 10 * 16000 * 2; // 10 seconds of 16 kHz PCM16

class MistralRealtimeStreaming {
  constructor() {
    this.ws = null;
    this.isConnected = false;
    this.isConnecting = false;
    this.isDisconnecting = false;
    this.text = "";
    this.finalText = null;
    this.audioBytesSent = 0;
    this.bufferingAudio = false;
    this.coldStartBuffer = [];
    this.coldStartBufferSize = 0;
    this.finalPromise = null;
    this._resolveFinal = null;
    this.onPartialTranscript = null;
    this.onFinalTranscript = null;
    this.onError = null;
    this.onSessionEnd = null;
  }

  // Audio sent before the socket is ready is kept and flushed on connect.
  beginConnecting() {
    this.bufferingAudio = true;
    this.coldStartBuffer = [];
    this.coldStartBufferSize = 0;
  }

  async connect({ apiKey, model, keyterms }) {
    if (!apiKey) throw new Error("Mistral API key is required");
    if (!this.bufferingAudio) this.beginConnecting();
    this.isConnecting = true;

    // English only, whatever the settings say: auto detection sometimes heard French.
    const session = {
      audio_format: { encoding: "pcm_s16le", sample_rate: 16000 },
      target_streaming_delay_ms: STREAMING_DELAY_MS,
      language: "en",
    };
    // Same word list the batch request sends: single words, at most 100.
    const contextBias = (keyterms || [])
      .flatMap((entry) => entry.trim().split(/\s+/))
      .filter(Boolean)
      .slice(0, 100);
    if (contextBias.length > 0) session.context_bias = contextBias;

    const url = `wss://api.mistral.ai/v1/audio/transcriptions/realtime?model=${encodeURIComponent(
      model || MISTRAL_REALTIME_MODEL
    )}`;
    const ws = new WebSocket(url, { headers: { Authorization: `Bearer ${apiKey}` } });
    this.ws = ws;

    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => fail(new Error("Mistral realtime connection timeout")),
        CONNECT_TIMEOUT_MS
      );
      const fail = (error) => {
        clearTimeout(timer);
        this.isConnecting = false;
        this.cleanup();
        reject(error);
      };
      ws.once("unexpected-response", (_req, res) =>
        fail(new Error(`Mistral realtime refused the connection (HTTP ${res.statusCode})`))
      );
      ws.on("open", () => ws.send(JSON.stringify({ type: "session.update", session })));
      ws.on("message", (data) => {
        const event = this._parse(data);
        if (event?.type === "session.updated" && this.isConnecting) {
          clearTimeout(timer);
          this.isConnecting = false;
          this.isConnected = true;
          debugLogger.debug("Mistral realtime connected", { contextBias: contextBias.length });
          this._flushColdStartBuffer();
          resolve();
          return;
        }
        if (event) this._handleEvent(event, fail);
      });
      // A socket this instance already closed must stay quiet.
      ws.on("error", (error) => {
        if (this.ws !== ws) return;
        if (this.isConnecting) return fail(error);
        debugLogger.warn("Mistral realtime socket error", { error: error.message });
        this._lose(error);
      });
      ws.on("close", (code) => {
        if (this.ws !== ws) return;
        if (this.isConnecting) return fail(new Error(`Mistral realtime closed (code ${code})`));
        const wasConnected = this.isConnected;
        this.isConnected = false;
        this._resolveFinal?.(null);
        // The server may close the socket after transcription.done; that is a normal end.
        if (wasConnected && !this.isDisconnecting && this.finalText === null) {
          debugLogger.debug("Mistral realtime closed", { code });
          this._lose(new Error(`Mistral realtime connection lost (code ${code})`));
        }
      });
    });
  }

  _parse(data) {
    try {
      return JSON.parse(data.toString());
    } catch {
      return null;
    }
  }

  _handleEvent(event, failConnect) {
    if (event.type === "transcription.text.delta") {
      this.text += event.text || "";
      this.onPartialTranscript?.(this.text);
      return;
    }
    if (event.type === "transcription.done") {
      this.finalText = (event.text ?? this.text).trim();
      this.onFinalTranscript?.(this.finalText);
      this._resolveFinal?.(this.finalText);
      return;
    }
    if (event.type === "error") {
      const error = new Error(event.error?.message || "Mistral realtime error");
      if (this.isConnecting) return failConnect(error);
      debugLogger.warn("Mistral realtime error event", {
        message: error.message,
        code: event.error?.code,
      });
      this._resolveFinal?.(null);
      this._lose(error);
    }
  }

  // The renderer fails over to the batch upload of the full recording on any
  // error, so a lost stream never ends the dictation.
  _lose(error) {
    if (this.isDisconnecting) return;
    this.onError?.(error);
  }

  _flushColdStartBuffer() {
    const buffered = this.coldStartBuffer;
    this.bufferingAudio = false;
    this.coldStartBuffer = [];
    this.coldStartBufferSize = 0;
    buffered.forEach((buf) => this._send(buf));
  }

  _send(pcmBuffer) {
    this.ws.send(
      JSON.stringify({ type: "input_audio.append", audio: pcmBuffer.toString("base64") })
    );
    this.audioBytesSent += pcmBuffer.length;
  }

  sendAudio(pcmBuffer) {
    if (this.isConnected && this.ws?.readyState === WebSocket.OPEN) {
      this._send(pcmBuffer);
      return true;
    }
    if (this.bufferingAudio && this.coldStartBufferSize < COLD_START_BUFFER_MAX) {
      const copy = Buffer.from(pcmBuffer);
      this.coldStartBuffer.push(copy);
      this.coldStartBufferSize += copy.length;
    }
    return false;
  }

  // Ends the audio stream and waits for the final text. Throws when the
  // stream cannot give one, so the caller uses the batch fallback instead.
  finalize() {
    this.finalPromise ??= this._finalize();
    return this.finalPromise;
  }

  async _finalize() {
    if (!this.isConnected || this.ws?.readyState !== WebSocket.OPEN) {
      throw new Error("Mistral realtime is not connected");
    }
    if (this.finalText !== null) return { text: this.finalText };
    const final = new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), FINAL_TIMEOUT_MS);
      this._resolveFinal = (text) => {
        clearTimeout(timer);
        this._resolveFinal = null;
        resolve(text);
      };
    });
    this.ws.send(JSON.stringify({ type: "input_audio.end" }));
    const text = await final;
    if (text === null) throw new Error("Mistral realtime gave no final transcript");
    return { text };
  }

  async disconnect() {
    this.isDisconnecting = true;
    const result = { text: this.finalText ?? "" };
    this.cleanup();
    this.isDisconnecting = false;
    return result;
  }

  cleanup() {
    this._resolveFinal?.(null);
    if (this.ws) {
      try {
        this.ws.close();
      } catch {}
      this.ws = null;
    }
    this.isConnected = false;
    this.bufferingAudio = false;
  }
}

module.exports = { MistralRealtimeStreaming, MISTRAL_REALTIME_MODEL };
