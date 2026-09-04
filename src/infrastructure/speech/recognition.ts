export type SpeechLocale = "ru-RU" | "en-US";

export type RecognitionAlternative = {
  transcript: string;
  confidence: number;
};

export type RecognitionOutcome = {
  alternatives: RecognitionAlternative[];
  localOnlyApplied: boolean;
};

export class RecognitionError extends Error {
  constructor(
    public readonly code: string,
    message?: string,
  ) {
    super(message || code);
    this.name = "RecognitionError";
  }
}

export function getRecognitionConstructor() {
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
}

export function hasLocalRecognitionApi() {
  const Recognition = getRecognitionConstructor();
  if (!Recognition) return false;
  const instance = new Recognition();
  return (
    "processLocally" in instance &&
    typeof Recognition.available === "function" &&
    typeof Recognition.install === "function"
  );
}

export async function checkLocalAvailability(locale: SpeechLocale) {
  const Recognition = getRecognitionConstructor();
  if (!Recognition?.available) return null;
  return Recognition.available({ langs: [locale], processLocally: true });
}

export async function installLocalLanguage(locale: SpeechLocale) {
  const Recognition = getRecognitionConstructor();
  if (!Recognition?.install) return null;
  return Recognition.install({ langs: [locale], processLocally: true });
}

export type RecognitionPhase = "starting" | "listening" | "processing";

export type ListenOptions = {
  localOnly: boolean;
  timeoutMs?: number;
  onPhaseChange?: (phase: RecognitionPhase) => void;
};

export type RecognitionSession = {
  result: Promise<RecognitionOutcome>;
  /** Finish capture and ask the recognizer for the recorded answer. */
  stop: () => void;
  /** Discard the answer and release the microphone. */
  cancel: () => void;
};

export function startListening(locale: SpeechLocale, options: ListenOptions): RecognitionSession {
  let stop = () => {};
  let cancel = () => {};
  const result = new Promise<RecognitionOutcome>((resolve, reject) => {
    const Recognition = getRecognitionConstructor();
    if (!Recognition) {
      reject(new RecognitionError("not-supported"));
      return;
    }
    const recognition = new Recognition();
    const supportsLocalOnly = "processLocally" in recognition;
    recognition.lang = locale;
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 5;
    if (supportsLocalOnly && options.localOnly) recognition.processLocally = true;
    let settled = false;
    let stopping = false;
    const alternatives: RecognitionAlternative[] = [];
    let timeout: number;
    const finish = (complete: () => void) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      recognition.onstart = null;
      recognition.onaudioend = null;
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      complete();
    };

    const abort = () => {
      try { recognition.abort(); } catch { /* Already stopped by the browser. */ }
    };
    cancel = () => {
      if (settled) return;
      finish(() => reject(new RecognitionError("aborted")));
      abort();
    };
    stop = () => {
      if (settled || stopping) return;
      stopping = true;
      options.onPhaseChange?.("processing");
      try {
        recognition.stop();
      } catch (error) {
        finish(() => reject(error));
        abort();
      }
    };
    timeout = window.setTimeout(() => {
      finish(() => reject(new RecognitionError("timeout", "Распознавание не завершилось вовремя")));
      abort();
    }, options.timeoutMs ?? 15_000);

    const completeResult = () => {
      const unique = alternatives.filter(
        (item, index, all) => item.transcript && all.findIndex((candidate) => candidate.transcript === item.transcript) === index,
      );
      finish(() => {
        if (unique.length === 0) reject(new RecognitionError("no-result"));
        else resolve({ alternatives: unique, localOnlyApplied: supportsLocalOnly && options.localOnly });
      });
    };

    recognition.onstart = () => {
      if (!settled && !stopping) options.onPhaseChange?.("listening");
    };
    recognition.onaudioend = () => {
      if (!settled) options.onPhaseChange?.("processing");
    };
    recognition.onresult = (event) => {
      if (settled) return;
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results.item(i);
        if (!result.isFinal) continue;
        for (let j = 0; j < result.length; j += 1) {
          const item = result.item(j);
          alternatives.push({ transcript: item.transcript.trim(), confidence: item.confidence });
        }
      }
      if (alternatives.length > 0) {
        // One-shot recognition has a single final result. Do not wait for onend.
        const needsStop = !stopping;
        completeResult();
        if (needsStop) {
          try { recognition.stop(); } catch { abort(); }
        }
      }
    };

    recognition.onerror = (event) => {
      finish(() => reject(new RecognitionError(event.error, event.message)));
    };

    recognition.onend = completeResult;

    try {
      options.onPhaseChange?.("starting");
      recognition.start();
    } catch (error) {
      finish(() => reject(error));
    }
  });
  return { result, stop: () => stop(), cancel: () => cancel() };
}

export function listenOnce(locale: SpeechLocale, options: ListenOptions): Promise<RecognitionOutcome> {
  return startListening(locale, options).result;
}
