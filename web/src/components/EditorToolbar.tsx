import type { ReactNode } from "react";
import type { EditorView } from "@codemirror/view";
import * as ToolbarPrimitive from "@radix-ui/react-toolbar";
import {
  CheckboxIcon,
  CodeIcon,
  DividerHorizontalIcon,
  ExclamationTriangleIcon,
  FrameIcon,
  FontBoldIcon,
  FontItalicIcon,
  ImageIcon,
  InfoCircledIcon,
  LightningBoltIcon,
  Link2Icon,
  ListBulletIcon,
  QuoteIcon,
  StrikethroughIcon,
  TableIcon,
} from "@radix-ui/react-icons";
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

// --- custom mini-icons for cases Radix doesn't cover well ---

function HeadingChar({ n }: { n: 1 | 2 | 3 }) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex h-4 w-4 items-center justify-center font-semibold leading-none"
      style={{ fontSize: n === 1 ? 13 : n === 2 ? 12 : 11 }}
    >
      H{n}
    </span>
  );
}

function HighlightIcon() {
  // a marked "H" with a yellow underline — universal highlighter affordance
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 15 15"
      fill="none"
      aria-hidden="true"
    >
      <text
        x="7.5"
        y="10"
        textAnchor="middle"
        fontFamily="serif"
        fontSize="11"
        fontWeight="700"
        fill="currentColor"
      >
        H
      </text>
      <rect x="2.5" y="12" width="10" height="1.5" fill="#facc15" />
    </svg>
  );
}

function NumberedListIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 15 15"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <text x="1" y="6" fontSize="4.5" fontWeight="700" fill="currentColor" stroke="none">1</text>
      <text x="1" y="11" fontSize="4.5" fontWeight="700" fill="currentColor" stroke="none">2</text>
      <line x1="6" y1="4.5" x2="13.5" y2="4.5" />
      <line x1="6" y1="9.5" x2="13.5" y2="9.5" />
    </svg>
  );
}

function MathInlineIcon() {
  return (
    <span
      aria-hidden="true"
      className="inline-flex h-4 w-4 items-center justify-center font-serif italic leading-none"
      style={{ fontSize: 13 }}
    >
      ƒx
    </span>
  );
}

function MathBlockIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
      <rect
        x="1"
        y="2.5"
        width="13"
        height="10"
        rx="1.4"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <text
        x="7.5"
        y="10.5"
        textAnchor="middle"
        fontFamily="serif"
        fontSize="7"
        fontStyle="italic"
        fontWeight="700"
        fill="currentColor"
      >
        ƒx
      </text>
    </svg>
  );
}

function WikilinkIcon() {
  // brackets `[[ ]]` shape — instantly says wikilink to anyone who's
  // touched Obsidian, while being a real icon
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 15 15"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4.5 3.5 L2.5 3.5 L2.5 11.5 L4.5 11.5" />
      <path d="M10.5 3.5 L12.5 3.5 L12.5 11.5 L10.5 11.5" />
      <line x1="6.5" y1="7.5" x2="8.5" y2="7.5" />
    </svg>
  );
}

interface Props {
  getView: () => EditorView | null;
  onUploadClick: () => void;
}

function btn(
  icon: ReactNode,
  title: string,
  onClick: () => void,
  opts?: { variant?: "icon" | "text" },
) {
  return (
    <Tooltip key={title}>
      <TooltipTrigger asChild>
        <ToolbarPrimitive.Button
          type="button"
          className="tb-btn"
          aria-label={title}
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.preventDefault();
            onClick();
          }}
          data-variant={opts?.variant ?? "icon"}
        >
          {icon}
        </ToolbarPrimitive.Button>
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
    <ToolbarPrimitive.Root
      className="editor-toolbar scroll"
      aria-label="Editor formatting"
    >
      <div className="tb-group">
        {btn(<HeadingChar n={1} />, "Heading 1", apply((v) => setHeading(v, 1)), { variant: "text" })}
        {btn(<HeadingChar n={2} />, "Heading 2", apply((v) => setHeading(v, 2)), { variant: "text" })}
        {btn(<HeadingChar n={3} />, "Heading 3", apply((v) => setHeading(v, 3)), { variant: "text" })}
      </div>
      <ToolbarPrimitive.Separator className="tb-sep" />
      <div className="tb-group">
        {btn(<FontBoldIcon />, "Bold (⌘B)", apply(bold))}
        {btn(<FontItalicIcon />, "Italic (⌘I)", apply(italic))}
        {btn(<StrikethroughIcon />, "Strikethrough", apply(strike))}
        {btn(<HighlightIcon />, "Highlight (==text==)", apply(highlight))}
      </div>
      <ToolbarPrimitive.Separator className="tb-sep" />
      <div className="tb-group">
        {btn(<ListBulletIcon />, "Bullet list", apply(bullet))}
        {btn(<NumberedListIcon />, "Numbered list", apply(numbered))}
        {btn(<CheckboxIcon />, "Task list", apply(task))}
        {btn(<QuoteIcon />, "Quote", apply(quote))}
      </div>
      <ToolbarPrimitive.Separator className="tb-sep" />
      <div className="tb-group">
        {btn(<CodeIcon />, "Inline code (`x`)", apply(inlineCode))}
        {btn(<CodeIcon />, "Code block (```)", apply((v) => codeBlock(v)))}
        {btn(<TableIcon />, "Table", apply(table))}
        {btn(<DividerHorizontalIcon />, "Horizontal rule", apply(horizontalRule))}
      </div>
      <ToolbarPrimitive.Separator className="tb-sep" />
      <div className="tb-group">
        {btn(<Link2Icon />, "External link", apply(link))}
        {btn(<WikilinkIcon />, "Wikilink ([[Note]])", apply(wikilink))}
        {btn(<ImageIcon />, "Upload image", () => onUploadClick())}
        {btn(<FrameIcon />, "Embed (![[Note]])", apply(image))}
      </div>
      <ToolbarPrimitive.Separator className="tb-sep" />
      <div className="tb-group">
        {btn(<MathInlineIcon />, "Math inline ($x$)", apply(mathInline))}
        {btn(<MathBlockIcon />, "Math block ($$…$$)", apply(mathBlock))}
      </div>
      <ToolbarPrimitive.Separator className="tb-sep" />
      <div className="tb-group">
        {btn(
          <InfoCircledIcon className="text-callout-note" />,
          "Callout: note",
          apply((v) => callout(v, "note")),
        )}
        {btn(
          <LightningBoltIcon className="text-callout-tip" />,
          "Callout: tip",
          apply((v) => callout(v, "tip")),
        )}
        {btn(
          <ExclamationTriangleIcon className="text-callout-warn" />,
          "Callout: warn",
          apply((v) => callout(v, "warning")),
        )}
      </div>
    </ToolbarPrimitive.Root>
  );
}
