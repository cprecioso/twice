#!/usr/bin/env node
import { a as bugs, i as author, o as description, r as loadConfig, s as version, t as binaryName } from "./config-BT1VsNa7.mjs";
import { t as CliError } from "./error-CBVDOF4e.mjs";
import { commandLine, message, optionNames, text, url } from "@optique/core/message";
import { commandsFromModules, defineCommand, runProgram } from "@optique/discover";
import { path, printError } from "@optique/run";
import { inspect, styleText } from "node:util";
import * as optique from "@optique/core";
import { choice, dependency, flag, map, merge, message as message$1, multiple, object, option, optionNames as optionNames$1, optional, or, string, text as text$1, values as values$1, withDefault } from "@optique/core";
import { ExecaError, execa } from "execa";
import * as path$2 from "node:path";
import path$1 from "node:path";
import * as z from "zod";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { Transform } from "node:stream";
import * as fs from "node:fs/promises";
import { gitRemote } from "@optique/git";
//#region src/cli/global.ts
const projectDirOptionNames = ["-p", "--project"];
const configFilePathOptionNames = ["-c", "--config"];
const projectDirDependency = dependency(path({
	type: "directory",
	mustExist: true
}));
const configFilePathDependency = dependency(path({
	type: "file",
	mustExist: true
}));
const globalOptions = object({
	projectDir: withDefault(option(...projectDirOptionNames, projectDirDependency, { description: message$1`The path to the project directory.` }), "."),
	configFilePath: optional(option(...configFilePathOptionNames, configFilePathDependency, { description: message$1`The path to the configuration file.` }))
});
//#endregion
//#region src/cli/lib/digest.ts
/**
* Passes `input` through unchanged while computing its SHA-256. Call `digest`
* once the returned stream has been fully consumed.
*/
const sha256Tap = (input) => {
	const hasher = createHash("sha256");
	return {
		stream: input.pipe(new Transform({ transform(chunk, _encoding, callback) {
			hasher.update(chunk);
			callback(null, chunk);
		} })),
		digest: () => hasher.digest("hex")
	};
};
const sha256Bytes = (data) => createHash("sha256").update(data).digest("hex");
const sha256File = async (filePath) => {
	const hasher = createHash("sha256");
	for await (const chunk of createReadStream(filePath)) hasher.update(chunk);
	return hasher.digest("hex");
};
//#endregion
//#region src/cli/lib/files.ts
const toPosix = (p) => p.split(path$2.sep).join(path$2.posix.sep);
/**
* The regular files matched by `globs` (relative to `cwd`), sorted by path.
* Matched directories are included recursively. Symlinks are followed.
*/
const collectFiles = async (cwd, globs) => {
	const files = /* @__PURE__ */ new Map();
	const visit = async (relPath, { recurse }) => {
		const absPath = path$2.join(cwd, relPath);
		const stat = await fs.stat(absPath);
		if (stat.isFile()) {
			const posixPath = toPosix(relPath);
			files.set(posixPath, {
				path: posixPath,
				mode: stat.mode & 73 ? "100755" : "100644"
			});
		} else if (stat.isDirectory() && recurse) {
			const entries = await fs.readdir(absPath, {
				recursive: true,
				withFileTypes: true
			});
			for (const entry of entries) {
				if (!entry.isFile() && !entry.isSymbolicLink()) continue;
				const entryPath = path$2.join(entry.parentPath, entry.name);
				await visit(path$2.relative(cwd, entryPath), { recurse: false });
			}
		}
	};
	for await (const match of fs.glob([...globs], { cwd })) await visit(match, { recurse: true });
	return [...files.values()].toSorted((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
};
//#endregion
//#region src/cli/lib/format.ts
const messageOptions = {
	colors: process.stderr.isTTY,
	quotes: !process.stderr.isTTY
};
const formatMessage$1 = (msg) => optique.formatMessage(msg, messageOptions);
/** Prints an informational message to stderr. */
const printMessage = (msg) => {
	console.error(formatMessage$1(msg));
};
//#endregion
//#region src/cli/lib/git.ts
const treeMode = "040000";
/** The directory an entry path lives in; `""` for the root. */
const parentDir = (entryPath) => {
	const dir = path$2.posix.dirname(entryPath);
	return dir === "." ? "" : dir;
};
const depthOf = (dir) => dir === "" ? 0 : dir.split("/").length;
const lines = (output) => output.split("\n").filter((line) => line !== "");
/**
* Thin wrappers around the git plumbing commands used to read and write
* objects and refs in the repository at `cwd`.
*/
const createGit = ({ cwd, env = {} }) => {
	const $ = execa({
		cwd,
		env,
		stdout: "pipe",
		stderr: "pipe"
	});
	/** Resolves a revision to an object id, or `null` if it doesn't resolve. */
	const revParse = async (rev) => {
		const result = await $({ reject: false })`git rev-parse --verify --quiet ${rev}`;
		return result.failed ? null : result.stdout.trim();
	};
	/** The short name of the ref a symbolic ref points to, or `null`. */
	const symbolicRef = async (name) => {
		const result = await $({ reject: false })`git symbolic-ref --quiet --short ${name}`;
		return result.failed ? null : result.stdout.trim();
	};
	const isValidRef = async (ref) => !(await $({ reject: false })`git check-ref-format ${ref}`).failed;
	/** Writes a blob with the given content. */
	const hashObject = async (input) => (await $({ input })`git hash-object -w --stdin`).stdout.trim();
	/** Writes one blob per file, with the content of the file as is. */
	const hashObjectPaths = async (paths) => {
		if (paths.length === 0) return [];
		const invalid = paths.find((p) => p.includes("\n"));
		if (invalid !== void 0) throw new CliError(message`Cannot store ${invalid}: file names must not contain line breaks.`);
		const { stdout } = await $({ input: paths.map((p) => `${p}\n`).join("") })`git hash-object -w --no-filters --stdin-paths`;
		const oids = lines(stdout);
		if (oids.length !== paths.length) throw new Error(`git hash-object returned ${oids.length} object ids for ${paths.length} paths`);
		return oids;
	};
	const emptyTree = async () => (await $({ input: "" })`git hash-object -t tree -w --stdin`).stdout.trim();
	/** Writes one tree per list of direct (non-nested) entries. */
	const mkTrees = async (trees) => {
		if (trees.length === 0) return [];
		if (trees.some((tree) => tree.length === 0)) throw new Error("git mktree cannot write empty trees in batch mode");
		const input = trees.map((tree) => tree.map((e) => `${e.mode} ${e.type} ${e.oid}\t${e.path}\0`).join("")).join("\0");
		const { stdout } = await $({ input })`git mktree --batch -z`;
		const oids = lines(stdout);
		if (oids.length !== trees.length) throw new Error(`git mktree returned ${oids.length} trees for ${trees.length} inputs`);
		return oids;
	};
	/**
	* Writes a tree from a flat list of entries, whose paths may be nested.
	* Intermediate trees are created as needed, with one `git mktree` call per
	* depth level (deepest first).
	*/
	const writeTree = async (entries) => {
		if (entries.length === 0) return emptyTree();
		const dirs = /* @__PURE__ */ new Map([["", []]]);
		const ensureDir = (dir) => {
			if (dirs.has(dir)) return;
			dirs.set(dir, []);
			ensureDir(parentDir(dir));
		};
		for (const entry of entries) {
			const dir = parentDir(entry.path);
			ensureDir(dir);
			dirs.get(dir).push({
				...entry,
				path: path$2.posix.basename(entry.path)
			});
		}
		const byDepth = Map.groupBy(dirs.keys(), depthOf);
		let root;
		for (let depth = Math.max(...byDepth.keys()); depth >= 0; depth--) {
			const dirsAtDepth = byDepth.get(depth) ?? [];
			const oids = await mkTrees(dirsAtDepth.map((dir) => dirs.get(dir)));
			for (const [i, dir] of dirsAtDepth.entries()) {
				const oid = oids[i];
				if (dir === "") root = oid;
				else dirs.get(parentDir(dir)).push({
					mode: treeMode,
					type: "tree",
					oid,
					path: path$2.posix.basename(dir)
				});
			}
		}
		return root;
	};
	const commitTree = async ({ tree, parents = [], message: commitMessage, author }) => {
		const authorEnv = author ? {
			GIT_AUTHOR_NAME: author.name,
			GIT_AUTHOR_EMAIL: author.email,
			GIT_AUTHOR_DATE: author.date
		} : {};
		const { stdout } = await $({
			input: commitMessage,
			env: {
				...env,
				...authorEnv
			}
		})`git commit-tree --no-gpg-sign ${parents.flatMap((p) => ["-p", p])} -F - ${tree}`;
		return stdout.trim();
	};
	const readCommit = async (oid) => {
		const { stdout } = await $({ stripFinalNewline: false })`git cat-file commit ${oid}`;
		const separator = stdout.indexOf("\n\n");
		const authorLine = stdout.slice(0, separator).split("\n").find((header) => header.startsWith("author "));
		const match = authorLine && /^author (.*) <(.*)> (\d+ [+-]\d{4})$/.exec(authorLine);
		if (!match) throw new Error(`Could not parse the author of commit ${oid}`);
		return {
			author: {
				name: match[1],
				email: match[2],
				date: match[3]
			},
			message: stdout.slice(separator + 2)
		};
	};
	/**
	* Points `ref` at `newOid`, verifying that it currently points at `oldOid`
	* (or that it doesn't exist, if `oldOid` is `null`).
	*/
	const updateRef = async (ref, newOid, oldOid) => {
		const command = oldOid === null ? `create ${ref} ${newOid}` : `update ${ref} ${newOid} ${oldOid}`;
		await $({ input: `${command}\n` })`git update-ref --stdin`;
	};
	const isAncestor = async (ancestor, descendant) => {
		try {
			await $`git merge-base --is-ancestor ${ancestor} ${descendant}`;
			return true;
		} catch (error) {
			if (error instanceof ExecaError && error.exitCode === 1) return false;
			throw error;
		}
	};
	/** The commits in `range`, following first parents, oldest first. */
	const revList = async (range) => lines((await $`git rev-list --reverse --first-parent ${range}`).stdout);
	/** The object ids the given refs point to on a remote (absent if missing). */
	const lsRemote = async (remote, refs) => {
		if (refs.length === 0) return /* @__PURE__ */ new Map();
		const { stdout } = await $`git ls-remote --refs ${remote} ${refs}`;
		const wanted = new Set(refs);
		return new Map(lines(stdout).flatMap((line) => {
			const [oid, ref] = line.split("	");
			return oid && ref && wanted.has(ref) ? [[ref, oid]] : [];
		}));
	};
	/** Fetches a ref from a remote, without touching any local ref. */
	const fetchRef = async (remote, ref) => {
		await $`git fetch --refmap= ${remote} ${ref}`;
		const oid = await revParse("FETCH_HEAD");
		if (oid === null) throw new Error(`git fetch did not record ${ref}`);
		return oid;
	};
	const push = async (remote, refspecs) => {
		await $`git push ${remote} ${refspecs}`;
	};
	return {
		revParse,
		symbolicRef,
		isValidRef,
		hashObject,
		hashObjectPaths,
		writeTree,
		commitTree,
		readCommit,
		updateRef,
		isAncestor,
		revList,
		lsRemote,
		fetchRef,
		push
	};
};
//#endregion
//#region src/cli/lib/git-identity.ts
const fallbackName = "twice";
const fallbackEmail = "twice@todone.run";
/**
* Environment variables that give git a committer/author identity when the
* repository or user has none configured. Any identity that is already set
* (through config or environment) is left untouched.
*/
const gitIdentityEnv = async (cwd) => {
	const $ = execa({ cwd });
	const configured = (key) => $`git config --get ${key}`.then(({ stdout }) => stdout.trim() !== "", () => false);
	const [hasName, hasEmail] = await Promise.all([configured("user.name"), configured("user.email")]);
	const env = {};
	if (!hasName) {
		env.GIT_AUTHOR_NAME = process.env.GIT_AUTHOR_NAME ?? fallbackName;
		env.GIT_COMMITTER_NAME = process.env.GIT_COMMITTER_NAME ?? fallbackName;
	}
	if (!hasEmail) {
		env.GIT_AUTHOR_EMAIL = process.env.GIT_AUTHOR_EMAIL ?? fallbackEmail;
		env.GIT_COMMITTER_EMAIL = process.env.GIT_COMMITTER_EMAIL ?? fallbackEmail;
	}
	return env;
};
//#endregion
//#region src/cli/lib/provenance/base.ts
const subjectSchema = z.object({
	name: z.string(),
	sha256: z.hash("sha256")
});
const enableSchema = z.function({
	input: z.tuple([]),
	output: z.boolean()
});
const generateProvenanceSchema = z.function({
	input: z.tuple([z.array(subjectSchema).min(1)]),
	output: z.promise(z.instanceof(Uint8Array))
});
const providerSchema = z.object({
	enable: enableSchema,
	generateProvenance: generateProvenanceSchema
});
//#endregion
//#region src/cli/lib/provenance/providers.ts
const allProviders = /* #__PURE__ */ Object.assign({ "./providers/github.ts": () => import("./github-BSfdJ3Rf.mjs") });
const providerIds = Object.keys(allProviders).map((key) => path$1.basename(key, ".ts"));
const getProvider = async (id) => {
	const lazyProvider = allProviders[`./providers/${id}.ts`];
	if (!lazyProvider) throw new CliError(message`Provider with id ${id} not found`);
	return providerSchema.parse(await lazyProvider());
};
const getGenerateProvenance = async (id) => {
	const provider = await getProvider(id);
	return provider.generateProvenance.bind(provider);
};
const NOT_ENABLED = Symbol("Not enabled");
const getFirstEnabledProvider = async () => {
	try {
		return await Promise.any(providerIds.map(async (id) => {
			const provider = await getProvider(id);
			if (provider.enable()) return {
				id,
				provider
			};
			else throw NOT_ENABLED;
		}));
	} catch (error) {
		if (error instanceof AggregateError) {
			error.errors = error.errors.filter((e) => e !== NOT_ENABLED);
			if (error.errors.length === 0) return null;
		}
		throw error;
	}
};
//#endregion
//#region src/cli/lib/provenance/index.ts
const provenanceOption = optional(or(option("--provenance", choice(providerIds, { metavar: "PROVIDER" }), { description: message`The provenance provider to use. By default, it's disabled locally, and enabled if a supported platform is detected.` }), map(flag("--no-provenance", { description: message`Always disable provenance.` }), () => false)));
//#endregion
//#region src/cli/lib/ref.ts
const refOptionNames = ["--ref"];
const refValue = string({ metavar: "REF" });
/** Selects the ref results are stored for, e.g. `main`. */
const refOption = optional(option(...refOptionNames, refValue, { description: message`The ref (e.g. branch) the results belong to. Defaults to the branch checked out at HEAD.` }));
/** Selects one or more refs results are stored for. */
const refsOption = multiple(option(...refOptionNames, refValue, { description: message`The ref(s) whose results to push. Defaults to the branch checked out at HEAD. (can be specified multiple times)` }));
/** The name of the branch checked out at HEAD. */
const detectRef = async (git) => {
	const branch = await git.symbolicRef("HEAD");
	if (branch === null) throw new CliError(message`HEAD is not on a branch. Use ${optionNames(refOptionNames)} to specify the ref the results belong to.`);
	return branch;
};
//#endregion
//#region src/cli/lib/store.ts
/**
* The ref under which the results for `refName` are stored. It points to a
* chain of commits, one per `attach` run, each a snapshot of the results of
* every configured task for a single source commit. Their tree looks like:
*
*     results/<task>/<result>
*     results/<task>/<result>.provenance.json
*
* where `<result>` is a plain file (`stdout`, `stderr`, `exitCode`) or the
* `files` directory, which holds the stored files at their original paths.
*/
const twiceRef = (refName) => `refs/twice/ref/${refName}`;
const resultsDir = "results";
/** The directory of the results tree that holds a task's results. */
const taskDir = (taskId) => `${resultsDir}/${taskId}`;
/** The path of a task's result within the results tree. */
const resultPath = (taskId, resultId) => `${taskDir(taskId)}/${resultId}`;
/** The name of a result's provenance file, which sits next to the result. */
const provenanceFileName = (resultId) => `${resultId}.provenance.json`;
/** Commit message trailers that describe what a results commit holds. */
const refTrailer = "Twice-Ref";
const commitTrailer = "Twice-Commit";
const assertValidRefName = async (git, refName) => {
	if (!await git.isValidRef(twiceRef(refName))) throw new CliError(message`${refName} is not a valid ref name.`);
};
/** The commit holding the results stored for `refName`, or `null`. */
const readResultsTip = (git, refName) => git.revParse(`${twiceRef(refName)}^{commit}`);
/** Writes a results tree holding the given tasks' results. */
const writeResultsTree = (git, taskTrees) => git.writeTree([...taskTrees].flatMap(([taskId, oid]) => oid === null ? [] : [{
	mode: "040000",
	type: "tree",
	oid,
	path: taskDir(taskId)
}]));
/** Commits a results tree on top of `parent` and points the ref at it. */
const commitResults = async (git, { refName, sourceCommit, tree, parent }) => {
	const commitMessage = [
		`Results for ${refName} at ${sourceCommit.slice(0, 7)}`,
		"",
		`${refTrailer}: ${refName}`,
		`${commitTrailer}: ${sourceCommit}`
	].join("\n") + "\n";
	const commit = await git.commitTree({
		tree,
		parents: parent === null ? [] : [parent],
		message: commitMessage
	});
	await git.updateRef(twiceRef(refName), commit, parent);
	return commit;
};
/**
* Re-creates the results commits `commits` (oldest first) on top of `onto`,
* keeping their trees, messages and authors, so that the history is linear.
*/
const replayResults = async (git, onto, commits) => {
	let base = onto;
	for (const commit of commits) {
		const tree = await git.revParse(`${commit}^{tree}`);
		if (tree === null) throw new Error(`${commit} is not a commit`);
		const { author, message: commitMessage } = await git.readCommit(commit);
		base = await git.commitTree({
			tree,
			parents: [base],
			message: commitMessage,
			author
		});
	}
	return base;
};
//#endregion
//#region src/cli/commands/attach.ts
const ignoreDirtyOptionNames = ["--ignore-dirty"];
var attach_default = defineCommand({
	parser: merge(globalOptions, object({
		ignoreDirty: withDefault(option(...ignoreDirtyOptionNames, { description: message$1`Run even if the working directory is dirty.` }), false),
		provenance: provenanceOption,
		ref: refOption
	})),
	metadata: { description: message$1`Run the configured tasks and store their results for the current ref.` },
	handler: async ({ projectDir, configFilePath, ignoreDirty, provenance: provenanceArg, ref: refArg }) => {
		const $ = execa({
			cwd: projectDir,
			stdout: "pipe",
			stdin: "inherit"
		});
		if (!ignoreDirty) {
			if (await $`git diff --quiet`.then(() => false, () => true)) throw new CliError(message$1`Working directory ${projectDir} is dirty. Use ${optionNames$1(ignoreDirtyOptionNames)} to override.`);
		}
		const config = await loadConfig(projectDir, configFilePath);
		const git = createGit({
			cwd: projectDir,
			env: await gitIdentityEnv(projectDir)
		});
		const refName = refArg ?? await detectRef(git);
		await assertValidRefName(git, refName);
		const sourceCommit = await git.revParse("HEAD^{commit}");
		if (sourceCommit === null) throw new CliError(message$1`HEAD does not point to a commit.`);
		const generateProvenance = await discoverProvenanceProvider(provenanceArg);
		const taskTrees = /* @__PURE__ */ new Map();
		for (const [taskId, taskDef] of Object.entries(config.tasks)) {
			const store = makeResultStore({
				git,
				taskId,
				generateProvenance
			});
			const taskProc = $(taskDef.run, {
				shell: true,
				reject: false
			});
			const storePromises = [];
			if (taskDef.store.stdout) storePromises.push(store.stream("stdout", taskProc.stdout));
			if (taskDef.store.stderr) storePromises.push(store.stream("stderr", taskProc.stderr));
			const [result] = await Promise.all([taskProc, ...storePromises]);
			if (result.exitCode === void 0) throw new CliError(message$1`Task ${taskId} did not exit normally.`, { cause: result });
			if (!taskDef.store.exitCode && result.exitCode !== 0) throw new CliError(message$1`Task ${taskId} failed with exit code ${text$1(String(result.exitCode))}.`, { cause: result });
			if (taskDef.store.exitCode) await store.bytes("exitCode", new TextEncoder().encode(JSON.stringify(result.exitCode)));
			if (taskDef.store.files) await store.files("files", taskDef.store.files.glob, projectDir);
			taskTrees.set(taskId, await store.writeTree());
		}
		const parent = await readResultsTip(git, refName);
		const tree = await writeResultsTree(git, taskTrees);
		const commit = await commitResults(git, {
			refName,
			sourceCommit,
			tree,
			parent
		});
		printMessage(message$1`Stored the results for ${refName} in ${twiceRef(refName)} (${commit}).`);
	}
});
/**
* Collects a task's results as tree entries, relative to the task's
* directory in the results tree, generating provenance for each of them.
*/
const makeResultStore = ({ git, taskId, generateProvenance }) => {
	const entries = [];
	const addBlob = (entryPath, oid, mode = "100644") => {
		entries.push({
			mode,
			type: "blob",
			oid,
			path: entryPath
		});
	};
	const addProvenance = async (resultId, subjects) => {
		if (generateProvenance === null || subjects.length === 0) return;
		const provenance = await generateProvenance(subjects);
		addBlob(provenanceFileName(resultId), await git.hashObject(provenance));
	};
	return {
		/** Stores a result as a file with the content of a stream. */
		stream: async (resultId, input) => {
			const { stream, digest } = sha256Tap(input);
			addBlob(resultId, await git.hashObject(stream));
			await addProvenance(resultId, [{
				name: resultPath(taskId, resultId),
				sha256: digest()
			}]);
		},
		/** Stores a result as a file with the given content. */
		bytes: async (resultId, data) => {
			addBlob(resultId, await git.hashObject(data));
			await addProvenance(resultId, [{
				name: resultPath(taskId, resultId),
				sha256: sha256Bytes(data)
			}]);
		},
		/**
		* Stores a result as a directory with the files matched by `globs` at
		* their original paths. Their provenance covers every file.
		*/
		files: async (resultId, globs, cwd) => {
			const files = await collectFiles(cwd, globs);
			if (files.length === 0) {
				printMessage(message$1`Task ${taskId}: no files matched ${values$1(globs)}; nothing stored.`);
				return;
			}
			const oids = await git.hashObjectPaths(files.map((file) => file.path));
			const subjects = [];
			for (const [i, file] of files.entries()) {
				addBlob(`${resultId}/${file.path}`, oids[i], file.mode);
				if (generateProvenance) subjects.push({
					name: `${resultPath(taskId, resultId)}/${file.path}`,
					sha256: await sha256File(path$2.join(cwd, file.path))
				});
			}
			await addProvenance(resultId, subjects);
		},
		/** Writes the task's results tree, or `null` if nothing was stored. */
		writeTree: async () => entries.length === 0 ? null : await git.writeTree(entries)
	};
};
const discoverProvenanceProvider = async (arg) => {
	if (arg === false) return null;
	const providerId = typeof arg === "string" ? arg : (await getFirstEnabledProvider())?.id;
	if (!providerId) {
		if (arg === true) throw new CliError(message$1`No provider found`);
		else return null;
	}
	return await getGenerateProvenance(providerId);
};
//#endregion
//#region src/cli/commands/push.ts
const remoteOptionNames = ["-r", "--remote"];
const remoteOptionValue = projectDirDependency.deriveAsync({
	metavar: "REMOTE",
	factory: (projectDir) => gitRemote({ dir: projectDir }),
	defaultValue: () => "origin"
});
var push_default = defineCommand({
	parser: merge(globalOptions, object({
		remote: withDefault(option(...remoteOptionNames, remoteOptionValue, { description: message$1`The remote to push the results to.` }), "origin"),
		refs: refsOption
	})),
	metadata: { description: message$1`Push the stored results for one or more refs to a remote.` },
	handler: async ({ projectDir, remote, refs: refArgs }) => {
		const git = createGit({
			cwd: projectDir,
			env: await gitIdentityEnv(projectDir)
		});
		const refNames = refArgs.length > 0 ? [...new Set(refArgs)] : [await detectRef(git)];
		for (const refName of refNames) await assertValidRefName(git, refName);
		const remoteTips = await git.lsRemote(remote, refNames.map(twiceRef)).catch((cause) => {
			throw new CliError(message$1`Could not list the refs of ${remote}.`, { cause });
		});
		for (const refName of refNames) {
			const ref = twiceRef(refName);
			const localTip = await readResultsTip(git, refName);
			if (localTip === null) throw new CliError(message$1`There are no results stored for ${refName}. Run ${commandLine(`${binaryName} attach`)} first.`);
			if (remoteTips.has(ref)) {
				const remoteTip = await git.fetchRef(remote, ref).catch((cause) => {
					throw new CliError(message$1`Could not fetch the results for ${refName} from ${remote}.`, { cause });
				});
				if (remoteTip === localTip) {
					printMessage(message$1`${remote} already has the results for ${refName}.`);
					continue;
				}
				if (!await git.isAncestor(remoteTip, localTip)) {
					const newCommits = await git.revList(`${remoteTip}..${localTip}`);
					if (newCommits.length === 0) {
						await git.updateRef(ref, remoteTip, localTip);
						printMessage(message$1`${remote} already has newer results for ${refName}; updated ${ref} to match.`);
						continue;
					}
					const newTip = await replayResults(git, remoteTip, newCommits);
					await git.updateRef(ref, newTip, localTip);
				}
			}
			await git.push(remote, [`${ref}:${ref}`]).catch((cause) => {
				throw new CliError(message$1`Could not push the results for ${refName} to ${remote}.`, { cause });
			});
			printMessage(message$1`Pushed the results for ${refName} to ${remote}.`);
		}
	}
});
//#endregion
//#region src/cli/commands.ts
var commands_default = commandsFromModules(/* #__PURE__ */ Object.assign({
	"./commands/attach.ts": attach_default,
	"./commands/push.ts": push_default
}), {
	base: "./commands/",
	extensions: [".ts"]
});
//#endregion
//#region src/bin.entry.ts
try {
	await runProgram({
		commands: commands_default,
		metadata: {
			name: binaryName,
			version,
			description: message`${text(description)}`,
			author: message`${text(author.name)} (${url(author.url)})`,
			bugs: message`${url(bugs.url)}`
		},
		help: { option: { names: ["-h", "--help"] } },
		version: {
			value: version,
			option: {
				names: ["-v", "--version"],
				hidden: "usage"
			}
		},
		completion: { command: { hidden: "usage" } },
		showDefault: true,
		showChoices: true
	});
} catch (err) {
	const { cliMessage, exitCode } = err instanceof CliError ? err : {
		cliMessage: message`An unexpected error occurred.`,
		exitCode: 1
	};
	printError(cliMessage);
	console.error("\n" + styleText("dim", inspect(err)));
	process.exitCode = exitCode;
}
//#endregion
export {};

//# sourceMappingURL=bin.mjs.map