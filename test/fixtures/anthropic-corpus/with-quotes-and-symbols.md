---
name: Quote-Friendly Skill
description: "Description with a colon: it requires quoting in YAML — also unicode 한글 / emoji ⭐"
---

# Quote-Friendly Skill

This fixture exists to verify the parser handles YAML strings that need to
be quoted because they contain a colon, em-dash, unicode, or other special
characters. Round-trip must preserve the bytes exactly.
