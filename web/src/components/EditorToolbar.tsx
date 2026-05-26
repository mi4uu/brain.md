import type { EditorView } from "@codemirror/view";
import {
  bold,
  italic,
  strike,
  highlight,
  inlineCode,
  codeBlock,
  setHeading,
  bullet,
  numbered,
  task,
  quote,
  link,
  wikilink,
  image,
  table,
  mathInline,
  mathBlock,
  callout,
  horizontalRule,
} from "../editor/actions";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

interface Props {
  getView: () => EditorView | null;
  onUploadClick: () => void;
}

function btn(label: string, title: string, onClick: () => void, opts?: { variant?: "icon" | "text"; mono?: boolean }) {
  return (
    <Tooltip key={title}>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="tb-btn"
          aria-label={title}
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.preventDefault();
            onClick();
          }}
          data-variant={opts?.variant ?? "text"}
          style={opts?.mono ? { fontFamily: "var(--font-mono)" } : undefined}
        >
          {label}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{title}</TooltipContent>
    </Tooltip>
  );
}

export function EditorToolbar({ getView, onUploadClick }: Props) {
  const apply = (fn: (v: EditorView) => void) => () => {
    const v = getView();
    if (v) fn(v);
  };

  return (
    <div className="editor-toolbar scroll" role="toolbar" aria-label="Editor formatting">
      <div className="tb-group">
        {btn("H1", "Heading 1", apply((v) => setHeading(v, 1)), { mono: true })}
        {btn("H2", "Heading 2", apply((v) => setHeading(v, 2)), { mono: true })}
        {btn("H3", "Heading 3", apply((v) => setHeading(v, 3)), { mono: true })}
      </div>
      <span className="tb-sep" />
      <div className="tb-group">
        {btn("B", "Bold (⌘B)", apply(bold))}
        {btn("I", "Italic (⌘I)", apply(italic))}
        {btn("S", "Strikethrough", apply(strike))}
        {btn("=", "Highlight", apply(highlight))}
      </div>
      <span className="tb-sep" />
      <div className="tb-group">
        {btn("•", "Bullet list", apply(bullet))}
        {btn("1.", "Numbered list", apply(numbered))}
        {btn("☐", "Task", apply(task))}
        {btn("❝", "Quote", apply(quote))}
      </div>
      <span className="tb-sep" />
      <div className="tb-group">
        {btn("`", "Inline code", apply(inlineCode), { mono: true })}
        {btn("```", "Code block", apply((v) => codeBlock(v)), { mono: true })}
        {btn("⊞", "Table", apply(table))}
        {btn("―", "Divider", apply(horizontalRule))}
      </div>
      <span className="tb-sep" />
      <div className="tb-group">
        {btn("🔗", "Link", apply(link))}
        {btn("[[ ]]", "Wikilink", apply(wikilink))}
        {btn("Img", "Upload image", () => onUploadClick())}
        {btn("![[ ]]", "Embed", apply(image))}
      </div>
      <span className="tb-sep" />
      <div className="tb-group">
        {btn("$x$", "Math inline", apply(mathInline), { mono: true })}
        {btn("$$", "Math block", apply(mathBlock), { mono: true })}
      </div>
      <span className="tb-sep" />
      <div className="tb-group">
        {btn("!note", "Callout: note", apply((v) => callout(v, "note")))}
        {btn("!tip", "Callout: tip", apply((v) => callout(v, "tip")))}
        {btn("!warn", "Callout: warn", apply((v) => callout(v, "warning")))}
      </div>
    </div>
  );
}
