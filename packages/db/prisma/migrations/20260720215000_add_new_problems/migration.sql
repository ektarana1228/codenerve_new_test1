DO $migration$
DECLARE
    v_user_id TEXT;
    v_prob_id TEXT;
BEGIN
    SELECT id INTO v_user_id FROM "User" LIMIT 1;
    IF v_user_id IS NULL THEN
        v_user_id := gen_random_uuid()::text;
        INSERT INTO "User" (id, email, "passwordHash", role, "createdAt")
        VALUES (v_user_id, 'admin@example.com', 'hash', 'ADMIN', NOW());
    END IF;

    -- CODING PROBLEM 1
    v_prob_id := gen_random_uuid()::text;
    INSERT INTO "LibraryProblem" ("id", "createdBy", "kind", "title", "topic", "difficulty", "description", "allowCopyPaste", "createdAt")
    VALUES (v_prob_id, v_user_id, 'CODING', 'Consensus Vote Finding', 'Arrays', 'EASY', 
    $desc$# Consensus Vote

Given `n` and an array of integers where one element appears more than `n/2` times, find the majority element.

Input: `n`, then `n` integers.$desc$, false, NOW());

    INSERT INTO "LibraryTestCase" ("id", "libraryProblemId", "input", "expected", "isHidden", "createdAt")
    VALUES (gen_random_uuid()::text, v_prob_id, $tc$3
2 2 1$tc$, $tc$2$tc$, false, NOW()),
           (gen_random_uuid()::text, v_prob_id, $tc$5
1 2 1 1 3$tc$, $tc$1$tc$, false, NOW()),
           (gen_random_uuid()::text, v_prob_id, $tc$7
4 4 4 4 2 3 1$tc$, $tc$4$tc$, true, NOW()),
           (gen_random_uuid()::text, v_prob_id, $tc$1
2$tc$, $tc$2$tc$, true, NOW());

    -- CODING PROBLEM 2
    v_prob_id := gen_random_uuid()::text;
    INSERT INTO "LibraryProblem" ("id", "createdBy", "kind", "title", "topic", "difficulty", "description", "allowCopyPaste", "createdAt")
    VALUES (v_prob_id, v_user_id, 'CODING', 'Bandwidth Distribution', 'Arrays', 'MEDIUM', 
    $desc$# Bandwidth Distribution

Given `n` and an array of integers, compute an array where each element at index `i` is the product of all elements except the one at `i`, without using division.$desc$, false, NOW());

    INSERT INTO "LibraryTestCase" ("id", "libraryProblemId", "input", "expected", "isHidden", "createdAt")
    VALUES (gen_random_uuid()::text, v_prob_id, $tc$4
1 2 3 4$tc$, $tc$24 12 8 6$tc$, false, NOW()),
           (gen_random_uuid()::text, v_prob_id, $tc$5
-1 1 0 -3 3$tc$, $tc$0 0 9 0 0$tc$, false, NOW()),
           (gen_random_uuid()::text, v_prob_id, $tc$3
2 2 2$tc$, $tc$4 4 4$tc$, true, NOW());

    -- CODING PROBLEM 3
    v_prob_id := gen_random_uuid()::text;
    INSERT INTO "LibraryProblem" ("id", "createdBy", "kind", "title", "topic", "difficulty", "description", "allowCopyPaste", "createdAt")
    VALUES (v_prob_id, v_user_id, 'CODING', 'Deployment Steps', 'Dynamic Programming', 'EASY', 
    $desc$# Deployment Sequence

You are deploying a system with `n` sequential steps. Each time you can either progress 1 or 2 steps. Find the number of distinct ways to complete the deployment.

Input: `n`$desc$, false, NOW());

    INSERT INTO "LibraryTestCase" ("id", "libraryProblemId", "input", "expected", "isHidden", "createdAt")
    VALUES (gen_random_uuid()::text, v_prob_id, $tc$2$tc$, $tc$2$tc$, false, NOW()),
           (gen_random_uuid()::text, v_prob_id, $tc$3$tc$, $tc$3$tc$, false, NOW()),
           (gen_random_uuid()::text, v_prob_id, $tc$5$tc$, $tc$8$tc$, true, NOW());

    -- CODING PROBLEM 4
    v_prob_id := gen_random_uuid()::text;
    INSERT INTO "LibraryProblem" ("id", "createdBy", "kind", "title", "topic", "difficulty", "description", "allowCopyPaste", "createdAt")
    VALUES (v_prob_id, v_user_id, 'CODING', 'Target Revenue Subarray', 'Hash Maps', 'MEDIUM', 
    $desc$# Target Revenue

Given a target revenue `k` and `n` daily revenue entries, find the total number of continuous daily subarrays whose sum equals exactly `k`.

Input: `k n`, then `n` integers.$desc$, false, NOW());

    INSERT INTO "LibraryTestCase" ("id", "libraryProblemId", "input", "expected", "isHidden", "createdAt")
    VALUES (gen_random_uuid()::text, v_prob_id, $tc$5 4
1 -1 5 0$tc$, $tc$4$tc$, false, NOW()),
           (gen_random_uuid()::text, v_prob_id, $tc$3 3
1 1 1$tc$, $tc$1$tc$, false, NOW()),
           (gen_random_uuid()::text, v_prob_id, $tc$0 3
0 0 0$tc$, $tc$6$tc$, true, NOW());

    -- CODING PROBLEM 5
    v_prob_id := gen_random_uuid()::text;
    INSERT INTO "LibraryProblem" ("id", "createdBy", "kind", "title", "topic", "difficulty", "description", "allowCopyPaste", "createdAt")
    VALUES (v_prob_id, v_user_id, 'CODING', 'Max Storage Volume', 'Two Pointers', 'MEDIUM', 
    $desc$# Storage Tanks

Given `n` non-negative integers representing heights of walls, find two walls that together with the x-axis form a container holding the most liquid. Print the max area.

Input: `n`, then `n` integers.$desc$, false, NOW());

    INSERT INTO "LibraryTestCase" ("id", "libraryProblemId", "input", "expected", "isHidden", "createdAt")
    VALUES (gen_random_uuid()::text, v_prob_id, $tc$9
1 8 6 2 5 4 8 3 7$tc$, $tc$49$tc$, false, NOW()),
           (gen_random_uuid()::text, v_prob_id, $tc$2
1 1$tc$, $tc$1$tc$, false, NOW()),
           (gen_random_uuid()::text, v_prob_id, $tc$5
1 2 1 2 1$tc$, $tc$4$tc$, true, NOW());

    -- CODING PROBLEM 6
    v_prob_id := gen_random_uuid()::text;
    INSERT INTO "LibraryProblem" ("id", "createdBy", "kind", "title", "topic", "difficulty", "description", "allowCopyPaste", "createdAt")
    VALUES (v_prob_id, v_user_id, 'CODING', 'Unique Signal Stream', 'Sliding Window', 'MEDIUM', 
    $desc$# Unique Signal

Given a string of characters representing incoming signals, find the length of the longest continuous sequence without repeating characters.$desc$, false, NOW());

    INSERT INTO "LibraryTestCase" ("id", "libraryProblemId", "input", "expected", "isHidden", "createdAt")
    VALUES (gen_random_uuid()::text, v_prob_id, $tc$abcabcbb$tc$, $tc$3$tc$, false, NOW()),
           (gen_random_uuid()::text, v_prob_id, $tc$bbbbb$tc$, $tc$1$tc$, false, NOW()),
           (gen_random_uuid()::text, v_prob_id, $tc$pwwkew$tc$, $tc$3$tc$, true, NOW());

    -- CODING PROBLEM 7
    v_prob_id := gen_random_uuid()::text;
    INSERT INTO "LibraryProblem" ("id", "createdBy", "kind", "title", "topic", "difficulty", "description", "allowCopyPaste", "createdAt")
    VALUES (v_prob_id, v_user_id, 'CODING', 'Merge System Logs', 'Two Pointers', 'EASY', 
    $desc$# Merge Logs

Given two sorted arrays of log timestamps, merge them into a single sorted output. 

Input: `m n`, then `m` elements, then `n` elements.$desc$, false, NOW());

    INSERT INTO "LibraryTestCase" ("id", "libraryProblemId", "input", "expected", "isHidden", "createdAt")
    VALUES (gen_random_uuid()::text, v_prob_id, $tc$3 3
1 2 3
2 5 6$tc$, $tc$1 2 2 3 5 6$tc$, false, NOW()),
           (gen_random_uuid()::text, v_prob_id, $tc$1 0
1$tc$, $tc$1$tc$, false, NOW()),
           (gen_random_uuid()::text, v_prob_id, $tc$0 1
1$tc$, $tc$1$tc$, true, NOW());

    -- CODING PROBLEM 8
    v_prob_id := gen_random_uuid()::text;
    INSERT INTO "LibraryProblem" ("id", "createdBy", "kind", "title", "topic", "difficulty", "description", "allowCopyPaste", "createdAt")
    VALUES (v_prob_id, v_user_id, 'CODING', 'Server Hop Validation', 'Greedy', 'MEDIUM', 
    $desc$# Server Hop

You are given an array of maximum hop lengths from each server. Determine if you can reach the last server starting from the first index. Print `true` or `false`.

Input: `n` then `n` integers.$desc$, false, NOW());

    INSERT INTO "LibraryTestCase" ("id", "libraryProblemId", "input", "expected", "isHidden", "createdAt")
    VALUES (gen_random_uuid()::text, v_prob_id, $tc$5
2 3 1 1 4$tc$, $tc$true$tc$, false, NOW()),
           (gen_random_uuid()::text, v_prob_id, $tc$5
3 2 1 0 4$tc$, $tc$false$tc$, false, NOW()),
           (gen_random_uuid()::text, v_prob_id, $tc$4
0 2 3 1$tc$, $tc$false$tc$, true, NOW());

    -- CODING PROBLEM 9
    v_prob_id := gen_random_uuid()::text;
    INSERT INTO "LibraryProblem" ("id", "createdBy", "kind", "title", "topic", "difficulty", "description", "allowCopyPaste", "createdAt")
    VALUES (v_prob_id, v_user_id, 'CODING', 'Peak Revenue Subarray', 'Dynamic Programming', 'MEDIUM', 
    $desc$# Peak Revenue

Given an array of daily profit/loss figures, find the contiguous subarray containing at least one number which has the largest sum and print its sum.

Input: `n` then `n` integers.$desc$, false, NOW());

    INSERT INTO "LibraryTestCase" ("id", "libraryProblemId", "input", "expected", "isHidden", "createdAt")
    VALUES (gen_random_uuid()::text, v_prob_id, $tc$9
-2 1 -3 4 -1 2 1 -5 4$tc$, $tc$6$tc$, false, NOW()),
           (gen_random_uuid()::text, v_prob_id, $tc$1
1$tc$, $tc$1$tc$, false, NOW()),
           (gen_random_uuid()::text, v_prob_id, $tc$3
-1 -2 -3$tc$, $tc$-1$tc$, true, NOW());

    -- CODING PROBLEM 10
    v_prob_id := gen_random_uuid()::text;
    INSERT INTO "LibraryProblem" ("id", "createdBy", "kind", "title", "topic", "difficulty", "description", "allowCopyPaste", "createdAt")
    VALUES (v_prob_id, v_user_id, 'CODING', 'Database Search Insert', 'Binary Search', 'EASY', 
    $desc$# Database Insert

Given a sorted array of distinct integers and a target value, return the index if the target is found. If not, return the index where it would be if it were inserted in order.

Input: `target n`, then `n` integers.$desc$, false, NOW());

    INSERT INTO "LibraryTestCase" ("id", "libraryProblemId", "input", "expected", "isHidden", "createdAt")
    VALUES (gen_random_uuid()::text, v_prob_id, $tc$5 4
1 3 5 6$tc$, $tc$2$tc$, false, NOW()),
           (gen_random_uuid()::text, v_prob_id, $tc$2 4
1 3 5 6$tc$, $tc$1$tc$, false, NOW()),
           (gen_random_uuid()::text, v_prob_id, $tc$0 4
1 3 5 6$tc$, $tc$0$tc$, true, NOW());


    -- PROJECT PROBLEM 1
    v_prob_id := gen_random_uuid()::text;
    INSERT INTO "LibraryProblem" ("id", "createdBy", "kind", "title", "difficulty", "description", "allowCopyPaste", "language", "doneWhen", "solutionFiles", "createdAt")
    VALUES (v_prob_id, v_user_id, 'PROJECT', 'Model inference drops requests under load', 'MEDIUM', 
    $desc$# Bug report: Model inference drops requests

`process_batch()` in `inference.py` processes multiple requests using a dummy
AI model. However, it overrides previous items in the batch array, losing requests.

Fix `inference.py` so all inputs are accumulated and returned correctly.$desc$, true, 'PYTHON',
    $json$["process_batch([\"req1\", \"req2\"]) returns predictions for both requests", "It preserves the order of incoming requests"]$json$::jsonb,
    $json$[{"path": "inference.py", "contentBase64": "ZGVmIHByb2Nlc3NfYmF0Y2gocmVxdWVzdHMpOgogICAgcmVzID0gW10KICAgIGZvciByIGluIHJlcXVlc3RzOgogICAgICAgIHJlcy5hcHBlbmQociArICJfcHJlZCIpCiAgICByZXR1cm4gcmVzCg=="}]$json$::jsonb, NOW());

    -- PROJECT PROBLEM 2
    v_prob_id := gen_random_uuid()::text;
    INSERT INTO "LibraryProblem" ("id", "createdBy", "kind", "title", "difficulty", "description", "allowCopyPaste", "language", "doneWhen", "solutionFiles", "createdAt")
    VALUES (v_prob_id, v_user_id, 'PROJECT', 'Min-Max scaler divides by zero', 'EASY', 
    $desc$# Bug report: Scaler throws ZeroDivisionError

`scale_features(data)` in `scaler.py` scales data to [0, 1].
When all values are the same, it divides by zero.

Fix `scaler.py` to return an array of zeros when max == min.$desc$, true, 'PYTHON',
    $json$["scale_features([5, 5, 5]) returns [0, 0, 0]", "scale_features([0, 10]) returns [0.0, 1.0]"]$json$::jsonb,
    $json$[{"path": "scaler.py", "contentBase64": "ZGVmIHNjYWxlX2ZlYXR1cmVzKGRhdGEpOgogICAgbWluX3YgPSBtaW4oZGF0YSkKICAgIG1heF92ID0gbWF4KGRhdGEpCiAgICBpZiBtaW5fdiA9PSBtYXhfdjoKICAgICAgICByZXR1cm4gWzAuMCBmb3IgXyBpbiBkYXRhXQogICAgcmV0dXJuIFsoeCAtIG1pbl92KSAvIChtYXhfdiAtIG1pbl92KSBmb3IgeCBpbiBkYXRhXQo="}]$json$::jsonb, NOW());

    -- PROJECT PROBLEM 3
    v_prob_id := gen_random_uuid()::text;
    INSERT INTO "LibraryProblem" ("id", "createdBy", "kind", "title", "difficulty", "description", "allowCopyPaste", "language", "doneWhen", "solutionFiles", "createdAt")
    VALUES (v_prob_id, v_user_id, 'PROJECT', 'Tokenizer ignores punctuation', 'MEDIUM', 
    $desc$# Bug report: Tokenizer ignores punctuation

`tokenize(text)` in `nlp.js` strips punctuation completely, but downstream NLP tasks
need punctuation as separate tokens.

Fix `nlp.js` to treat punctuation marks (!, ?, .) as standalone tokens.$desc$, true, 'JAVASCRIPT',
    $json$["tokenize(\"Hello, world!\") returns [\"Hello\", \",\", \"world\", \"!\"]"]$json$::jsonb,
    $json$[{"path": "nlp.js", "contentBase64": "ZnVuY3Rpb24gdG9rZW5pemUodGV4dCkgewogIHJldHVybiB0ZXh0Lm1hdGNoKC9cdysrfFsuLCE/XS9nKSB8fCBbXTsKfQptb2R1bGUuZXhwb3J0cyA9IHsgdG9rZW5pemUgfTsK"}]$json$::jsonb, NOW());

    -- PROJECT PROBLEM 4
    v_prob_id := gen_random_uuid()::text;
    INSERT INTO "LibraryProblem" ("id", "createdBy", "kind", "title", "difficulty", "description", "allowCopyPaste", "language", "doneWhen", "solutionFiles", "createdAt")
    VALUES (v_prob_id, v_user_id, 'PROJECT', 'K-Means crashes on empty cluster', 'HARD', 
    $desc$# Bug report: K-Means crashes on empty cluster

`update_centroids(clusters)` in `kmeans.py` recalculates centroid means.
If a cluster has no points, `sum()` over empty list crashes or returns 0 instead of maintaining the old centroid.

Fix `kmeans.py` to keep the old centroid if a cluster is empty.$desc$, true, 'PYTHON',
    $json$["update_centroids keeps previous centroid for empty clusters"]$json$::jsonb,
    $json$[{"path": "kmeans.py", "contentBase64": "ZGVmIHVwZGF0ZV9jZW50cm9pZHMoY2x1c3RlcnMsIG9sZF9jZW50cm9pZHMpOgogICAgcmVzID0gW10KICAgIGZvciBpLCBjbHVzdGVyIGluIGVudW1lcmF0ZShjbHVzdGVycyk6CiAgICAgICAgaWYgbm90IGNsdXN0ZXI6CiAgICAgICAgICAgIHJlcy5hcHBlbmQob2xkX2NlbnRyb2lkc1tpXSkKICAgICAgICBlbHNlOgogICAgICAgICAgICByZXMuYXBwZW5kKHN1bShjbHVzdGVyKS9sZW4oY2x1c3RlcikpCiAgICByZXR1cm4gcmVzCg=="}]$json$::jsonb, NOW());

    -- PROJECT PROBLEM 5
    v_prob_id := gen_random_uuid()::text;
    INSERT INTO "LibraryProblem" ("id", "createdBy", "kind", "title", "difficulty", "description", "allowCopyPaste", "language", "doneWhen", "solutionFiles", "createdAt")
    VALUES (v_prob_id, v_user_id, 'PROJECT', 'Recommender returns undefined for new users', 'MEDIUM', 
    $desc$# Bug report: Recommender fails for new users

`recommend(userId)` in `rec.ts` throws when user has no history.
It should return popular items as a fallback.

Fix `rec.ts` to return `["pop1", "pop2"]` if user history is empty.$desc$, true, 'TYPESCRIPT',
    $json$["recommend(\"new_user\") returns popular items"]$json$::jsonb,
    $json$[{"path": "rec.ts", "contentBase64": "Y29uc3QgaGlzdG9yeTogUmVjb3JkPHN0cmluZywgc3RyaW5nW10+ID0geyAidTEiOiBbIml0ZW1BIl0gfTsKZXhwb3J0IGZ1bmN0aW9uIHJlY29tbWVuZCh1c2VySWQ6IHN0cmluZyk6IHN0cmluZ1tdIHsKICBjb25zdCBoaXN0ID0gaGlzdG9yeVt1c2VySWRdOwogIGlmICghaGlzdCB8fCBoaXN0Lmxlbmd0aCA9PT0gMCkgcmV0dXJuIFsicG9wMSIsICJwb3AyIl07CiAgcmV0dXJuIGhpc3QubWFwKHggPT4geCArICJfc2ltIik7Cn0K"}]$json$::jsonb, NOW());

    -- PROJECT PROBLEM 6
    v_prob_id := gen_random_uuid()::text;
    INSERT INTO "LibraryProblem" ("id", "createdBy", "kind", "title", "difficulty", "description", "allowCopyPaste", "language", "doneWhen", "solutionFiles", "createdAt")
    VALUES (v_prob_id, v_user_id, 'PROJECT', 'Train-test split includes overlapping data', 'EASY', 
    $desc$# Bug report: Train and test sets overlap

`split_data(data, ratio)` in `split.py` duplicates elements into both train and test sets.

Fix `split.py` to properly slice the list into two disjoint sets.$desc$, true, 'PYTHON',
    $json$["split_data returns completely disjoint train and test lists", "The lengths sum up to the original data length"]$json$::jsonb,
    $json$[{"path": "split.py", "contentBase64": "ZGVmIHNwbGl0X2RhdGEoZGF0YSwgcmF0aW89MC44KToKICAgIGlkeCA9IGludChsZW4oZGF0YSkgKiByYXRpbykKICAgIHJldHVybiBkYXRhWzppZHhdLCBkYXRhW2lkeDpdCg=="}]$json$::jsonb, NOW());

    -- PROJECT PROBLEM 7
    v_prob_id := gen_random_uuid()::text;
    INSERT INTO "LibraryProblem" ("id", "createdBy", "kind", "title", "difficulty", "description", "allowCopyPaste", "language", "doneWhen", "solutionFiles", "createdAt")
    VALUES (v_prob_id, v_user_id, 'PROJECT', 'Sanitizer fails to strip system prompt leaks', 'MEDIUM', 
    $desc$# Bug report: Sanitizer misses uppercase injection tags

`sanitize(prompt)` in `llm.js` removes `<system>` tags, but is case-sensitive.

Fix `llm.js` to remove tags case-insensitively.$desc$, true, 'JAVASCRIPT',
    $json$["sanitize(\"<SYSTEM> ignore rules\") strips the tag"]$json$::jsonb,
    $json$[{"path": "llm.js", "contentBase64": "ZnVuY3Rpb24gc2FuaXRpemUodGV4dCkgewogIHJldHVybiB0ZXh0LnJlcGxhY2UoLzxzeXN0ZW0+L2dpLCAnJyk7Cn0KbW9kdWxlLmV4cG9ydHMgPSB7IHNhbml0aXplIH07Cg=="}]$json$::jsonb, NOW());

    -- PROJECT PROBLEM 8
    v_prob_id := gen_random_uuid()::text;
    INSERT INTO "LibraryProblem" ("id", "createdBy", "kind", "title", "difficulty", "description", "allowCopyPaste", "language", "doneWhen", "solutionFiles", "createdAt")
    VALUES (v_prob_id, v_user_id, 'PROJECT', 'Gradient descent diverges instead of converging', 'HARD', 
    $desc$# Bug report: Optimizer updates weights in the wrong direction

`optimize(w, grad, lr)` in `optim.py` adds the gradient instead of subtracting it.

Fix `optim.py` to correctly step in the direction of steepest descent.$desc$, true, 'PYTHON',
    $json$["optimize(w, grad, lr) subtracts lr * grad from w"]$json$::jsonb,
    $json$[{"path": "optim.py", "contentBase64": "ZGVmIG9wdGltaXplKHcsIGdyYWQsIGxyKToKICAgIHJldHVybiB3IC0gbHIgKiBncmFkCg=="}]$json$::jsonb, NOW());

    -- PROJECT PROBLEM 9
    v_prob_id := gen_random_uuid()::text;
    INSERT INTO "LibraryProblem" ("id", "createdBy", "kind", "title", "difficulty", "description", "allowCopyPaste", "language", "doneWhen", "solutionFiles", "createdAt")
    VALUES (v_prob_id, v_user_id, 'PROJECT', 'Dot product incorrectly transposes dimensions', 'MEDIUM', 
    $desc$# Bug report: Dot product loops are swapped

`dot(a, b)` in `math.js` computes 1D dot product but returns NaN for valid arrays.

Fix `math.js` to properly compute sum(a[i]*b[i]).$desc$, true, 'JAVASCRIPT',
    $json$["dot([1, 2], [3, 4]) returns 11"]$json$::jsonb,
    $json$[{"path": "math.js", "contentBase64": "ZnVuY3Rpb24gZG90KGEsIGIpIHsKICBsZXQgc3VtID0gMDsKICBmb3IobGV0IGk9MDsgaTxhLmxlbmd0aDsgaSsrKSBzdW0gKz0gYVtpXSAqIGJbaV07CiAgcmV0dXJuIHN1bTsKfQptb2R1bGUuZXhwb3J0cyA9IHsgZG90IH07Cg=="}]$json$::jsonb, NOW());

    -- PROJECT PROBLEM 10
    v_prob_id := gen_random_uuid()::text;
    INSERT INTO "LibraryProblem" ("id", "createdBy", "kind", "title", "difficulty", "description", "allowCopyPaste", "language", "doneWhen", "solutionFiles", "createdAt")
    VALUES (v_prob_id, v_user_id, 'PROJECT', 'Imputer replaces nulls with 0 instead of mean', 'MEDIUM', 
    $desc$# Bug report: Missing values are zeroed out

`impute(data)` in `clean.py` should replace `None` with the mean of valid values.
Instead, it replaces them with 0.

Fix `clean.py` to calculate the mean of non-None values and use it for imputation.$desc$, true, 'PYTHON',
    $json$["impute([2, 4, None]) returns [2, 4, 3]"]$json$::jsonb,
    $json$[{"path": "clean.py", "contentBase64": "ZGVmIGltcHV0ZShkYXRhKToKICAgIHZhbGlkID0gW3ggZm9yIHggaW4gZGF0YSBpZiB4IGlzIG5vdCBOb25lXQogICAgbWVhbiA9IHN1bSh2YWxpZCkvbGVuKHZhbGlkKSBpZiB2YWxpZCBlbHNlIDAKICAgIHJldHVybiBbbWVhbiBpZiB4IGlzIE5vbmUgZWxzZSB4IGZvciB4IGluIGRhdGFdCg=="}]$json$::jsonb, NOW());

END $migration$;
