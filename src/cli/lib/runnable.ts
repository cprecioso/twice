import { execa } from "execa";
import * as z from "zod";

export const runnableSchema = z.compile(z.string().brand<"Runnable">());

export type RunnableInput = z.input<typeof runnableSchema>;
export type Runnable = z.infer<typeof runnableSchema>;

export const run = async (runnable: Runnable, { cwd }: { cwd: string }) => {
  const result = await execa(runnable, { cwd, shell: true });
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
  };
};

export type RunnableResult = keyof Awaited<ReturnType<typeof run>>;
