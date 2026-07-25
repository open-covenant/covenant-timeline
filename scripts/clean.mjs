import { rm } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

if (process.argv.length < 3) {
  throw new Error("clean requires at least one relative target");
}

const base = process.cwd();
for (const target of process.argv.slice(2)) {
  if (isAbsolute(target)) throw new Error("clean targets must be relative");
  const resolved = resolve(base, target);
  const relation = relative(base, resolved);
  if (!relation || relation.startsWith("..")) {
    throw new Error(`refusing to clean ${target}`);
  }
  await rm(resolved, { recursive: true, force: true });
}
