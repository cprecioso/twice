import { formatMessage } from "@optique/core/message";
//#region src/cli/error.ts
var CliError = class extends Error {
	constructor(cliMessage, { plainError = formatMessage(cliMessage), ...options } = {}) {
		super(plainError, options);
		this.cliMessage = cliMessage;
		Object.defineProperties(this, {
			cliMessage: { enumerable: false },
			exitCode: { enumerable: false }
		});
	}
	cliMessage;
	exitCode = 1;
};
//#endregion
export { CliError as t };

//# sourceMappingURL=error-CBVDOF4e.mjs.map