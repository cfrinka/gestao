import { AsyncLocalStorage } from "async_hooks";

interface DemoContextValue {
  sessionId: string;
}

const storage = new AsyncLocalStorage<DemoContextValue>();

export const demoContext = {
  run<T>(value: DemoContextValue, callback: () => T): T {
    return storage.run(value, callback);
  },
};

export function getDemoSessionId(): string | null {
  return storage.getStore()?.sessionId ?? null;
}
