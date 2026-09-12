import { type Message, formatMessage } from "@optique/core/message";

export class CliError extends Error {
  constructor(
    cliMessage: Message,
    {
      plainError = formatMessage(cliMessage),
      ...options
    }: ErrorOptions & { plainError?: string } = {},
  ) {
    super(plainError, options);
    this.cliMessage = cliMessage;

    Object.defineProperties(this, {
      cliMessage: { enumerable: false },
      exitCode: { enumerable: false },
    });
  }

  cliMessage;
  exitCode = 1;
}
