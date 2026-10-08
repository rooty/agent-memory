-- Текст для поиска, заранее приведённый к нижнему регистру в Worker.
-- lower() в SQLite понимает только латиницу, поэтому кириллицу так искать нельзя.
ALTER TABLE facts ADD COLUMN search TEXT NOT NULL DEFAULT '';

-- Заполнение старых записей. lower() здесь корректен только для латиницы:
-- кириллица в верхнем регистре станет искаться после повторного memory_save.
UPDATE facts SET search = lower(key || char(10) || content || char(10) || replace(trim(tags, ','), ',', ' '));
