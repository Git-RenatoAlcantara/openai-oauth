import { describe, expect, test } from "vitest"
import {
	resetCodexClientVersionCache,
	resolveCodexClientVersion,
	resolveOpenAIOAuthModels,
} from "../src/models.js"

describe("model discovery", () => {
	test("prefers the local codex cli version", async () => {
		resetCodexClientVersionCache()

		const version = await resolveCodexClientVersion({
			runCommand: async () => ({
				stdout: "codex-cli 0.111.0\n",
				stderr: "",
			}),
			fetchImpl: async () => {
				throw new Error("remote lookup should not run")
			},
		})

		expect(version).toBe("0.111.0")
	})

	test("falls back to the npm registry version", async () => {
		resetCodexClientVersionCache()

		const version = await resolveCodexClientVersion({
			runCommand: async () => {
				throw new Error("codex is not installed")
			},
			fetchImpl: async () =>
				new Response(
					JSON.stringify({
						version: "0.114.0",
					}),
					{
						status: 200,
						headers: {
							"Content-Type": "application/json",
						},
					},
				),
		})

		expect(version).toBe("0.114.0")
	})

	test("uses a pinned fallback when local and remote version discovery fail", async () => {
		resetCodexClientVersionCache()

		const version = await resolveCodexClientVersion({
			runCommand: async () => {
				throw new Error("codex is not installed")
			},
			fetchImpl: async () => {
				throw new Error("network unavailable")
			},
		})

		expect(version).toBe("0.111.0")
	})

	test("returns configured models without upstream discovery", async () => {
		resetCodexClientVersionCache()

		const models = await resolveOpenAIOAuthModels(
			{
				baseURL: "https://chatgpt.com/backend-api/codex",
				fetch: async () => {
					throw new Error("upstream fetch should not run")
				},
				request: async () => {
					throw new Error("upstream fetch should not run")
				},
			},
			["gpt-5.4", "gpt-5.3-codex", "gpt-5.4"],
		)

		expect(models).toEqual(["gpt-5.4", "gpt-5.3-codex"])
	})
})
