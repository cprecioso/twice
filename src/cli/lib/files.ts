// oxlint-disable no-await-in-loop

import * as fs from "node:fs/promises";
import * as path from "node:path";

export interface CollectedFile {
  /** The slash-separated path of the file, relative to the collection root. */
  path: string;
  /** The git mode of the file: executable or not. */
  mode: "100644" | "100755";
}

const toPosix = (p: string) => p.split(path.sep).join(path.posix.sep);

/**
 * The regular files matched by `globs` (relative to `cwd`), sorted by path.
 * Matched directories are included recursively. Symlinks are followed.
 */
export const collectFiles = async (
  cwd: string,
  globs: readonly string[],
): Promise<CollectedFile[]> => {
  const files = new Map<string, CollectedFile>();

  const visit = async (relPath: string, { recurse }: { recurse: boolean }) => {
    const absPath = path.join(cwd, relPath);
    const stat = await fs.stat(absPath);

    if (stat.isFile()) {
      const posixPath = toPosix(relPath);
      files.set(posixPath, {
        path: posixPath,
        mode: stat.mode & 0o111 ? "100755" : "100644",
      });
    } else if (stat.isDirectory() && recurse) {
      const entries = await fs.readdir(absPath, {
        recursive: true,
        withFileTypes: true,
      });
      for (const entry of entries) {
        if (!entry.isFile() && !entry.isSymbolicLink()) continue;
        const entryPath = path.join(entry.parentPath, entry.name);
        await visit(path.relative(cwd, entryPath), { recurse: false });
      }
    }
  };

  for await (const match of fs.glob([...globs], { cwd })) {
    await visit(match, { recurse: true });
  }

  return [...files.values()].toSorted((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );
};
