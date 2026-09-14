// oxlint-disable no-await-in-loop

import { message } from "@optique/core/message";
import { CliError } from "../error";
import type { Git, Oid, TreeEntry } from "./git";

/**
 * The ref under which the results for `refName` are stored. It points to a
 * chain of commits, one per `attach` run, each a snapshot of the results of
 * every configured task for a single source commit. Their tree looks like:
 *
 *     results/<task>/<result>
 *     results/<task>/<result>.provenance.json
 *
 * where `<result>` is a plain file (`stdout`, `stderr`, `exitCode`) or the
 * `files` directory, which holds the stored files at their original paths.
 */
export const twiceRef = (refName: string) => `refs/twice/ref/${refName}`;

const resultsDir = "results";

/** The directory of the results tree that holds a task's results. */
export const taskDir = (taskId: string) => `${resultsDir}/${taskId}`;

/** The path of a task's result within the results tree. */
export const resultPath = (taskId: string, resultId: string) =>
  `${taskDir(taskId)}/${resultId}`;

/** The name of a result's provenance file, which sits next to the result. */
export const provenanceFileName = (resultId: string) =>
  `${resultId}.provenance.json`;

/** Commit message trailers that describe what a results commit holds. */
const refTrailer = "Twice-Ref";
const commitTrailer = "Twice-Commit";

export const assertValidRefName = async (git: Git, refName: string) => {
  if (!(await git.isValidRef(twiceRef(refName)))) {
    throw new CliError(message`${refName} is not a valid ref name.`);
  }
};

/** The commit holding the results stored for `refName`, or `null`. */
export const readResultsTip = (git: Git, refName: string) =>
  git.revParse(`${twiceRef(refName)}^{commit}`);

/** Task id → tree holding the task's results, or `null` if it has none. */
export type TaskTrees = ReadonlyMap<string, Oid | null>;

/** Writes a results tree holding the given tasks' results. */
export const writeResultsTree = (
  git: Git,
  taskTrees: TaskTrees,
): Promise<Oid> =>
  git.writeTree(
    [...taskTrees].flatMap(([taskId, oid]): TreeEntry[] =>
      oid === null
        ? []
        : [{ mode: "040000", type: "tree", oid, path: taskDir(taskId) }],
    ),
  );

/** Commits a results tree on top of `parent` and points the ref at it. */
export const commitResults = async (
  git: Git,
  {
    refName,
    sourceCommit,
    tree,
    parent,
  }: {
    refName: string;
    /** The commit the results were produced from. */
    sourceCommit: Oid;
    tree: Oid;
    /** The current results commit of the ref, or `null` if there is none. */
    parent: Oid | null;
  },
): Promise<Oid> => {
  const commitMessage =
    [
      `Results for ${refName} at ${sourceCommit.slice(0, 7)}`,
      "",
      `${refTrailer}: ${refName}`,
      `${commitTrailer}: ${sourceCommit}`,
    ].join("\n") + "\n";

  const commit = await git.commitTree({
    tree,
    parents: parent === null ? [] : [parent],
    message: commitMessage,
  });
  await git.updateRef(twiceRef(refName), commit, parent);
  return commit;
};

/**
 * Re-creates the results commits `commits` (oldest first) on top of `onto`,
 * keeping their trees, messages and authors, so that the history is linear.
 */
export const replayResults = async (
  git: Git,
  onto: Oid,
  commits: readonly Oid[],
): Promise<Oid> => {
  let base = onto;

  for (const commit of commits) {
    const tree = await git.revParse(`${commit}^{tree}`);
    if (tree === null) throw new Error(`${commit} is not a commit`);

    const { author, message: commitMessage } = await git.readCommit(commit);
    base = await git.commitTree({
      tree,
      parents: [base],
      message: commitMessage,
      author,
    });
  }

  return base;
};
