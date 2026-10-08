-- Факты общей памяти. key — короткий стабильный идентификатор, например
-- "workflow/report-done". Сохранение по существующему key обновляет запись.
CREATE TABLE facts (
  key        TEXT PRIMARY KEY,
  content    TEXT NOT NULL,
  -- Теги хранятся как ",tag1,tag2," чтобы фильтровать через LIKE '%,tag,%'.
  tags       TEXT NOT NULL DEFAULT ',',
  author     TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX facts_updated_at ON facts (updated_at DESC);
