// oxlint-disable no-await-in-loop no-shadow

import {
  merge,
  message,
  object,
  option,
  optionNames,
  withDefault,
} from "@optique/core";
import { defineCommand } from "@optique/discover";
import { execa } from "execa";
import gulpTar from "gulp-tar";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import type Vinyl from "vinyl";
import * as vfs from "vinyl-fs";
import { loadConfig } from "../config";
import { CliError } from "../error";
import { globalOptions } from "../global";
import { provenanceOption } from "../lib/provenance";
import type { GenerateProvenance, ProviderId } from "../lib/provenance/base";
import {
  getFirstEnabledProvider,
  getGenerateProvenance,
} from "../lib/provenance/providers";
import {
  assertTasksDefined,
  enabledTasksOption,
  isTaskEnabled,
  provenanceNoteNamespace,
  resultNoteNamespace,
} from "../lib/tasks";

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
      enabledTasks: enabledTasksOption,
      provenance: provenanceOption,
    }),
  ),
  metadata: {
    description: message`Run the configured commands and attach the result to the HEAD commit.`,
  },
  handler: async ({
    projectDir,
    configFilePath,
    ignoreDirty,
    enabledTasks,
    provenance: provenanceArg,
  }) => {
    const $ = execa({ cwd: projectDir });

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

    const config = await loadConfig(configFilePath);
    const ref = "HEAD";

    assertTasksDefined(config, enabledTasks);

    const provenance = await discoverProvenanceProvider(provenanceArg);

    for (const [taskId, taskDef] of Object.entries(config.tasks)) {
      if (!isTaskEnabled(enabledTasks, taskId)) continue;

      const taskProc = $(taskDef.run, {
        shell: true,
        all: true,
        reject: !taskDef.store.exitCode,
      });

      if (taskDef.store.stdout)
        await runSubtask("stdout", taskProc.stdout, {
          taskId,
          cwd: projectDir,
          ref,
          generateProvenance: provenance,
        });

      if (taskDef.store.stderr)
        await runSubtask("stderr", taskProc.stderr, {
          taskId,
          cwd: projectDir,
          ref,
          generateProvenance: provenance,
        });

      if (taskDef.store.exitCode)
        await runSubtask(
          "exitCode",
          JSON.stringify((await taskProc).exitCode),
          {
            taskId,
            cwd: projectDir,
            ref,
            generateProvenance: provenance,
          },
        );

      if (taskDef.store.glob)
        await runSubtask(
          "glob",
          new Readable()
            .wrap(
              vfs.src(taskDef.store.glob!, {
                cwd: projectDir,
                cwdbase: true,
                buffer: false,
              }),
            )
            .compose(gulpTar("archive.tar"))
            .compose(
              assertOnlyOneElement(
                "Compressed file has already been processed.",
              ),
            )
            .compose(async function* (source: AsyncIterable<Vinyl>) {
              for await (const file of source) {
                assert(
                  file.contents !== null,
                  "File contents should not be null.",
                );
                yield* file.contents;
              }
            }),
          {
            taskId,
            cwd: projectDir,
            ref,
            generateProvenance: provenance,
          },
        );
    }
  },
});

async function runSubtask(
  resultId: string,
  input: Readable | string,
  {
    taskId,
    generateProvenance,
    cwd,
    ref,
  }: {
    taskId: string;
    generateProvenance: GenerateProvenance | null;
    cwd: string;
    ref: string;
  },
) {
  const $ = execa({ cwd });

  const resultNs = resultNoteNamespace(taskId, resultId);

  const createBlobProc = $({ input })`git hash-object -w --stdin`;

  const blobHash = (await createBlobProc).stdout;

  await $({ cwd })`git notes --ref ${resultNs} add -f -C ${blobHash} ${ref}`;

  if (generateProvenance) {
    const provenanceNs = provenanceNoteNamespace(taskId, resultId);
    const provenanceData = await generateProvenance({
      name: resultNs,
      sha256: blobHash,
    });
    await $({
      input: provenanceData,
    })`git notes --ref ${provenanceNs} add -f --no-stripspace -F - ${ref}`;
  }
}

// We can't do an early return in the async generator because it leaves the streams in an inconsistent state.
// Instead, we'll assert at runtime that only one element is processed in the async generator.
const assertOnlyOneElement = <T>(
  error: string | Error = "Only one element should be processed.",
) =>
  async function* (source: AsyncIterable<T>) {
    let done = false;
    for await (const element of source) {
      assert(!done, error);
      yield element;
      done = true;
    }
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
