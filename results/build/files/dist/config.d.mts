import * as c12 from "c12";
import * as z from "zod";
//#region src/cli/config.d.ts
declare const globSchema: z.ZodUnion<readonly [z.ZodPipe<z.ZodString, z.ZodTransform<string[], string>>, z.ZodArray<z.ZodString>]>;
type GlobInput = z.input<typeof globSchema>;
declare const configSchema: z.ZodObject<{
  tasks: z.ZodRecord<z.ZodString, z.ZodObject<{
    run: z.core.$ZodBranded<z.ZodString, "Runnable", "out">;
    store: z.ZodIntersection<z.ZodObject<{
      files: z.ZodOptional<z.ZodObject<{
        glob: z.ZodUnion<readonly [z.ZodPipe<z.ZodString, z.ZodTransform<string[], string>>, z.ZodArray<z.ZodString>]>;
      }, z.core.$strip>>;
    }, z.core.$strip>, z.ZodRecord<z.ZodEnum<{
      exitCode: "exitCode";
      stderr: "stderr";
      stdout: "stdout";
    }>, z.ZodDefault<z.ZodBoolean>>>;
  }, z.core.$strip>>;
}, z.core.$strip>;
type ConfigInput = z.input<typeof configSchema>;
export declare const defineConfig: c12.DefineConfig<{
  tasks: Record<string, {
    run: string;
    store: {
      files?: {
        glob: string | string[];
      } | undefined;
    } & Partial<Record<"exitCode" | "stderr" | "stdout", boolean | undefined>>;
  }>;
}, c12.ConfigLayerMeta>;
//#endregion
//#region src/cli/lib/runnable.d.ts
declare const runnableSchema: z.core.$ZodBranded<z.ZodString, "Runnable", "out">;
type RunnableInput = z.input<typeof runnableSchema>;
//#endregion
export type { ConfigInput as Config, GlobInput as Glob, RunnableInput as Runnable };
//# sourceMappingURL=config.d.mts.map