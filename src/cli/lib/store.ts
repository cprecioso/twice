// oxlint-disable no-await-in-loop

import { message } from "@optique/core/message";
import { CliError } from "../error";
import type { Git, Oid, TreeEntry } from "./git";

/**
 * The ref under which the results for `refName` are stored. It points to a
 * chain of commits, one per `attach` run, whose tree looks like:
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

/** Commit message trailers that describe what a results commit attached. */
const refTrailer = "Twice-Ref";
const commitTrailer = "Twice-Commit";
const taskTrailer = "Twice-Task";

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

/** Reads the trees holding the given tasks' results in a results commit. */
export const readTaskTrees = async (
  git: Git,
  commit: Oid,
  taskIds: readonly string[],
): Promise<TaskTrees> =>
  new Map(
    await Promise.all(
      taskIds.map(
        async (taskId) =>
          [taskId, await git.revParse(`${commit}:${taskDir(taskId)}`)] as const,
      ),
    ),
  );

/**
 * Writes a results tree: the tree of the results commit `base` (or an empty
 * one, if `base` is `null`) with the results of the tasks in `taskTrees`
 * replaced. Everything else in the base tree is kept as is.
 */
export const writeResultsTree = async (
  git: Git,
  base: Oid | null,
  taskTrees: TaskTrees,
): Promise<Oid> => {
  const rootEntries = base === null ? [] : await git.lsTree(`${base}^{tree}`);
  const results = rootEntries.find((entry) => entry.path === resultsDir);
  const taskEntries =
    results?.type === "tree" ? await git.lsTree(results.oid) : [];

  return git.writeTree([
    ...rootEntries.filter((entry) => entry !== results),
    ...taskEntries
      .filter((entry) => !taskTrees.has(entry.path))
      .map((entry): TreeEntry => ({
        mode: entry.mode,
        type: entry.type,
        oid: entry.oid,
        path: taskDir(entry.path),
      })),
    ...[...taskTrees].flatMap(([taskId, oid]): TreeEntry[] =>
      oid === null
        ? []
        : [{ mode: "040000", type: "tree", oid, path: taskDir(taskId) }],
    ),
  ]);
};

/** Commits a results tree on top of `parent` and points the ref at it. */
export const commitResults = async (
  git: Git,
  {
    refName,
    sourceCommit,
    taskIds,
    tree,
    parent,
  }: {
    refName: string;
    /** The commit the results were produced from. */
    sourceCommit: Oid;
    /** The tasks whose results this commit attaches. */
    taskIds: readonly string[];
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
      ...taskIds.map((taskId) => `${taskTrailer}: ${taskId}`),
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
 * Re-creates the results commits `commits` (oldest first) on top of `onto`.
 * Each re-created commit only replaces the results of the tasks its original
 * attached, so the results of other tasks present in `onto` are kept.
 */
export const replayResults = async (
  git: Git,
  onto: Oid,
  commits: readonly Oid[],
): Promise<Oid> => {
  let base = onto;

  for (const commit of commits) {
    const { author, message: commitMessage } = await git.readCommit(commit);
    const taskIds = await attachedTasks(git, commit, commitMessage);
    const tree = await writeResultsTree(
      git,
      base,
      await readTaskTrees(git, commit, taskIds),
    );
    base = await git.commitTree({
      tree,
      parents: [base],
      message: commitMessage,
      author,
    });
  }

  return base;
};

/** The tasks whose results a results commit attached. */
const attachedTasks = async (git: Git, commit: Oid, commitMessage: string) => {
  const trailers = await git.trailers(commitMessage);

  if (trailers.some((trailer) => trailer.key === commitTrailer)) {
    return trailers
      .filter((trailer) => trailer.key === taskTrailer)
      .map((trailer) => trailer.value);
  }

  // Not created by `attach`: consider every task in its tree attached.
  const results = await git.revParse(`${commit}:${resultsDir}`);
  return results === null
    ? []
    : (await git.lsTree(results)).map((entry) => entry.path);
};
