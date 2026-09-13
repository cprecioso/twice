// oxlint-disable no-await-in-loop
import { merge, message, object, option, withDefault } from "@optique/core";
import { defineCommand } from "@optique/discover";
import { gitRemote } from "@optique/git";
import { execa } from "execa";
import { loadConfig } from "../config";
import { globalOptions, projectDirDependency } from "../global";
import {
  assertTasksDefined,
  enabledTasksOption,
  isTaskEnabled,
  provenanceNoteNamespace,
  provenanceNoteRef,
  resultNoteNamespace,
  resultNoteRef,
} from "../lib/tasks";

const remoteOptionNames = ["-r", "--remote"] as const;

const remoteOptionValue = projectDirDependency.deriveAsync({
  metavar: "REMOTE",
  factory: (projectDir) => gitRemote({ dir: projectDir }),
  defaultValue: () => "origin" as const,
});

export default defineCommand({
  parser: merge(
    globalOptions,
    object({
      remote: withDefault(
        option(...remoteOptionNames, remoteOptionValue, {
          description: message`The remote to push the notes to.`,
        }),
        "origin",
      ),
      disableProvenance: option("--no-provenance", {
        description: message`Do not push provenance information.`,
      }),
      enabledTasks: enabledTasksOption,
    }),
  ),
  metadata: {
    description: message`Push the results attached to the HEAD commit to a remote.`,
  },
  handler: async ({
    projectDir,
    configFilePath,
    remote,
    disableProvenance,
    enabledTasks,
    ref,
  }) => {
    const $ = execa({ cwd: projectDir, stdout: "pipe", stdin: "inherit" });
    const config = await loadConfig(projectDir, configFilePath);

    assertTasksDefined(config, enabledTasks);

    const refs: string[] = [];

    for (const [taskId, taskDef] of Object.entries(config.tasks)) {
      if (!isTaskEnabled(enabledTasks, taskId)) continue;

      for (const [resultId, value] of Object.entries(taskDef.store)) {
        if (!value) continue;

        const hasNote = (namespace: string) =>
          $`git notes --ref ${namespace} list ${ref}`.then(
            () => true,
            () => false,
          );

        const [hasResult, hasProvenance] = await Promise.all([
          hasNote(resultNoteNamespace(taskId, resultId)),
          disableProvenance
            ? Promise.resolve(false)
            : hasNote(provenanceNoteNamespace(taskId, resultId)),
        ]);

        if (!hasResult) continue;

        refs.push(resultNoteRef(taskId, resultId));
        if (hasProvenance) {
          refs.push(provenanceNoteRef(taskId, resultId));
        }
      }
    }

    if (refs.length === 0) return;

    const refspecs = refs.toSorted().map((r) => `${r}:${r}`);
    await $`git push ${remote} ${refspecs}`;
  },
});
