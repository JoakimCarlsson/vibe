import React from 'react';
import * as ReactNative from 'react-native';
import * as JSXRuntime from 'react/jsx-runtime';

import { evaluateBytecode } from '../../modules/vibe-hermes';

declare const globalThis: {
  __vibeRequire?: (name: string) => unknown;
  __VIBE_APP?: React.ComponentType;
};

const modules: Record<string, unknown> = {
  react: React,
  'react-native': ReactNative,
  'react/jsx-runtime': JSXRuntime,
};

globalThis.__vibeRequire = (name: string) => {
  const mod = modules[name];
  if (!mod) {
    throw new Error(`Module "${name}" is not available in the shell`);
  }
  return mod;
};

/**
 * Evaluates a base64-encoded Hermes bytecode bundle on the device's runtime
 * and returns the component it assigns to globalThis.__VIBE_APP.
 */
export function loadGeneratedComponent(hbcBase64: string): React.ComponentType {
  globalThis.__VIBE_APP = undefined;
  evaluateBytecode(hbcBase64);

  const exported = globalThis.__VIBE_APP;
  if (typeof exported !== 'function') {
    throw new Error('Bytecode did not assign a component to __VIBE_APP');
  }
  return exported;
}
