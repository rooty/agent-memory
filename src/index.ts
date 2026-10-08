import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { FactStore, type Fact } from "./store";

export interface Env {
  DB: D1Database;
  MEMORY_TOKEN?: string;
}

const INSTRUCTIONS = `Общая память для агентов (Claude Code, Codex, Hermes Agent).
Здесь хранятся факты и правила работы, общие для всех агентов.
В начале задачи найди относящиеся к ней факты через memory_search и следуй им.
Когда пользователь просит запомнить правило или факт, сохрани его через memory_save
с коротким стабильным key вида "область/тема" (например "workflow/report-done").`;

const KEY = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[\w./-]+$/, "только буквы, цифры, _ . / -")
  .describe('Короткий стабильный идентификатор факта, например "workflow/report-done"');

function asText(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function formatFacts(facts: Fact[]) {
  return asText({ count: facts.length, facts });
}

function buildServer(store: FactStore): McpServer {
  const server = new McpServer({ name: "agent-memory", version: "0.1.0" }, { instructions: INSTRUCTIONS });

  server.registerTool(
    "memory_save",
    {
      title: "Сохранить факт",
      description: "Сохраняет факт в общую память. Если факт с таким key уже есть, он перезаписывается.",
      inputSchema: {
        key: KEY,
        content: z.string().min(1).max(10_000).describe("Текст факта или правила"),
        tags: z.array(z.string().max(50)).max(20).optional().describe("Теги для фильтрации, например [\"workflow\", \"deploy\"]"),
        author: z.string().max(100).optional().describe("Кто сохраняет: claude-code, codex, hermes и т.п."),
      },
    },
    async (args) => {
      const { fact, created } = await store.save(args);
      return asText({ status: created ? "created" : "updated", fact });
    },
  );

  server.registerTool(
    "memory_get",
    {
      title: "Получить факт",
      description: "Возвращает факт по точному key.",
      inputSchema: { key: KEY },
    },
    async ({ key }) => {
      const fact = await store.get(key);
      return fact ? asText(fact) : { ...asText({ error: `факт "${key}" не найден` }), isError: true };
    },
  );

  server.registerTool(
    "memory_search",
    {
      title: "Найти факты",
      description:
        "Ищет факты по словам (все слова должны встретиться в key, тексте или тегах) и/или по тегу. " +
        "Без query и tag возвращает последние обновлённые факты.",
      inputSchema: {
        query: z.string().max(500).optional().describe("Слова для поиска"),
        tag: z.string().max(50).optional().describe("Вернуть только факты с этим тегом"),
        limit: z.number().int().min(1).max(100).default(20),
        offset: z.number().int().min(0).default(0),
      },
    },
    async (args) => formatFacts(await store.search(args)),
  );

  server.registerTool(
    "memory_delete",
    {
      title: "Удалить факт",
      description: "Удаляет факт по key.",
      inputSchema: { key: KEY },
      annotations: { destructiveHint: true },
    },
    async ({ key }) => {
      const deleted = await store.delete(key);
      return deleted ? asText({ status: "deleted", key }) : { ...asText({ error: `факт "${key}" не найден` }), isError: true };
    },
  );

  return server;
}

// Сравнение за постоянное время, чтобы не подсказывать токен по таймингу.
async function tokenMatches(given: string, expected: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(given)),
    crypto.subtle.digest("SHA-256", enc.encode(expected)),
  ]);
  return crypto.subtle.timingSafeEqual(a, b);
}

async function authorize(request: Request, env: Env): Promise<Response | null> {
  if (!env.MEMORY_TOKEN) {
    return new Response("MEMORY_TOKEN is not configured", { status: 500 });
  }
  const header = request.headers.get("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  if (!token || !(await tokenMatches(token, env.MEMORY_TOKEN))) {
    return new Response("Unauthorized", { status: 401, headers: { "WWW-Authenticate": "Bearer" } });
  }
  return null;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return new Response("ok");
    }
    if (url.pathname !== "/mcp") {
      return new Response("Not found", { status: 404 });
    }
    const denied = await authorize(request, env);
    if (denied) return denied;

    // Режим без сессий: на каждый запрос свой сервер и транспорт, состояние только в D1.
    const server = buildServer(new FactStore(env.DB));
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    return transport.handleRequest(request);
  },
} satisfies ExportedHandler<Env>;
