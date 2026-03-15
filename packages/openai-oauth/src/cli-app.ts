import { access } from "node:fs/promises"
import yargs from "yargs"
import { hideBin } from "yargs/helpers"
import {
	createCodexOAuthClient,
	resolveAuthFileCandidates,
} from "../../openai-oauth-core/src/index.js"
import { startOpenAIOAuthServer } from "./index.js"
import { resolveOpenAIOAuthModels } from "./models.js"
import { DEFAULT_PORT } from "./shared.js"

export type CliArgs = {
	host?: string
	port?: number
	models?: string[]
	baseURL?: string
	clientId?: string
	tokenUrl?: string
	authFilePath?: string
}

const parseModels = (value: string | undefined): string[] | undefined => {
	if (typeof value !== "string") {
		return undefined
	}

	const models = value
		.split(",")
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0)

	return models.length > 0 ? models : undefined
}

export const parseCliArgs = (argv: string[]): CliArgs => {
	const parsed = yargs(argv)
		.scriptName("openai-oauth")
		.strict()
		.help()
		.option("host", {
			type: "string",
			describe: "Host interface to bind the local proxy to.",
		})
		.option("port", {
			type: "number",
			describe: "Port to bind the local proxy to.",
		})
		.option("models", {
			type: "string",
			describe: "Comma-separated list of models exposed by /v1/models.",
			coerce: parseModels,
		})
		.option("base-url", {
			type: "string",
			describe: "Override the upstream Codex responses base URL.",
		})
		.option("oauth-client-id", {
			type: "string",
			describe: "Override the OAuth client id used for token refresh.",
		})
		.option("oauth-token-url", {
			type: "string",
			describe: "Override the OAuth token URL used for token refresh.",
		})
		.option("oauth-file", {
			type: "string",
			describe: "Override the auth.json file path used for local OAuth tokens.",
		})
		.parseSync()

	return {
		host: parsed.host,
		port: parsed.port,
		models: parsed.models,
		baseURL: parsed.baseUrl,
		clientId: parsed.oauthClientId,
		tokenUrl: parsed.oauthTokenUrl,
		authFilePath: parsed.oauthFile,
	}
}

export const toServerOptions = (args: CliArgs) => ({
	host: args.host,
	port: args.port ?? DEFAULT_PORT,
	models: args.models,
	baseURL: args.baseURL,
	clientId: args.clientId,
	tokenUrl: args.tokenUrl,
	authFilePath: args.authFilePath,
})

const findExistingAuthFile = async (
	authFilePath: string | undefined,
): Promise<string | undefined> => {
	for (const candidate of resolveAuthFileCandidates(authFilePath)) {
		try {
			await access(candidate)
			return candidate
		} catch {}
	}

	return undefined
}

const toMissingAuthFileMessage = (authFilePath: string | undefined): string => {
	if (authFilePath) {
		return [
			`No auth file was found at ${authFilePath}.`,
			"Run `npx @openai/codex login` and try again.",
		].join("\n")
	}

	const candidates = resolveAuthFileCandidates(undefined)
	return [
		`No auth file was found in the default search paths: ${candidates.join(", ")}.`,
		"Run `npx @openai/codex login` and try again.",
	].join("\n")
}

const toStartupMessage = (
	options: ReturnType<typeof toServerOptions>,
	availableModels: string[],
): string => {
	const baseUrl = `http://${options.host ?? "127.0.0.1"}:${options.port ?? DEFAULT_PORT}/v1`

	return [
		`OpenAI-compatible endpoint ready at ${baseUrl}`,
		"Use this as your OpenAI base URL. No API key is required.",
		`Available Models: ${availableModels.join(", ")}`,
	].join("\n")
}

export const runCli = async (argv: string[] = hideBin(process.argv)) => {
	const args = parseCliArgs(argv)
	const options = toServerOptions(args)
	const existingAuthFile = await findExistingAuthFile(options.authFilePath)
	if (!existingAuthFile) {
		throw new Error(toMissingAuthFileMessage(options.authFilePath))
	}

	const client = createCodexOAuthClient({
		...options,
		responsesState: false,
	})
	const availableModels = await resolveOpenAIOAuthModels(client, options.models)
	const server = await startOpenAIOAuthServer(options)

	console.log(
		toStartupMessage(
			{
				...options,
				host: server.host,
				port: server.port,
			},
			availableModels,
		),
	)

	const shutdown = async () => {
		await server.close()
		process.exit(0)
	}

	process.on("SIGINT", () => {
		void shutdown()
	})

	process.on("SIGTERM", () => {
		void shutdown()
	})
}

export { toMissingAuthFileMessage, toStartupMessage }
