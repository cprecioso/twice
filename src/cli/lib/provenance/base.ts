import type { Tagged } from "type-fest";
import * as z from "zod";

export type ProviderId = Tagged<string, "ProviderId">;

export type Subject = z.infer<typeof subjectSchema>;
export const subjectSchema = z.object({
  name: z.string(),
  sha256: z.hash("sha256"),
});

export type Enable = z.infer<typeof enableSchema>;
export const enableSchema = z.function({
  input: z.tuple([]),
  output: z.boolean(),
});

export type GenerateProvenance = z.infer<typeof generateProvenanceSchema>;
export const generateProvenanceSchema = z.function({
  input: z.tuple([subjectSchema]),
  output: z.promise(z.instanceof(Uint8Array)),
});

export type Provider = z.infer<typeof providerSchema>;
export const providerSchema = z.object({
  enable: enableSchema,
  generateProvenance: generateProvenanceSchema,
});
