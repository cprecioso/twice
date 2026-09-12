/// <reference types="node" />

import * as it from "@cprecioso/async-iterable-helpers";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { defineConfig } from "tsdown";

const nodeMajorVersion = process.versions.node.split(".").at(0);
assert(nodeMajorVersion);

const entry = await it
  .from(fs.glob("src/*.entry.ts", { cwd: import.meta.dirname }))
  .pipe(it.map((file) => [path.basename(file, ".entry.ts"), file] as const))
  .sink(it.toArray())
  .then((pairs) => Object.fromEntries(pairs));

export default defineConfig({
  entry,

  outDir: "dist",
  clean: true,

  platform: "node",
  target: "node" + nodeMajorVersion,
  format: "esm",

  sourcemap: true,
  dts: { sourcemap: true },

  attw: { profile: "esm-only" },
  publint: { strict: true },
});
