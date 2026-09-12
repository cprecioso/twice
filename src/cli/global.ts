import { message, object, option, optional, withDefault } from "@optique/core";
import { path } from "@optique/run";

export const projectDirOptionNames = ["-p", "--project"] as const;
export const configFilePathOptionNames = ["-c", "--config"] as const;

export const globalOptions = object({
  projectDir: withDefault(
    option(
      ...projectDirOptionNames,
      path({ type: "directory", mustExist: true }),
      { description: message`The path to the project directory.` },
    ),
    ".",
  ),
  configFilePath: optional(
    option(
      ...configFilePathOptionNames,
      path({ type: "file", mustExist: true }),
      {
        description: message`The path to the configuration file.`,
      },
    ),
  ),
});
