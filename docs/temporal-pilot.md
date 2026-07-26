# Independent temporal pilot

This pilot is the smallest credible external operation of experimental
v0alpha3. It is for a maintainer, model developer, or runtime team willing to
use Timeline in one real workflow and publish redacted evidence.

It does not require a partnership, hosted Covenant service, or production
authorization.

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

Software delivery, an experiment run, a research review, or an agent task is
enough. Do not use regulated or sensitive data in the first public pilot.

## Operator responsibilities

The external operator:

1. pins a Timeline commit containing experimental v0alpha3;
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
- record sequence is never presented as occurrence time;
- ambiguous results remain ambiguous; and
- the operator identifies at least one concrete benefit, failure, or required
  contract change.

A negative result is useful. A pilot that exposes a wrong abstraction or no
operational benefit should be published as such.

## Start

1. Run `pnpm temporal:demo`.
2. Read [the model interface](./model-interface.md).
3. Open a focused proposal on
   [RFC issue 15](https://github.com/open-covenant/covenant-timeline/issues/15)
   describing the workflow and expected artifacts.
4. Keep the first integration to one axis mapping, one context, and one query
   family unless the workflow genuinely needs more.
