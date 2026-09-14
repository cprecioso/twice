// oxlint-disable no-await-in-loop

import { merge, message, object, option, withDefault } from "@optique/core";
import { commandLine } from "@optique/core/message";
import { defineCommand } from "@optique/discover";
import { gitRemote } from "@optique/git";
import { binaryName } from "../config";
import { CliError } from "../error";
import { globalOptions, projectDirDependency } from "../global";
import { printMessage } from "../lib/format";
import { createGit } from "../lib/git";
import { gitIdentityEnv } from "../lib/git-identity";
import { detectRef, refsOption } from "../lib/ref";
import {
  assertValidRefName,
  readResultsTip,
  replayResults,
  twiceRef,
} from "../lib/store";

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
          description: message`The remote to push the results to.`,
        }),
        "origin",
      ),
      refs: refsOption,
    }),
  ),
  metadata: {
    description: message`Push the stored results for one or more refs to a remote.`,
  },
  handler: async ({ projectDir, remote, refs: refArgs }) => {
    const git = createGit({
      cwd: projectDir,
      env: await gitIdentityEnv(projectDir),
    });

    const refNames =
      refArgs.length > 0 ? [...new Set(refArgs)] : [await detectRef(git)];

    for (const refName of refNames) await assertValidRefName(git, refName);

    const remoteTips = await git
      .lsRemote(remote, refNames.map(twiceRef))
      .catch((cause: unknown) => {
        throw new CliError(message`Could not list the refs of ${remote}.`, {
          cause,
        });
      });

    for (const refName of refNames) {
      const ref = twiceRef(refName);

      const localTip = await readResultsTip(git, refName);
      if (localTip === null) {
        throw new CliError(
          message`There are no results stored for ${refName}. Run ${commandLine(`${binaryName} attach`)} first.`,
        );
      }

      if (remoteTips.has(ref)) {
        const remoteTip = await git
          .fetchRef(remote, ref)
          .catch((cause: unknown) => {
            throw new CliError(
              message`Could not fetch the results for ${refName} from ${remote}.`,
              { cause },
            );
          });

        if (remoteTip === localTip) {
          printMessage(
            message`${remote} already has the results for ${refName}.`,
          );
          continue;
        }

        if (!(await git.isAncestor(remoteTip, localTip))) {
          const newCommits = await git.revList(`${remoteTip}..${localTip}`);

          if (newCommits.length === 0) {
            // The remote has everything stored locally, and more.
            await git.updateRef(ref, remoteTip, localTip);
            printMessage(
              message`${remote} already has newer results for ${refName}; updated ${ref} to match.`,
            );
            continue;
          }

          // The results diverged (e.g. they were stored in a fresh clone):
          // rebuild the local commits on top of the remote ones.
          const newTip = await replayResults(git, remoteTip, newCommits);
          await git.updateRef(ref, newTip, localTip);
        }
      }

      await git.push(remote, [`${ref}:${ref}`]).catch((cause: unknown) => {
        throw new CliError(
          message`Could not push the results for ${refName} to ${remote}.`,
          { cause },
        );
      });

      printMessage(message`Pushed the results for ${refName} to ${remote}.`);
    }
  },
});
