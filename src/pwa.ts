import { registerSW } from "virtual:pwa-register";

export type PwaCallbacks = {
  onOfflineReady: () => void;
  onNeedRefresh: () => void;
  onRegistrationError: (error: Error) => void;
};

export function registerPwa(callbacks: PwaCallbacks) {
  return registerSW({
    immediate: true,
    onOfflineReady: callbacks.onOfflineReady,
    onNeedRefresh: callbacks.onNeedRefresh,
    onRegisterError: callbacks.onRegistrationError,
  });
}
