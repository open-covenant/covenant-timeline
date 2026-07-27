const core = Object.freeze({
  schema: "covenant.timeline.release-evidence.v1",
  schemaPath: "schemas/release-evidence.v1.schema.json",
  package: "@covenant-org/timeline",
  manifest: "packages/prototype/package.json",
  tagPrefix: "timeline-v",
  workflowPath: ".github/workflows/release.yml",
  workflowName: "release",
  jobName: "publish",
  artifactName: "timeline-release",
  tarballStem: "covenant-org-timeline",
  sbomName: "timeline.spdx.json",
  sbomNamespaceSuffix: undefined,
  smoke: "core",
});

const mcp = Object.freeze({
  schema: "covenant.timeline.mcp-release-evidence.v1",
  schemaPath: "schemas/mcp-release-evidence.v1.schema.json",
  package: "@covenant-org/timeline-mcp",
  manifest: "packages/mcp-server/package.json",
  tagPrefix: "timeline-mcp-v",
  workflowPath: ".github/workflows/release-mcp.yml",
  workflowName: "release MCP server",
  jobName: "publish",
  artifactName: "timeline-mcp-release",
  tarballStem: "covenant-org-timeline-mcp",
  sbomName: "timeline-mcp.spdx.json",
  sbomNamespaceSuffix: "mcp-server",
  smoke: "mcp",
});

const profiles = new Map([
  [core.schema, core],
  [mcp.schema, mcp],
]);

export function releaseEvidenceProfile(record) {
  const profile = profiles.get(record.schema);
  if (!profile) {
    throw new Error(`unsupported release evidence schema ${record.schema}`);
  }
  return profile;
}

export { core as coreReleaseEvidenceProfile };
export { mcp as mcpReleaseEvidenceProfile };
