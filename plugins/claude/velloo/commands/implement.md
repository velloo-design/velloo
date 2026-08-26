---
description: Turn a Velloo design into production code
argument-hint: screen id(s) — or leave empty for the whole board
---

Use the velloo-implement skill to implement: $ARGUMENTS

Emit order is theme → snippets → screens. Treat a non-empty `warnings` array
on any emit result as a blocker, not a footnote. Verify each implemented page
with `compare_to_url` against the running app before calling it done.
