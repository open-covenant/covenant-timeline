import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { constants as fsConstants, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { lstat, open, readFile, realpath, writeFile } from "node:fs/promises";
import {
  dirname,
  isAbsolute,
  join,
  relative as relativePath,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { TextDecoder } from "node:util";

const fatalUtf8 = new TextDecoder("utf-8", {
  fatal: true,
  ignoreBOM: true,
});

export const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
);

export function isMain(moduleUrl, entry = process.argv[1]) {
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}

export const MCP_AGENT_PILOT_LIMITS = Object.freeze({
  maxArtifactBytes: 64 * 1024,
  maxRunBytes: 4 * 1024 * 1024,
  maxEnvironmentBytes: 64 * 1024,
  maxEvidenceManifestBytes: 256 * 1024,
  maxEvidenceFiles: 256,
  maxEvidenceFileBytes: 4 * 1024 * 1024,
  maxEvidenceTotalBytes: 16 * 1024 * 1024,
  maxConclusions: 64,
  maxQueryBytes: 1024 * 1024,
  maxQueryTotalBytes: 4 * 1024 * 1024,
  maxConclusionBytes: 4 * 1024 * 1024,
  maxConclusionTotalBytes: 16 * 1024 * 1024,
  maxTranscriptBytes: 8 * 1024 * 1024,
  maxTranscriptLines: 10_000,
});

export async function loadTimeline() {
  const require = createRequire(
    join(repositoryRoot, "packages/mcp-server/package.json"),
  );
  const entry = require.resolve("@covenant-org/timeline");
  return import(pathToFileURL(entry).href);
}

export async function loadMcpClient() {
  const require = createRequire(
    join(repositoryRoot, "packages/mcp-server/package.json"),
  );
  const clientEntry = require.resolve("@modelcontextprotocol/client");
  const stdioEntry = require.resolve("@modelcontextprotocol/client/stdio");
  const [{ Client }, { StdioClientTransport }] = await Promise.all([
    import(pathToFileURL(clientEntry).href),
    import(pathToFileURL(stdioEntry).href),
  ]);
  return { Client, StdioClientTransport };
}

export async function readJson(path, parseJson) {
  return parseJson(decodeUtf8(await readFile(path), "JSON file"));
}

export async function writeCanonicalJson(path, value, canonicalJson) {
  await writeFile(path, `${canonicalJson(value)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
}

export function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function sourceIdentity() {
  const revisionResult = spawnSync(
    "git",
    ["-C", repositoryRoot, "rev-parse", "HEAD"],
    { encoding: "utf8", env: credentialFreeEnvironment() },
  );
  const revision = revisionResult.stdout.trim();
  if (revisionResult.status !== 0 || !/^[0-9a-f]{40}$/.test(revision)) {
    throw new Error("source checkout has no exact Git revision");
  }
  const status = spawnSync(
    "git",
    ["-C", repositoryRoot, "status", "--porcelain"],
    { encoding: "utf8", env: credentialFreeEnvironment() },
  );
  if (status.status !== 0) throw new Error("source status is unavailable");
  return {
    revision,
    dirty: status.stdout !== "",
  };
}

export function decodeUtf8(bytes, label) {
  try {
    return fatalUtf8.decode(bytes);
  } catch {
    throw new Error(`${label} is not valid UTF-8`);
  }
}

export function resolveInside(root, relative, label) {
  if (
    typeof relative !== "string" ||
    relative.length === 0 ||
    relative.includes("\\")
  ) {
    throw new Error(`${label} must be a relative POSIX path`);
  }
  const path = resolve(root, relative);
  const fromRoot = relativePath(resolve(root), path);
  if (
    fromRoot === "" ||
    fromRoot === ".." ||
    fromRoot.startsWith(`..${sep}`) ||
    isAbsolute(fromRoot)
  ) {
    throw new Error(`${label} leaves its root directory`);
  }
  return path;
}

export async function canonicalArtifactRoot(directory) {
  return canonicalDirectory(directory, "artifact root");
}

export async function canonicalInputRoot(directory) {
  return canonicalDirectory(directory, "input root");
}

export async function assertArtifactDirectory(root, path, label) {
  return assertRealDirectory(root, path, label, "the artifact");
}

export async function assertInputDirectory(root, path, label) {
  return assertRealDirectory(root, path, label, "the input");
}

async function assertRealDirectory(root, path, label, scope) {
  const absolute = assertContainedPath(root, path, label, scope);
  const [stat, canonical] = await Promise.all([
    lstat(absolute),
    realpath(absolute),
  ]);
  if (!stat.isDirectory() || canonical !== absolute) {
    throw new Error(`${label} must be a real directory inside ${scope}`);
  }
}

export async function readBoundedArtifactFile(
  root,
  path,
  maxBytes,
  label,
  reserve,
) {
  return readBoundedExactFile(path, maxBytes, label, {
    root,
    scope: "the artifact",
    reserve,
  });
}

export async function readBoundedInputFile(
  root,
  path,
  maxBytes,
  label,
  reserve,
) {
  return readBoundedExactFile(path, maxBytes, label, {
    root,
    scope: "the input",
    reserve,
  });
}

export async function readBoundedExactFile(
  path,
  maxBytes,
  label,
  {
    root,
    scope = "its containing directory",
    reserve,
    validate,
    sync = false,
  } = {},
) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new TypeError("maxBytes must be a non-negative safe integer");
  }
  const absolute = root
    ? assertContainedPath(root, path, label, scope)
    : resolve(path);
  const link = await lstat(absolute, { bigint: true });
  if (!link.isFile()) {
    throw new Error(`${label} must be a real file inside ${scope}`);
  }

  const flags =
    process.platform === "win32"
      ? sync
        ? "r+"
        : "r"
      : fsConstants.O_RDONLY |
        (fsConstants.O_NOFOLLOW ?? 0) |
        (fsConstants.O_NONBLOCK ?? 0) |
        (fsConstants.O_CLOEXEC ?? 0);
  const handle = await open(absolute, flags);
  try {
    const before = await handle.stat({ bigint: true });
    if (
      !before.isFile() ||
      before.dev !== link.dev ||
      before.ino !== link.ino ||
      before.size < 0n ||
      before.size > BigInt(maxBytes) ||
      before.size > BigInt(Number.MAX_SAFE_INTEGER)
    ) {
      throw new Error(
        `${label} exceeds its byte limit or changed while opening`,
      );
    }
    const expectedSize = Number(before.size);
    if (reserve !== undefined) reserve(expectedSize);

    const bytes = Buffer.alloc(expectedSize + 1);
    let offset = 0;
    while (offset < bytes.byteLength) {
      const { bytesRead } = await handle.read(
        bytes,
        offset,
        bytes.byteLength - offset,
        null,
      );
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    const [after, current] = await Promise.all([
      handle.stat({ bigint: true }),
      lstat(absolute, { bigint: true }),
    ]);
    if (
      offset !== expectedSize ||
      !sameExactFileVersion(before, after) ||
      !sameExactFileVersion(before, current)
    ) {
      throw new Error(
        `${label} exceeds its byte limit or changed while reading`,
      );
    }
    const exact = bytes.subarray(0, offset);
    if (validate !== undefined) {
      await validate(exact);
      const reread = Buffer.alloc(expectedSize + 1);
      let rereadOffset = 0;
      while (rereadOffset < reread.byteLength) {
        const { bytesRead } = await handle.read(
          reread,
          rereadOffset,
          reread.byteLength - rereadOffset,
          rereadOffset,
        );
        if (bytesRead === 0) break;
        rereadOffset += bytesRead;
      }
      if (
        rereadOffset !== expectedSize ||
        !exact.equals(reread.subarray(0, rereadOffset))
      ) {
        throw new Error(`${label} changed while being validated`);
      }
    }
    const [validated, validatedPath] = await Promise.all([
      handle.stat({ bigint: true }),
      lstat(absolute, { bigint: true }),
    ]);
    if (
      !sameExactFileVersion(before, validated) ||
      !sameExactFileVersion(before, validatedPath)
    ) {
      throw new Error(`${label} changed while being validated`);
    }
    if (sync) {
      await handle.sync();
      const syncedPath = await lstat(absolute, { bigint: true });
      if (
        !syncedPath.isFile() ||
        syncedPath.dev !== before.dev ||
        syncedPath.ino !== before.ino
      ) {
        throw new Error(`${label} changed while being synchronized`);
      }
    }
    return exact;
  } finally {
    await handle.close();
  }
}

function sameExactFileVersion(before, candidate) {
  if (
    !candidate.isFile() ||
    candidate.dev !== before.dev ||
    candidate.ino !== before.ino ||
    candidate.size !== before.size ||
    candidate.mtimeNs !== before.mtimeNs ||
    candidate.mode !== before.mode ||
    candidate.uid !== before.uid ||
    candidate.gid !== before.gid
  ) {
    return false;
  }
  if (
    candidate.ctimeNs === before.ctimeNs &&
    candidate.nlink === before.nlink
  ) {
    return true;
  }

  // Atomic publishers expose a hard link, then remove their staging link.
  return (
    before.nlink === 2n &&
    candidate.nlink === 1n &&
    candidate.ctimeNs >= before.ctimeNs
  );
}

export function credentialFreeEnvironment(source = process.env) {
  const environment = {};
  for (const name of [
    "PATH",
    "SystemRoot",
    "WINDIR",
    "COMSPEC",
    "PATHEXT",
    "TMPDIR",
    "TEMP",
    "TMP",
    "LANG",
    "LC_ALL",
  ]) {
    if (source[name] !== undefined) environment[name] = source[name];
  }
  environment.GIT_CONFIG_NOSYSTEM = "1";
  environment.GIT_CONFIG_GLOBAL =
    process.platform === "win32" ? "NUL" : "/dev/null";
  environment.GIT_OPTIONAL_LOCKS = "0";
  return environment;
}

async function canonicalDirectory(directory, label) {
  const root = await realpath(directory);
  const stat = await lstat(root);
  if (!stat.isDirectory()) {
    throw new Error(`${label} must be a directory`);
  }
  return root;
}

function assertContainedPath(root, path, label, scope) {
  const absolute = resolve(path);
  const fromRoot = relativePath(root, absolute);
  if (
    fromRoot === "" ||
    fromRoot === ".." ||
    fromRoot.startsWith(`..${sep}`) ||
    isAbsolute(fromRoot)
  ) {
    throw new Error(`${label} leaves ${scope} root`);
  }
  return absolute;
}

export function exactRecord(value, keys, label) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new Error(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new Error(`${label} has unexpected fields`);
  }
  return value;
}

export function safeName(value, label) {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(value)) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

export function safeEvidenceName(value, label) {
  if (
    typeof value !== "string" ||
    !/^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/.test(value)
  ) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}
