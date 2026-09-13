import { map, message, multiple, option, string } from "@optique/core";
import { binaryName, type Config } from "../config";
import { CliError } from "../error";

export const enabledTasksOptionNames = ["-t", "--task"] as const;

export const enabledTasksOption = map(
  multiple(
    option(...enabledTasksOptionNames, string({ metavar: "TASK_NAME" }), {
      description: message`Select only the specified task(s). (can be specified multiple times)`,
    }),
  ),
  (tasks) =>
    tasks.length > 0 ? (new Set(tasks) as ReadonlySet<string>) : null,
);

export const assertTasksDefined = (
  config: Config,
  enabledTasks: ReadonlySet<string> | null,
) => {
  if (!enabledTasks) return;
  for (const taskId of enabledTasks) {
    if (!(taskId in config.tasks)) {
      throw new CliError(message`Task ${taskId} is not defined`);
    }
  }
};

export const isTaskEnabled = (
  enabledTasks: ReadonlySet<string> | null,
  taskId: string,
) => !enabledTasks || enabledTasks.has(taskId);

/** The `git notes --ref` namespace for a task's stored result. */
export const notesNamespace = (taskId: string, resultId: string) =>
  [binaryName, "tasks", taskId, "results", resultId].join("/");

/** The full ref name for a task's stored result. */
export const notesRef = (taskId: string, resultId: string) =>
  `refs/notes/${notesNamespace(taskId, resultId)}`;
