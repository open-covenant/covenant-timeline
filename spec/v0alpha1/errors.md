# Errors and Findings

Schema validation failures use `schema.invalid`.

Reducer findings use stable identifiers:

| Code                                     | Meaning                                |
| ---------------------------------------- | -------------------------------------- |
| `timeline.contract.duplicate_checkpoint` | Checkpoint IDs are not unique          |
| `timeline.checkpoint.unknown`            | Evaluation names an unknown checkpoint |
| `timeline.evidence.duplicate`            | Evidence ID already exists in the run  |
| `timeline.evidence.unknown`              | Evaluation names unknown evidence      |
| `timeline.command.unknown`               | Receipt names an unknown command       |
| `timeline.extension.required_unknown`    | Required extension is unsupported      |

Sequence mismatch and contract/run mismatch are fatal input errors in the
prototype. A later wire protocol may assign stable codes once transport
requirements exist.

Finding identifiers may be added in a compatible release. Existing identifiers
must not change meaning.
