// oxlint-disable no-await-in-loop
import {
  merge,
  message,
  object,
  option,
  string,
  withDefault,
} from "@optique/core";
import { defineCommand } from "@optique/discover";
import { execa } from "execa";
import { loadConfig } from "../config";
import { globalOptions } from "../global";
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

export default defineCommand({
  parser: merge(
    globalOptions,
    object({
      remote: withDefault(
        option(...remoteOptionNames, string({ metavar: "REMOTE" }), {
          description: message`The remote to push the notes to.`,
        }),
        "origin",
      ),
      enabledTasks: enabledTasksOption,
    }),
  ),
  metadata: {
    description: message`Push the results attached to the HEAD commit to a remote.`,
  },
  handler: async ({
    projectDir,
    remote,
    enabledTasks,
    configFilePath: configFile,
  }) => {
    const $ = execa({ cwd: projectDir });
    const config = await loadConfig(configFile);
    const ref = "HEAD";

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
          hasNote(provenanceNoteNamespace(taskId, resultId)),
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
