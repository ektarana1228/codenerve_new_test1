-- Backfill only missing starter/reference files for the ten Project Library
-- entries introduced by 20260720215000_add_new_problems. Solution files remain
-- admin-only and existing non-empty reference files are never overwritten.
UPDATE "LibraryProblem"
SET "referenceFiles" = CASE "title"
  WHEN 'Model inference drops requests under load' THEN '[{"path":"inference.py","contentBase64":"ZGVmIHByb2Nlc3NfYmF0Y2gocmVxdWVzdHMpOgogICAgcmVzID0gW10KICAgIGZvciByIGluIHJlcXVlc3RzOgogICAgICAgIHJlcyA9IFtyICsgIl9wcmVkIl0KICAgIHJldHVybiByZXMK"}]'::jsonb
  WHEN 'Min-Max scaler divides by zero' THEN '[{"path":"scaler.py","contentBase64":"ZGVmIHNjYWxlX2ZlYXR1cmVzKGRhdGEpOgogICAgbWluX3YgPSBtaW4oZGF0YSkKICAgIG1heF92ID0gbWF4KGRhdGEpCiAgICByZXR1cm4gWyh4IC0gbWluX3YpIC8gKG1heF92IC0gbWluX3YpIGZvciB4IGluIGRhdGFdCg=="}]'::jsonb
  WHEN 'Tokenizer ignores punctuation' THEN '[{"path":"nlp.js","contentBase64":"ZnVuY3Rpb24gdG9rZW5pemUodGV4dCkgewogIHJldHVybiB0ZXh0LnJlcGxhY2UoL1suLCE/XS9nLCAnJykuc3BsaXQoL1xzKy8pOwp9Cm1vZHVsZS5leHBvcnRzID0geyB0b2tlbml6ZSB9Owo="}]'::jsonb
  WHEN 'K-Means crashes on empty cluster' THEN '[{"path":"kmeans.py","contentBase64":"ZGVmIHVwZGF0ZV9jZW50cm9pZHMoY2x1c3RlcnMsIG9sZF9jZW50cm9pZHMpOgogICAgcmV0dXJuIFtzdW0oY2x1c3RlcikvbGVuKGNsdXN0ZXIpIGZvciBjbHVzdGVyIGluIGNsdXN0ZXJzXQo="}]'::jsonb
  WHEN 'Recommender returns undefined for new users' THEN '[{"path":"rec.ts","contentBase64":"Y29uc3QgaGlzdG9yeTogUmVjb3JkPHN0cmluZywgc3RyaW5nW10+ID0geyAidTEiOiBbIml0ZW1BIl0gfTsKZXhwb3J0IGZ1bmN0aW9uIHJlY29tbWVuZCh1c2VySWQ6IHN0cmluZyk6IHN0cmluZ1tdIHsKICByZXR1cm4gaGlzdG9yeVt1c2VySWRdLm1hcCh4ID0+IHggKyAiX3NpbSIpOwp9Cg=="}]'::jsonb
  WHEN 'Train-test split includes overlapping data' THEN '[{"path":"split.py","contentBase64":"ZGVmIHNwbGl0X2RhdGEoZGF0YSwgcmF0aW89MC44KToKICAgIGlkeCA9IGludChsZW4oZGF0YSkgKiByYXRpbykKICAgIHJldHVybiBkYXRhWzppZHhdLCBkYXRhW2lkeC0xOl0K"}]'::jsonb
  WHEN 'Sanitizer fails to strip system prompt leaks' THEN '[{"path":"llm.js","contentBase64":"ZnVuY3Rpb24gc2FuaXRpemUodGV4dCkgewogIHJldHVybiB0ZXh0LnJlcGxhY2UoLzxzeXN0ZW0+L2csICcnKTsKfQptb2R1bGUuZXhwb3J0cyA9IHsgc2FuaXRpemUgfTsK"}]'::jsonb
  WHEN 'Gradient descent diverges instead of converging' THEN '[{"path":"optim.py","contentBase64":"ZGVmIG9wdGltaXplKHcsIGdyYWQsIGxyKToKICAgIHJldHVybiB3ICsgbHIgKiBncmFkCg=="}]'::jsonb
  WHEN 'Dot product incorrectly transposes dimensions' THEN '[{"path":"math.js","contentBase64":"ZnVuY3Rpb24gZG90KGEsIGIpIHsKICBsZXQgc3VtID0gMDsKICBmb3IobGV0IGk9MTsgaTw9YS5sZW5ndGg7IGkrKykgc3VtICs9IGFbaV0gKiBiW2ldOwogIHJldHVybiBzdW07Cn0KbW9kdWxlLmV4cG9ydHMgPSB7IGRvdCB9Owo="}]'::jsonb
  WHEN 'Imputer replaces nulls with 0 instead of mean' THEN '[{"path":"clean.py","contentBase64":"ZGVmIGltcHV0ZShkYXRhKToKICAgIHJldHVybiBbMCBpZiB4IGlzIE5vbmUgZWxzZSB4IGZvciB4IGluIGRhdGFdCg=="}]'::jsonb
END
WHERE "kind" = 'PROJECT'
  AND ("referenceFiles" IS NULL OR "referenceFiles" = '[]'::jsonb)
  AND "title" IN (
    'Model inference drops requests under load',
    'Min-Max scaler divides by zero',
    'Tokenizer ignores punctuation',
    'K-Means crashes on empty cluster',
    'Recommender returns undefined for new users',
    'Train-test split includes overlapping data',
    'Sanitizer fails to strip system prompt leaks',
    'Gradient descent diverges instead of converging',
    'Dot product incorrectly transposes dimensions',
    'Imputer replaces nulls with 0 instead of mean'
  );
