import { requireNativeModule } from 'expo-modules-core';

const native = requireNativeModule('VibeHermes');

declare const globalThis: {
  __vibeEvalBytecode?: (base64: string) => void;
};

/**
 * Installs the global.__vibeEvalBytecode JSI binding. Idempotent; call once
 * before evaluating any bytecode.
 */
export function install(): void {
  native.install();
}

/**
 * Evaluates a base64-encoded Hermes bytecode bundle on the JS runtime. The
 * bundle is expected to assign its component to globalThis.__VIBE_APP.
 */
export function evaluateBytecode(base64: string): void {
  if (!globalThis.__vibeEvalBytecode) {
    install();
  }
  globalThis.__vibeEvalBytecode!(base64);
}
