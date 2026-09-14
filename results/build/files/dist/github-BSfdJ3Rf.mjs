import { t as CliError } from "./error-CBVDOF4e.mjs";
import { envVar, message, values } from "@optique/core/message";
import { attestProvenance } from "@actions/attest";
import { provider } from "std-env";
//#region src/cli/lib/provenance/providers/github.ts
const GITHUB_TOKEN_ENV_VAR_NAME = "GITHUB_TOKEN";
const getGitHubToken = () => {
	const token = process.env[GITHUB_TOKEN_ENV_VAR_NAME];
	if (!token) throw new CliError(message`The ${envVar(GITHUB_TOKEN_ENV_VAR_NAME)} environment variable is required to generate provenance.`);
	return token;
};
const enable = () => provider === "github_actions";
const generateProvenance = async function generateProvenance(subjects) {
	const token = getGitHubToken();
	try {
		const attestation = await attestProvenance({
			subjects: subjects.map((subject) => ({
				name: subject.name,
				digest: { sha256: subject.sha256 }
			})),
			token
		});
		return new TextEncoder().encode(JSON.stringify(attestation.bundle));
	} catch (cause) {
		throw new CliError(message`Failed to generate provenance for ${values(subjects.map((subject) => subject.name))}`, { cause });
	}
};
//#endregion
export { enable, generateProvenance };

//# sourceMappingURL=github-BSfdJ3Rf.mjs.map