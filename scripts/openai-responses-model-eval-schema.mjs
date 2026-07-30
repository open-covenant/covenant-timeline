import { createModelEvalOutputSchema } from "./model-eval-output-schema.mjs";

export function createOpenAIResponseFormat(arm) {
  return {
    type: "json_schema",
    name: `covenant_timeline_${arm.replaceAll("-", "_")}_v1`,
    strict: true,
    schema: createModelEvalOutputSchema(arm),
  };
}
