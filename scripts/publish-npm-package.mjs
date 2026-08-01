#!/usr/bin/env node

import { createHash, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const MAX_ARCHIVE_BYTES = 16 * 1024 * 1024;

export async function reconcileNpmPackage(
  { archive, packageName, version, distTag },
  dependencies = {},
) {
  const expected = await readFile(resolve(archive));
  if (expected.byteLength > MAX_ARCHIVE_BYTES) {
    throw new Error("npm package archive exceeds its byte limit");
  }
  const inspect = dependencies.inspect ?? inspectRegistry;
  const download = dependencies.download ?? downloadTarball;
  const publish = dependencies.publish ?? publishArchive;
  const spec = `${packageName}@${version}`;

  const existing = await inspect(spec);
  if (existing !== null) {
    await verifyExisting(existing, expected, download);
    return { status: "existing", spec };
  }

  try {
    await publish({ archive: resolve(archive), distTag });
    return { status: "published", spec };
  } catch (publishError) {
    const recovered = await inspect(spec);
    if (recovered === null) throw publishError;
    await verifyExisting(recovered, expected, download);
    return { status: "recovered", spec };
  }
}

async function inspectRegistry(spec) {
  const result = spawnSync(command("npm"), ["view", spec, "dist", "--json"], {
    encoding: "utf8",
    env: process.env,
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    if (/npm error code E404\b/u.test(result.stderr)) return null;
    throw commandError("npm registry lookup failed", result);
  }
  let value;
  try {
    value = JSON.parse(result.stdout);
  } catch {
    throw new Error("npm registry returned invalid package metadata");
  }
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    typeof value.tarball !== "string" ||
    typeof value.integrity !== "string" ||
    typeof value.shasum !== "string"
  ) {
    throw new Error("npm registry returned incomplete package metadata");
  }
  const tarball = new URL(value.tarball);
  if (
    tarball.protocol !== "https:" ||
    tarball.hostname !== "registry.npmjs.org"
  ) {
    throw new Error("npm registry returned an unexpected tarball URL");
  }
  return {
    tarball: tarball.href,
    integrity: value.integrity,
    shasum: value.shasum,
  };
}

async function downloadTarball(url) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`npm tarball download failed with HTTP ${response.status}`);
  }
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_ARCHIVE_BYTES) {
    throw new Error("npm tarball exceeds its byte limit");
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > MAX_ARCHIVE_BYTES) {
    throw new Error("npm tarball exceeds its byte limit");
  }
  return bytes;
}

function publishArchive({ archive, distTag }) {
  const result = spawnSync(
    command("npm"),
    [
      "publish",
      archive,
      "--access",
      "public",
      "--provenance",
      "--tag",
      distTag,
    ],
    {
      encoding: "utf8",
      env: process.env,
      shell: process.platform === "win32",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (result.status !== 0) throw commandError("npm publish failed", result);
}

async function verifyExisting(metadata, expected, download) {
  const observed = Buffer.from(await download(metadata.tarball));
  verifyDigest(observed, "sha512", metadata.integrity, "integrity");
  verifyDigest(observed, "sha1", metadata.shasum, "shasum");
  if (
    observed.byteLength !== expected.byteLength ||
    !timingSafeEqual(observed, expected)
  ) {
    throw new Error("published npm package differs from the release archive");
  }
}

function verifyDigest(bytes, algorithm, expected, label) {
  const actual =
    algorithm === "sha512"
      ? `${algorithm}-${createHash(algorithm).update(bytes).digest("base64")}`
      : createHash(algorithm).update(bytes).digest("hex");
  if (actual !== expected) {
    throw new Error(`published npm package ${label} is invalid`);
  }
}

function commandError(label, result) {
  return new Error(
    [label, result.error?.message, result.stdout, result.stderr]
      .filter(Boolean)
      .join("\n")
      .trim(),
  );
}

function command(name) {
  return process.platform === "win32" ? `${name}.cmd` : name;
}

const isEntrypoint =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isEntrypoint) {
  const [archive, packageName, version, distTag, ...unexpected] =
    process.argv.slice(2);
  if (
    !archive ||
    !packageName ||
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(version ?? "") ||
    !/^[a-z][a-z0-9._-]{0,127}$/u.test(distTag ?? "") ||
    unexpected.length > 0
  ) {
    throw new Error(
      "usage: publish-npm-package <archive> <package> <version> <dist-tag>",
    );
  }
  const result = await reconcileNpmPackage({
    archive,
    packageName,
    version,
    distTag,
  });
  process.stdout.write(
    `${result.spec} ${result.status} (${basename(resolve(archive))})\n`,
  );
}
