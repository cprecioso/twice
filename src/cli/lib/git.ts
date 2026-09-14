// oxlint-disable no-await-in-loop

import { message } from "@optique/core/message";
import { execa, ExecaError } from "execa";
import * as path from "node:path";
import type { Readable } from "node:stream";
import { CliError } from "../error";

/** A git object id, as printed by git. */
export type Oid = string;

export type TreeEntryType = "blob" | "tree" | "commit";

export interface TreeEntry {
  /** The octal mode as printed by `git ls-tree`, e.g. `100644`. */
  mode: string;
  type: TreeEntryType;
  oid: Oid;
  /**
   * The slash-separated path of the entry, relative to the tree it was read
   * from or will be written to.
   */
  path: string;
}

export interface CommitAuthor {
  name: string;
  email: string;
  /** A date in any format git accepts, e.g. its raw `<timestamp> <offset>`. */
  date: string;
}

export interface Trailer {
  key: string;
  value: string;
}

const treeMode = "040000";

const parseTreeEntry = (line: string): TreeEntry => {
  const match = /^(\d+) (blob|tree|commit) ([0-9a-f]+)\t(.+)$/s.exec(line);
  if (!match) throw new Error(`Unexpected git ls-tree output: ${line}`);
  const [, mode, type, oid, entryPath] = match;
  return {
    mode: mode!,
    type: type as TreeEntryType,
    oid: oid!,
    path: entryPath!,
  };
};

/** The directory an entry path lives in; `""` for the root. */
const parentDir = (entryPath: string) => {
  const dir = path.posix.dirname(entryPath);
  return dir === "." ? "" : dir;
};

const depthOf = (dir: string) => (dir === "" ? 0 : dir.split("/").length);

const lines = (output: string) =>
  output.split("\n").filter((line) => line !== "");

/**
 * Thin wrappers around the git plumbing commands used to read and write
 * objects and refs in the repository at `cwd`.
 */
export const createGit = ({
  cwd,
  env = {},
}: {
  cwd: string;
  env?: Readonly<Record<string, string>>;
}) => {
  const $ = execa({ cwd, env, stdout: "pipe", stderr: "pipe" });

  /** Resolves a revision to an object id, or `null` if it doesn't resolve. */
  const revParse = async (rev: string): Promise<Oid | null> => {
    const result = await $({
      reject: false,
    })`git rev-parse --verify --quiet ${rev}`;
    return result.failed ? null : result.stdout.trim();
  };

  /** The short name of the ref a symbolic ref points to, or `null`. */
  const symbolicRef = async (name: string): Promise<string | null> => {
    const result = await $({
      reject: false,
    })`git symbolic-ref --quiet --short ${name}`;
    return result.failed ? null : result.stdout.trim();
  };

  const isValidRef = async (ref: string) =>
    !(await $({ reject: false })`git check-ref-format ${ref}`).failed;

  /** Writes a blob with the given content. */
  const hashObject = async (
    input: Readable | Uint8Array | string,
  ): Promise<Oid> =>
    (await $({ input })`git hash-object -w --stdin`).stdout.trim();

  /** Writes one blob per file, with the content of the file as is. */
  const hashObjectPaths = async (paths: readonly string[]): Promise<Oid[]> => {
    if (paths.length === 0) return [];

    const invalid = paths.find((p) => p.includes("\n"));
    if (invalid !== undefined) {
      throw new CliError(
        message`Cannot store ${invalid}: file names must not contain line breaks.`,
      );
    }

    const { stdout } = await $({
      input: paths.map((p) => `${p}\n`).join(""),
    })`git hash-object -w --no-filters --stdin-paths`;

    const oids = lines(stdout);
    if (oids.length !== paths.length) {
      throw new Error(
        `git hash-object returned ${oids.length} object ids for ${paths.length} paths`,
      );
    }
    return oids;
  };

  const emptyTree = async (): Promise<Oid> =>
    (await $({ input: "" })`git hash-object -t tree -w --stdin`).stdout.trim();

  /** Lists the entries of a tree. Paths are relative to that tree. */
  const lsTree = async (
    treeish: string,
    { recursive = false } = {},
  ): Promise<TreeEntry[]> => {
    const { stdout } =
      await $`git ls-tree -z --full-tree ${recursive ? ["-r"] : []} ${treeish}`;
    return stdout
      .split("\0")
      .filter((line) => line !== "")
      .map(parseTreeEntry);
  };

  /** Writes one tree per list of direct (non-nested) entries. */
  const mkTrees = async (
    trees: readonly (readonly TreeEntry[])[],
  ): Promise<Oid[]> => {
    if (trees.length === 0) return [];
    if (trees.some((tree) => tree.length === 0)) {
      throw new Error("git mktree cannot write empty trees in batch mode");
    }

    const input = trees
      .map((tree) =>
        tree.map((e) => `${e.mode} ${e.type} ${e.oid}\t${e.path}\0`).join(""),
      )
      .join("\0");
    const { stdout } = await $({ input })`git mktree --batch -z`;

    const oids = lines(stdout);
    if (oids.length !== trees.length) {
      throw new Error(
        `git mktree returned ${oids.length} trees for ${trees.length} inputs`,
      );
    }
    return oids;
  };

  /**
   * Writes a tree from a flat list of entries, whose paths may be nested.
   * Intermediate trees are created as needed, with one `git mktree` call per
   * depth level (deepest first).
   */
  const writeTree = async (entries: readonly TreeEntry[]): Promise<Oid> => {
    if (entries.length === 0) return emptyTree();

    const dirs = new Map<string, TreeEntry[]>([["", []]]);
    const ensureDir = (dir: string) => {
      if (dirs.has(dir)) return;
      dirs.set(dir, []);
      ensureDir(parentDir(dir));
    };

    for (const entry of entries) {
      const dir = parentDir(entry.path);
      ensureDir(dir);
      dirs.get(dir)!.push({ ...entry, path: path.posix.basename(entry.path) });
    }

    const byDepth = Map.groupBy(dirs.keys(), depthOf);
    let root: Oid | undefined;

    for (let depth = Math.max(...byDepth.keys()); depth >= 0; depth--) {
      const dirsAtDepth = byDepth.get(depth) ?? [];
      const oids = await mkTrees(dirsAtDepth.map((dir) => dirs.get(dir)!));

      for (const [i, dir] of dirsAtDepth.entries()) {
        const oid = oids[i]!;
        if (dir === "") {
          root = oid;
        } else {
          dirs.get(parentDir(dir))!.push({
            mode: treeMode,
            type: "tree",
            oid,
            path: path.posix.basename(dir),
          });
        }
      }
    }

    return root!;
  };

  const commitTree = async ({
    tree,
    parents = [],
    message: commitMessage,
    author,
  }: {
    tree: Oid;
    parents?: readonly Oid[];
    message: string;
    author?: CommitAuthor;
  }): Promise<Oid> => {
    const authorEnv = author
      ? {
          GIT_AUTHOR_NAME: author.name,
          GIT_AUTHOR_EMAIL: author.email,
          GIT_AUTHOR_DATE: author.date,
        }
      : {};

    const { stdout } = await $({
      input: commitMessage,
      env: { ...env, ...authorEnv },
    })`git commit-tree --no-gpg-sign ${parents.flatMap((p) => ["-p", p])} -F - ${tree}`;

    return stdout.trim();
  };

  const readCommit = async (
    oid: Oid,
  ): Promise<{ author: CommitAuthor; message: string }> => {
    const { stdout } = await $({
      stripFinalNewline: false,
    })`git cat-file commit ${oid}`;

    const separator = stdout.indexOf("\n\n");
    const headers = stdout.slice(0, separator).split("\n");
    const authorLine = headers.find((header) => header.startsWith("author "));
    const match =
      authorLine && /^author (.*) <(.*)> (\d+ [+-]\d{4})$/.exec(authorLine);
    if (!match) throw new Error(`Could not parse the author of commit ${oid}`);

    return {
      author: { name: match[1]!, email: match[2]!, date: match[3]! },
      message: stdout.slice(separator + 2),
    };
  };

  /** The trailers of a commit message. */
  const trailers = async (commitMessage: string): Promise<Trailer[]> => {
    const { stdout } = await $({
      input: commitMessage,
    })`git interpret-trailers --parse`;

    return lines(stdout).flatMap((line) => {
      const separator = line.indexOf(": ");
      if (separator === -1) return [];
      return [
        { key: line.slice(0, separator), value: line.slice(separator + 2) },
      ];
    });
  };

  /**
   * Points `ref` at `newOid`, verifying that it currently points at `oldOid`
   * (or that it doesn't exist, if `oldOid` is `null`).
   */
  const updateRef = async (ref: string, newOid: Oid, oldOid: Oid | null) => {
    const command =
      oldOid === null
        ? `create ${ref} ${newOid}`
        : `update ${ref} ${newOid} ${oldOid}`;
    await $({ input: `${command}\n` })`git update-ref --stdin`;
  };

  const isAncestor = async (ancestor: Oid, descendant: Oid) => {
    try {
      await $`git merge-base --is-ancestor ${ancestor} ${descendant}`;
      return true;
    } catch (error) {
      if (error instanceof ExecaError && error.exitCode === 1) return false;
      throw error;
    }
  };

  /** The commits in `range`, following first parents, oldest first. */
  const revList = async (range: string): Promise<Oid[]> =>
    lines((await $`git rev-list --reverse --first-parent ${range}`).stdout);

  /** The object ids the given refs point to on a remote (absent if missing). */
  const lsRemote = async (
    remote: string,
    refs: readonly string[],
  ): Promise<Map<string, Oid>> => {
    if (refs.length === 0) return new Map();

    const { stdout } = await $`git ls-remote --refs ${remote} ${refs}`;
    const wanted = new Set(refs);

    return new Map(
      lines(stdout).flatMap((line) => {
        const [oid, ref] = line.split("\t");
        return oid && ref && wanted.has(ref) ? [[ref, oid] as const] : [];
      }),
    );
  };

  /** Fetches a ref from a remote, without touching any local ref. */
  const fetchRef = async (remote: string, ref: string): Promise<Oid> => {
    await $`git fetch --refmap= ${remote} ${ref}`;
    const oid = await revParse("FETCH_HEAD");
    if (oid === null) throw new Error(`git fetch did not record ${ref}`);
    return oid;
  };

  const push = async (remote: string, refspecs: readonly string[]) => {
    await $`git push ${remote} ${refspecs}`;
  };

  return {
    revParse,
    symbolicRef,
    isValidRef,
    hashObject,
    hashObjectPaths,
    lsTree,
    writeTree,
    commitTree,
    readCommit,
    trailers,
    updateRef,
    isAncestor,
    revList,
    lsRemote,
    fetchRef,
    push,
  };
};

export type Git = ReturnType<typeof createGit>;
