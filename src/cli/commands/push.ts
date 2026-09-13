import {
  formatMessage,
  merge,
  message,
  object,
  option,
  string,
  withDefault,
} from "@optique/core";
import { lineBreak, text, type Message } from "@optique/core/message";
import { defineCommand } from "@optique/discover";
import { execa } from "execa";
import { Listr, type ListrTask } from "listr2";
import { loadConfig } from "../config";
import { CliError } from "../error";
import { globalOptions } from "../global";
import {
  assertTasksDefined,
  enabledTasksOption,
  isTaskEnabled,
  notesNamespace,
  notesRef,
} from "../lib/tasks";

const remoteOptionNames = ["-r", "--remote"] as const;

const fmt = (msg: Message) =>
  formatMessage(msg, {
    colors: process.stderr.isTTY,
    quotes: !process.stderr.isTTY,
  });

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

    await new Listr([
      {
        title: fmt(message`Looking for results attached to ${ref}`),
        task: (_, task) =>
          task.newListr(
            Object.entries(config.tasks).map(
              ([taskId, taskDef]): ListrTask => ({
                title: fmt(message`Task ${taskId}`),
                enabled: isTaskEnabled(enabledTasks, taskId),
                task: (_ctx, subtask) =>
                  subtask.newListr(
                    Object.entries(taskDef.store)
                      .filter(([, value]) => Boolean(value))
                      .map(
                        ([resultId]): ListrTask => ({
                          title: `Checking ${resultId}`,
                          task: async (_leafCtx, leaf) => {
                            const hasNote = await $({
                              reject: false,
                            })`git notes --ref ${notesNamespace(taskId, resultId)} list ${ref}`.then(
                              ({ exitCode }) => exitCode === 0,
                            );
                            if (hasNote) {
                              refs.push(notesRef(taskId, resultId));
                              leaf.title = `Found ${resultId}`;
                            } else {
                              leaf.skip(`No ${resultId} attached`);
                            }
                          },
                        }),
                      ),
                    { concurrent: true },
                  ),
              }),
            ),
            { concurrent: true },
          ),
      },
      {
        title: fmt(message`Pushing to ${remote}`),
        rendererOptions: { persistentOutput: true },
        task: async (_, task) => {
          if (refs.length === 0) {
            task.skip(fmt(message`No results attached to ${ref}`));
            return;
          }
          refs.sort();
          const refspecs = refs.map((r) => `${r}:${r}`);
          const result = await $({
            reject: false,
            all: true,
          })`git push ${remote} ${refspecs}`;
          if (result.exitCode !== 0) {
            throw new CliError(
              message`Failed to push notes to ${remote}:${lineBreak()}${text(result.all ?? "")}`,
            );
          }
          task.output = result.all ?? "";
        },
      },
    ]).run();
  },
});
