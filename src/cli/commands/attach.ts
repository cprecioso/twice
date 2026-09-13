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
import { glob } from "node:fs/promises";
import { Readable } from "node:stream";
import * as tar from "tar";
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
    ref,
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

    const config = await loadConfig(projectDir, configFilePath);

    assertTasksDefined(config, enabledTasks);

    const generateProvenance = await discoverProvenanceProvider(provenanceArg);

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
          generateProvenance,
        });

      if (taskDef.store.stderr)
        await runSubtask("stderr", taskProc.stderr, {
          taskId,
          cwd: projectDir,
          ref,
          generateProvenance,
        });

      if (taskDef.store.exitCode)
        await runSubtask(
          "exitCode",
          JSON.stringify((await taskProc).exitCode),
          {
            taskId,
            cwd: projectDir,
            ref,
            generateProvenance,
          },
        );

      if (taskDef.store.glob) {
        const files = await Array.fromAsync(
          glob(taskDef.store.glob, { cwd: projectDir }),
        );
        const tarStream = Readable.from(
          tar.create({ C: projectDir, cwd: projectDir }, files),
        );

        await runSubtask("glob", tarStream, {
          taskId,
          cwd: projectDir,
          ref,
          generateProvenance,
        });
      }
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
