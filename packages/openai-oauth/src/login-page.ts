import { createHash, randomBytes } from "node:crypto"
import { access, mkdir, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const CLIENT_ID =
	process.env.CHATGPT_LOCAL_CLIENT_ID ?? "app_EMoamEEZ73f0CkXaXp7hrann"
const ISSUER = process.env.CHATGPT_LOCAL_ISSUER ?? "https://auth.openai.com"
const SCOPES =
	"openid profile email offline_access api.connectors.read api.connectors.invoke"

type PkceSession = {
	codeVerifier: string
	redirectUri: string
	expiresAt: number
}
const pkceStore = new Map<string, PkceSession>()

const base64url = (buf: Buffer): string =>
	buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")

export const buildLoginUrl = (
	redirectUri: string,
): { url: string; state: string } => {
	const codeVerifier = base64url(randomBytes(32))
	const codeChallenge = base64url(
		createHash("sha256").update(codeVerifier).digest(),
	)
	const state = base64url(randomBytes(16))

	pkceStore.set(state, {
		codeVerifier,
		redirectUri,
		expiresAt: Date.now() + 10 * 60 * 1000,
	})

	const params = new URLSearchParams({
		response_type: "code",
		client_id: CLIENT_ID,
		redirect_uri: redirectUri,
		scope: SCOPES,
		code_challenge: codeChallenge,
		code_challenge_method: "S256",
		state,
		id_token_add_organizations: "true",
		codex_cli_simplified_flow: "true",
		originator: "codex_cli_rs",
	})

	return { url: `${ISSUER}/oauth/authorize?${params}`, state }
}

export const handleOAuthCallback = async (
	code: string,
	state: string,
): Promise<{ ok: true } | { ok: false; error: string }> => {
	const session = pkceStore.get(state)
	if (!session) return { ok: false, error: "Estado OAuth inválido ou expirado." }
	if (Date.now() > session.expiresAt) {
		pkceStore.delete(state)
		return { ok: false, error: "Sessão OAuth expirada. Tente novamente." }
	}
	pkceStore.delete(state)

	const tokenRes = await fetch(`${ISSUER}/oauth/token`, {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			grant_type: "authorization_code",
			client_id: CLIENT_ID,
			code,
			redirect_uri: session.redirectUri,
			code_verifier: session.codeVerifier,
		}),
	})

	if (!tokenRes.ok) {
		const text = await tokenRes.text()
		return { ok: false, error: `Falha ao trocar tokens: ${text}` }
	}

	const tokens = (await tokenRes.json()) as Record<string, unknown>

	const authFile = {
		tokens: {
			id_token: tokens.id_token,
			access_token: tokens.access_token,
			refresh_token: tokens.refresh_token,
		},
		last_refresh: new Date().toISOString(),
	}

	const authPath = AUTH_CANDIDATES[AUTH_CANDIDATES.length - 1] as string
	await mkdir(path.dirname(authPath), { recursive: true })
	await writeFile(authPath, JSON.stringify(authFile, null, 2), "utf-8")

	return { ok: true }
}

const AUTH_CANDIDATES = [
	process.env.CHATGPT_LOCAL_HOME
		? path.join(process.env.CHATGPT_LOCAL_HOME, "auth.json")
		: null,
	process.env.CODEX_HOME
		? path.join(process.env.CODEX_HOME, "auth.json")
		: null,
	path.join(os.homedir(), ".chatgpt-local", "auth.json"),
	path.join(os.homedir(), ".codex", "auth.json"),
].filter((v): v is string => typeof v === "string")

export const getAuthStatus = async (): Promise<{
	authenticated: boolean
	path?: string
}> => {
	for (const candidate of AUTH_CANDIDATES) {
		try {
			await access(candidate)
			return { authenticated: true, path: candidate }
		} catch {}
	}
	return { authenticated: false }
}

export const saveAuthJson = async (
	content: string,
): Promise<{ ok: true; path: string } | { ok: false; error: string }> => {
	let parsed: unknown
	try {
		parsed = JSON.parse(content)
	} catch {
		return { ok: false, error: "JSON inválido." }
	}

	if (typeof parsed !== "object" || parsed === null) {
		return { ok: false, error: "Conteúdo inválido: deve ser um objeto JSON." }
	}

	const authPath = AUTH_CANDIDATES[AUTH_CANDIDATES.length - 1] as string
	await mkdir(path.dirname(authPath), { recursive: true })
	await writeFile(authPath, JSON.stringify(parsed, null, 2), "utf-8")
	return { ok: true, path: authPath }
}

export const getLoginPageHtml = (authPath?: string, errorMsg?: string): string => `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>openai-oauth</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: system-ui, -apple-system, sans-serif;
      background: #0f0f0f;
      color: #e5e5e5;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .card {
      background: #1a1a1a;
      border: 1px solid #2a2a2a;
      border-radius: 12px;
      padding: 40px;
      width: 100%;
      max-width: 540px;
    }
    .logo {
      font-size: 1.5rem;
      font-weight: 700;
      margin-bottom: 8px;
      color: #fff;
      text-align: center;
    }
    .subtitle {
      font-size: 0.875rem;
      color: #888;
      margin-bottom: 32px;
      text-align: center;
    }
    .status {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 8px 16px;
      border-radius: 8px;
      font-size: 0.875rem;
      margin-bottom: 24px;
    }
    .status.ok { background: #0d2b1a; color: #4ade80; border: 1px solid #166534; }
    .status.err { background: #2b0d0d; color: #f87171; border: 1px solid #991b1b; }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; flex-shrink: 0; }
    .btn {
      display: inline-block;
      background: #10a37f;
      color: #fff;
      border: none;
      padding: 12px 28px;
      border-radius: 8px;
      font-size: 0.9rem;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s;
      text-decoration: none;
      width: 100%;
      text-align: center;
    }
    .btn:hover { background: #0d8a6a; }
    .error-msg {
      margin-top: 12px;
      color: #f87171;
      font-size: 0.85rem;
    }
    .auth-path {
      margin-top: 12px;
      font-size: 0.75rem;
      color: #555;
      text-align: center;
    }
    .steps {
      background: #111;
      border: 1px solid #2a2a2a;
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 20px;
      font-size: 0.85rem;
      color: #bbb;
      line-height: 1.7;
    }
    .steps code {
      background: #222;
      border: 1px solid #333;
      border-radius: 4px;
      padding: 2px 6px;
      font-family: monospace;
      color: #10a37f;
    }
    textarea {
      width: 100%;
      height: 140px;
      background: #111;
      border: 1px solid #333;
      border-radius: 8px;
      color: #e5e5e5;
      font-family: monospace;
      font-size: 0.8rem;
      padding: 12px;
      resize: vertical;
      margin-bottom: 12px;
      outline: none;
    }
    textarea:focus { border-color: #10a37f; }
    label { display: block; font-size: 0.85rem; color: #aaa; margin-bottom: 8px; }
    .center { text-align: center; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">openai-oauth</div>
    <div class="subtitle">Proxy local compatível com a API OpenAI</div>

    <div class="center">
      ${
        authPath
          ? `<div class="status ok"><span class="dot"></span> Autenticado</div>`
          : `<div class="status err"><span class="dot"></span> Não autenticado</div>`
      }
    </div>

    ${errorMsg ? `<div class="error-msg">${errorMsg}</div>` : ""}

    ${
      authPath
        ? `<p class="auth-path">Arquivo: ${authPath}</p>
    <div style="margin-top:24px;">
      <a class="btn" href="/v1/models">Ver modelos disponíveis</a>
    </div>`
        : `<div class="steps">
      <strong style="color:#fff;">Como autenticar:</strong><br/>
      1. No seu computador local, execute:<br/>
      <code>npx @openai/codex login</code><br/>
      2. Faça login no navegador que abrir.<br/>
      3. Copie o conteúdo do arquivo gerado:<br/>
      <code>~/.codex/auth.json</code><br/>
      4. Cole abaixo e clique em Salvar.
    </div>
    <form method="POST" action="/auth/upload">
      <label for="auth">Conteúdo do auth.json:</label>
      <textarea id="auth" name="auth" placeholder='{"tokens": {"access_token": "...", "refresh_token": "..."}}' required></textarea>
      <button type="submit" class="btn">Salvar e autenticar</button>
    </form>`
    }
  </div>
</body>
</html>`
