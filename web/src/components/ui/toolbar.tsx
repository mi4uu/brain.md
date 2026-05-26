import * as React from "react";
import * as ToolbarPrimitive from "@radix-ui/react-toolbar";
import { cn } from "../../lib/utils";

const Toolbar = React.forwardRef<
  React.ElementRef<typeof ToolbarPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ToolbarPrimitive.Root>
>(({ className, ...props }, ref) => (
  <ToolbarPrimitive.Root
    ref={ref}
    className={cn(
      "flex w-full items-center gap-1 rounded-2 border border-border bg-surface-alt px-2 py-1",
      className,
    )}
    {...props}
  />
));
Toolbar.displayName = ToolbarPrimitive.Root.displayName;

const ToolbarButton = React.forwardRef<
  React.ElementRef<typeof ToolbarPrimitive.Button>,
  React.ComponentPropsWithoutRef<typeof ToolbarPrimitive.Button>
>(({ className, ...props }, ref) => (
  <ToolbarPrimitive.Button
    ref={ref}
    className={cn(
      "inline-flex h-8 min-w-[2rem] items-center justify-center rounded-1 px-2 text-sm text-fg-2 transition-colors duration-fast",
      "hover:bg-hover hover:text-fg-1",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
      "data-[state=on]:bg-accent-soft data-[state=on]:text-accent",
      "disabled:pointer-events-none disabled:opacity-40",
      className,
    )}
    {...props}
  />
));
ToolbarButton.displayName = ToolbarPrimitive.Button.displayName;

const ToolbarLink = React.forwardRef<
  React.ElementRef<typeof ToolbarPrimitive.Link>,
  React.ComponentPropsWithoutRef<typeof ToolbarPrimitive.Link>
>(({ className, ...props }, ref) => (
  <ToolbarPrimitive.Link
    ref={ref}
    className={cn(
      "inline-flex h-8 items-center justify-center rounded-1 px-2 text-sm text-link hover:underline",
      className,
    )}
    {...props}
  />
));
ToolbarLink.displayName = ToolbarPrimitive.Link.displayName;

const ToolbarSeparator = React.forwardRef<
  React.ElementRef<typeof ToolbarPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof ToolbarPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <ToolbarPrimitive.Separator
    ref={ref}
    className={cn("mx-1 h-5 w-px bg-border", className)}
    {...props}
  />
));
ToolbarSeparator.displayName = ToolbarPrimitive.Separator.displayName;

const ToolbarToggleGroup = React.forwardRef<
  React.ElementRef<typeof ToolbarPrimitive.ToggleGroup>,
  React.ComponentPropsWithoutRef<typeof ToolbarPrimitive.ToggleGroup>
>(({ className, ...props }, ref) => (
  <ToolbarPrimitive.ToggleGroup
    ref={ref}
    className={cn("inline-flex items-center gap-0.5", className)}
    {...props}
  />
));
ToolbarToggleGroup.displayName = ToolbarPrimitive.ToggleGroup.displayName;

const ToolbarToggleItem = React.forwardRef<
  React.ElementRef<typeof ToolbarPrimitive.ToggleItem>,
  React.ComponentPropsWithoutRef<typeof ToolbarPrimitive.ToggleItem>
>(({ className, ...props }, ref) => (
  <ToolbarPrimitive.ToggleItem
    ref={ref}
    className={cn(
      "inline-flex h-8 min-w-[2rem] items-center justify-center rounded-1 px-2 text-sm text-fg-2 transition-colors duration-fast",
      "hover:bg-hover hover:text-fg-1",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
      "data-[state=on]:bg-accent-soft data-[state=on]:text-accent",
      className,
    )}
    {...props}
  />
));
ToolbarToggleItem.displayName = ToolbarPrimitive.ToggleItem.displayName;

export {
  Toolbar,
  ToolbarButton,
  ToolbarLink,
  ToolbarSeparator,
  ToolbarToggleGroup,
  ToolbarToggleItem,
};
