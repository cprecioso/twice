// oxlint-disable no-await-in-loop

import {
  merge,
  message,
  object,
  option,
  optionNames,
  text,
  values,
  withDefault,
} from "@optique/core";
import { defineCommand } from "@optique/discover";
import { execa } from "execa";
import * as path from "node:path";
import type { Readable } from "node:stream";
import { loadConfig, type Glob } from "../config";
import { CliError } from "../error";
import { globalOptions } from "../global";
import { sha256Bytes, sha256File, sha256Tap } from "../lib/digest";
import { collectFiles } from "../lib/files";
import { printMessage } from "../lib/format";
import { createGit, type Git, type Oid, type TreeEntry } from "../lib/git";
import { gitIdentityEnv } from "../lib/git-identity";
import { provenanceOption } from "../lib/provenance";
import type {
  GenerateProvenance,
  ProviderId,
  Subject,
} from "../lib/provenance/base";
import {
  getFirstEnabledProvider,
  getGenerateProvenance,
} from "../lib/provenance/providers";
import { detectRef, refOption } from "../lib/ref";
import {
  assertValidRefName,
  commitResults,
  provenanceFileName,
  readResultsTip,
  resultPath,
  twiceRef,
  writeResultsTree,
} from "../lib/store";

const ignoreDirtyOptionNames = ["--ignore-dirty"] as const;

export default defineCommand({
  parser: merge(
    globalOptions,
    object({
      ignoreDirty: withDefault(
        option(...ignoreDirtyOptionNames, {
          description: message`Run even if the working directory is dirty.`,
        }),
        false,
      ),
      provenance: provenanceOption,
      ref: refOption,
    }),
  ),
  metadata: {
    description: message`Run the configured tasks and store their results for the current ref.`,
  },
  handler: async ({
    projectDir,
    configFilePath,
    ignoreDirty,
    provenance: provenanceArg,
    ref: refArg,
  }) => {
    const $ = execa({ cwd: projectDir, stdout: "pipe", stdin: "inherit" });

    if (!ignoreDirty) {
      const isDirty = await $`git diff --quiet`.then(
        () => false,
        () => true,
      );

      if (isDirty) {
        throw new CliError(
          message`Working directory ${projectDir} is dirty. Use ${optionNames(ignoreDirtyOptionNames)} to override.`,
        );
      }
    }

    const config = await loadConfig(projectDir, configFilePath);

    const git = createGit({
      cwd: projectDir,
      env: await gitIdentityEnv(projectDir),
    });

    const refName = refArg ?? (await detectRef(git));
    await assertValidRefName(git, refName);

    const sourceCommit = await git.revParse("HEAD^{commit}");
    if (sourceCommit === null) {
      throw new CliError(message`HEAD does not point to a commit.`);
    }

    const generateProvenance = await discoverProvenanceProvider(provenanceArg);

    const taskTrees = new Map<string, Oid | null>();

    for (const [taskId, taskDef] of Object.entries(config.tasks)) {
      const store = makeResultStore({ git, taskId, generateProvenance });

      const taskProc = $(taskDef.run, { shell: true, reject: false });

      const storePromises: Promise<void>[] = [];

      if (taskDef.store.stdout)
        storePromises.push(store.stream("stdout", taskProc.stdout));

      if (taskDef.store.stderr)
        storePromises.push(store.stream("stderr", taskProc.stderr));

      const [result] = await Promise.all([taskProc, ...storePromises]);

      if (result.exitCode === undefined) {
        throw new CliError(message`Task ${taskId} did not exit normally.`, {
          cause: result,
        });
      }

      if (!taskDef.store.exitCode && result.exitCode !== 0) {
        throw new CliError(
          message`Task ${taskId} failed with exit code ${text(String(result.exitCode))}.`,
          { cause: result },
        );
      }

      if (taskDef.store.exitCode)
        await store.bytes(
          "exitCode",
          new TextEncoder().encode(JSON.stringify(result.exitCode)),
        );

      if (taskDef.store.files)
        await store.files("files", taskDef.store.files.glob, projectDir);

      taskTrees.set(taskId, await store.writeTree());
    }

    const parent = await readResultsTip(git, refName);
    const tree = await writeResultsTree(git, taskTrees);
    const commit = await commitResults(git, {
      refName,
      sourceCommit,
      tree,
      parent,
    });

    printMessage(
      message`Stored the results for ${refName} in ${twiceRef(refName)} (${commit}).`,
    );
  },
});

/**
 * Collects a task's results as tree entries, relative to the task's
 * directory in the results tree, generating provenance for each of them.
 */
const makeResultStore = ({
  git,
  taskId,
  generateProvenance,
}: {
  git: Git;
  taskId: string;
  generateProvenance: GenerateProvenance | null;
}) => {
  const entries: TreeEntry[] = [];

  const addBlob = (entryPath: string, oid: Oid, mode = "100644") => {
    entries.push({ mode, type: "blob", oid, path: entryPath });
  };

  const addProvenance = async (resultId: string, subjects: Subject[]) => {
    if (generateProvenance === null || subjects.length === 0) return;
    const provenance = await generateProvenance(subjects);
    addBlob(provenanceFileName(resultId), await git.hashObject(provenance));
  };

  return {
    /** Stores a result as a file with the content of a stream. */
    stream: async (resultId: string, input: Readable) => {
      const { stream, digest } = sha256Tap(input);
      addBlob(resultId, await git.hashObject(stream));
      await addProvenance(resultId, [
        { name: resultPath(taskId, resultId), sha256: digest() },
      ]);
    },

    /** Stores a result as a file with the given content. */
    bytes: async (resultId: string, data: Uint8Array) => {
      addBlob(resultId, await git.hashObject(data));
      await addProvenance(resultId, [
        { name: resultPath(taskId, resultId), sha256: sha256Bytes(data) },
      ]);
    },

    /**
     * Stores a result as a directory with the files matched by `globs` at
     * their original paths. Their provenance covers every file.
     */
    files: async (resultId: string, globs: Glob, cwd: string) => {
      const files = await collectFiles(cwd, globs);

      if (files.length === 0) {
        printMessage(
          message`Task ${taskId}: no files matched ${values(globs)}; nothing stored.`,
        );
        return;
      }

      const oids = await git.hashObjectPaths(files.map((file) => file.path));
      const subjects: Subject[] = [];

      for (const [i, file] of files.entries()) {
        addBlob(`${resultId}/${file.path}`, oids[i]!, file.mode);

        if (generateProvenance) {
          subjects.push({
            name: `${resultPath(taskId, resultId)}/${file.path}`,
            sha256: await sha256File(path.join(cwd, file.path)),
          });
        }
      }

      await addProvenance(resultId, subjects);
    },

    /** Writes the task's results tree, or `null` if nothing was stored. */
    writeTree: async () =>
      entries.length === 0 ? null : await git.writeTree(entries),
  };
};

const discoverProvenanceProvider = async (
  arg: undefined | boolean | ProviderId,
) => {
  if (arg === false) return null;

  const providerId =
    typeof arg === "string" ? arg : (await getFirstEnabledProvider())?.id;

  if (!providerId) {
    if (arg === true) throw new CliError(message`No provider found`);
    else return null;
  }

  return await getGenerateProvenance(providerId);
};
