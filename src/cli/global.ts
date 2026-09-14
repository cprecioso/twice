import {
  dependency,
  message,
  object,
  option,
  optional,
  withDefault,
} from "@optique/core";
import { path } from "@optique/run";

export const projectDirOptionNames = ["-p", "--project"] as const;
export const configFilePathOptionNames = ["-c", "--config"] as const;

export const projectDirDependency = dependency(
  path({ type: "directory", mustExist: true }),
);
const configFilePathDependency = dependency(
  path({ type: "file", mustExist: true }),
);

export const globalOptions = object({
  projectDir: withDefault(
    option(...projectDirOptionNames, projectDirDependency, {
      description: message`The path to the project directory.`,
    }),
    ".",
  ),
  configFilePath: optional(
    option(...configFilePathOptionNames, configFilePathDependency, {
      description: message`The path to the configuration file.`,
    }),
  ),
});
