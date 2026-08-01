import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
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
  "typescript",
  "zod",
];
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
  dependencies = applicationDependencies,
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
    new Set(paths).size !== paths.length
  ) {
    throw new Error("real-model pilot runtime file set is invalid");
  }
  await assertRelativeImportClosure(root, paths);
  const files = await Promise.all(
    paths.map(async (path) => ({
      path,
      ...(await digestFile(
        join(root, path),
        limits.fileBytes,
        `runtime file ${path}`,
      )),
    })),
  );
  const closure = await resolvedPackageClosure(resolutionRoot, dependencies);
  const identity = {
    schema: "covenant.timeline.real-model-pilot.runtime.v1",
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

async function assertRelativeImportClosure(root, paths) {
  const included = new Set(paths);
  const sources = new Map();
  for (const path of paths) {
    if (!/\.(?:js|mjs)$/u.test(path)) continue;
    const bytes = await readBoundedExactFile(
      join(root, path),
      limits.fileBytes,
      `runtime source ${path}`,
    );
    sources.set(path, decodeUtf8(bytes, `runtime source ${path}`));
  }
  for (const [path, specifiers] of runtimeModuleSpecifiers(sources)) {
    for (const specifier of specifiers) {
      if (!isRelativeSpecifier(specifier)) continue;
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
    }
  }
}

function runtimeModuleSpecifiers(sources) {
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
    result.set(path, moduleSpecifiersForSource(sourceFile, checker));
  }
  return result;
}

function moduleSpecifiersForSource(sourceFile, checker) {
  const specifiers = new Set();
  const createRequireBindings = importedBindings(
    sourceFile,
    checker,
    "node:module",
    "createRequire",
  );
  const pathToFileUrlBindings = importedBindings(
    sourceFile,
    checker,
    "node:url",
    "pathToFileURL",
  );
  const loaderBindings = new Set();
  const loaderDeclarations = new Set();
  const createRequireInitializers = new Set();

  visit(sourceFile, (node) => {
    if (
      !ts.isVariableDeclaration(node) ||
      !node.initializer ||
      !ts.isCallExpression(node.initializer) ||
      !isImportedCall(node.initializer, createRequireBindings, checker)
    ) {
      return;
    }
    if (!ts.isIdentifier(node.name) || !isConstDeclaration(node)) {
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
  });

  const resolvedPackages = new Map();
  visit(sourceFile, (node) => {
    if (
      !ts.isVariableDeclaration(node) ||
      !ts.isIdentifier(node.name) ||
      !isConstDeclaration(node) ||
      !node.initializer ||
      !ts.isCallExpression(node.initializer) ||
      !isLoaderResolveCall(node.initializer, loaderBindings, checker)
    ) {
      return;
    }
    const specifier = soleLiteralArgument(node.initializer);
    if (!specifier || isRelativeSpecifier(specifier)) return;
    const symbol = checker.getSymbolAtLocation(node.name);
    if (symbol) resolvedPackages.set(symbol, specifier);
  });

  visit(sourceFile, (node) => {
    if (
      ts.isImportDeclaration(node) ||
      (ts.isExportDeclaration(node) && node.moduleSpecifier)
    ) {
      const specifier = literalText(node.moduleSpecifier);
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
      const specifier = soleLiteralArgument(node);
      if (specifier !== undefined) {
        specifiers.add(specifier);
        return;
      }
      if (
        node.arguments.length === 1 &&
        isResolvedPackageUrl(
          node.arguments[0],
          pathToFileUrlBindings,
          resolvedPackages,
          checker,
        )
      ) {
        return;
      }
      throw new Error(
        `runtime source ${sourceFile.fileName} contains an unsupported computed dynamic import`,
      );
    }
    if (
      ts.isCallExpression(node) &&
      isImportedCall(node, createRequireBindings, checker) &&
      !createRequireInitializers.has(node)
    ) {
      throw new Error(
        `runtime source ${sourceFile.fileName} uses createRequire outside a const binding`,
      );
    }
    if (!ts.isCallExpression(node)) return;
    const loader = checker.getSymbolAtLocation(node.expression);
    if (loaderBindings.has(loader)) {
      const specifier = soleLiteralArgument(node);
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

function importedBindings(sourceFile, checker, moduleName, importedName) {
  const bindings = new Set();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      literalText(statement.moduleSpecifier) !== moduleName ||
      !statement.importClause?.namedBindings ||
      !ts.isNamedImports(statement.importClause.namedBindings)
    ) {
      continue;
    }
    for (const element of statement.importClause.namedBindings.elements) {
      if ((element.propertyName ?? element.name).text !== importedName)
        continue;
      const symbol = checker.getSymbolAtLocation(element.name);
      if (symbol) bindings.add(symbol);
    }
  }
  return bindings;
}

function isImportedCall(call, bindings, checker) {
  return (
    ts.isIdentifier(call.expression) &&
    bindings.has(checker.getSymbolAtLocation(call.expression))
  );
}

function isLoaderResolveCall(call, bindings, checker) {
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
) {
  if (
    !ts.isPropertyAccessExpression(expression) ||
    expression.name.text !== "href" ||
    !ts.isCallExpression(expression.expression) ||
    !isImportedCall(expression.expression, pathToFileUrlBindings, checker) ||
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

function soleLiteralArgument(call) {
  if (call.arguments.length !== 1) return undefined;
  return literalText(call.arguments[0]);
}

function literalText(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  return undefined;
}

function isConstDeclaration(declaration) {
  return (
    ts.isVariableDeclarationList(declaration.parent) &&
    (declaration.parent.flags & ts.NodeFlags.Const) !== 0
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
    contentDigest(expected.identity) !== expected.digest
  ) {
    throw new Error("real-model pilot runtime digest did not reproduce");
  }
  return expected;
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

async function resolvedPackageClosure(root, dependencies) {
  const roots = new Map();
  const pending = [];
  const unresolvedEdges = [];

  for (const specifier of [...dependencies].sort()) {
    const target = await resolveApplicationPackage(specifier, root);
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
  if (specifier === "typescript") {
    return resolvePackage(specifier, import.meta.url);
  }
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
