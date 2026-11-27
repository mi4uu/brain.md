# Views

A fenced `base` block in any note is a live view over your notes, in the same YAML format Obsidian Bases uses.

````base
filters:
  and:
    - file.inFolder("Projects")
views:
  - type: table
    name: Table
    order:
      - file.name
      - status
      - due
    sort:
      - property: due
        direction: ASC
  - type: kanban
    name: Board
    groupBy:
      property: status
    groupOrder: [Todo, Doing, Done]
````

The view shows in the preview. The toolbar switches views and edits sort, filters and columns; each change is written back into the block, so the view definition is an ordinary change to the note (it shows in History and the Changes view). Keys brain.md does not understand are left as they are.

## What a view lists

Every note (`.md`) the viewer may read, except hidden notes and the note that holds the block. Obsidian lists every file; brain.md lists notes only.

## Layouts

`table`, `cards`, `list`, `kanban`. `map` keeps its settings and shows "not supported yet".

- **Table**: click a cell to edit that property; drag a header edge, or use the column menu, to resize; the column menu also sorts, moves, hides and sets a summary. Widths are saved as `columnSize`.
- **Cards**: title, the chosen properties and an optional cover from the view's `image` property (a note property holding an http(s) URL or an image file in the note folder's `.media` directory).
- **List**: one compact row per note.
- **Kanban**: columns come from `groupBy` and `groupOrder`. Drag a card to another column to set that property, or use the `...` menu, "Move to" plus the column name. `+` in a column creates a note with the property preset.

## Editing cells

- An empty input unsets the property.
- A list property edits as comma-separated text, but only when that text round-trips to the same list. Otherwise the cell is read-only.
- Cells the server shortened or hid are read-only.
- Inline maps and lists inside a view are edited in the note source only.

## Kanban moves

Kanban cannot move a card that is grouped by a list property. Drag works with a mouse only. On a phone, and with the keyboard, use "Move to" in the card menu.

## View keys

`type`, `name`, `order` (columns), `filters`, `sort`, `groupBy` (`property`, `direction`), `groupOrder`, `limit`, `summaries`, `columnSize`, `image`. Top level: `filters`, `formulas`, `properties` (`displayName`), `summaries`, `views`.

A column or sort key is `file.<name>`, `formula.<name>`, `note.<name>` or a bare property name.

## Expressions

Filters and formulas are one expression: property names, `note.x`, `note["a b"]`, `file.x`, `formula.x`, `this.x`, literals, `! && || == != < <= > >= + - * / %`, parentheses.

`file.` values: `name`, `basename`, `fullname`, `path`, `folder`, `ext`, `size`, `ctime`, `mtime`, `tags`, `links`, `backlinks`, `embeds`, `properties`.

Functions: `file.hasTag`, `file.inFolder`, `file.hasLink`, `file.hasProperty`; on text `contains containsAll containsAny startsWith endsWith isEmpty lower upper trim` and the property `length`; on lists `contains containsAll containsAny isEmpty` and the property `length`; on anything `isTruthy toString`; `if`, `now`, `today`, `date`, `link`; on dates `format` (`YYYY MM DD HH mm ss`) and `+` / `-` with `"1 week"`, `"3d"`.

`now()` and `today()` use the server's local time zone for now.

An unknown function evaluates to empty, with a warning naming it. Syntax it cannot parse (a lambda, `?:`) makes a filter be ignored and a formula empty, also with a warning. Neither blanks the view or fails the note.

Expressions come from notes and from agents, so they are sandboxed: they read own properties only, call methods from a fixed table, have a step budget, and cannot build regular expressions.

## Limits

- A query is checked against a 2 second budget while expressions run, so it is not a hard cap. If it runs over, the view shows a warning that results are partial.
- brain.md notices edits made outside it within about 60 seconds. An open view refreshes when the window regains focus or when you save a note. The web view does not poll; `query_notes` sees new data after the interval.

## Permissions

A view only shows notes the viewer may read, including in link cells (`file.links`, `file.backlinks`, link properties).

## Agents

`query_notes` runs the same engine: `filter`, `columns` and `sort`, or a `base` YAML, or `path` and `view` to run a block in a note. See [MCP](mcp.md).

An agent gets at most about 200 KB per page of results.

A ```` ```base ```` fence indented inside a list item, or inside a `%% %%` comment, renders as plain code in the preview, but `query_notes` may still run it.
