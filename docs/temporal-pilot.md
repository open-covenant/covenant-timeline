# Independent temporal pilot

Run Timeline in one external long-running-agent workflow and publish a redacted
artifact that another process can replay and verify. The result should identify
one operational benefit, failure, or required contract change.

An operator can run the pilot independently with the local MCP package or the
library. No hosted Covenant service or formal partnership is required.

Teams that are not ready to operate a workflow can start with the public
[model-interface v1 smoke benchmark](../benchmarks/model-interface/v1/README.md).
The [roadmap](../ROADMAP.md) defines how that development suite, this pilot, and
independent implementation evidence fit together.

## Candidate workflow

Choose work that naturally contains:

- at least two events whose occurrence order is not adequately represented by
  record arrival order;
- one duration, delay, deadline, or overlap question;
- one uncertain or bounded coordinate;
- one correction or delayed observation;
- one process or model-session restart; and
- a decision that benefits from preserving ambiguity or detecting a
  contradiction.

Start with one long-running agent or software-delivery workflow. Do not use
regulated or sensitive data in the first public pilot.

## Operator responsibilities

The external operator:

1. pins `@covenant-org/timeline-mcp@0.0.0-alpha.1` for an MCP agent,
   `@covenant-org/timeline@0.0.0-alpha.2` for a custom host, or an exact
   Timeline commit;
2. defines its subject, axes, origins, units, and scenario contexts;
3. records points, intervals, coordinate assertions, constraints, and facts
   from its own system;
4. retains the referenced evidence bytes, checks their declared SHA-256
   digests, and authenticates their authority outside the generic kernel;
5. submits queries at explicit knowledge cuts;
6. verifies every returned receipt;
7. resumes after at least one process or model-session boundary; and
8. exports a redacted run, queries, conclusions, and reproduction command.

The Timeline maintainers may help with schemas and bugs. They must not operate
the host, fabricate the records, or be the sole party verifying the result.

## Minimum artifact

Publish:

```text
pilot/
  README.md
  run.json
  queries/
  conclusions/
  environment.json
```

`README.md` states:

- the operator and repository or runtime;
- the workflow and why temporal reasoning mattered;
- how digest-referenced evidence was retained, authenticated, or redacted;
- the pinned Timeline revision;
- the exact replay and proof-verification command;
- which records crossed the restart;
- what correction changed a later knowledge cut;
- any contradiction or indeterminate result;
- manual work avoided or error prevented; and
- limitations or requested changes.

`environment.json` records only non-sensitive runtime facts: operating system,
architecture, Node.js version, package or commit identity, and command exit
status.

## Pass criteria

The pilot passes when:

- the operator is not a Covenant Timeline maintainer acting on the project's
  behalf;
- the workflow and records originated outside this repository;
- another process can reproduce each semantic result from exported bytes;
- every supplied proof receipt verifies;
- an earlier knowledge cut remains unchanged after a later correction;
- reported occurrence times come from admitted temporal assertions rather than
  record arrival order;
- ambiguous results remain ambiguous; and
- the operator identifies at least one concrete benefit, failure, or required
  contract change.

A negative result is useful. A pilot that exposes a wrong abstraction or no
operational benefit should be published as such.

## Start

1. Connect `@covenant-org/timeline-mcp@0.0.0-alpha.1` to an MCP agent, install
   `@covenant-org/timeline@0.0.0-alpha.2` in a custom host, or run
   `pnpm temporal:demo` from a source checkout.
2. Read [the model interface](./model-interface.md). If a model will propose
   records, validate its adapter with the public v1 smoke benchmark.
3. Comment on the
   [independent pilot issue](https://github.com/open-covenant/covenant-timeline/issues/21)
   with the workflow and expected artifacts.
4. Keep the first integration to one axis mapping, one context, and one query
   family unless the workflow genuinely needs more.
