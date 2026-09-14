import { multiple, option, optional, string } from "@optique/core";
import { message, optionNames } from "@optique/core/message";
import { CliError } from "../error";
import type { Git } from "./git";

export const refOptionNames = ["--ref"] as const;

const refValue = string({ metavar: "REF" });

/** Selects the ref results are stored for, e.g. `main`. */
export const refOption = optional(
  option(...refOptionNames, refValue, {
    description: message`The ref (e.g. branch) the results belong to. Defaults to the branch checked out at HEAD.`,
  }),
);

/** Selects one or more refs results are stored for. */
export const refsOption = multiple(
  option(...refOptionNames, refValue, {
    description: message`The ref(s) whose results to push. Defaults to the branch checked out at HEAD. (can be specified multiple times)`,
  }),
);

/** The name of the branch checked out at HEAD. */
export const detectRef = async (git: Git) => {
  const branch = await git.symbolicRef("HEAD");
  if (branch === null) {
    throw new CliError(
      message`HEAD is not on a branch. Use ${optionNames(refOptionNames)} to specify the ref the results belong to.`,
    );
  }
  return branch;
};
