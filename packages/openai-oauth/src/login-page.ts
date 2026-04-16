import { spawn } from "node:child_process"
import { access } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

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

export const startLoginAndGetUrl = (): Promise<string> =>
	new Promise((resolve, reject) => {
		const proc = spawn("npx", ["@openai/codex", "login"], {
			shell: true,
			env: process.env,
		})

		let resolved = false

		const tryMatch = (text: string) => {
			const match = text.match(
				/https:\/\/auth\.openai\.com\/oauth\/authorize[^\s\n]+/,
			)
			if (match && !resolved) {
				resolved = true
				resolve(match[0])
			}
		}

		proc.stdout?.on("data", (chunk: Buffer) => tryMatch(chunk.toString()))
		proc.stderr?.on("data", (chunk: Buffer) => tryMatch(chunk.toString()))

		proc.on("close", (code) => {
			if (!resolved) {
				reject(new Error(`Login process exited with code ${code}`))
			}
		})

		proc.on("error", (err) => {
			if (!resolved) reject(err)
		})

		setTimeout(() => {
			if (!resolved) {
				proc.kill()
				reject(new Error("Login timed out after 30s"))
			}
		}, 30000)
	})

export const getLoginPageHtml = (authPath?: string): string => `<!DOCTYPE html>
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
    }
    .card {
      background: #1a1a1a;
      border: 1px solid #2a2a2a;
      border-radius: 12px;
      padding: 40px;
      width: 100%;
      max-width: 480px;
      text-align: center;
    }
    .logo {
      font-size: 1.5rem;
      font-weight: 700;
      margin-bottom: 8px;
      color: #fff;
    }
    .subtitle {
      font-size: 0.875rem;
      color: #888;
      margin-bottom: 32px;
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
    }
    .btn:hover { background: #0d8a6a; }
    .btn:disabled { background: #444; cursor: not-allowed; }
    .url-box {
      margin-top: 24px;
      background: #111;
      border: 1px solid #333;
      border-radius: 8px;
      padding: 16px;
      text-align: left;
      display: none;
    }
    .url-box.visible { display: block; }
    .url-label { font-size: 0.75rem; color: #888; margin-bottom: 8px; }
    .url-link {
      word-break: break-all;
      color: #60a5fa;
      font-size: 0.8rem;
      text-decoration: none;
    }
    .url-link:hover { text-decoration: underline; }
    .error-msg {
      margin-top: 16px;
      color: #f87171;
      font-size: 0.85rem;
      display: none;
    }
    .error-msg.visible { display: block; }
    .auth-path {
      margin-top: 12px;
      font-size: 0.75rem;
      color: #555;
    }
    .spinner {
      display: inline-block;
      width: 16px;
      height: 16px;
      border: 2px solid #fff4;
      border-top-color: #fff;
      border-radius: 50%;
      animation: spin 0.7s linear infinite;
      vertical-align: middle;
      margin-right: 8px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">openai-oauth</div>
    <div class="subtitle">Proxy local compatível com a API OpenAI</div>

    ${
			authPath
				? `<div class="status ok"><span class="dot"></span> Autenticado</div>
    <p class="auth-path">${authPath}</p>`
				: `<div class="status err"><span class="dot"></span> Não autenticado</div>`
		}

    ${
			!authPath
				? `<div style="margin-top:8px;">
      <button class="btn" id="loginBtn" onclick="doLogin()">Entrar com ChatGPT</button>
    </div>
    <div class="url-box" id="urlBox">
      <div class="url-label">Abra esta URL no seu navegador para concluir o login:</div>
      <a class="url-link" id="loginUrl" href="#" target="_blank"></a>
    </div>
    <div class="error-msg" id="errorMsg"></div>`
				: `<div style="margin-top:24px;">
      <a class="btn" href="/v1/models">Ver modelos disponíveis</a>
    </div>`
		}
  </div>

  <script>
    async function doLogin() {
      const btn = document.getElementById('loginBtn')
      const urlBox = document.getElementById('urlBox')
      const urlLink = document.getElementById('loginUrl')
      const errorMsg = document.getElementById('errorMsg')

      btn.disabled = true
      btn.innerHTML = '<span class="spinner"></span>Aguardando...'
      urlBox.classList.remove('visible')
      errorMsg.classList.remove('visible')

      try {
        const res = await fetch('/auth/login', { method: 'POST' })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error?.message ?? 'Erro ao iniciar login')
        urlLink.href = data.url
        urlLink.textContent = data.url
        urlBox.classList.add('visible')
        window.open(data.url, '_blank')
        btn.innerHTML = 'Aguardando callback...'
      } catch (err) {
        btn.disabled = false
        btn.innerHTML = 'Entrar com ChatGPT'
        errorMsg.textContent = err.message
        errorMsg.classList.add('visible')
      }
    }
  </script>
</body>
</html>`
