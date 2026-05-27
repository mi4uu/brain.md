---
title: Embeds & Transclusion
tags: [feature, demo]
---

# Embeds & Transclusion

Pull a note (or part of a note) inline with `![[Note]]`.

## Transcluding another note

The next block renders the body of [[Callouts]] inline. Click the
chevron in preview to collapse / expand.

![[Callouts]]

## Image embeds

Place images in `<note-folder>/.media/` and reference them with
`![[image.png]]`. Use a `|width` suffix for size:

```
![[diagram.png|600]]
![[hero.jpg|800x400]]
```

## Audio / Video / PDF

Same syntax — brain.md sniffs MIME and renders an `<audio>`, `<video>`
or `<embed>` as appropriate.

## Recursion guard

Embedding a note that embeds you back is caught — the second occurrence
renders as a stub link, never as an infinite loop.

## Drop to upload

Drag any file from your OS into the editor pane → it's uploaded to
`.media/` next to the current note and the `![[filename]]` is inserted
at the caret.
