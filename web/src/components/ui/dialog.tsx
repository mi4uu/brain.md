import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Cross2Icon } from "@radix-ui/react-icons";
import { cn } from "../../lib/utils";

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogPortal = DialogPrimitive.Portal;
const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-modal bg-black/50 backdrop-blur-sm",
      "data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out",
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    showClose?: boolean;
  }
>(({ className, children, showClose = true, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed left-1/2 top-1/2 z-modal grid grid-cols-[minmax(0,1fr)] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 " +
          "max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain " +
          "border border-border bg-surface-elev p-5 text-fg-1 shadow-2 rounded-3 outline-none " +
          "data-[state=open]:animate-zoom-in data-[state=closed]:animate-zoom-out",
        className,
      )}
      {...props}
    >
      {children}
      {showClose && (
        <DialogPrimitive.Close
          className={cn(
            "absolute right-3 top-3 rounded-1 p-1 text-fg-3 transition-colors duration-fast",
            "hover:bg-hover hover:text-fg-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
          )}
          aria-label="Close"
        >
          <Cross2Icon className="h-4 w-4" />
        </DialogPrimitive.Close>
      )}
    </DialogPrimitive.Content>
  </DialogPortal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("flex flex-col gap-1.5 text-left", className)}
    {...props}
  />
);
DialogHeader.displayName = "DialogHeader";

// Sticks to the bottom of the scrolling DialogContent, so the actions stay reachable when the body
// is taller than the viewport. Chrome measures sticky offsets inside the scroller's padding, so
// -bottom-5 and the negative margins cancel DialogContent's p-5 and the bar sits on the edge.
const DialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "sticky -bottom-5 z-10 -mx-5 -mb-5 flex flex-wrap items-center justify-end gap-2 " +
        "border-t border-border bg-surface-elev px-5 pb-5 pt-3",
      className,
    )}
    {...props}
  />
);
DialogFooter.displayName = "DialogFooter";

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-md font-medium text-fg-1", className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-fg-3", className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  DialogClose,
  DialogOverlay,
  DialogPortal,
};
