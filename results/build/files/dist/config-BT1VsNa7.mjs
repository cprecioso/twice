import { t as CliError } from "./error-CBVDOF4e.mjs";
import { lineBreak, message, text } from "@optique/core/message";
import "execa";
import * as c12 from "c12";
import * as z from "zod";
//#region package.json
var name = "@cprecioso/twice";
var version = "0.1.0";
var description = "Store and compare CI results between commits";
var bugs = { "url": "https://github.com/cprecioso/twice/issues" };
var author = {
	"name": "Carlos Precioso",
	"url": "https://github.com/cprecioso"
};
//#endregion
//#region src/cli/lib/runnable.ts
const runnableSchema = z.compile(z.string().brand());
//#endregion
//#region src/cli/config.ts
const binaryName = name.split("/").at(-1);
const globSchema = z.compile(z.union([z.string().transform((p) => [p]), z.string().array()]));
/**
* Task ids name the directory their results are stored in, so they must be a
* single, well-formed path component.
*/
const taskIdSchema = z.string().refine((taskId) => taskId !== "." && taskId !== ".." && !/[/\0\n]/.test(taskId) && taskId.trim() === taskId && taskId !== "", { error: "Task ids cannot be empty, be '.' or '..', contain slashes, NUL characters or line breaks, or start or end with whitespace" });
const configSchema = z.compile(z.object({ tasks: z.record(taskIdSchema, z.object({
	run: runnableSchema,
	store: z.object({ files: z.object({ glob: globSchema }).optional() }).and(z.record(z.enum([
		"exitCode",
		"stderr",
		"stdout"
	]), z.boolean().default(false)))
})) }));
const defineConfig = c12.createDefineConfig();
const loadConfig = async (projectDir, configFile) => {
	const { config } = await c12.loadConfig({
		name: binaryName,
		globalRc: false,
		configFile,
		cwd: projectDir
	});
	const result = configSchema.safeParse(config);
	if (result.success) return result.data;
	else throw new CliError(message`Couldn't parse config:${lineBreak()}${z.prettifyError(result.error).split("\n").flatMap((line, i) => {
		const parts = [text("	"), text(line)];
		if (i !== 0) parts.unshift(lineBreak());
		return parts;
	})}`, { cause: result.error });
};
//#endregion
export { bugs as a, author as i, defineConfig as n, description as o, loadConfig as r, version as s, binaryName as t };

//# sourceMappingURL=config-BT1VsNa7.mjs.map