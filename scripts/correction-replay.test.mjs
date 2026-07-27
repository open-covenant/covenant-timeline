import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { evaluateCorrectionReplay } from "../examples/correction-replay.mjs";
import { canonicalJson, parseJson } from "../packages/prototype/dist/index.js";

test("correction replay preserves and verifies each selected cut", async () => {
  const replay = await evaluateCorrectionReplay();

  assert.equal(replay.schema, "covenant.timeline.correction-replay.v1");
  assert.deepEqual(
    replay.cuts.map(({ name, recordedThrough, conclusion, verified }) => ({
      name,
      recordedThrough,
      result: conclusion.result,
      verified,
    })),
    [
      {
        name: "before",
        recordedThrough: 3,
        result: {
          type: "difference.bounds",
          status: "bounded",
          minimum: -100,
          maximum: -100,
        },
        verified: true,
      },
      {
        name: "transition",
        recordedThrough: 4,
        result: {
          type: "difference.bounds",
          status: "inconsistent",
          minimum: null,
          maximum: null,
        },
        verified: true,
      },
      {
        name: "after",
        recordedThrough: 5,
        result: {
          type: "difference.bounds",
          status: "bounded",
          minimum: 100,
          maximum: 100,
        },
        verified: true,
      },
    ],
  );

  const beforeSources = proofSources(replay.cuts[0].conclusion);
  const transitionSources = proofSources(replay.cuts[1].conclusion);
  const afterSources = proofSources(replay.cuts[2].conclusion);
  assert.deepEqual(beforeSources, new Set(["deploy.v1", "review.v1"]));
  assert.deepEqual(transitionSources, new Set(["review.v1", "review.v2"]));
  assert.deepEqual(afterSources, new Set(["deploy.v1", "review.v2"]));
});

test("public receipt examples match the checked conclusion fixture", async () => {
  const replay = await evaluateCorrectionReplay();
  const expected = replay.cuts[2].conclusion;

  for (const path of [
    new URL("../README.md", import.meta.url),
    new URL("../packages/prototype/README.md", import.meta.url),
  ]) {
    const markdown = await readFile(path, "utf8");
    const match =
      /<!-- correction-conclusion:start -->\s*```json\n([\s\S]*?)\n```\s*<!-- correction-conclusion:end -->/.exec(
        markdown,
      );
    assert.ok(match, `${path.pathname} is missing the correction conclusion`);
    assert.equal(canonicalJson(parseJson(match[1])), canonicalJson(expected));
  }
});

function proofSources(conclusion) {
  const proof = conclusion.receipt.proof;
  const edges =
    proof.kind === "bounds"
      ? [...proof.lowerEdges, ...proof.upperEdges]
      : proof.edges;
  return new Set(edges.map(({ sourceId }) => sourceId));
}
