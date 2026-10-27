export interface Config {
  owner: string;
  ai: { enabled: boolean; model: string | null };
  voice: { enabled: boolean; retainAudio: boolean; locale: string; presentation: string };
  identity: { enrollmentEnabled: boolean };
  visuals: { reducedMotion: boolean };
  permissions: { allowedRoots: string[]; writesEnabled: boolean };
  google: { enabled: boolean };
  memory: { enabled: boolean };
  automation: { enabled: boolean };
  budget: { monthlyLimitUsd: number };
  developer: { diagnostics: boolean };
}

export const defaults: Config = {
  owner: 'Owner',
  ai: { enabled: false, model: null },
  voice: { enabled: false, retainAudio: false, locale: 'en-AU', presentation: 'female' },
  identity: { enrollmentEnabled: false },
  visuals: { reducedMotion: false },
  permissions: { allowedRoots: [], writesEnabled: false },
  google: { enabled: false },
  memory: { enabled: false },
  automation: { enabled: false },
  budget: { monthlyLimitUsd: 0 },
  developer: { diagnostics: false }
};

export function validateConfig(value: unknown): Config {
  function check(actual: any, expected: any, path: string): void {
    if (expected === null) {
      if (actual !== null && (typeof actual !== 'string' || !actual.trim())) throw new Error(`Invalid config: ${path}`);
    } else if (Array.isArray(expected)) {
      if (!Array.isArray(actual) || actual.some(v => typeof v !== 'string' || !v.trim())) throw new Error(`Invalid config: ${path}`);
    } else if (typeof expected === 'object') {
      if (!actual || typeof actual !== 'object' || Array.isArray(actual)) throw new Error(`Invalid config: ${path}`);
      if (Object.keys(actual).some(k => !Object.hasOwn(expected, k))) throw new Error(`Unknown config field: ${path}`);
      for (const key of Object.keys(expected)) check(actual[key], expected[key], `${path}.${key}`);
    } else if (typeof actual !== typeof expected || (typeof actual === 'number' && (!Number.isFinite(actual) || actual < 0)) || (typeof actual === 'string' && !actual.trim())) {
      throw new Error(`Invalid config: ${path}`);
    }
  }
  check(value, defaults, 'config');
  return structuredClone(value) as Config;
}
