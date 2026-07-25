# Errors and Findings

Schema validation failures use `schema.invalid`.

Reducer findings use stable identifiers:

| Code                                     | Meaning                                |
| ---------------------------------------- | -------------------------------------- |
| `timeline.contract.duplicate_checkpoint` | Checkpoint IDs are not unique          |
| `timeline.checkpoint.unknown`            | Evaluation names an unknown checkpoint |
| `timeline.event.duplicate`               | Event ID already exists in the run     |
| `timeline.evidence.duplicate`            | Evidence ID already exists in the run  |
| `timeline.evidence.unknown`              | Evaluation names unknown evidence      |
| `timeline.command.unknown`               | Receipt names an unknown command       |
| `timeline.receipt.duplicate`             | Command already has a receipt          |
| `timeline.extension.required_unknown`    | Required extension is unsupported      |

Fatal input errors use stable codes:

| Code                             | Meaning                                 |
| -------------------------------- | --------------------------------------- |
| `schema.invalid`                 | Portable document validation failed     |
| `timeline.event.sequence`        | Event sequence is not the next sequence |
| `timeline.run.contract_mismatch` | State belongs to a different contract   |
| `timeline.run.id`                | Run ID is not a portable identifier     |

Finding identifiers may be added in a compatible release. Existing identifiers
must not change meaning.
