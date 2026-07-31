# MCP agent pilot starter

This example exercises Covenant Timeline from a source checkout without
requiring a published MCP package. It starts the local MCP server, records
evidence-backed temporal assertions, crosses a server restart, admits a
correction, and exports an artifact that a separate process verifies.

The included release scenario is a starter, not evidence of independent
adoption. Replace the contract, evidence, events, and queries with records from
an operator-owned workflow before submitting a pilot.

## Run

From the repository root:

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm build
node scripts/mcp-agent-pilot.mjs \
  --input examples/mcp-agent-pilot \
  --out ../timeline-pilot-artifact
```

The output must be outside the repository checkout so generated evidence and
results cannot make the source tree dirty or contaminate its recorded revision.

The driver:

1. hashes the exact bytes under `evidence/`;
2. substitutes those digests into the event drafts;
3. creates a run and appends events using whole-run digest compare-and-swap;
4. stops and restarts the stdio MCP server at the configured boundary;
5. projects and reasons at the pre-correction and corrected knowledge cuts;
6. reads the portable run resource;
7. exports the evidence, run, queries, conclusions, environment, and exact MCP
   tool-call transcript; and
8. launches a separate verifier over the exported bytes.

Reverify an exported artifact without starting the MCP server:

```sh
node scripts/mcp-agent-pilot-verify.mjs ../timeline-pilot-artifact
```

The verifier checks evidence digests, referenced evidence coverage, canonical
run/query/conclusion bytes, the append digest chain, the recorded MCP arguments
and results, deterministic recomputation, and every proof receipt. It needs the
built Timeline library but does not use the network, input fixtures, MCP store,
or a published MCP package. The verification report separately identifies the
source checkout that generated the artifact and the checkout running the
verifier, including whether each was dirty and whether the two identities
match. These identities are recorded provenance, not authentication.

## Input files

- `pilot.json` identifies the restart boundary and query files.
- `contract.json` declares the temporal axes and contexts.
- `events.json` contains MCP event drafts. Assertions use `evidenceFiles`;
  the driver replaces them with SHA-256 `evidenceRefs`.
- `queries/` contains exact MCP query drafts with explicit knowledge cuts.
- `evidence/` contains the original bytes retained by the operator. Evidence
  may use any safe flat lowercase filename; hidden files, traversal, symlinks,
  and nested directories are rejected.

Event drafts intentionally omit `schema` and `sequence`; the MCP server assigns
both. Each append uses the `runDigest` returned by the preceding create or
append response.

## Export

The generated artifact contains:

```text
timeline-pilot-artifact/
  README.md
  artifact.json
  run.json
  queries/
  conclusions/
  evidence/
  evidence-manifest.json
  environment.json
  tool-calls.jsonl
  verification.json
```

`tool-calls.jsonl` records the exact arguments and structured result of every
call to all five Timeline MCP tools. It contains no evidence payload bytes.

Direct MCP writes remain structurally validated but unauthenticated. A real
operator must authenticate evidence and decide which typed records to admit
before invoking the append tool.
