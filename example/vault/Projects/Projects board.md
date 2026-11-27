---
title: Projects board
tags: [project, demo, views]
---

# Projects board

Every note in this folder, as a live view. Switch between the board,
the table and the cards in the toolbar. Drag a card to another column,
or click a cell, and the note's frontmatter changes.

```base
filters:
  and:
    - file.inFolder("Projects")
    - status
properties:
  file.name:
    displayName: Project
views:
  - type: kanban
    name: Board
    order:
      - file.name
      - owner
      - priority
      - due
    groupBy:
      property: status
    groupOrder: [Todo, Doing, Done]
  - type: table
    name: Table
    order:
      - file.name
      - status
      - owner
      - priority
      - due
      - estimate
    sort:
      - property: due
        direction: ASC
    summaries:
      estimate: Sum
  - type: cards
    name: Cards
    order:
      - file.name
      - status
      - owner
      - due
```

Agents see the same thing through `query_notes` with
`path: "Projects/Projects board.md"`.
