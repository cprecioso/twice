import * as optique from "@optique/core";

const messageOptions = {
  colors: process.stderr.isTTY,
  quotes: !process.stderr.isTTY,
};

export const formatMessage = (msg: optique.Message) =>
  optique.formatMessage(msg, messageOptions);

/** Prints an informational message to stderr. */
export const printMessage = (msg: optique.Message) => {
  console.error(formatMessage(msg));
};
