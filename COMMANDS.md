# Comandos — openai-oauth

Referência rápida de todos os comandos disponíveis no projeto.

---

## Pré-requisito: Login

Antes de rodar qualquer coisa, autentique-se com sua conta ChatGPT:

```bash
npx @openai/codex login
```

Isso cria o arquivo de autenticação em `~/.codex/auth.json` (ou `~/.chatgpt-local/auth.json`).

---

## Desenvolvimento (monorepo)

Executados na raiz do projeto (`C:\Users\renat\Projetos\openai-oauth`):

| Comando              | Descrição                                              |
| -------------------- | ------------------------------------------------------ |
| `bun install`        | Instala todas as dependências do monorepo              |
| `bun run dev`        | Inicia todos os pacotes em modo desenvolvimento        |
| `bun run build`      | Compila todos os pacotes (via Turbo)                   |
| `bun run test`       | Roda todos os testes do monorepo                       |
| `bun run typecheck`  | Verificação de tipos TypeScript em todos os pacotes    |
| `bun run format-and-lint`      | Checa formatação e lint com Biome            |
| `bun run format-and-lint:fix`  | Corrige formatação e lint automaticamente    |

---

## CLI — openai-oauth

Inicia o proxy local compatível com a API OpenAI:

```bash
# Via npx (sem instalação)
npx openai-oauth

# Em desenvolvimento (dentro do monorepo)
bun run dev
```

Ao iniciar com sucesso:

```
OpenAI-compatible endpoint ready at http://127.0.0.1:10531/v1
Use this as your OpenAI base URL. No API key is required.
Available Models: gpt-5.4, gpt-5.4-mini, gpt-5.3-codex, gpt-5.2, codex-auto-review
```

### Opções da CLI

| Flag                    | Padrão                                | Descrição                                                      |
| ----------------------- | ------------------------------------- | -------------------------------------------------------------- |
| `--host <host>`         | `127.0.0.1`                           | Interface de rede para bind                                    |
| `--port <port>`         | `10531`                               | Porta do proxy local                                           |
| `--models <ids>`        | Modelos da conta (auto-descobertos)   | Lista separada por vírgula dos modelos expostos em `/v1/models`|
| `--codex-version <ver>` | Versão local do codex ou `0.111.0`    | Versão da API Codex usada para descoberta de modelos           |
| `--base-url <url>`      | `https://chatgpt.com/backend-api/codex` | Sobrescreve a URL base do Codex                              |
| `--oauth-client-id <id>`| `app_EMoamEEZ73f0CkXaXp7hrann`        | Sobrescreve o client ID OAuth para refresh                     |
| `--oauth-token-url <url>`| `https://auth.openai.com/oauth/token`| Sobrescreve a URL do token OAuth                               |
| `--oauth-file <path>`   | `~/.codex/auth.json`                  | Caminho personalizado para o arquivo de autenticação           |
| `--help`                | —                                     | Exibe a ajuda                                                  |
| `--version`             | —                                     | Exibe a versão instalada                                       |

### Exemplos

```bash
# Porta customizada
npx openai-oauth --port 8080

# Expor modelos específicos
npx openai-oauth --models gpt-5.4,gpt-5.4-mini

# Arquivo de auth customizado
npx openai-oauth --oauth-file /caminho/para/auth.json

# Bind em todas as interfaces (acesso na rede local)
npx openai-oauth --host 0.0.0.0
```

---

## Endpoints disponíveis

Com o servidor rodando em `http://127.0.0.1:10531`:

| Endpoint              | Método | Descrição                         |
| --------------------- | ------ | --------------------------------- |
| `/v1/responses`       | POST   | Respostas (stateless)             |
| `/v1/chat/completions`| POST   | Chat completions (compatível OpenAI) |
| `/v1/models`          | GET    | Lista de modelos disponíveis      |

---

## Provider (Vercel AI SDK)

Use direto no código sem precisar do proxy local:

```ts
import { generateText } from "ai"
import { createOpenAIOAuth } from "openai-oauth-provider"

const openai = createOpenAIOAuth()

const result = await generateText({
  model: openai("gpt-5.4"),
  prompt: "Olá, mundo!",
})

console.log(result.text)
```

---

## Testes

```bash
# Todos os testes
bun run test

# Apenas um pacote específico (ex: openai-oauth)
cd packages/openai-oauth
bun run test

# Testes E2E com conta real (requer login)
bun run test:live
```

---

## Build

```bash
# Build completo do monorepo
bun run build

# Build de um pacote específico
cd packages/openai-oauth
bun run build
```
