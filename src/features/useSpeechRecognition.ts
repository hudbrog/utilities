import { useCallback, useEffect, useRef, useState } from "react";
import { RecognitionError, startListening, type ListenOptions, type RecognitionPhase, type RecognitionSession, type SpeechLocale } from "../infrastructure/speech/recognition";

export function useSpeechRecognition() {
  const [phase, setPhase] = useState<RecognitionPhase | "idle">("idle");
  const active = useRef<RecognitionSession | null>(null);

  useEffect(() => () => {
    const session = active.current;
    active.current = null;
    session?.cancel();
  }, []);

  const listen = useCallback(async (locale: SpeechLocale, options: Omit<ListenOptions, "onPhaseChange">) => {
    if (active.current) throw new RecognitionError("already-listening");
    const session = startListening(locale, { ...options, onPhaseChange: setPhase });
    active.current = session;
    try {
      const outcome = await session.result;
      if (active.current !== session) throw new RecognitionError("aborted");
      return outcome;
    } finally {
      if (active.current === session) {
        active.current = null;
        setPhase("idle");
      }
    }
  }, []);

  const stop = useCallback(() => active.current?.stop(), []);
  return { phase, listen, stop };
}
