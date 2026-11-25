import type { SpeechLocale } from "./recognition";
import { findEnglishClip, playEnglishClip } from "./englishAudio";
import { pickBestVoice } from "./voiceSelection";

const MIN_COMPLETION_TIMEOUT_MS = 2_500;
const MAX_COMPLETION_TIMEOUT_MS = 10_000;
const MAX_DIAGNOSTICS = 40;
const DIAGNOSTICS_KEY = "english-srs-tts-diagnostics-v1";
const TIMEOUT_RECOVERY_MS = 150;

export type SpeechSource = "answer" | "prompt" | "replay" | "diagnostic";
export type SpeechPlaybackEvent = {
  kind: "requested" | "queued" | "dispatched" | "started" | "ended" | "error" | "timeout" | "cancelled";
  at: number;
  detail?: string;
};
export type SpeechPlaybackDiagnostic = {
  id: string;
  requestedAt: number;
  locale: SpeechLocale;
  source: SpeechSource;
  textLength: number;
  voiceName: string | null;
  events: SpeechPlaybackEvent[];
};
export type SelectedVoice = { name: string; lang: string; localService: boolean } | null;

type SpeechRequest = {
  text: string;
  locale: SpeechLocale;
  record: SpeechPlaybackDiagnostic;
  resolve: (voice: SelectedVoice) => void;
  reject: (error: Error) => void;
};

let sequence = 0;
let active: SpeechRequest | null = null;
let stopActive: (() => void) | null = null;
let recoveryTimer: number | null = null;
const pending: SpeechRequest[] = [];
let subscribedSynthesis: SpeechSynthesis | null = null;
let cachedVoices: SpeechSynthesisVoice[] = [];
let historyLoaded = false;
let history: SpeechPlaybackDiagnostic[] = [];

export function speechCompletionTimeoutMs(text: string): number {
  return Math.min(MAX_COMPLETION_TIMEOUT_MS, Math.max(MIN_COMPLETION_TIMEOUT_MS, 1_500 + text.length * 120));
}

function loadHistory() {
  if (historyLoaded) return;
  historyLoaded = true;
  try {
    const saved = JSON.parse(window.localStorage?.getItem(DIAGNOSTICS_KEY) ?? "[]") as unknown;
    if (Array.isArray(saved)) {
      history = saved.filter((item): item is SpeechPlaybackDiagnostic =>
        item !== null && typeof item === "object" && typeof item.id === "string" && Array.isArray(item.events),
      ).slice(-MAX_DIAGNOSTICS);
    }
  } catch {
    // Diagnostics must never interfere with learning (e.g. private browsing or disabled storage).
  }
}

function recordEvent(record: SpeechPlaybackDiagnostic, kind: SpeechPlaybackEvent["kind"], detail?: string) {
  loadHistory();
  if (!history.includes(record)) {
    history.push(record);
    if (history.length > MAX_DIAGNOSTICS) history.shift();
  }
  record.events.push({ kind, at: Date.now(), ...(detail ? { detail } : {}) });
  try {
    window.localStorage?.setItem(DIAGNOSTICS_KEY, JSON.stringify(history));
  } catch {
    // Keep the in-memory history even when persistent storage is unavailable.
  }
}

/** Last 40 TTS requests, including real onstart/onend/error/timeout events. No word text is stored. */
export function getSpeechPlaybackDiagnostics(): SpeechPlaybackDiagnostic[] {
  loadHistory();
  return history.map((item) => ({ ...item, events: item.events.map((event) => ({ ...event })) }));
}

/** Populate voice selection early, without delaying playback or requiring a user gesture. */
export function prepareSpeechSynthesis() {
  if (!("speechSynthesis" in window)) return;
  const synthesis = window.speechSynthesis;
  if (subscribedSynthesis !== synthesis) {
    subscribedSynthesis = synthesis;
    cachedVoices = [];
    synthesis.addEventListener?.("voiceschanged", () => {
      if (subscribedSynthesis === synthesis) cachedVoices = synthesis.getVoices();
    });
  }
  const voices = synthesis.getVoices();
  if (voices.length) cachedVoices = voices;
}

function playRecording(request: SpeechRequest, clip: NonNullable<ReturnType<typeof findEnglishClip>>) {
  const controller = new AbortController();
  const voice = { name: "Kokoro · af_heart", lang: "en-US", localService: true };
  request.record.voiceName = voice.name;
  const finish = (kind: "ended" | "cancelled" | "error" | "timeout", error?: Error) => {
    if (active !== request) return;
    window.clearTimeout(timer);
    active = null;
    stopActive = null;
    controller.abort();
    recordEvent(request.record, kind, error?.message);
    if (error) request.reject(error);
    else request.resolve(kind === "ended" ? voice : null);
    queueMicrotask(playNext);
  };
  const timer = window.setTimeout(() => finish("timeout", new Error("english-audio-timeout")), MAX_COMPLETION_TIMEOUT_MS);
  stopActive = () => finish("cancelled");
  recordEvent(request.record, "dispatched");
  void playEnglishClip(clip, controller.signal, () => recordEvent(request.record, "started"))
    .then(() => finish("ended"), (error: unknown) => finish("error", error instanceof Error ? error : new Error(String(error))));
}

function playNext() {
  if (active || recoveryTimer !== null || pending.length === 0) return;
  const request = pending.shift()!;
  active = request;

  const clip = request.locale === "en-US" && findEnglishClip(request.text);
  if (clip) {
    playRecording(request, clip);
    return;
  }
  if (!window.speechSynthesis) {
    active = null;
    const error = new Error("speech-synthesis-not-supported");
    recordEvent(request.record, "error", error.message);
    request.reject(error);
    queueMicrotask(playNext);
    return;
  }
  const synthesis = window.speechSynthesis;
  prepareSpeechSynthesis();
  const voice = pickBestVoice(cachedVoices, request.locale);
  const selectedVoice: SelectedVoice = voice
    ? { name: voice.name, lang: voice.lang, localService: voice.localService }
    : null;
  request.record.voiceName = selectedVoice?.name ?? null;

  let utterance: SpeechSynthesisUtterance;
  try {
    utterance = new SpeechSynthesisUtterance(request.text);
    utterance.lang = request.locale;
    utterance.rate = 0.9;
    if (voice) utterance.voice = voice;
  } catch (error) {
    active = null;
    recordEvent(request.record, "error", String(error));
    request.reject(error instanceof Error ? error : new Error(String(error)));
    queueMicrotask(playNext);
    return;
  }

  let completed = false;
  let timeout: number | undefined;
  const finish = (kind: "ended" | "error" | "timeout" | "cancelled", error?: Error) => {
    if (completed) return;
    completed = true;
    if (timeout !== undefined) window.clearTimeout(timeout);
    utterance.onstart = null;
    utterance.onend = null;
    utterance.onerror = null;
    stopActive = null;
    active = null;
    recordEvent(request.record, kind, error?.message);

    if (kind === "ended") request.resolve(selectedVoice);
    else if (kind === "cancelled") request.resolve(null);
    else request.reject(error ?? new Error("speech-synthesis-" + kind));

    if (kind === "timeout") {
      // Only reset WebKit when it has actually become stuck. Do not cancel every new word.
      try { synthesis.cancel(); } catch { /* Already stopped. */ }
      recoveryTimer = window.setTimeout(() => {
        recoveryTimer = null;
        playNext();
      }, TIMEOUT_RECOVERY_MS);
    } else {
      queueMicrotask(playNext);
    }
  };

  stopActive = () => {
    finish("cancelled");
    try { synthesis.cancel(); } catch { /* Already stopped. */ }
  };
  utterance.onstart = () => recordEvent(request.record, "started");
  utterance.onend = () => finish("ended");
  utterance.onerror = (event) => finish("error", new Error(event.error || "speech-synthesis-error"));
  timeout = window.setTimeout(
    () => finish("timeout", new Error("speech-synthesis-timeout")),
    speechCompletionTimeoutMs(request.text),
  );
  recordEvent(request.record, "dispatched");
  try {
    if (synthesis.paused) synthesis.resume();
    synthesis.speak(utterance);
  } catch (error) {
    finish("error", error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * Speech is serialized rather than cancelled between cards. Callers may move the UI on
 * without waiting: a following audio question plays only after the previous answer finishes.
 */
export function speak(text: string, locale: SpeechLocale, options: { source?: SpeechSource } = {}): Promise<SelectedVoice> {
  const record: SpeechPlaybackDiagnostic = {
    id: Date.now() + "-" + (++sequence),
    requestedAt: Date.now(),
    locale,
    source: options.source ?? "answer",
    textLength: text.length,
    voiceName: null,
    events: [],
  };
  return new Promise<SelectedVoice>((resolve, reject) => {
    const queued = active !== null || pending.length !== 0 || recoveryTimer !== null;
    pending.push({ text, locale, record, resolve, reject });
    recordEvent(record, "requested");
    if (queued) recordEvent(record, "queued");
    playNext();
  });
}

/** Cancel queued or active audio when leaving the study screen; cancellation never counts as an error. */
export function cancelSpeech() {
  if (recoveryTimer !== null) {
    window.clearTimeout(recoveryTimer);
    recoveryTimer = null;
  }
  for (const request of pending.splice(0)) {
    recordEvent(request.record, "cancelled");
    request.resolve(null);
  }
  stopActive?.();
}
