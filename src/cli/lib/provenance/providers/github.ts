import { attestProvenance } from "@actions/attest";
import { envVar, message } from "@optique/core/message";
import { provider } from "std-env";
import { CliError } from "../../../error";
import type { Enable, GenerateProvenance, Subject } from "../base";

const GITHUB_TOKEN_ENV_VAR_NAME = "GITHUB_TOKEN";

const getGitHubToken = () => {
  const token = process.env[GITHUB_TOKEN_ENV_VAR_NAME];
  if (!token) {
    throw new CliError(
      message`The ${envVar(GITHUB_TOKEN_ENV_VAR_NAME)} environment variable is required to generate provenance.`,
    );
  }
  return token;
};

export const enable: Enable = () => provider === "github_actions";

export const generateProvenance: GenerateProvenance =
  async function generateProvenance(subject: Subject) {
    const token = getGitHubToken();
    try {
      const attestation = await attestProvenance({
        subjects: [{ name: subject.name, digest: { sha256: subject.sha256 } }],
        token,
      });
      return new TextEncoder().encode(JSON.stringify(attestation.bundle));
    } catch (cause) {
      throw new CliError(
        message`Failed to generate provenance for ${subject.name}`,
        { cause },
      );
    }
  };
