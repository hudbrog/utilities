import type { DirectionState } from "../scheduler/model";
import { createSeededRandom } from "../random";

export type ExerciseType = "mc_text" | "stt_text" | "mc_audio" | "stt_audio";

export type ExerciseCapabilities = {
  speechRecognitionAvailable: boolean;
  listeningAudioUnlocked: boolean;
};

export function selectExerciseType(
  state: DirectionState,
  capabilities: ExerciseCapabilities,
  seed: string,
): ExerciseType {
  const canUseStt = capabilities.speechRecognitionAvailable && !state.sttProblematic;

  if (state.stage <= 1) return "mc_text";
  if (state.stage <= 4) return canUseStt ? "stt_text" : "mc_text";

  if (!capabilities.listeningAudioUnlocked) return canUseStt ? "stt_text" : "mc_text";

  const useAudio = createSeededRandom(seed)() < 0.3;
  if (canUseStt) return useAudio ? "stt_audio" : "stt_text";
  return useAudio ? "mc_audio" : "mc_text";
}
