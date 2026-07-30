const PASSTHROUGH_KEYS = [
  "PATH",
  "Path",
  "PATHEXT",
  "SystemRoot",
  "SYSTEMROOT",
  "COMSPEC",
  "ComSpec",
  "WINDIR",
  "LANG",
  "LC_ALL",
];

const OVERRIDE_KEYS = new Set([
  "HOME",
  "USERPROFILE",
  "TMPDIR",
  "TMP",
  "TEMP",
  "NPM_CONFIG_USERCONFIG",
  "NPM_CONFIG_GLOBALCONFIG",
  "NPM_CONFIG_CACHE",
  "NPM_CONFIG_REGISTRY",
]);

export function createIsolatedEnvironment(source, overrides = {}) {
  const environment = {};
  for (const key of PASSTHROUGH_KEYS) {
    if (source[key] !== undefined) {
      environment[key] = source[key];
    }
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (!OVERRIDE_KEYS.has(key)) {
      throw new Error(`unsupported isolated environment key ${key}`);
    }
    environment[key] = value;
  }
  environment.NO_UPDATE_NOTIFIER = "1";
  return environment;
}
