import { registerSW } from "virtual:pwa-register";

export type PwaCallbacks = {
  onOfflineReady: () => void;
  onNeedRefresh: () => void;
  onRegistrationError: (error: Error) => void;
};

// A failed precache leaves no active worker on a new device. Retry the same
// registration so Workbox can reuse files already downloaded on this install.
function recoverFirstInstall(url: string, initial?: ServiceWorkerRegistration) {
  if (!initial || initial.active) return;
  let ready = false;
  let delay = 2_000;
  let timer: number | undefined;
  function schedule() {
    if (ready || timer !== undefined || !navigator.onLine) return;
    timer = window.setTimeout(retry, delay);
    delay = Math.min(delay * 2, 60_000);
  }

  async function retry() {
    window.clearTimeout(timer);
    timer = undefined;
    if (ready || !navigator.onLine) return;
    try {
      const registration = await navigator.serviceWorker.getRegistration(url);
      if (!registration) await navigator.serviceWorker.register(url);
      else if (!registration.active && !registration.installing && !registration.waiting) await registration.update();
    } catch {
      // Keep the partial precache and retry once the connection is usable.
    } finally {
      schedule();
    }
  }

  schedule();
  window.addEventListener("online", retry);
  void navigator.serviceWorker.ready.then(() => {
    ready = true;
    window.clearTimeout(timer);
    window.removeEventListener("online", retry);
  });
}

export function registerPwa(callbacks: PwaCallbacks) {
  return registerSW({
    immediate: true,
    onOfflineReady: callbacks.onOfflineReady,
    onNeedRefresh: callbacks.onNeedRefresh,
    onRegisteredSW: recoverFirstInstall,
    onRegisterError: callbacks.onRegistrationError,
  });
}
