import {
  choice,
  flag,
  map,
  option,
  optional,
  or,
  type InferValue,
} from "@optique/core";
import { message } from "@optique/core/message";
import { providerIds } from "./providers";

export const provenanceOption = optional(
  or(
    option("--provenance", choice(providerIds, { metavar: "PROVIDER" }), {
      description: message`The provenance provider to use. By default, it's disabled locally, and enabled if a supported platform is detected.`,
    }),
    map(
      flag("--no-provenance", {
        description: message`Always disable provenance.`,
      }),
      () => false,
    ),
  ),
);

export type ProvenanceMode = InferValue<typeof provenanceOption>;
