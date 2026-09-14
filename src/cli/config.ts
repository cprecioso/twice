import pkg from "#/package.json" with { type: "json" };
import { lineBreak, message, text } from "@optique/core/message";
import * as c12 from "c12";
import type { UnionToTuple } from "type-fest";
import * as z from "zod";
import { CliError } from "./error";
import { runnableSchema, type RunnableResult } from "./lib/runnable";

export const binaryName = pkg.name.split("/").at(-1)!;

export const globSchema = z.compile(
  z.union([z.string().transform((p) => [p]), z.string().array()]),
);

export type GlobInput = z.input<typeof globSchema>;
export type Glob = z.infer<typeof globSchema>;

/**
 * Task ids name the directory their results are stored in, so they must be a
 * single, well-formed path component.
 */
const taskIdSchema = z
  .string()
  .refine(
    (taskId) =>
      taskId !== "." &&
      taskId !== ".." &&
      !/[/\0\n]/.test(taskId) &&
      taskId.trim() === taskId &&
      taskId !== "",
    {
      error:
        "Task ids cannot be empty, be '.' or '..', contain slashes, NUL characters or line breaks, or start or end with whitespace",
    },
  );

export const configSchema = z.compile(
  z.object({
    tasks: z.record(
      taskIdSchema,
      z.object({
        run: runnableSchema,
        store: z
          .object({
            files: z.object({ glob: globSchema }).optional(),
          })
          .and(
            z.record(
              z.enum([
                "exitCode",
                "stderr",
                "stdout",
              ] satisfies UnionToTuple<RunnableResult>),
              z.boolean().default(false),
            ),
          ),
      }),
    ),
  }),
);

export type ConfigInput = z.input<typeof configSchema>;
export type Config = z.infer<typeof configSchema>;

export const defineConfig = c12.createDefineConfig<ConfigInput>();

export const loadConfig = async (projectDir: string, configFile?: string) => {
  const { config } = await c12.loadConfig({
    name: binaryName,
    globalRc: false,
    configFile,
    cwd: projectDir,
  });

  const result = configSchema.safeParse(config);
  if (result.success) {
    return result.data;
  } else {
    throw new CliError(
      message`Couldn't parse config:${lineBreak()}${z
        .prettifyError(result.error)
        .split("\n")
        .flatMap((line, i) => {
          const parts = [text("\t"), text(line)];
          if (i !== 0) parts.unshift(lineBreak());
          return parts;
        })}`,
      { cause: result.error },
    );
  }
};
