import { readFile } from "node:fs/promises";
import { isMain } from "./mcp-agent-pilot-lib.mjs";

export function validateGitHubReleaseState(
  value,
  { tag, prerelease, expectedAssets, allowMissing = false },
) {
  const errors = [];
  if (!isRecord(value)) return ["GitHub release state must be an object"];

  if (value.tagName !== tag) {
    errors.push(`GitHub release tag must be ${tag}`);
  }
  if (value.isDraft !== false) {
    errors.push("GitHub release must be public, not a draft");
  }
  if (value.isPrerelease !== prerelease) {
    errors.push(
      `GitHub release prerelease state must be ${String(prerelease)}`,
    );
  }

  const expected = validateAssetNames(expectedAssets, "expected", errors);
  if (!Array.isArray(value.assets)) {
    errors.push("GitHub release assets must be an array");
    return errors;
  }

  const actualNames = [];
  for (const asset of value.assets) {
    if (!isRecord(asset) || !validAssetName(asset.name)) {
      errors.push("GitHub release asset names must be non-empty basenames");
      continue;
    }
    actualNames.push(asset.name);
  }

  const actual = new Set(actualNames);
  if (actual.size !== actualNames.length) {
    errors.push("GitHub release assets must not contain duplicate names");
  }

  const unexpected = [...actual].filter((name) => !expected.has(name)).sort();
  if (unexpected.length > 0) {
    errors.push(
      `GitHub release has unexpected assets: ${unexpected.join(", ")}`,
    );
  }
  if (!allowMissing) {
    const missing = [...expected].filter((name) => !actual.has(name)).sort();
    if (missing.length > 0) {
      errors.push(`GitHub release is missing assets: ${missing.join(", ")}`);
    }
  }

  return errors;
}

if (isMain(import.meta.url)) {
  const [, , statePath, tag, prereleaseText, mode, ...expectedAssets] =
    process.argv;
  const usage =
    "usage: check-github-release-state.mjs <state.json> <tag> <true|false> <allow-missing|complete> <asset>...";

  if (
    !statePath ||
    !tag ||
    !["true", "false"].includes(prereleaseText) ||
    !["allow-missing", "complete"].includes(mode) ||
    expectedAssets.length === 0
  ) {
    console.error(usage);
    process.exit(1);
  }

  let state;
  try {
    state = JSON.parse(await readFile(statePath, "utf8"));
  } catch (error) {
    console.error(`could not read GitHub release state: ${error.message}`);
    process.exit(1);
  }

  const errors = validateGitHubReleaseState(state, {
    tag,
    prerelease: prereleaseText === "true",
    expectedAssets,
    allowMissing: mode === "allow-missing",
  });
  if (errors.length > 0) {
    console.error(errors.join("\n"));
    process.exit(1);
  }
  console.log(`GitHub release state is ${mode}`);
}

function validateAssetNames(names, label, errors) {
  if (!Array.isArray(names) || names.length === 0) {
    errors.push(`${label} GitHub release assets must be a non-empty array`);
    return new Set();
  }
  if (names.some((name) => !validAssetName(name))) {
    errors.push(
      `${label} GitHub release asset names must be non-empty basenames`,
    );
  }
  const unique = new Set(names);
  if (unique.size !== names.length) {
    errors.push(`${label} GitHub release assets must not contain duplicates`);
  }
  return unique;
}

function validAssetName(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value !== "." &&
    value !== ".." &&
    !value.includes("/") &&
    !value.includes("\\")
  );
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
