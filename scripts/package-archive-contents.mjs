export function parseTarListings(namesText, verboseText, label) {
  const names = lines(namesText);
  const verbose = lines(verboseText);
  if (names.length !== verbose.length) {
    throw new Error(`${label} archive listings disagree`);
  }

  return names.map((name, index) => {
    const listing = verbose[index];
    const type = listing[0];
    return {
      name,
      size: type === "-" ? parseRegularFileSize(listing, name, label) : 0,
      type,
    };
  });
}

export function assertArchiveFiles(files, options) {
  return assertArchiveEntries(
    files.map((name) => ({ name, size: 0, type: "-" })),
    options,
  );
}

export function assertArchiveEntries(
  entries,
  { expectedFiles, expectedUnpackedSize, label, maxUnpackedBytes },
) {
  const actual = entries.map(({ name }) => name).sort();
  const expected = [...expectedFiles].sort();
  const unexpected = actual.filter((file) => !expected.includes(file));
  const missing = expected.filter((file) => !actual.includes(file));
  const duplicate = new Set(actual).size !== actual.length;
  const nonRegular = entries.filter(({ type }) => type !== "-");
  let unpackedSize = 0;

  for (const entry of entries) {
    if (!Number.isSafeInteger(entry.size) || entry.size < 0) {
      throw new Error(`invalid ${label} archive member size for ${entry.name}`);
    }
    unpackedSize += entry.size;
    if (
      !Number.isSafeInteger(unpackedSize) ||
      unpackedSize > maxUnpackedBytes
    ) {
      throw new Error(
        `${label} archive exceeds ${maxUnpackedBytes} unpacked bytes`,
      );
    }
  }

  if (
    expectedUnpackedSize !== undefined &&
    unpackedSize !== expectedUnpackedSize
  ) {
    throw new Error(
      `${label} archive unpacked size must be ${expectedUnpackedSize}, received ${unpackedSize}`,
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
        ? `unexpected ${label} archive files: ${unexpected.join(", ")}`
        : undefined,
      missing.length > 0
        ? `missing ${label} archive files: ${missing.join(", ")}`
        : undefined,
      duplicate ? `duplicate ${label} archive members` : undefined,
      nonRegular.length > 0
        ? `non-regular ${label} archive members: ${nonRegular
            .map(({ name, type }) => `${name} (${type})`)
            .join(", ")}`
        : undefined,
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

function parseRegularFileSize(listing, name, label) {
  const suffix = ` ${name}`;
  if (!listing.endsWith(suffix)) {
    throw new Error(`${label} archive verbose listing disagrees for ${name}`);
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
    throw new Error(`invalid ${label} archive member size for ${name}`);
  }
  return size;
}

function lines(value) {
  return value.trim().split(/\r?\n/).filter(Boolean);
}
