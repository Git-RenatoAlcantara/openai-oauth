import { spawn } from "node:child_process"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import {
	type CodexOAuthSettings,
	createCodexOAuthClient,
} from "../../openai-oauth-core/src/index.js"
import {
	createOpenAIOAuth,
	type OpenAIOAuthProvider,
} from "../../openai-oauth-provider/src/index.js"
import { handleChatCompletionsRequest } from "./chat-completions.js"
import { createRequestLogger } from "./logging.js"
import {
	getAuthStatus,
	getLoginPageHtml,
	saveAuthJson,
} from "./login-page.js"
import { createModelResolver } from "./models.js"
import { handleResponsesRequest } from "./responses.js"
import {
	corsHeaders,
	DEFAULT_HOST,
	DEFAULT_PORT,
	resolveAddress,
	toErrorResponse,
	toJsonResponse,
	toWebRequest,
	writeWebResponse,
} from "./shared.js"
import type {
	OpenAIOAuthServerOptions,
	RunningOpenAIOAuthServer,
} from "./types.js"

const handleRoutes = async (
	request: Request,
	settings: OpenAIOAuthServerOptions,
	provider: OpenAIOAuthProvider,
	client: ReturnType<typeof createCodexOAuthClient>,
	resolveModels: () => Promise<string[]>,
	requestLogger: ReturnType<typeof createRequestLogger>,
): Promise<Response> => {
	if (request.method === "OPTIONS") {
		return new Response(null, {
			status: 204,
			headers: corsHeaders,
		})
	}

	const url = new URL(request.url)

	if (request.method === "GET" && url.pathname === "/") {
		const status = await getAuthStatus()
		const html = getLoginPageHtml(status.path)
		return new Response(html, {
			status: 200,
			headers: { "content-type": "text/html; charset=utf-8" },
		})
	}

	if (request.method === "GET" && url.pathname === "/auth/status") {
		const status = await getAuthStatus()
		return toJsonResponse(status)
	}

	if (request.method === "POST" && url.pathname === "/auth/upload") {
		let body: string
		try {
			const formData = await request.formData()
			body = (formData.get("auth") as string | null) ?? ""
		} catch {
			body = await request.text()
		}
		const result = await saveAuthJson(body)
		if (!result.ok) {
			const html = getLoginPageHtml(undefined, result.error)
			return new Response(html, { status: 400, headers: { "content-type": "text/html; charset=utf-8" } })
		}
		return new Response(null, { status: 302, headers: { location: "/" } })
	}

	if (request.method === "POST" && url.pathname === "/auth/login") {
		const loginUrl = await new Promise<string | null>((resolve) => {
			const child = spawn("npx", ["@openai/codex", "login"], {
				shell: true,
				stdio: ["ignore", "pipe", "pipe"],
			})
			let output = ""
			const timeout = setTimeout(() => { child.kill(); resolve(null) }, 15000)
			child.stdout.on("data", (data: Buffer) => {
				output += data.toString()
				const match = output.match(/(https:\/\/auth\.openai\.com\/oauth\/authorize[^\s]+)/)
				if (match) {
					clearTimeout(timeout)
					resolve(match[1] as string)
				}
			})
			child.stderr.on("data", (data: Buffer) => {
				console.log("[auth/login] stderr:", data.toString())
			})
			child.on("close", () => { clearTimeout(timeout); resolve(null) })
		})
		console.log("[auth/login] loginUrl:", loginUrl)
		if (!loginUrl) {
			return toJsonResponse({ ok: false, error: "Falha ao iniciar codex login." }, 500)
		}
		return toJsonResponse({ ok: true, url: loginUrl })
	}

	if (request.method === "GET" && url.pathname === "/health") {
		return toJsonResponse({
			ok: true,
			replay_state: "stateless",
		})
	}

	if (request.method === "GET" && url.pathname === "/v1/models") {
		try {
			const models = await resolveModels()
			return toJsonResponse({
				object: "list",
				data: models.map((id) => ({
					id,
					object: "model",
					created: 0,
					owned_by: "codex-oauth",
				})),
			})
		} catch (error) {
			return toErrorResponse(
				error instanceof Error ? error.message : "Failed to load models.",
				502,
				"upstream_error",
			)
		}
	}

	if (request.method === "POST" && url.pathname === "/v1/responses") {
		return handleResponsesRequest(request, settings, client)
	}

	if (request.method === "POST" && url.pathname === "/v1/chat/completions") {
		return handleChatCompletionsRequest(request, provider, requestLogger)
	}

	return toErrorResponse("Route not found.", 404, "not_found_error")
}

export const createOpenAIOAuthFetchHandler = (
	settings: OpenAIOAuthServerOptions = {},
): ((request: Request) => Promise<Response>) => {
	const sharedSettings: CodexOAuthSettings = {
		...settings,
		responsesState: false,
	}
	const client = createCodexOAuthClient(sharedSettings)
	const provider = createOpenAIOAuth(sharedSettings)
	const resolveModels = createModelResolver(client, settings.models, {
		codexVersion: settings.codexVersion,
	})
	const requestLogger = createRequestLogger(settings)

	return async (request) => {
		try {
			return await handleRoutes(
				request,
				settings,
				provider,
				client,
				resolveModels,
				requestLogger,
			)
		} catch (error) {
			return toErrorResponse(
				error instanceof Error ? error.message : "Unexpected server error.",
				500,
				"server_error",
			)
		}
	}
}

export const startOpenAIOAuthServer = async (
	settings: OpenAIOAuthServerOptions = {},
): Promise<RunningOpenAIOAuthServer> => {
	const host = settings.host ?? DEFAULT_HOST
	const port = settings.port ?? DEFAULT_PORT
	const handler = createOpenAIOAuthFetchHandler(settings)
	const server = createServer(async (req, res) => {
		try {
			const request = await toWebRequest(req, { host, port })
			const response = await handler(request)
			await writeWebResponse(res, response)
		} catch (error) {
			if (res.headersSent || res.writableEnded) {
				res.destroy(error instanceof Error ? error : undefined)
				return
			}

			const message =
				error instanceof Error ? error.message : "Unexpected server error."
			await writeWebResponse(res, toErrorResponse(message, 500, "server_error"))
		}
	})

	await new Promise<void>((resolve, reject) => {
		server.once("error", reject)
		server.listen(port, host, () => {
			server.off("error", reject)
			resolve()
		})
	})

	const address = resolveAddress(server.address() as AddressInfo, host)
	return {
		server,
		host: address.host,
		port: address.port,
		url: `http://${address.host}:${address.port}/v1`,
		close: () =>
			new Promise<void>((resolve, reject) => {
				server.close((error) => {
					if (error) {
						reject(error)
						return
					}

					resolve()
				})
			}),
	}
}
