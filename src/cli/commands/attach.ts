import {
  formatMessage,
  map,
  merge,
  message,
  multiple,
  object,
  option,
  optionNames,
  string,
  withDefault,
} from "@optique/core";
import { defineCommand } from "@optique/discover";
import { execa } from "execa";
import gulpTar from "gulp-tar";
import { Listr, type ListrTask } from "listr2";
import assert from "node:assert/strict";
import { Readable, type PipelineSource } from "node:stream";
import { pipeline } from "node:stream/promises";
import type Vinyl from "vinyl";
import * as vfs from "vinyl-fs";
import { binaryName, loadConfig } from "../config";
import { CliError } from "../error";
import { globalOptions } from "../global";

const ignoreDirtyOptionNames = ["--ignore-dirty"] as const;
const enabledTasksOptionNames = ["-t", "--task"] as const;

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
      enabledTasks: map(
        multiple(
          option(...enabledTasksOptionNames, string({ metavar: "TASK_NAME" }), {
            description: message`Run only the specified task(s). (can be specified multiple times)`,
          }),
        ),
        (tasks) =>
          tasks.length > 0 ? (new Set(tasks) as ReadonlySet<string>) : null,
      ),
    }),
  ),
  metadata: {
    description: message`Run the configured commands and attach the result to the HEAD commit.`,
  },
  handler: async ({
    projectDir,
    ignoreDirty,
    enabledTasks,
    configFilePath: configFile,
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

    const config = await loadConfig(configFile);
    const ref = "HEAD";

    if (enabledTasks) {
      for (const taskId of enabledTasks) {
        if (!(taskId in config.tasks)) {
          throw new CliError(message`Task ${taskId} is not defined`);
        }
      }
    }

    await new Listr(
      Object.entries(config.tasks).map(
        ([taskId, taskDef]): ListrTask => ({
          title: formatMessage(message`Running task ${taskId}`, {
            colors: process.stderr.isTTY,
            quotes: !process.stderr.isTTY,
          }),
          enabled: !enabledTasks || enabledTasks.has(taskId),
          rendererOptions: {
            persistentOutput: true,
          },
          task(_, task) {
            const proc = $(taskDef.run, { shell: true, all: true });

            function makeSubtask(
              id: string,
              inputFn: undefined | (() => Promise<PipelineSource<any>>),
            ): ListrTask | undefined {
              if (!inputFn) return;

              const namespace = [
                binaryName,
                "tasks",
                taskId,
                "results",
                id,
              ].join("/");

              return {
                title: `Storing ${id}`,
                task: async (_ctx, subtask) =>
                  pipeline(
                    await inputFn(),
                    $`git notes --ref ${namespace} add -f -F - ${ref}`.duplex(),
                    subtask.stdout(),
                  ),
              };
            }

            return task.newListr(
              [
                {
                  title: "Running task",
                  rendererOptions: {
                    outputBar: 4,
                    persistentOutput: true,
                  },
                  task: () => proc.all,
                },
                makeSubtask(
                  "stdout",
                  taskDef.store.stdout && (async () => proc.stdout),
                ),
                makeSubtask(
                  "stderr",
                  taskDef.store.stderr && (async () => proc.stderr),
                ),
                makeSubtask(
                  "exitCode",
                  taskDef.store.exitCode &&
                    (async () => [
                      JSON.stringify((await proc).exitCode ?? null),
                    ]),
                ),
                makeSubtask(
                  "glob",
                  taskDef.store.glob &&
                    (async () =>
                      Readable.from(
                        vfs.src(taskDef.store.glob!, {
                          cwd: projectDir,
                          cwdbase: true,
                        }),
                      )
                        .compose(gulpTar("archive.tar"))
                        .compose(async function* (
                          source: AsyncIterable<Vinyl>,
                        ) {
                          for await (const file of source) {
                            assert(
                              file.contents,
                              "File contents should not be null or undefined",
                            );
                            yield* file.contents;
                          }
                        })),
                ),
              ].filter(<T>(t: T | undefined): t is T => Boolean(t)),
              { concurrent: true },
            );
          },
        }),
      ),
    ).run();
  },
});
