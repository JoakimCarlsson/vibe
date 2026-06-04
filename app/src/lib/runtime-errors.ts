declare function require(name: string): {
  enable?: (options: {
    allRejections: boolean;
    onUnhandled: (id: number, error: unknown) => void;
    onHandled: (id: number) => void;
  }) => void;
};

type GlobalHandler = (error: unknown, isFatal?: boolean) => void;

declare const globalThis: {
  ErrorUtils?: {
    getGlobalHandler?: () => GlobalHandler;
    setGlobalHandler?: (handler: GlobalHandler) => void;
  };
};

type Handler = (report: string) => void;

let activeHandler: Handler | null = null;
let trackingEnabled = false;

function toReport(value: unknown): string {
  if (value instanceof Error) {
    const stack = (value.stack ?? '').split('\n').slice(0, 6).join('\n').trim();
    return stack && !stack.startsWith(value.message) ? `${value.message}\n\n${stack}` : value.message;
  }
  if (value && typeof value === 'object') {
    const message = (value as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return String(value);
}

function enableRejectionTrackingOnce() {
  if (trackingEnabled) return;
  try {
    const tracking = require('promise/setimmediate/rejection-tracking');
    tracking.enable?.({
      allRejections: true,
      onUnhandled: (_id, error) => activeHandler?.(toReport(error)),
      onHandled: () => {},
    });
    trackingEnabled = true;
  } catch {
    // promise rejection tracking is best-effort; the ErrorUtils handler still applies
  }
}

/**
 * Traps runtime errors the React error boundary cannot see: synchronous
 * uncaught errors and unhandled promise rejections (e.g. failing async event
 * handlers). Routes them to onError. Returns a cleanup that stops routing and
 * restores the previous global handler.
 */
export function installRuntimeErrorTrap(onError: Handler): () => void {
  activeHandler = onError;
  enableRejectionTrackingOnce();

  let restore = () => {};
  const eu = globalThis.ErrorUtils;
  if (eu?.getGlobalHandler && eu.setGlobalHandler) {
    const previous = eu.getGlobalHandler();
    eu.setGlobalHandler((error, isFatal) => {
      activeHandler?.(toReport(error));
      previous?.(error, isFatal);
    });
    restore = () => eu.setGlobalHandler?.(previous);
  }

  return () => {
    activeHandler = null;
    restore();
  };
}
