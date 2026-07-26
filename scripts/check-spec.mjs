import { readFileSync } from "node:fs";

const failures = [];
const totals = [
  checkVersion("v0alpha1", /^CTL-[A-Z]+-\d{3}$/),
  checkVersion("v0alpha2", /^CTL2-[A-Z]+-\d{3}$/),
  checkVersion("v0alpha3", /^CTL3-[A-Z]+-\d{3}$/),
];

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(
  `spec traceability passed (${totals.reduce((sum, value) => sum + value.requirements, 0)} requirements, ${totals.reduce((sum, value) => sum + value.cases, 0)} cases)`,
);

function checkVersion(version, requirementPattern) {
  const requirementsPath = `spec/${version}/requirements.md`;
  const casesPath = `conformance/${version}/cases.json`;
  const requirementsText = readFileSync(requirementsPath, "utf8");
  const cases = JSON.parse(readFileSync(casesPath, "utf8"));
  const rows = requirementsText
    .split("\n")
    .filter((line) => {
      const id = line.split("|")[1]?.trim() ?? "";
      return requirementPattern.test(id);
    })
    .map((line) =>
      line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim()),
    );
  const requirementIds = new Set();
  const caseIds = new Set(cases.map(({ id }) => id));

  for (const [id, rule, mechanical, listedCases] of rows) {
    if (requirementIds.has(id)) {
      failures.push(`${requirementsPath}: duplicate requirement ${id}`);
    }
    requirementIds.add(id);
    if (!rule) failures.push(`${requirementsPath}: ${id} has no rule`);
    if (mechanical !== "yes" && mechanical !== "no") {
      failures.push(`${requirementsPath}: ${id} mechanical must be yes or no`);
    }
    if (mechanical === "yes") {
      const references = listedCases
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      if (references.length === 0) {
        failures.push(`${requirementsPath}: ${id} has no cases`);
      }
      for (const caseId of references) {
        if (!caseIds.has(caseId)) {
          failures.push(`${requirementsPath}: ${id} references ${caseId}`);
        }
      }
    }
  }
  if (rows.length < 8) {
    failures.push(`${requirementsPath}: expected at least 8 requirements`);
  }
  for (const testCase of cases) {
    for (const requirement of testCase.requirements ?? []) {
      if (!requirementIds.has(requirement)) {
        failures.push(
          `${casesPath}: ${testCase.id} references unknown ${requirement}`,
        );
      }
    }
  }
  return { requirements: rows.length, cases: cases.length };
}
