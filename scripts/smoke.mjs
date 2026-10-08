// Проверка сервера памяти через настоящий MCP-клиент.
// Использование: MEMORY_URL=http://localhost:8787/mcp MEMORY_TOKEN=... node scripts/smoke.mjs
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = new URL(process.env.MEMORY_URL ?? "http://localhost:8787/mcp");
const token = process.env.MEMORY_TOKEN;
assert.ok(token, "MEMORY_TOKEN is required");

const unauthorized = await fetch(url, { method: "POST", body: "{}" });
assert.equal(unauthorized.status, 401, "request without token must be rejected");

const client = new Client({ name: "smoke", version: "0.0.0" });
await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));

const call = async (name, args) => {
  const res = await client.callTool({ name, arguments: args });
  return { ...JSON.parse(res.content[0].text), isError: res.isError ?? false };
};

const tools = (await client.listTools()).tools.map((t) => t.name).sort();
assert.deepEqual(tools, ["memory_delete", "memory_get", "memory_save", "memory_search"]);
assert.match(client.getInstructions() ?? "", /memory_search/);

const key = `smoke/${Date.now()}`;
const saved = await call("memory_save", { key, content: "Сообщать: задача закончена, запушена, задеплоена", tags: ["Workflow", "smoke"], author: "smoke" });
assert.equal(saved.status, "created");
assert.deepEqual(saved.fact.tags, ["smoke", "workflow"]);

const updated = await call("memory_save", { key, content: "Сообщать 100% результата: закончена, запушена, задеплоена", tags: ["smoke"] });
assert.equal(updated.status, "updated");

assert.equal((await call("memory_get", { key })).content, "Сообщать 100% результата: закончена, запушена, задеплоена");
assert.equal((await call("memory_search", { query: "ЗАПУШЕНА задеплоена", tag: "smoke" })).count, 1);
assert.equal((await call("memory_search", { query: "100%", tag: "smoke" })).count, 1);
assert.equal((await call("memory_search", { query: "1%", tag: "smoke" })).count, 0, "% must be literal");
assert.equal((await call("memory_search", { query: "запушена", tag: "nope" })).count, 0);

// Кириллица ищется без учёта регистра в обе стороны.
const cyrKey = `smoke/cyr-${Date.now()}`;
await call("memory_save", { key: cyrKey, content: "После Задачи СООБЩАТЬ итог", tags: ["smoke"] });
assert.equal((await call("memory_search", { query: "после задачи сообщать", tag: "smoke" })).count, 1);
assert.equal((await call("memory_search", { query: "ИТОГ", tag: "smoke" })).count, 1);
assert.equal((await call("memory_delete", { key: cyrKey })).status, "deleted");

assert.equal((await call("memory_delete", { key })).status, "deleted");
assert.equal((await call("memory_get", { key })).isError, true);

await client.close();
console.log("smoke: ok");
