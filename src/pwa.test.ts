import { afterEach, describe, expect, it, vi } from "vitest";

import { checkForPwaUpdate } from "./pwaUpdate";

afterEach(() => vi.unstubAllGlobals());

function browserWith(registration: Partial<ServiceWorkerRegistration> | undefined, online = true) {
  const getRegistration = vi.fn(async () => registration as ServiceWorkerRegistration | undefined);
  vi.stubGlobal("navigator", { onLine: online, serviceWorker: { getRegistration } });
  vi.stubGlobal("window", {
    location: { origin: "https://example.test" },
    setTimeout,
    clearTimeout,
  });
  return getRegistration;
}

describe("manual PWA update checks", () => {
  it("does not attempt a network check while offline", async () => {
    const getRegistration = browserWith(undefined, false);
    expect(await checkForPwaUpdate()).toBe("offline");
    expect(getRegistration).not.toHaveBeenCalled();
  });

  it("reports the current version when update finds no worker", async () => {
    const registration = { waiting: null, installing: null } as unknown as ServiceWorkerRegistration;
    const update = vi.fn(async () => registration);
    browserWith({ update, waiting: null, installing: null });
    expect(await checkForPwaUpdate()).toBe("current");
    expect(update).toHaveBeenCalledOnce();
  });

  it("reports an installed waiting worker as available", async () => {
    const waiting = {} as ServiceWorker;
    const registration = { waiting, installing: null } as unknown as ServiceWorkerRegistration;
    const update = vi.fn(async () => registration);
    browserWith({ update, waiting, installing: null });
    expect(await checkForPwaUpdate()).toBe("available");
  });
});
