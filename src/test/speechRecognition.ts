import { vi } from "vitest";

export class FakeRecognition {
  static instances: FakeRecognition[] = [];
  static autoStart = true;
  lang = "";
  continuous = true;
  interimResults = true;
  maxAlternatives = 1;
  processLocally = false;
  onstart: (() => void) | null = null;
  onaudioend: (() => void) | null = null;
  onend: (() => void) | null = null;
  onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null = null;
  onerror: ((event: BrowserSpeechRecognitionErrorEvent) => void) | null = null;
  start = vi.fn(() => { if (FakeRecognition.autoStart) this.onstart?.(); });
  stop = vi.fn();
  abort = vi.fn(() => { this.error("aborted"); this.onend?.(); });

  constructor() { FakeRecognition.instances.push(this); }

  static reset() { FakeRecognition.instances = []; FakeRecognition.autoStart = true; }
  static get latest() { return FakeRecognition.instances.at(-1)!; }

  result(transcripts: string[], isFinal = true) {
    this.onresult?.(recognitionEvent(transcripts, isFinal));
  }

  error(code: string) {
    this.onerror?.(Object.assign(new Event("error"), { error: code, message: code }));
  }
}

export function recognitionEvent(transcripts: string[], isFinal = true): BrowserSpeechRecognitionEvent {
  return Object.assign(new Event("result"), {
    resultIndex: 0,
    results: {
      length: 1,
      item: () => ({ isFinal, length: transcripts.length, item: (index: number) => ({ transcript: transcripts[index], confidence: 0.9 }) }),
    },
  });
}
