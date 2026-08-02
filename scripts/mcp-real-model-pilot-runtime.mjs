import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { decodeUtf8, readBoundedExactFile } from "./mcp-agent-pilot-lib.mjs";

export const pilotRepositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
);

const limits = {
  executableBytes: 256 * 1024 * 1024,
  fileBytes: 16 * 1024 * 1024,
  fixedFiles: 256,
  packages: 128,
  packageFiles: 4096,
  packageBytes: 128 * 1024 * 1024,
  packageManifestBytes: 1024 * 1024,
};
const profiles = new Set(["formal-openai", "development-unbound-adapter"]);
const schemas = {
  v1: "covenant.timeline.real-model-pilot.runtime.v1",
  v2: "covenant.timeline.real-model-pilot.runtime.v2",
  current: "covenant.timeline.real-model-pilot.runtime.v3",
};
const fixedDirectories = [
  "packages/prototype/dist",
  "packages/mcp-server/dist",
];
const fixedFiles = [
  "packages/prototype/package.json",
  "packages/mcp-server/package.json",
  "schemas/mcp-real-model-pilot.v1.schema.json",
  "schemas/v0alpha3/common.schema.json",
  "scripts/mcp-agent-pilot-lib.mjs",
  "scripts/mcp-agent-pilot.mjs",
  "scripts/formal-attempt-ledger.mjs",
  "scripts/mcp-real-model-pilot-bootstrap.mjs",
  "scripts/mcp-real-model-pilot-failure-artifact.mjs",
  "scripts/mcp-real-model-pilot-failure-export.mjs",
  "scripts/mcp-real-model-pilot-failure-verify.mjs",
  "scripts/mcp-real-model-pilot-failure.mjs",
  "scripts/mcp-real-model-pilot-lib.mjs",
  "scripts/mcp-real-model-pilot-phase-decision.mjs",
  "scripts/mcp-real-model-pilot-recovery.mjs",
  "scripts/mcp-real-model-pilot-runtime.mjs",
  "scripts/mcp-real-model-pilot-verify-bootstrap.mjs",
  "scripts/mcp-real-model-pilot-verify.mjs",
  "scripts/mcp-real-model-pilot.mjs",
  "scripts/model-eval-output-schema.mjs",
  "scripts/openai-responses-model-eval-adapter.mjs",
  "scripts/openai-responses-model-eval-schema.mjs",
  "scripts/strict-json.mjs",
];
const applicationDependencies = [
  "@covenant-org/timeline",
  "@modelcontextprotocol/client",
  "@modelcontextprotocol/server",
  "ajv",
  "ajv-formats",
  "canonicalize",
  "jsonc-parser",
  "zod",
];
const measurementDependencies = ["typescript"];
const legacyFixedFiles = [
  "packages/prototype/package.json",
  "packages/mcp-server/package.json",
  "schemas/mcp-real-model-pilot.v1.schema.json",
  "schemas/v0alpha3/common.schema.json",
  "scripts/formal-attempt-ledger.mjs",
  "scripts/mcp-agent-pilot-lib.mjs",
  "scripts/mcp-agent-pilot.mjs",
  "scripts/mcp-real-model-pilot-bootstrap.mjs",
  "scripts/mcp-real-model-pilot-lib.mjs",
  "scripts/mcp-real-model-pilot-runtime.mjs",
  "scripts/mcp-real-model-pilot-verify-bootstrap.mjs",
  "scripts/mcp-real-model-pilot-verify.mjs",
  "scripts/mcp-real-model-pilot.mjs",
  "scripts/openai-responses-model-eval-adapter.mjs",
  "scripts/openai-responses-model-eval-schema.mjs",
  "scripts/strict-json.mjs",
];
const v2CompiledFiles = [
  "packages/mcp-server/dist/cli.js",
  "packages/mcp-server/dist/constants.js",
  "packages/mcp-server/dist/errors.js",
  "packages/mcp-server/dist/index.js",
  "packages/mcp-server/dist/model-admission.js",
  "packages/mcp-server/dist/schemas.js",
  "packages/mcp-server/dist/server.js",
  "packages/mcp-server/dist/store.js",
  "packages/mcp-server/dist/types.js",
  "packages/prototype/dist/archive.js",
  "packages/prototype/dist/cli.js",
  "packages/prototype/dist/contract.js",
  "packages/prototype/dist/document.js",
  "packages/prototype/dist/identity.js",
  "packages/prototype/dist/index.js",
  "packages/prototype/dist/json.js",
  "packages/prototype/dist/limits.js",
  "packages/prototype/dist/profiles/github.js",
  "packages/prototype/dist/profiles/index.js",
  "packages/prototype/dist/report.js",
  "packages/prototype/dist/run.js",
  "packages/prototype/dist/v0alpha2/contract.js",
  "packages/prototype/dist/v0alpha2/document.js",
  "packages/prototype/dist/v0alpha2/index.js",
  "packages/prototype/dist/v0alpha2/migrate.js",
  "packages/prototype/dist/v0alpha2/report.js",
  "packages/prototype/dist/v0alpha2/run.js",
  "packages/prototype/dist/v0alpha2/validation.js",
  "packages/prototype/dist/v0alpha3/document.js",
  "packages/prototype/dist/v0alpha3/index.js",
  "packages/prototype/dist/v0alpha3/kernel.js",
  "packages/prototype/dist/v0alpha3/model-proposal.js",
  "packages/prototype/dist/v0alpha3/types.js",
];
const currentCompiledFiles = [
  ...v2CompiledFiles,
  "packages/mcp-server/dist/demo.js",
];
const v1RequiredFiles = [...legacyFixedFiles, ...v2CompiledFiles];
const v2RequiredFiles = [...fixedFiles, ...v2CompiledFiles].sort();
const currentRequiredFiles = [...fixedFiles, ...currentCompiledFiles].sort();
const parserCache = new Map();
export async function capturePilotRuntime({
  profile = "formal-openai",
  root = pilotRepositoryRoot,
  resolutionRoot = pilotRepositoryRoot,
  executable = process.execPath,
  node = {
    version: process.version,
    modules: process.versions.modules,
    v8: process.versions.v8,
    platform: process.platform,
    arch: process.arch,
  },
  dependencies = [],
} = {}) {
  if (!profiles.has(profile)) {
    throw new Error("real-model pilot runtime profile is invalid");
  }
  const executableFile = await digestFile(
    executable,
    limits.executableBytes,
    "Node executable",
  );
  const paths = [...fixedFiles];
  for (const directory of fixedDirectories) {
    paths.push(...(await javascriptFiles(root, directory)));
  }
  paths.sort();
  if (
    paths.length === 0 ||
    paths.length > limits.fixedFiles ||
    new Set(paths).size !== paths.length ||
    !equal(paths, currentRequiredFiles)
  ) {
    throw new Error(
      "real-model pilot runtime file inventory changed; define a new runtime schema",
    );
  }
  const captured = await Promise.all(
    paths.map((path) => captureRuntimeFile(root, path)),
  );
  const files = captured.map(({ path, digest, byteLength }) => ({
    path,
    digest,
    byteLength,
  }));
  const sources = new Map(
    captured
      .filter(({ path }) => /\.(?:js|mjs)$/u.test(path))
      .map(({ path, bytes }) => [
        path,
        decodeUtf8(bytes, `runtime source ${path}`),
      ]),
  );
  const requestedDependencies = [
    ...new Set([
      ...applicationDependencies,
      ...measurementDependencies,
      ...dependencies,
    ]),
  ];
  const parserRoot = await resolveApplicationPackage(
    "typescript",
    pilotRepositoryRoot,
  );
  const overrides = new Map([["typescript", parserRoot]]);
  let closure = await resolvedPackageClosure(
    resolutionRoot,
    requestedDependencies,
    overrides,
  );
  const parserPackage = applicationPackage(closure, "typescript");
  const parser = await loadMeasuredTypeScript(parserRoot, parserPackage);
  const importedDependencies = assertRelativeImportClosure(
    root,
    paths,
    sources,
    parser,
  );
  const allDependencies = [
    ...new Set([...requestedDependencies, ...importedDependencies]),
  ];
  if (
    profile === "formal-openai" &&
    allDependencies.some(
      (dependency) =>
        !applicationDependencies.includes(dependency) &&
        !measurementDependencies.includes(dependency),
    )
  ) {
    throw new Error(
      "formal runtime imports a package outside its versioned dependency inventory",
    );
  }
  if (allDependencies.length !== requestedDependencies.length) {
    closure = await resolvedPackageClosure(
      resolutionRoot,
      allDependencies,
      overrides,
    );
  }
  assertPackageUnchanged(
    parserPackage,
    await digestPackage(parserRoot),
    "TypeScript parser",
  );
  const identity = {
    schema: schemas.current,
    profile,
    node: {
      version: node.version,
      modules: node.modules,
      v8: node.v8,
      platform: node.platform,
      arch: node.arch,
      executableDigest: executableFile.digest,
      executableByteLength: executableFile.byteLength,
    },
    files,
    packages: closure.packages,
    resolutions: closure.resolutions,
  };
  return { identity, digest: contentDigest(identity) };
}

async function captureRuntimeFile(root, path) {
  const bytes = await readBoundedExactFile(
    join(root, path),
    limits.fileBytes,
    `runtime file ${path}`,
    { root, scope: "the runtime root" },
  );
  return {
    path,
    bytes,
    digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    byteLength: bytes.byteLength,
  };
}

function applicationPackage(closure, specifier) {
  const edge = closure.resolutions.find(
    (resolution) =>
      resolution.from === "application" && resolution.specifier === specifier,
  );
  const item = edge
    ? closure.packages.find((candidate) => candidate.id === edge.to)
    : undefined;
  if (!item) {
    throw new Error(`runtime package ${specifier} is not in the closure`);
  }
  return item;
}

async function loadMeasuredTypeScript(root, measured) {
  const cached = parserCache.get(root);
  if (cached) {
    assertPackageUnchanged(cached.measured, measured, "TypeScript parser");
    return cached.module;
  }
  const manifest = await readPackageManifest(root);
  if (
    manifest.name !== "typescript" ||
    typeof manifest.main !== "string" ||
    manifest.main.length === 0
  ) {
    throw new Error("TypeScript parser package has no stable entry point");
  }
  const entry = await realpath(join(root, manifest.main));
  const contained = relative(root, entry);
  if (
    contained === "" ||
    contained === ".." ||
    contained.startsWith(`..${sep}`) ||
    resolve(root, contained) !== entry
  ) {
    throw new Error("TypeScript parser entry escapes its measured package");
  }
  const loaded = await import(pathToFileURL(entry).href);
  const module = loaded.default ?? loaded;
  if (
    typeof module.createProgram !== "function" ||
    typeof module.createSourceFile !== "function" ||
    typeof module.flattenDiagnosticMessageText !== "function"
  ) {
    throw new Error("TypeScript parser entry is invalid");
  }
  parserCache.set(root, { measured, module });
  return module;
}

function assertPackageUnchanged(before, after, label) {
  if (
    before.digest !== after.digest ||
    before.fileCount !== after.fileCount ||
    before.byteLength !== after.byteLength
  ) {
    throw new Error(`${label} changed after it was measured`);
  }
}

function assertRelativeImportClosure(root, paths, sources, ts) {
  const included = new Set(paths);
  const dependencies = new Set();
  for (const [path, specifiers] of runtimeModuleSpecifiers(sources, ts)) {
    for (const specifier of specifiers) {
      if (isRelativeSpecifier(specifier)) {
        const target = relative(
          root,
          resolve(dirname(join(root, path)), specifier),
        )
          .split(sep)
          .join("/");
        if (
          target === "" ||
          target === ".." ||
          target.startsWith("../") ||
          !included.has(target)
        ) {
          throw new Error(
            `runtime file ${path} imports unbound local module ${specifier}`,
          );
        }
        continue;
      }
      const dependency = packageRootForSpecifier(specifier);
      if (dependency) dependencies.add(dependency);
    }
  }
  return dependencies;
}

function packageRootForSpecifier(specifier) {
  if (specifier.startsWith("node:")) return undefined;
  const parts = specifier.split("/");
  const root = specifier.startsWith("@")
    ? parts.length >= 2
      ? `${parts[0]}/${parts[1]}`
      : undefined
    : parts[0];
  if (!root || !packageName(root)) {
    throw new Error(`runtime source imports unsupported module ${specifier}`);
  }
  return root;
}

function runtimeModuleSpecifiers(sources, ts) {
  const options = {
    allowJs: true,
    checkJs: false,
    module: ts.ModuleKind.ESNext,
    moduleDetection: ts.ModuleDetectionKind.Force,
    noLib: true,
    noResolve: true,
    target: ts.ScriptTarget.ESNext,
  };
  const host = {
    fileExists: (path) => sources.has(path),
    getCanonicalFileName: (path) => path,
    getCurrentDirectory: () => "",
    getDefaultLibFileName: () => "",
    getNewLine: () => "\n",
    getSourceFile(path, languageVersion) {
      const source = sources.get(path);
      if (source === undefined) return undefined;
      return ts.createSourceFile(
        path,
        source,
        languageVersion,
        true,
        ts.getScriptKindFromFileName(path),
      );
    },
    readFile: (path) => sources.get(path),
    useCaseSensitiveFileNames: () => true,
    writeFile() {},
  };
  const program = ts.createProgram([...sources.keys()], options, host);
  const checker = program.getTypeChecker();
  const result = new Map();

  for (const path of sources.keys()) {
    const sourceFile = program.getSourceFile(path);
    if (!sourceFile) {
      throw new Error(`runtime source ${path} could not be parsed`);
    }
    const diagnostics = program.getSyntacticDiagnostics(sourceFile);
    if (diagnostics.length > 0) {
      const detail = ts
        .flattenDiagnosticMessageText(diagnostics[0].messageText, " ")
        .replace(/\s+/gu, " ");
      throw new Error(
        `runtime source ${path} is not valid JavaScript: ${detail}`,
      );
    }
    result.set(path, moduleSpecifiersForSource(sourceFile, checker, ts));
  }
  return result;
}

function moduleSpecifiersForSource(sourceFile, checker, ts) {
  const specifiers = new Set();
  assertLoaderImportForms(sourceFile, ts);
  assertNoDynamicCodeConstruction(sourceFile, ts);
  const createRequireBindings = importedBindings(
    sourceFile,
    checker,
    "node:module",
    "createRequire",
    ts,
  );
  const pathToFileUrlBindings = importedBindings(
    sourceFile,
    checker,
    "node:url",
    "pathToFileURL",
    ts,
  );
  const loaderBindings = new Set();
  const loaderDeclarations = new Set();
  const createRequireInitializers = new Set();

  assertImportedBindingUses(sourceFile, createRequireBindings, checker, ts);
  assertImportedBindingUses(sourceFile, pathToFileUrlBindings, checker, ts);
  assertNoBuiltinLoaderConstruction(sourceFile, ts);

  visit(sourceFile, (node) => {
    if (
      !ts.isVariableDeclaration(node) ||
      !node.initializer ||
      !ts.isCallExpression(node.initializer) ||
      !isImportedCall(node.initializer, createRequireBindings, checker, ts)
    ) {
      return;
    }
    if (!ts.isIdentifier(node.name) || !isConstDeclaration(node, ts)) {
      throw new Error(
        `runtime source ${sourceFile.fileName} uses an unsupported createRequire binding`,
      );
    }
    const symbol = checker.getSymbolAtLocation(node.name);
    if (!symbol) {
      throw new Error(
        `runtime source ${sourceFile.fileName} has an unresolved createRequire binding`,
      );
    }
    loaderBindings.add(symbol);
    loaderDeclarations.add(node.name);
    createRequireInitializers.add(node.initializer);
    if (hasExportModifier(node.parent.parent, ts)) {
      throw new Error(
        `runtime source ${sourceFile.fileName} exports a CommonJS loader`,
      );
    }
  });

  const resolvedPackages = new Map();
  visit(sourceFile, (node) => {
    if (
      !ts.isVariableDeclaration(node) ||
      !ts.isIdentifier(node.name) ||
      !isConstDeclaration(node, ts) ||
      !node.initializer ||
      !ts.isCallExpression(node.initializer) ||
      !isLoaderResolveCall(node.initializer, loaderBindings, checker, ts)
    ) {
      return;
    }
    const specifier = soleLiteralArgument(node.initializer, ts);
    if (!specifier || isRelativeSpecifier(specifier)) return;
    const symbol = checker.getSymbolAtLocation(node.name);
    if (symbol) {
      resolvedPackages.set(symbol, specifier);
      specifiers.add(specifier);
    }
  });

  visit(sourceFile, (node) => {
    if (
      ts.isImportDeclaration(node) ||
      (ts.isExportDeclaration(node) && node.moduleSpecifier)
    ) {
      const specifier = literalText(node.moduleSpecifier, ts);
      if (specifier === undefined) {
        throw new Error(
          `runtime source ${sourceFile.fileName} contains a non-literal module declaration`,
        );
      }
      specifiers.add(specifier);
      return;
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      const specifier = soleLiteralArgument(node, ts);
      if (specifier !== undefined) {
        if (isLoaderModuleSpecifier(specifier)) {
          throw new Error(
            `runtime source ${sourceFile.fileName} contains an unsupported dynamic node:module import`,
          );
        }
        specifiers.add(specifier);
        return;
      }
      if (
        node.arguments.length === 1 &&
        (isResolvedPackageUrl(
          node.arguments[0],
          pathToFileUrlBindings,
          resolvedPackages,
          checker,
          ts,
        ) ||
          isMeasuredParserUrl(
            node,
            sourceFile,
            pathToFileUrlBindings,
            checker,
            ts,
          ))
      ) {
        return;
      }
      throw new Error(
        `runtime source ${sourceFile.fileName} contains an unsupported computed dynamic import`,
      );
    }
    if (
      ts.isCallExpression(node) &&
      isImportedCall(node, createRequireBindings, checker, ts) &&
      !createRequireInitializers.has(node)
    ) {
      throw new Error(
        `runtime source ${sourceFile.fileName} uses createRequire outside a const binding`,
      );
    }
    if (!ts.isCallExpression(node)) return;
    const loader = checker.getSymbolAtLocation(node.expression);
    if (loaderBindings.has(loader)) {
      const specifier = soleLiteralArgument(node, ts);
      if (specifier === undefined) {
        throw new Error(
          `runtime source ${sourceFile.fileName} contains a computed CommonJS require`,
        );
      }
      specifiers.add(specifier);
      return;
    }
    if (
      ts.isIdentifier(node.expression) &&
      node.expression.text === "require"
    ) {
      throw new Error(
        `runtime source ${sourceFile.fileName} contains an unbound CommonJS require`,
      );
    }
  });

  visit(sourceFile, (node) => {
    if (!ts.isIdentifier(node)) return;
    const symbol = checker.getSymbolAtLocation(node);
    if (!loaderBindings.has(symbol) || loaderDeclarations.has(node)) return;
    const parent = node.parent;
    if (ts.isCallExpression(parent) && parent.expression === node) return;
    if (
      ts.isPropertyAccessExpression(parent) &&
      parent.expression === node &&
      parent.name.text === "resolve" &&
      ts.isCallExpression(parent.parent) &&
      parent.parent.expression === parent
    ) {
      return;
    }
    throw new Error(
      `runtime source ${sourceFile.fileName} passes or aliases a CommonJS loader`,
    );
  });

  return specifiers;
}

function assertLoaderImportForms(sourceFile, ts) {
  for (const statement of sourceFile.statements) {
    if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier &&
      isLoaderModuleSpecifier(literalText(statement.moduleSpecifier, ts))
    ) {
      throw new Error(
        `runtime source ${sourceFile.fileName} contains an unsupported node:module re-export`,
      );
    }
    if (
      !ts.isImportDeclaration(statement) ||
      !isLoaderModuleSpecifier(literalText(statement.moduleSpecifier, ts))
    ) {
      continue;
    }
    const clause = statement.importClause;
    const defaultOnly = clause?.name && !clause.namedBindings;
    const namespaceOnly =
      !clause?.name &&
      clause?.namedBindings &&
      ts.isNamespaceImport(clause.namedBindings);
    const namedCreateRequire =
      !clause?.name &&
      clause?.namedBindings &&
      ts.isNamedImports(clause.namedBindings) &&
      clause.namedBindings.elements.length === 1 &&
      (
        clause.namedBindings.elements[0].propertyName ??
        clause.namedBindings.elements[0].name
      ).text === "createRequire";
    if (!defaultOnly && !namespaceOnly && !namedCreateRequire) {
      throw new Error(
        `runtime source ${sourceFile.fileName} contains an unsupported node:module import`,
      );
    }
  }
}

function isLoaderModuleSpecifier(specifier) {
  return specifier === "node:module" || specifier === "module";
}

function assertNoDynamicCodeConstruction(sourceFile, ts) {
  const constructors = new Set([
    "AsyncFunction",
    "AsyncGeneratorFunction",
    "Function",
    "GeneratorFunction",
    "eval",
  ]);
  visit(sourceFile, (node) => {
    const named = ts.isIdentifier(node) && constructors.has(node.text);
    const computed =
      ts.isElementAccessExpression(node) &&
      constructors.has(literalText(node.argumentExpression, ts));
    const constructorAccess =
      (ts.isPropertyAccessExpression(node) &&
        node.name.text === "constructor") ||
      (ts.isElementAccessExpression(node) &&
        literalText(node.argumentExpression, ts) === "constructor");
    if (named || computed || constructorAccess) {
      throw new Error(
        `runtime source ${sourceFile.fileName} uses unsupported dynamic code construction`,
      );
    }
  });
}

function importedBindings(sourceFile, checker, moduleName, importedName, ts) {
  const direct = new Set();
  const objects = new Set();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      literalText(statement.moduleSpecifier, ts) !== moduleName ||
      !statement.importClause
    ) {
      continue;
    }
    if (statement.importClause.name) {
      const symbol = checker.getSymbolAtLocation(statement.importClause.name);
      if (symbol) objects.add(symbol);
    }
    const { namedBindings } = statement.importClause;
    if (namedBindings && ts.isNamespaceImport(namedBindings)) {
      const symbol = checker.getSymbolAtLocation(namedBindings.name);
      if (symbol) objects.add(symbol);
      continue;
    }
    if (namedBindings && ts.isNamedImports(namedBindings)) {
      for (const element of namedBindings.elements) {
        const imported = (element.propertyName ?? element.name).text;
        const symbol = checker.getSymbolAtLocation(element.name);
        if (!symbol) continue;
        if (imported === importedName) direct.add(symbol);
        if (imported === "default") objects.add(symbol);
      }
    }
  }
  return { direct, importedName, objects };
}

function isImportedCall(call, bindings, checker, ts) {
  if (ts.isIdentifier(call.expression)) {
    return bindings.direct.has(checker.getSymbolAtLocation(call.expression));
  }
  if (
    ts.isPropertyAccessExpression(call.expression) &&
    call.expression.name.text === bindings.importedName
  ) {
    return bindings.objects.has(
      checker.getSymbolAtLocation(call.expression.expression),
    );
  }
  return false;
}

function assertImportedBindingUses(sourceFile, bindings, checker, ts) {
  visit(sourceFile, (node) => {
    if (!ts.isIdentifier(node)) return;
    const symbol = checker.getSymbolAtLocation(node);
    if (!bindings.direct.has(symbol) && !bindings.objects.has(symbol)) return;
    if (isImportBinding(node, ts)) return;

    const parent = node.parent;
    if (
      bindings.direct.has(symbol) &&
      ts.isCallExpression(parent) &&
      parent.expression === node
    ) {
      return;
    }
    if (bindings.objects.has(symbol)) {
      const access =
        ts.isPropertyAccessExpression(parent) &&
        parent.expression === node &&
        parent.name.text === bindings.importedName;
      if (
        access &&
        ts.isCallExpression(parent.parent) &&
        parent.parent.expression === parent
      ) {
        return;
      }
    }
    throw new Error(
      `runtime source ${sourceFile.fileName} uses an unsupported ${bindings.importedName} binding`,
    );
  });
}

function isImportBinding(node, ts) {
  const parent = node.parent;
  return (
    (ts.isImportClause(parent) && parent.name === node) ||
    (ts.isNamespaceImport(parent) && parent.name === node) ||
    (ts.isImportSpecifier(parent) && parent.name === node)
  );
}

function assertNoBuiltinLoaderConstruction(sourceFile, ts) {
  visit(sourceFile, (node) => {
    const named = ts.isIdentifier(node) && node.text === "getBuiltinModule";
    const computed =
      ts.isElementAccessExpression(node) &&
      literalText(node.argumentExpression, ts) === "getBuiltinModule";
    if (named || computed) {
      throw new Error(
        `runtime source ${sourceFile.fileName} uses unsupported built-in module loading`,
      );
    }
  });
}

function isLoaderResolveCall(call, bindings, checker, ts) {
  return (
    ts.isPropertyAccessExpression(call.expression) &&
    call.expression.name.text === "resolve" &&
    bindings.has(checker.getSymbolAtLocation(call.expression.expression))
  );
}

function isResolvedPackageUrl(
  expression,
  pathToFileUrlBindings,
  resolvedPackages,
  checker,
  ts,
) {
  if (
    !ts.isPropertyAccessExpression(expression) ||
    expression.name.text !== "href" ||
    !ts.isCallExpression(expression.expression) ||
    !isImportedCall(
      expression.expression,
      pathToFileUrlBindings,
      checker,
      ts,
    ) ||
    expression.expression.arguments.length !== 1
  ) {
    return false;
  }
  const [argument] = expression.expression.arguments;
  return (
    ts.isIdentifier(argument) &&
    resolvedPackages.has(checker.getSymbolAtLocation(argument))
  );
}

function isMeasuredParserUrl(
  call,
  sourceFile,
  pathToFileUrlBindings,
  checker,
  ts,
) {
  if (sourceFile.fileName !== "scripts/mcp-real-model-pilot-runtime.mjs") {
    return false;
  }
  const [expression] = call.arguments;
  if (
    !ts.isPropertyAccessExpression(expression) ||
    expression.name.text !== "href" ||
    !ts.isCallExpression(expression.expression) ||
    !isImportedCall(
      expression.expression,
      pathToFileUrlBindings,
      checker,
      ts,
    ) ||
    expression.expression.arguments.length !== 1 ||
    !ts.isIdentifier(expression.expression.arguments[0]) ||
    expression.expression.arguments[0].text !== "entry"
  ) {
    return false;
  }
  for (let node = call.parent; node; node = node.parent) {
    if (ts.isFunctionDeclaration(node)) {
      return node.name?.text === "loadMeasuredTypeScript";
    }
  }
  return false;
}

function soleLiteralArgument(call, ts) {
  if (call.arguments.length !== 1) return undefined;
  return literalText(call.arguments[0], ts);
}

function literalText(node, ts) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  return undefined;
}

function isConstDeclaration(declaration, ts) {
  return (
    ts.isVariableDeclarationList(declaration.parent) &&
    (declaration.parent.flags & ts.NodeFlags.Const) !== 0
  );
}

function hasExportModifier(node, ts) {
  return node.modifiers?.some(
    (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
  );
}

function isRelativeSpecifier(specifier) {
  return specifier.startsWith("./") || specifier.startsWith("../");
}

function visit(node, callback) {
  callback(node);
  node.forEachChild((child) => visit(child, callback));
}

export async function pilotRuntimeMatches(expected, options = {}) {
  return (await comparePilotRuntime(expected, options)).matches;
}

export async function assertPilotRuntime(expected, options = {}) {
  const comparison = await comparePilotRuntime(expected, options);
  if (!comparison.matches) {
    const changes = describeRuntimeChanges(
      expected.identity,
      comparison.actual.identity,
    );
    const detail = changes.length > 0 ? `: ${changes.join(", ")}` : "";
    throw new Error(`real-model pilot runtime identity changed${detail}`);
  }
  return expected;
}

export function validatePilotRuntime(expected) {
  if (
    !record(expected) ||
    Object.keys(expected).sort().join(",") !== "digest,identity" ||
    !validRuntimeIdentity(expected.identity)
  ) {
    throw new Error("real-model pilot runtime binding is invalid");
  }
  if (contentDigest(expected.identity) !== expected.digest) {
    throw new Error("real-model pilot runtime digest did not reproduce");
  }
  return expected;
}

function validRuntimeIdentity(identity) {
  if (
    !record(identity) ||
    keys(identity) !== "files,node,packages,profile,resolutions,schema" ||
    !Object.values(schemas).includes(identity.schema) ||
    !profiles.has(identity.profile) ||
    !validNodeIdentity(identity.node) ||
    !Array.isArray(identity.files) ||
    identity.files.length === 0 ||
    identity.files.length > limits.fixedFiles ||
    !Array.isArray(identity.packages) ||
    identity.packages.length === 0 ||
    identity.packages.length > limits.packages ||
    !Array.isArray(identity.resolutions) ||
    identity.resolutions.length === 0 ||
    identity.resolutions.length > 1024
  ) {
    return false;
  }
  const filePaths = new Set();
  for (const file of identity.files) {
    if (
      !record(file) ||
      keys(file) !== "byteLength,digest,path" ||
      !runtimePath(file.path) ||
      !digest(file.digest) ||
      !positiveBoundedInteger(file.byteLength, limits.fileBytes) ||
      filePaths.has(file.path)
    ) {
      return false;
    }
    filePaths.add(file.path);
  }
  const exactFiles =
    identity.schema === schemas.current
      ? currentRequiredFiles
      : identity.schema === schemas.v2
        ? v2RequiredFiles
        : null;
  if (
    exactFiles
      ? !setEqual(filePaths, new Set(exactFiles))
      : v1RequiredFiles.some((path) => !filePaths.has(path))
  ) {
    return false;
  }
  const packages = new Map();
  let packageFiles = 0;
  let packageBytes = 0;
  for (const item of identity.packages) {
    if (
      !record(item) ||
      keys(item) !== "byteLength,digest,fileCount,id,name,version" ||
      !packageName(item.name) ||
      !boundedText(item.version, 256) ||
      !digest(item.digest) ||
      item.id !== `npm:${item.name}@${item.version}#${item.digest.slice(7)}` ||
      !positiveBoundedInteger(item.fileCount, limits.packageFiles) ||
      !positiveBoundedInteger(item.byteLength, limits.packageBytes) ||
      packages.has(item.id)
    ) {
      return false;
    }
    packages.set(item.id, item);
    packageFiles += item.fileCount;
    packageBytes += item.byteLength;
  }
  if (
    packageFiles > limits.packageFiles ||
    packageBytes > limits.packageBytes
  ) {
    return false;
  }

  const edges = new Set();
  const applicationRoots = new Set();
  const reachable = new Set();
  const pending = [];
  for (const edge of identity.resolutions) {
    if (
      !record(edge) ||
      keys(edge) !== "from,specifier,to" ||
      (edge.from !== "application" && !packages.has(edge.from)) ||
      !packageName(edge.specifier) ||
      !packages.has(edge.to) ||
      packages.get(edge.to).name !== edge.specifier
    ) {
      return false;
    }
    const key = `${edge.from}\0${edge.specifier}\0${edge.to}`;
    if (edges.has(key)) return false;
    edges.add(key);
    if (edge.from === "application") {
      if (applicationRoots.has(edge.specifier)) return false;
      applicationRoots.add(edge.specifier);
      pending.push(edge.to);
    }
  }
  const requiredDependencies = [
    ...applicationDependencies,
    ...(identity.schema === schemas.v1 ? [] : measurementDependencies),
  ];
  for (const dependency of requiredDependencies) {
    if (!applicationRoots.has(dependency)) return false;
  }
  if (
    identity.schema !== schemas.v1 &&
    identity.profile === "formal-openai" &&
    applicationRoots.size !== requiredDependencies.length
  ) {
    return false;
  }
  while (pending.length > 0) {
    const id = pending.shift();
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const edge of identity.resolutions) {
      if (edge.from === id) pending.push(edge.to);
    }
  }
  return reachable.size === packages.size;
}

function validNodeIdentity(node) {
  return (
    record(node) &&
    keys(node) ===
      "arch,executableByteLength,executableDigest,modules,platform,v8,version" &&
    boundedText(node.version, 128) &&
    boundedText(node.modules, 32) &&
    boundedText(node.v8, 128) &&
    boundedText(node.platform, 64) &&
    boundedText(node.arch, 64) &&
    digest(node.executableDigest) &&
    positiveBoundedInteger(node.executableByteLength, limits.executableBytes)
  );
}

function runtimePath(value) {
  return (
    boundedText(value, 512) &&
    !value.startsWith("/") &&
    !value.includes("\\") &&
    value
      .split("/")
      .every((part) => part !== "" && part !== "." && part !== "..")
  );
}

function packageName(value) {
  return (
    boundedText(value, 214) &&
    /^(?:@[a-z0-9._~-]+\/)?[a-z0-9._~-]+$/u.test(value)
  );
}

function boundedText(value, maximum) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

function positiveBoundedInteger(value, maximum) {
  return Number.isSafeInteger(value) && value > 0 && value <= maximum;
}

function digest(value) {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/u.test(value);
}

function keys(value) {
  return Object.keys(value).sort().join(",");
}

function setEqual(left, right) {
  return (
    left.size === right.size && [...left].every((value) => right.has(value))
  );
}

async function comparePilotRuntime(expected, options) {
  validatePilotRuntime(expected);
  const dependencies = expected.identity.resolutions
    .filter(({ from }) => from === "application")
    .map(({ specifier }) => specifier);
  const actual = await capturePilotRuntime({
    dependencies,
    ...options,
    profile: expected.identity.profile,
  });
  return {
    actual,
    matches:
      expected.digest === actual.digest &&
      equal(expected.identity, actual.identity),
  };
}

function describeRuntimeChanges(expected, actual) {
  const changes = [];
  if (!equal(expected.node, actual.node)) changes.push("Node runtime");

  const expectedFiles = new Map(
    expected.files.map((file) => [file.path, file]),
  );
  const actualFiles = new Map(actual.files.map((file) => [file.path, file]));
  for (const path of [
    ...new Set([...expectedFiles.keys(), ...actualFiles.keys()]),
  ].sort()) {
    if (!equal(expectedFiles.get(path), actualFiles.get(path))) {
      changes.push(`file ${path}`);
    }
  }

  const packageKeys = new Set([
    ...expected.packages.map(packageKey),
    ...actual.packages.map(packageKey),
  ]);
  for (const key of [...packageKeys].sort()) {
    const before = expected.packages.filter((item) => packageKey(item) === key);
    const after = actual.packages.filter((item) => packageKey(item) === key);
    if (!equal(before, after)) changes.push(`package ${key}`);
  }
  if (!equal(expected.resolutions, actual.resolutions)) {
    changes.push("package resolutions");
  }
  return changes.slice(0, 8);
}

function packageKey(item) {
  return `${item.name}@${item.version}`;
}

async function resolvedPackageClosure(
  root,
  dependencies,
  overrides = new Map(),
) {
  const roots = new Map();
  const pending = [];
  const unresolvedEdges = [];

  for (const specifier of [...dependencies].sort()) {
    const target =
      overrides.get(specifier) ??
      (await resolveApplicationPackage(specifier, root));
    unresolvedEdges.push({ from: "application", specifier, target });
    await enqueue(target);
  }

  while (pending.length > 0) {
    const packageRoot = pending.shift();
    const metadata = roots.get(packageRoot);
    const dependencies = new Set([
      ...Object.keys(metadata.document.dependencies ?? {}),
      ...Object.keys(metadata.document.optionalDependencies ?? {}),
      ...Object.keys(metadata.document.peerDependencies ?? {}),
    ]);
    for (const specifier of [...dependencies].sort()) {
      let target;
      try {
        target = await resolvePackageFrom(
          specifier,
          join(packageRoot, "package.json"),
        );
      } catch (error) {
        if (
          metadata.document.optionalDependencies?.[specifier] !== undefined ||
          metadata.document.peerDependenciesMeta?.[specifier]?.optional === true
        ) {
          continue;
        }
        throw error;
      }
      unresolvedEdges.push({ from: packageRoot, specifier, target });
      await enqueue(target);
    }
  }

  if (roots.size === 0 || roots.size > limits.packages) {
    throw new Error("real-model pilot runtime package set is invalid");
  }
  const packages = [];
  const idByRoot = new Map();
  let totalFiles = 0;
  let totalBytes = 0;
  for (const [packageRoot, metadata] of [...roots.entries()].sort((a, b) =>
    `${a[1].document.name}@${a[1].document.version}`.localeCompare(
      `${b[1].document.name}@${b[1].document.version}`,
      "en",
    ),
  )) {
    const bundle = await digestPackage(packageRoot);
    totalFiles += bundle.fileCount;
    totalBytes += bundle.byteLength;
    if (totalFiles > limits.packageFiles || totalBytes > limits.packageBytes) {
      throw new Error("real-model pilot runtime package closure is too large");
    }
    const id = `npm:${metadata.document.name}@${metadata.document.version}#${bundle.digest.slice(7)}`;
    idByRoot.set(packageRoot, id);
    packages.push({
      id,
      name: metadata.document.name,
      version: metadata.document.version,
      ...bundle,
    });
  }
  packages.sort((a, b) => a.id.localeCompare(b.id, "en"));
  const resolutions = unresolvedEdges
    .map(({ from, specifier, target }) => ({
      from: from === "application" ? from : idByRoot.get(from),
      specifier,
      to: idByRoot.get(target),
    }))
    .sort((a, b) =>
      `${a.from}\0${a.specifier}\0${a.to}`.localeCompare(
        `${b.from}\0${b.specifier}\0${b.to}`,
        "en",
      ),
    );
  if (resolutions.length > 1024) {
    throw new Error("real-model pilot runtime resolution set is too large");
  }
  return { packages, resolutions };

  async function enqueue(packageRoot) {
    if (roots.has(packageRoot)) return;
    const document = await readPackageManifest(packageRoot);
    if (
      typeof document.name !== "string" ||
      typeof document.version !== "string"
    ) {
      throw new Error("resolved runtime package has no stable identity");
    }
    roots.set(packageRoot, { document });
    pending.push(packageRoot);
  }
}

async function resolveApplicationPackage(specifier, root) {
  const importers = [
    join(root, "package.json"),
    join(root, "packages/mcp-server/package.json"),
    join(root, "packages/prototype/package.json"),
  ];
  let failure;
  for (const importer of importers) {
    try {
      return await resolvePackageFrom(specifier, importer);
    } catch (error) {
      failure = error;
    }
  }
  throw failure;
}

async function resolvePackageFrom(specifier, importer) {
  let directory = dirname(importer);
  for (;;) {
    const candidate = join(directory, "node_modules", specifier);
    let packageRoot;
    try {
      packageRoot = await realpath(candidate);
    } catch (error) {
      if (!pathMissing(error)) throw error;
    }
    if (packageRoot) {
      const document = await readPackageManifest(packageRoot);
      if (document.name === specifier) return packageRoot;
    }
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return resolvePackage(specifier, importer);
}

async function resolvePackage(specifier, importer) {
  const resolver = createRequire(importer);
  let entry;
  try {
    entry = resolver.resolve(`${specifier}/package.json`);
  } catch {
    entry = resolver.resolve(specifier);
  }
  let directory = dirname(await realpath(entry));
  for (;;) {
    let document;
    try {
      document = await readPackageManifest(directory);
    } catch (error) {
      if (!pathMissing(error)) throw error;
    }
    if (document?.name === specifier) return directory;
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  throw new Error(`could not resolve runtime package ${specifier}`);
}

function pathMissing(error) {
  return error?.code === "ENOENT" || error?.code === "ENOTDIR";
}

async function digestPackage(root) {
  const paths = await packageFiles(root);
  const entries = [];
  let byteLength = 0;
  for (const path of paths) {
    const file = await digestFile(
      join(root, path),
      limits.fileBytes,
      `runtime package file ${path}`,
    );
    byteLength += file.byteLength;
    if (byteLength > limits.packageBytes) {
      throw new Error("real-model pilot runtime package is too large");
    }
    entries.push({ path, ...file });
  }
  return {
    digest: contentDigest(entries),
    fileCount: entries.length,
    byteLength,
  };
}

async function readPackageManifest(root) {
  const bytes = await readBoundedExactFile(
    join(root, "package.json"),
    limits.packageManifestBytes,
    "runtime package manifest",
  );
  return JSON.parse(decodeUtf8(bytes, "runtime package manifest"));
}

async function packageFiles(root, directory = "") {
  const absolute = join(root, directory);
  const entries = await readdir(absolute, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name, "en"));
  const paths = [];
  for (const entry of entries) {
    if (entry.name === "node_modules") continue;
    const path = directory ? `${directory}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      paths.push(...(await packageFiles(root, path)));
      continue;
    }
    if (!entry.isFile()) {
      throw new Error("runtime package contains a non-file entry");
    }
    paths.push(path);
    if (paths.length > limits.packageFiles) {
      throw new Error("real-model pilot runtime package has too many files");
    }
  }
  return paths;
}

async function javascriptFiles(root, directory) {
  const absolute = join(root, directory);
  const entries = await readdir(absolute, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name, "en"));
  const files = [];
  for (const entry of entries) {
    const path = join(absolute, entry.name);
    if (entry.isDirectory()) {
      files.push(
        ...(await javascriptFiles(
          root,
          relative(root, path).split(sep).join("/"),
        )),
      );
    } else if (entry.isFile() && /\.(?:js|mjs)$/u.test(entry.name)) {
      files.push(relative(root, path).split(sep).join("/"));
    } else if (!entry.isFile()) {
      throw new Error("real-model pilot runtime contains a non-file entry");
    }
  }
  return files;
}

async function digestFile(path, maximum, label) {
  const link = await lstat(path, { bigint: true });
  if (!link.isFile()) {
    throw new Error(`${label} is not a bounded regular file`);
  }
  const flags =
    process.platform === "win32"
      ? "r"
      : fsConstants.O_RDONLY |
        (fsConstants.O_NOFOLLOW ?? 0) |
        (fsConstants.O_NONBLOCK ?? 0) |
        (fsConstants.O_CLOEXEC ?? 0);
  const handle = await open(path, flags);
  try {
    const before = await handle.stat({ bigint: true });
    if (
      !before.isFile() ||
      before.dev !== link.dev ||
      before.ino !== link.ino ||
      before.size < 0n ||
      before.size > BigInt(maximum) ||
      before.size > BigInt(Number.MAX_SAFE_INTEGER)
    ) {
      throw new Error(`${label} is not a bounded regular file`);
    }
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(64 * 1024);
    const expectedSize = Number(before.size);
    let offset = 0;
    while (offset < expectedSize) {
      const { bytesRead } = await handle.read(
        buffer,
        0,
        Math.min(buffer.length, expectedSize - offset),
        offset,
      );
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
      offset += bytesRead;
    }
    const [after, current] = await Promise.all([
      handle.stat({ bigint: true }),
      lstat(path, { bigint: true }),
    ]);
    if (
      offset !== expectedSize ||
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.size !== before.size ||
      after.mtimeNs !== before.mtimeNs ||
      after.ctimeNs !== before.ctimeNs ||
      !current.isFile() ||
      current.dev !== before.dev ||
      current.ino !== before.ino
    ) {
      throw new Error(`${label} changed while hashing`);
    }
    return {
      digest: `sha256:${hash.digest("hex")}`,
      byteLength: expectedSize,
    };
  } finally {
    await handle.close();
  }
}

function contentDigest(value) {
  return `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`;
}

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function equal(left, right) {
  return canonical(left) === canonical(right);
}

function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
