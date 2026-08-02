import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { extname } from "node:path";

const files = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard"],
  {
    encoding: "utf8",
  },
)
  .trim()
  .split("\n")
  .filter(Boolean);

const textExtensions = new Set([
  ".cjs",
  ".css",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".py",
  ".toml",
  ".ts",
  ".tsx",
  ".yaml",
  ".yml",
]);
const canonicalMailmap =
  "Mizuki <kamiyo-ai@users.noreply.github.com> <covenant@users.noreply.github.com>\n";

const failures = [];
const generatedSegments = new Set([
  "dist",
  "coverage",
  ".turbo",
  "node_modules",
]);

for (const file of files) {
  if (!existsSync(file)) continue;

  const segments = file.split("/");
  if (
    segments.some((segment) => generatedSegments.has(segment)) ||
    file.endsWith(".tsbuildinfo")
  ) {
    failures.push(`${file}: generated artifact must not be tracked`);
    continue;
  }

  if (file === ".mailmap") {
    if (readFileSync(file, "utf8") !== canonicalMailmap) {
      failures.push(`${file}: maintainer identity mapping is not canonical`);
    }
    continue;
  }

  if (!textExtensions.has(extname(file))) continue;

  const contents = readFileSync(file, "utf8");
  if (contents.includes(`/${"Users"}/`)) {
    failures.push(`${file}: absolute home path`);
  }

  if (
    file.startsWith("packages/") &&
    /\b(?:from|require\()\s*['"]@covenant\//.test(contents)
  ) {
    failures.push(`${file}: portable package imports Covenant code`);
  }

  if (
    file.startsWith("packages/prototype/src/") &&
    /\bprocess\.env\b/.test(contents)
  ) {
    failures.push(`${file}: prototype reads implicit environment state`);
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(`boundary check passed (${files.length} files)`);
