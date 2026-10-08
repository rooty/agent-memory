export interface Fact {
  key: string;
  content: string;
  tags: string[];
  author: string | null;
  created_at: string;
  updated_at: string;
}

interface FactRow {
  key: string;
  content: string;
  tags: string;
  author: string | null;
  created_at: string;
  updated_at: string;
}

const COLUMNS = "key, content, tags, author, created_at, updated_at";

function normalizeTags(tags: string[] | undefined): string[] {
  const clean = (tags ?? [])
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 0 && !t.includes(","));
  return [...new Set(clean)].sort();
}

function encodeTags(tags: string[]): string {
  return tags.length ? `,${tags.join(",")},` : ",";
}

function toFact(row: FactRow): Fact {
  return { ...row, tags: row.tags.split(",").filter(Boolean) };
}

// Текст для поиска: key, content и теги в нижнем регистре. Считается здесь,
// потому что lower() в SQLite не понимает кириллицу.
function searchText(key: string, content: string, tags: string[]): string {
  return [key, content, tags.join(" ")].join("\n").toLowerCase();
}

// Экранирует спецсимволы LIKE, чтобы "%" и "_" в запросе искались буквально.
function likePattern(s: string): string {
  return `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export class FactStore {
  constructor(private db: D1Database) {}

  async save(input: { key: string; content: string; tags?: string[]; author?: string }): Promise<{ fact: Fact; created: boolean }> {
    const existing = await this.get(input.key);
    const tagList = normalizeTags(input.tags);
    const tags = encodeTags(tagList);
    const row = await this.db
      .prepare(
        `INSERT INTO facts (key, content, tags, author, search) VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT (key) DO UPDATE SET
           content = excluded.content,
           tags = excluded.tags,
           author = excluded.author,
           search = excluded.search,
           updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
         RETURNING ${COLUMNS}`,
      )
      .bind(input.key, input.content, tags, input.author ?? null, searchText(input.key, input.content, tagList))
      .first<FactRow>();
    return { fact: toFact(row!), created: existing === null };
  }

  async get(key: string): Promise<Fact | null> {
    const row = await this.db.prepare(`SELECT ${COLUMNS} FROM facts WHERE key = ?1`).bind(key).first<FactRow>();
    return row ? toFact(row) : null;
  }

  async search(opts: { query?: string; tag?: string; limit: number; offset: number }): Promise<Fact[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    // Каждое слово запроса должно встретиться в key, content или tags (без учёта регистра).
    for (const word of (opts.query ?? "").split(/\s+/).filter(Boolean)) {
      params.push(likePattern(word.toLowerCase()));
      where.push(`search LIKE ?${params.length} ESCAPE '\\'`);
    }
    const tag = normalizeTags(opts.tag ? [opts.tag] : [])[0];
    if (tag) {
      params.push(`%,${tag},%`);
      where.push(`tags LIKE ?${params.length}`);
    }
    params.push(opts.limit, opts.offset);
    const sql =
      `SELECT ${COLUMNS} FROM facts` +
      (where.length ? ` WHERE ${where.join(" AND ")}` : "") +
      ` ORDER BY updated_at DESC, key LIMIT ?${params.length - 1} OFFSET ?${params.length}`;
    const { results } = await this.db.prepare(sql).bind(...params).all<FactRow>();
    return results.map(toFact);
  }

  async delete(key: string): Promise<boolean> {
    const res = await this.db.prepare("DELETE FROM facts WHERE key = ?1").bind(key).run();
    return res.meta.changes > 0;
  }
}
