import {
  formatMessage,
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
import { Listr, type ListrTask } from "listr2";
import assert from "node:assert/strict";
import { Readable, type PipelineSource } from "node:stream";
import { pipeline } from "node:stream/promises";
import type Vinyl from "vinyl";
import * as vfs from "vinyl-fs";
import { loadConfig } from "../config";
import { CliError } from "../error";
import { globalOptions } from "../global";
import {
  assertTasksDefined,
  enabledTasksOption,
  isTaskEnabled,
  notesNamespace,
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

    assertTasksDefined(config, enabledTasks);

    await new Listr(
      Object.entries(config.tasks).map(
        ([taskId, taskDef]): ListrTask => ({
          title: formatMessage(message`Running task ${taskId}`, {
            colors: process.stderr.isTTY,
            quotes: !process.stderr.isTTY,
          }),
          enabled: isTaskEnabled(enabledTasks, taskId),
          rendererOptions: {
            persistentOutput: true,
          },
          task(_, task) {
            const proc = $(taskDef.run, {
              shell: true,
              all: true,
              reject: !taskDef.store.exitCode,
            });

            function makeSubtask(
              id: string,
              inputFn: false | undefined | (() => Promise<PipelineSource<any>>),
            ): ListrTask | undefined {
              if (!inputFn) return;

              const namespace = notesNamespace(taskId, id);

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
                          buffer: false,
                        }),
                      )
                        .compose(gulpTar("archive.tar"))
                        .compose(
                          assertOnlyOneElement(
                            "Compressed file has already been processed.",
                          ),
                        )
                        .compose(async function* (
                          source: AsyncIterable<Vinyl>,
                        ) {
                          for await (const file of source) {
                            assert(
                              file.contents !== null,
                              "File contents should not be null.",
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
