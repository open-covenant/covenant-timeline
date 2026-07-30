import { printParseErrorCode, visit, type JSONPath } from "jsonc-parser";

export interface TimelineJsonIssue {
  code: "duplicate_key" | "syntax";
  offset: number;
  line: number;
  column: number;
  path?: string;
  detail: string;
}

export class TimelineJsonError extends SyntaxError {
  readonly code = "timeline.input.invalid_json";

  constructor(readonly issues: readonly TimelineJsonIssue[]) {
    super(
      issues
        .map(
          ({ line, column, detail }) =>
            `line ${line + 1}, column ${column + 1}: ${detail}`,
        )
        .join("; "),
    );
    this.name = "TimelineJsonError";
  }
}

export function parseJson(text: string): unknown {
  const objectKeys: Set<string>[] = [];

  visit(
    text,
    {
      onObjectBegin: () => {
        objectKeys.push(new Set());
      },
      onObjectProperty: (property, offset, _length, line, column, path) => {
        const keys = objectKeys.at(-1);
        if (keys?.has(property)) {
          throw new TimelineJsonError([
            {
              code: "duplicate_key",
              offset,
              line,
              column,
              path: formatPath([...path(), property]),
              detail: `duplicate object key ${JSON.stringify(property)}`,
            },
          ]);
        }
        keys?.add(property);
      },
      onObjectEnd: () => {
        objectKeys.pop();
      },
      onError: (error, offset, _length, line, column) => {
        throw new TimelineJsonError([
          {
            code: "syntax",
            offset,
            line,
            column,
            detail: printParseErrorCode(error),
          },
        ]);
      },
    },
    {
      allowEmptyContent: false,
      allowTrailingComma: false,
      disallowComments: true,
    },
  );

  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new TimelineJsonError([
      { code: "syntax", offset: 0, line: 0, column: 0, detail },
    ]);
  }
}

function formatPath(path: JSONPath): string {
  return path.reduce<string>(
    (result, segment) =>
      typeof segment === "number"
        ? `${result}[${segment}]`
        : `${result}.${segment}`,
    "$",
  );
}
