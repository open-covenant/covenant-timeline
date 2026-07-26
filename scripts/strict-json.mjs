import { printParseErrorCode, visit } from "jsonc-parser";

export class StrictJsonError extends SyntaxError {
  constructor(label, issues) {
    super(`${label}: ${issues.join("; ")}`);
    this.name = "StrictJsonError";
  }
}

export function parseStrictJson(text, label = "JSON") {
  const issues = [];
  const objectKeys = [];

  visit(
    text,
    {
      onObjectBegin: () => {
        objectKeys.push(new Set());
      },
      onObjectProperty: (property, _offset, _length, line, column) => {
        const keys = objectKeys.at(-1);
        if (keys?.has(property)) {
          issues.push(
            `line ${line + 1}, column ${column + 1}: duplicate object key ${JSON.stringify(property)}`,
          );
        }
        keys?.add(property);
      },
      onObjectEnd: () => {
        objectKeys.pop();
      },
      onError: (error, _offset, _length, line, column) => {
        issues.push(
          `line ${line + 1}, column ${column + 1}: ${printParseErrorCode(error)}`,
        );
      },
    },
    {
      allowEmptyContent: false,
      allowTrailingComma: false,
      disallowComments: true,
    },
  );

  if (issues.length > 0) throw new StrictJsonError(label, issues);
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new StrictJsonError(label, [
      error instanceof Error ? error.message : String(error),
    ]);
  }
}
