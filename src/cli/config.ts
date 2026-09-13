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

export const configSchema = z.compile(
  z.object({
    tasks: z.record(
      z.string(),
      z.object({
        run: runnableSchema,
        store: z
          .object({ glob: globSchema.optional() })
          .and(
            z.record(
              z.enum([
                "stdout",
                "stderr",
                "exitCode",
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

export const loadConfig = async (configFile?: string) => {
  const { config } = await c12.loadConfig({
    name: binaryName,
    globalRc: false,
    configFile,
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
