# agent-memory

Общая память для агентов Claude Code, Codex и Hermes Agent. Это MCP-сервер на Cloudflare Workers
с хранилищем в D1 (SQLite). Агенты подключаются к нему по HTTP и читают и пишут общие факты,
например «как сообщать, что задача закончена, запушена и задеплоена».

## Инструменты

| Инструмент      | Что делает                                                                   |
|-----------------|------------------------------------------------------------------------------|
| `memory_save`   | Сохраняет факт по `key`. Если такой `key` уже есть, факт перезаписывается.     |
| `memory_get`    | Возвращает факт по точному `key`.                                             |
| `memory_search` | Ищет по словам (каждое слово должно встретиться в key, тексте или тегах) и/или по тегу. |
| `memory_delete` | Удаляет факт по `key`.                                                        |

Факт состоит из `key` (например `workflow/report-done`), `content`, `tags`, `author`, `created_at` и `updated_at`.
Сервер передаёт агентам инструкцию: в начале задачи искать относящиеся к ней факты.

Эндпоинты: `POST /mcp` (MCP Streamable HTTP, нужен заголовок `Authorization: Bearer <MEMORY_TOKEN>`)
и `GET /health`.

## Локальный запуск

```sh
npm install
cp .dev.vars.example .dev.vars     # задать MEMORY_TOKEN
npm run db:migrate:local
npm run dev                        # http://localhost:8787/mcp
MEMORY_TOKEN=... npm run smoke     # проверка через настоящий MCP-клиент
```

## Деплой в Cloudflare

```sh
npx wrangler login                          # или CLOUDFLARE_API_TOKEN в окружении
# база agent-memory уже создана, её id в wrangler.jsonc
npm run db:migrate:remote
openssl rand -hex 32 | npx wrangler secret put MEMORY_TOKEN
npm run deploy                              # https://agent-memory.<account>.workers.dev/mcp
```

Обновление уже задеплоенного сервера: `git pull && npm ci && npm run db:migrate:remote && npm run deploy`.
Миграции применяются только новые, повторный запуск безопасен.

## Подключение агентов

Ниже `MEMORY_URL` — адрес вида `https://agent-memory.<account>.workers.dev/mcp`, а `MEMORY_TOKEN` —
переменная окружения с токеном.

**Claude Code**

```sh
claude mcp add --transport http --scope user memory "$MEMORY_URL" \
  --header "Authorization: Bearer $MEMORY_TOKEN"
```

**Codex** (`~/.codex/config.toml`)

```toml
[mcp_servers.memory]
url = "https://agent-memory.<account>.workers.dev/mcp"
bearer_token_env_var = "MEMORY_TOKEN"
```

Проверка: внутри Codex команда `/mcp` должна показать `memory: connected (4 tools)`.

Если там `authentication required`, значит, процесс Codex не видит `MEMORY_TOKEN` (так бывает,
когда Codex запущен как приложение или из IDE). Тогда впишите токен прямо в конфиг вместо
`bearer_token_env_var` и выполните `chmod 600 ~/.codex/config.toml`:

```toml
[mcp_servers.memory]
url = "https://agent-memory.<account>.workers.dev/mcp"
http_headers = { Authorization = "Bearer <сам токен>" }
```

В `http_headers` переменные окружения не подставляются, поэтому `"Bearer $MEMORY_TOKEN"`
уйдёт на сервер буквально и получит 401.

**Hermes Agent** (`~/.hermes/config.yaml`). Нужен пакет с MCP: `pip install "hermes-agent[mcp]"`.

```yaml
mcp_servers:
  memory:
    url: "https://agent-memory.<account>.workers.dev/mcp"
    headers:
      Authorization: "Bearer ${MEMORY_TOKEN}"
```

Проверка: `hermes mcp test memory`.
