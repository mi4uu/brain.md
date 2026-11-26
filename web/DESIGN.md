---
name: brain.md
description: Shared notebook for a person and their agents, quiet graphite chrome with ink accent
colors:
  ink: "#2f5bb7"
  ink-strong: "#24489a"
  ink-night: "#8aaef0"
  ink-night-strong: "#a9c4f5"
  paper: "#fafaf9"
  paper-sheet: "#ffffff"
  paper-shade: "#f4f4f2"
  graphite-text: "#1a1a1a"
  graphite-text-2: "#404040"
  graphite-text-3: "#6b6b6b"
  night: "#141415"
  night-sheet: "#19191b"
  night-shade: "#202022"
  night-raised: "#232325"
  night-text: "#ecedee"
  night-text-2: "#c1c2c5"
  night-text-3: "#909296"
  callout-note: "#3b82f6"
  callout-tip: "#10b981"
  callout-warn: "#f59e0b"
  callout-danger: "#ef4444"
  callout-info: "#06b6d4"
typography:
  display:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Inter, Roboto, Helvetica, Arial, sans-serif"
    fontSize: "32px"
    fontWeight: 400
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Inter, Roboto, Helvetica, Arial, sans-serif"
    fontSize: "26px"
    fontWeight: 400
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Inter, Roboto, Helvetica, Arial, sans-serif"
    fontSize: "20px"
    fontWeight: 500
    lineHeight: 1.3
  body:
    fontFamily: "Iowan Old Style, Source Serif Pro, Georgia, serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.7
  ui:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Inter, Roboto, Helvetica, Arial, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "JetBrains Mono, SF Mono, Menlo, Consolas, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.3
    fontFeature: "tnum"
rounded:
  sm: "4px"
  md: "6px"
  lg: "10px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "24px"
  "6": "32px"
  "7": "48px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper-sheet}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
    height: "44px"
  button-primary-hover:
    backgroundColor: "{colors.ink-strong}"
    textColor: "{colors.paper-sheet}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.graphite-text-2}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
  button-icon:
    backgroundColor: "transparent"
    textColor: "{colors.graphite-text-2}"
    rounded: "{rounded.md}"
    size: "32px"
  input:
    backgroundColor: "{colors.paper-sheet}"
    textColor: "{colors.graphite-text}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
    height: "44px"
  tree-row:
    textColor: "{colors.graphite-text-2}"
    rounded: "{rounded.sm}"
    padding: "4px 8px"
    height: "32px"
  dialog:
    backgroundColor: "{colors.paper-sheet}"
    textColor: "{colors.graphite-text}"
    rounded: "{rounded.lg}"
    padding: "24px"
  kbd:
    backgroundColor: "{colors.paper-shade}"
    textColor: "{colors.graphite-text-2}"
    typography: "{typography.ui}"
    rounded: "{rounded.sm}"
    padding: "1px 6px"
---

# Design System: brain.md

## Overview

**Creative North Star: "The Shared Notebook"**

brain.md is a notebook that a person and their agents write in together. The chrome is the binding and the margins of that notebook: graphite neutrals, hairline rules, small sans labels, nothing that glows or asks for attention. The notes are the page: a serif reading column, real headings, callouts in their own colours, and wikilinks set in mono brackets so a link to another note always looks like one.

Density follows an operating tool, not a landing page. The sidebar, topbar and toolbars are compact (32px rows and icon buttons on a fine pointer) and grow to 44px touch targets on a coarse pointer. The phone is a first-class surface: secondary actions fold into one menu, the editor and preview become tabs, and nothing scrolls sideways.

The visual anti-references are confirmed: no AI-SaaS slop (violet gradients, glow, emoji labels, uppercase tracked labels, sparkle badges) and no Electron-desktop chrome (heavy title bars, icon ribbons, desktop-only menus that break on a phone).

**Key Characteristics:**
- Neutral graphite chrome in both themes; colour lives in the notes and one accent.
- Serif for reading notes, system sans for interface and keycaps, mono for meta and `[[links]]`.
- Flat surfaces separated by tone and 1px hairlines; shadow only on things that float.
- One user-selectable accent (Ink by default), always at 4.5:1 or better.
- Sentence case everywhere, weights 400 and 500.

## Colors

Graphite neutrals carry every surface; a single ink accent marks the action, the selection and the link.

### Primary
- **Ink** (`ink` light, `ink-night` dark): primary buttons, caret, focus ring, active tab underline, selected tree row tint, native control accent, graph focus. The accent is a user setting (Ink, Violet, Teal, Rust, Graphite presets in Settings > Editor); Ink is the default and the value recorded here.
- **Deep Ink** (`ink-strong` light, `ink-night-strong` dark): link text and the primary button hover. Stronger than the accent so links read on the page.

### Neutral
- **Paper** (`paper`): light app background behind panes.
- **Sheet** (`paper-sheet`): light raised surfaces: topbar, sidebar, dialogs, inputs.
- **Shade** (`paper-shade`): light secondary surface, code and keycap background.
- **Graphite text** (`graphite-text`, `graphite-text-2`, `graphite-text-3`): primary, secondary and muted text roles in light. A fourth step (#9a9a9a) is reserved for disabled and placeholder text.
- **Night** (`night`, `night-sheet`, `night-shade`, `night-raised`): the dark ramp from app background to raised menus. Neutral grey with no hue tint.
- **Night text** (`night-text`, `night-text-2`, `night-text-3`): the three dark text roles.
- **Hairlines**: borders are text colour at low opacity, rgba(0,0,0,0.09) light and rgba(255,255,255,0.08) dark, with a stronger 0.15/0.16 step for separators and active outlines.

### Semantic
- **Callouts** (`callout-note`, `callout-tip`, `callout-warn`, `callout-danger`, `callout-info`): only inside notes, as a 3px left rule and the callout title colour. Dark theme uses the lighter 400-step of each hue. Warn and danger also mark error banners in Settings.

### Named Rules
**The Ink Only Rule.** The accent appears on the primary action, the current selection, focus and links. It never fills a surface, a header or a decorative shape.

**The Neutral Night Rule.** Dark surfaces stay hue-neutral (#141415 to #232325). A dark theme that reads blue, violet or brown has drifted.

**The Derived Tint Rule.** Soft accent tints (selection, selected row, accent-soft) are mixed from the current accent, never hardcoded, so every preset follows the setting.

## Typography

**Display Font:** system sans (-apple-system, Segoe UI, Inter, Roboto)
**Body Font:** Iowan Old Style (with Source Serif Pro, Georgia)
**Label/Mono Font:** JetBrains Mono (with SF Mono, Menlo, Consolas)

**Character:** A reading serif for what the person and agents wrote, set against plain system sans for everything that operates on it; mono marks machine-ish things: counts, timestamps, commit and path meta, link brackets.

### Hierarchy
- **Display** (400, 32px, 1.3, -0.01em): note H1 in the preview, with a hairline under it.
- **Headline** (400, 26px, 1.3): note H2.
- **Title** (500, 20px, 1.3): note H3 (in secondary text colour), dialog titles, empty state heading.
- **Body** (400, 17px serif, 1.7): note paragraphs in a column of at most 760px.
- **UI** (400 or 500, 13px sans): sidebar rows, toolbar labels, menus, buttons, settings.
- **Label** (400, 12px mono, tabular figures): counts, times, commit and path meta, `[[ ]]` brackets at 0.75em. Keycaps use the sans at 12px, because shortcuts are mostly letters and mono fallbacks blur O and 0.

### Named Rules
**The Sentence Case Rule.** No uppercase labels and no tracked-out small text. Section labels read "Bookmarks", not "BOOKMARKS".

**The Two Weights Rule.** 400 and 500 only in the interface; hierarchy comes from size and text role. Bold belongs to note content.

## Layout

Desktop is a three-zone shell: a 48px topbar across the top, a 260px sidebar, and a main area split into editor and preview columns of equal width with pane heads and a shared editor toolbar. The editor/preview split can collapse to editor-only or preview-only. With no note open, the empty state takes the whole main area and the pane heads disappear.

Spacing follows a 4px scale (4, 8, 12, 16, 24, 32, 48). Compact panels pad 12 to 16, dialogs 24, the reading column centres inside the preview with 24 to 32 at the edges.

Breakpoints: at 840px and below the sidebar becomes a drawer, editor and preview become bottom tabs, and Daily, Tasks, Graph and Settings move from the topbar into the More menu. At 720px the git status chip hides; at 540px the wordmark hides and only the mark stays.

**The No Sideways Scroll Rule.** At 390px wide the topbar and every pane fit the viewport; anything that does not fit moves into a menu.

## Elevation & Depth

Flat by default. Depth comes from tonal steps (app, sheet, shade, raised) and 1px hairlines. Shadows exist only for elements that float over content: dialogs, dropdown menus, the mobile drawer and the command palette.

### Shadow Vocabulary
- **Float** (`box-shadow: 0 8px 24px rgba(0,0,0,0.08)` light, `0 12px 32px rgba(0,0,0,0.5)` dark): dialogs, menus, drawer, palette.
- **Lift** (`box-shadow: 0 1px 2px rgba(0,0,0,0.04), 0 2px 6px rgba(0,0,0,0.05)` light): small floating chips such as tooltips.

### Named Rules
**The Only What Floats Rule.** A surface that sits in the layout never casts a shadow. If it does not cover other content, separate it with tone or a hairline instead.

## Shapes

Small, nested radii: 4px for rows, keycaps, code and chips; 6px for buttons, inputs and swatches; 10px for dialogs and the command palette. Inner radius never exceeds its container. Pills are reserved for true dots (status, accent swatch, graph nodes). Borders are 1px hairlines; the only thick rule is the 3px left edge of a callout or blockquote.

## Components

### Buttons
- **Shape:** gently rounded (6px).
- **Primary:** ink fill with on-accent text (white in light, near-black #141415 in dark), 8px 12px padding, 44px tall on touch and 32px on a fine pointer.
- **Hover / Focus:** hover steps to Deep Ink; focus shows a 2px accent outline offset 1px. Transitions colour and background only, 120ms.
- **Ghost:** transparent with secondary text; hover adds a 4 to 5% surface tint and primary text.
- **Icon:** 16px line icons at 1.5 stroke in secondary text, 32px square on desktop, 44px on touch. Icons never carry their own colour.

### Chips
- **Tags and counts:** quiet text on a 5 to 6% neutral tint, 4px radius, secondary text colour. No accent fill.
- **Git status:** small dot (green clean, amber dirty) plus mono timestamp.

### Cards / Containers
- **Corner Style:** 10px for dialogs, 6px for inline panels such as the frontmatter table.
- **Background:** sheet in light, raised night in dark.
- **Shadow Strategy:** Float shadow for dialogs only; inline containers use a hairline.
- **Internal Padding:** 24px dialogs, 12 to 16px inline panels.

### Inputs / Fields
- **Style:** sheet background, 1px hairline, 6px radius, 8px 12px padding, 44px min height.
- **Focus:** border turns accent plus a 3px accent-soft ring.
- **Error:** danger-coloured text below the field; banners use the semantic colour at 10% fill with a 40% border.

### Navigation
- **Topbar:** 48px, sheet background, hairline below. Left: menu button (mobile), flat `[[•]]` mark and wordmark `brain` with a muted `.md`, the note's folder (muted) and name, "edited by" byline. Right: the status chip, Changes with its count, Search, Bookmark, then Daily, Tasks, Graph, a hairline separator, Settings, and More (`...`). Search lives only here, not in the sidebar.
- **Status chip:** one answer to "is my work safe": an 8px dot (green saved and in history, grey saving, amber unsaved or not in history yet, red not saved) and a short label, with a tooltip saying what it means. A click does the useful thing: retry a failed save, record pending history now, or open History. Below 540px only the dot shows, except a failed save, which keeps its words.
- **Layout switch:** on desktop the first visible pane head holds a segmented control (Editor, Preview, Both) with 16px icons, the pressed option on the active surface step with a strong hairline, and a `⌘\` keycap at the far right. It moves to the preview head in preview-only mode so it is never hidden.
- **Sidebar tree:** 32px rows, 4px radius, 16px line icons in muted text, indent guides as hairlines. Selected row: accent-soft tint with primary text; hover: neutral tint.
- **Mobile:** drawer sidebar with Float shadow; bottom Edit / Preview tabs (44px) only when a note is open. A note opens in Preview for reading; new, daily and link-created notes open in Edit. The formatting toolbar shows only in Edit. The title shows the note name without its folder, and below 420px the mark gives way to it.

### Wikilink (signature)
Links between notes render as link-coloured text wrapped in mono `[[` `]]` brackets at 0.75em in muted text; on hover the brackets take the link colour and the text underlines. Broken links use the warn colour with a wavy underline. This is the one detail only brain.md has; do not reuse the bracket treatment for anything that is not a note link.

### Changes View (signature)
The owner's review of what agents and people changed. It takes the main area (not a dialog) and opens on start when agents changed something since the last "Mark all seen", unless the URL names a note. Day groups (Today, Yesterday, date) hold one row per note: an accent dot when it is new, the path with the folder muted, actor chips (agent in mono with a strong hairline, person as muted sans, unattributed with a dashed hairline), the edit count and the last time in mono. A row expands into its edits, each with Diff and Revert. Revert asks which of two things to do, undo only this change or restore the note to before it, and lists the later edits the second option removes. Only agent changes count as new; the owner's own edits are listed but never highlighted. The same accent dot marks changed notes in the tree, and the topbar carries the count.

### Accent Picker
Settings > Editor shows the five accent presets as a radiogroup of bordered swatch buttons (12px dot in the preset colour for the current theme, label in UI type). The active preset gets the active surface step and the strong hairline. Arrow keys, Home and End move the selection.

## Do's and Don'ts

### Do:
- **Do** keep every surface on the graphite ramp and put colour in notes, callouts, the graph and the single accent.
- **Do** derive tints from the current accent with `color-mix`, so all five presets work.
- **Do** check 4.5:1 for on-accent text and for links on the page whenever an accent value changes.
- **Do** size controls 32px on a fine pointer and 44px on a coarse pointer.
- **Do** move secondary actions into the More menu below 840px instead of letting a bar scroll sideways.
- **Do** use mono only for meta: counts, times, commit and path meta, and link brackets.

### Don't:
- **Don't** use hue gradients, glows, coloured shadows, gradient text, emoji as icons, uppercase tracked labels or sparkle badges (AI-SaaS slop).
- **Don't** add Electron-style desktop chrome: title bars, icon ribbons, menus that only work with a mouse.
- **Don't** give icons their own colours or mix icon sizes in one row.
- **Don't** put a shadow on anything that does not float over content.
- **Don't** hardcode an accent hex in a component; use the accent tokens.
- **Don't** use weights above 500 in the interface.
