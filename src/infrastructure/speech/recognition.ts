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

export function listenOnce(
  locale: SpeechLocale,
  options: { localOnly: boolean; timeoutMs?: number },
): Promise<RecognitionOutcome> {
  const Recognition = getRecognitionConstructor();
  if (!Recognition) {
    return Promise.reject(new RecognitionError("not-supported"));
  }

  const recognition = new Recognition();
  const supportsLocalOnly = "processLocally" in recognition;
  recognition.lang = locale;
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.maxAlternatives = 5;
  if (supportsLocalOnly && options.localOnly) recognition.processLocally = true;

  return new Promise((resolve, reject) => {
    let settled = false;
    const alternatives: RecognitionAlternative[] = [];
    const timeout = window.setTimeout(() => {
      recognition.abort();
      finish(() => reject(new RecognitionError("timeout", "Распознавание не завершилось вовремя")));
    }, options.timeoutMs ?? 15_000);

    const finish = (complete: () => void) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      complete();
    };

    recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results.item(i);
        if (!result.isFinal) continue;
        for (let j = 0; j < result.length; j += 1) {
          const item = result.item(j);
          alternatives.push({ transcript: item.transcript.trim(), confidence: item.confidence });
        }
      }
    };

    recognition.onerror = (event) => {
      finish(() => reject(new RecognitionError(event.error, event.message)));
    };

    recognition.onend = () => {
      finish(() => {
        const unique = alternatives.filter(
          (item, index, all) => all.findIndex((candidate) => candidate.transcript === item.transcript) === index,
        );
        if (unique.length === 0) reject(new RecognitionError("no-result"));
        else resolve({ alternatives: unique, localOnlyApplied: supportsLocalOnly && options.localOnly });
      });
    };

    try {
      recognition.start();
    } catch (error) {
      finish(() => reject(error));
    }
  });
}
