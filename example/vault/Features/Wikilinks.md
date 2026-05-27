---
title: Wikilinks
tags: [feature, demo]
aliases: [Links, Internal Links]
---

# Wikilinks

The bread and butter of any second brain. `[[Note Name]]` creates a
clickable internal link.

## Basic forms

- `[[Welcome]]` → [[Welcome]]
- `[[Math]]` → [[Math]]
- `[[Math|the math note]]` (aliased label) → [[Math|the math note]]
- `[[Math#KaTeX block]]` (heading anchor) → [[Math#KaTeX block]]

## Resolution hierarchy

When you type `[[Wikilinks]]`, brain.md resolves it in this order:

1. **Full path** — `[[Features/Wikilinks]]` always wins
2. **Basename** — `[[Wikilinks]]` (case-insensitive)
3. **Alias** — frontmatter `aliases:` from the target note

If a basename is ambiguous, the resolver returns all matches and the
editor inserts the full path on drag-drop.

## Drag-and-drop

Drag any note from the sidebar into the editor — brain.md inserts a
`[[basename]]` for unique names, or `[[Full/Path/Name]]` when ambiguous.

## `@` quick-link

Inside the editor, type `@` followed by part of a note name to get a
fuzzy autocomplete. Accepting the suggestion rewrites `@query` into
`[[Chosen Note]]`.

## Backlinks

The right-side **Backlinks** panel updates live as you write. The
panel below shows every note linking back to the current one — line
number + context snippet.
