import assert from "node:assert/strict";
import test from "node:test";
import { validateGitHubReleaseState } from "./check-github-release-state.mjs";

const options = {
  tag: "timeline-v0.0.0-alpha.3",
  prerelease: true,
  expectedAssets: ["timeline.tgz", "timeline.tgz.sha256", "timeline.spdx.json"],
};

test("accepts an exact public GitHub release", () => {
  assert.deepEqual(validateGitHubReleaseState(state(), options), []);
});

test("allows expected assets to be missing only before reconciliation", () => {
  const value = state({ assets: [{ name: "timeline.tgz" }] });
  assert.deepEqual(
    validateGitHubReleaseState(value, { ...options, allowMissing: true }),
    [],
  );
  assert.match(
    validateGitHubReleaseState(value, options).join("\n"),
    /missing assets/,
  );
});

test("rejects draft, mismatched, and malformed releases", () => {
  assert.match(
    validateGitHubReleaseState(state({ isDraft: true }), options).join("\n"),
    /must be public/,
  );
  assert.match(
    validateGitHubReleaseState(state({ isPrerelease: false }), options).join(
      "\n",
    ),
    /prerelease state/,
  );
  assert.match(
    validateGitHubReleaseState(state({ tagName: "wrong" }), options).join("\n"),
    /release tag/,
  );
  assert.match(
    validateGitHubReleaseState(null, options).join("\n"),
    /must be an object/,
  );
});

test("rejects unexpected and duplicate assets before upload", () => {
  const unexpected = state({
    assets: [...state().assets, { name: "unreviewed.txt" }],
  });
  assert.match(
    validateGitHubReleaseState(unexpected, {
      ...options,
      allowMissing: true,
    }).join("\n"),
    /unexpected assets: unreviewed\.txt/,
  );

  const duplicate = state({
    assets: [...state().assets, { name: "timeline.tgz" }],
  });
  assert.match(
    validateGitHubReleaseState(duplicate, options).join("\n"),
    /duplicate names/,
  );
});

test("rejects non-portable asset names", () => {
  assert.match(
    validateGitHubReleaseState(state(), {
      ...options,
      expectedAssets: ["/tmp/timeline.tgz"],
    }).join("\n"),
    /non-empty basenames/,
  );
  assert.match(
    validateGitHubReleaseState(
      state({ assets: [{ name: "nested/timeline.tgz" }] }),
      { ...options, allowMissing: true },
    ).join("\n"),
    /non-empty basenames/,
  );
});

function state(overrides = {}) {
  return {
    tagName: options.tag,
    isDraft: false,
    isPrerelease: true,
    assets: options.expectedAssets.map((name) => ({ name })),
    ...overrides,
  };
}
