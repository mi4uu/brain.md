---
title: Frontmatter & Aliases
aliases: [YAML, Metadata, Tags]
tags: [feature, demo, metadata]
created: 2026-05-27
status: live
---

# Frontmatter & Aliases

Every note can carry a YAML frontmatter block. brain.md parses it,
shows it in the Properties panel, and uses two fields specially:

## `aliases`

```yaml
aliases: [YAML, Metadata, Tags]
```

The wikilink resolver now matches **any** of those names. So
`[[YAML]]` lands on this note, and so does `[[Metadata]]`.

## `tags`

Both forms work:

```yaml
tags: [feature, demo]
# or
tag: feature
```

Tags from frontmatter merge with inline `#tag` mentions in the body
into the per-note tag set, indexed for the **Tags** sidebar.

## Live tags in this note

`#feature` · `#demo` · `#metadata` — these inline mentions all show
up in the sidebar Tags panel. Click any to filter the vault by that
tag.

## What you can put in frontmatter

Anything valid YAML. brain.md preserves unknown fields untouched. The
Properties panel surfaces title, aliases, tags, status, dates.
