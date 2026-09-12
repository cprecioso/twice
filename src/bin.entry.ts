#!/usr/bin/env node

import pkg from "#/package.json" with { type: "json" };
import { message, text, url } from "@optique/core/message";
import { runProgram } from "@optique/discover";
import { printError } from "@optique/run";
import { inspect, styleText } from "node:util";
import commands from "./cli/commands";
import { binaryName } from "./cli/config";
import { CliError } from "./cli/error";

try {
  await runProgram({
    commands,
    metadata: {
      name: binaryName,
      version: pkg.version,
      description: message`${text(pkg.description)}`,
      author: message`${text(pkg.author.name)} (${url(pkg.author.url)})`,
      bugs: message`${url(pkg.bugs.url)}`,
    },

    help: { option: { names: ["-h", "--help"] } },
    version: {
      value: pkg.version,
      option: { names: ["-v", "--version"], hidden: "usage" },
    },
    completion: { command: { hidden: "usage" } },

    showDefault: true,
  });
} catch (err) {
  const { cliMessage, exitCode } =
    err instanceof CliError
      ? err
      : { cliMessage: message`An unexpected error occurred.`, exitCode: 1 };

  printError(cliMessage);
  console.error("\n" + styleText("dim", inspect(err)));
  process.exitCode = exitCode;
}
