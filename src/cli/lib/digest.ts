import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { Transform, type Readable } from "node:stream";

/**
 * Passes `input` through unchanged while computing its SHA-256. Call `digest`
 * once the returned stream has been fully consumed.
 */
export const sha256Tap = (input: Readable) => {
  const hasher = createHash("sha256");
  const stream = input.pipe(
    new Transform({
      transform(chunk, _encoding, callback) {
        hasher.update(chunk);
        callback(null, chunk);
      },
    }),
  );
  return { stream, digest: () => hasher.digest("hex") };
};

export const sha256Bytes = (data: Uint8Array) =>
  createHash("sha256").update(data).digest("hex");

export const sha256File = async (filePath: string) => {
  const hasher = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hasher.update(chunk);
  return hasher.digest("hex");
};
