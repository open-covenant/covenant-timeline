export const expectedMcpArchiveFiles = [
  "LICENSE",
  "README.md",
  "dist/cli.d.ts",
  "dist/cli.d.ts.map",
  "dist/cli.js",
  "dist/cli.js.map",
  "dist/constants.d.ts",
  "dist/constants.d.ts.map",
  "dist/constants.js",
  "dist/constants.js.map",
  "dist/demo.d.ts",
  "dist/demo.d.ts.map",
  "dist/demo.js",
  "dist/demo.js.map",
  "dist/errors.d.ts",
  "dist/errors.d.ts.map",
  "dist/errors.js",
  "dist/errors.js.map",
  "dist/index.d.ts",
  "dist/index.d.ts.map",
  "dist/index.js",
  "dist/index.js.map",
  "dist/schemas.d.ts",
  "dist/schemas.d.ts.map",
  "dist/schemas.js",
  "dist/schemas.js.map",
  "dist/server.d.ts",
  "dist/server.d.ts.map",
  "dist/server.js",
  "dist/server.js.map",
  "dist/store.d.ts",
  "dist/store.d.ts.map",
  "dist/store.js",
  "dist/store.js.map",
  "dist/types.d.ts",
  "dist/types.d.ts.map",
  "dist/types.js",
  "dist/types.js.map",
  "package.json",
].map((file) => `package/${file}`);

export const maxMcpArchiveUnpackedBytes = 8 * 1024 * 1024;

export function assertMcpArchiveFiles(files) {
  return assertMcpArchiveEntries(
    files.map((name) => ({ name, size: 0, type: "-" })),
  );
}

export function parseMcpTarListings(namesText, verboseText) {
  const names = lines(namesText);
  const verbose = lines(verboseText);
  if (names.length !== verbose.length) {
    throw new Error("MCP archive listings disagree");
  }
  return names.map((name, index) => {
    const listing = verbose[index];
    const type = listing[0];
    return {
      name,
      size: type === "-" ? parseRegularFileSize(listing, name) : 0,
      type,
    };
  });
}

export function assertMcpArchiveEntries(
  entries,
  { expectedUnpackedSize } = {},
) {
  const actual = entries.map(({ name }) => name).sort();
  const expected = [...expectedMcpArchiveFiles].sort();
  const unexpected = actual.filter((file) => !expected.includes(file));
  const missing = expected.filter((file) => !actual.includes(file));
  const duplicate = new Set(actual).size !== actual.length;
  const nonRegular = entries.filter(({ type }) => type !== "-");
  let unpackedSize = 0;
  for (const entry of entries) {
    if (!Number.isSafeInteger(entry.size) || entry.size < 0) {
      throw new Error(`invalid MCP archive member size for ${entry.name}`);
    }
    unpackedSize += entry.size;
    if (
      !Number.isSafeInteger(unpackedSize) ||
      unpackedSize > maxMcpArchiveUnpackedBytes
    ) {
      throw new Error(
        `MCP archive exceeds ${maxMcpArchiveUnpackedBytes} unpacked bytes`,
      );
    }
  }
  if (
    expectedUnpackedSize !== undefined &&
    unpackedSize !== expectedUnpackedSize
  ) {
    throw new Error(
      `MCP archive unpacked size must be ${expectedUnpackedSize}, received ${unpackedSize}`,
    );
  }
  if (
    unexpected.length === 0 &&
    missing.length === 0 &&
    !duplicate &&
    nonRegular.length === 0
  ) {
    return { fileCount: entries.length, unpackedSize };
  }

  throw new Error(
    [
      unexpected.length > 0
        ? `unexpected MCP archive files: ${unexpected.join(", ")}`
        : undefined,
      missing.length > 0
        ? `missing MCP archive files: ${missing.join(", ")}`
        : undefined,
      duplicate ? "duplicate MCP archive members" : undefined,
      nonRegular.length > 0
        ? `non-regular MCP archive members: ${nonRegular
            .map(({ name, type }) => `${name} (${type})`)
            .join(", ")}`
        : undefined,
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

function parseRegularFileSize(listing, name) {
  const suffix = ` ${name}`;
  if (!listing.endsWith(suffix)) {
    throw new Error(`MCP archive verbose listing disagrees for ${name}`);
  }
  const fields = listing.slice(0, -suffix.length).trim().split(/\s+/);
  let value;
  if (/^[0-9]+$/.test(fields[1]) && fields.length >= 8) {
    value = fields[4];
  } else if (fields[1]?.includes("/") && fields.length >= 5) {
    value = fields[2];
  } else {
    throw new Error(`unsupported tar verbose listing for ${name}`);
  }
  const size = Number(value);
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new Error(`invalid MCP archive member size for ${name}`);
  }
  return size;
}

function lines(value) {
  return value.trim().split(/\r?\n/).filter(Boolean);
}
