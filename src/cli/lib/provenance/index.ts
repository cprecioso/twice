import {
  choice,
  negatableFlag,
  option,
  optional,
  or,
  type InferValue,
} from "@optique/core";
import { message } from "@optique/core/message";
import { providerIds } from "./providers";

export const provenanceOption = optional(
  or(
    negatableFlag(
      {
        positive: "--provenance",
        negative: "--no-provenance",
      },
      { description: message`Whether to enable provenance.` },
    ),
    option("--provenance", choice(providerIds, { metavar: "PROVIDER" }), {
      description: message`
          The provenance provider to use.
          By default, it's disabled locally, and enabled if a supported platform is detected.
        `,
    }),
  ),
);

export type ProvenanceMode = InferValue<typeof provenanceOption>;
