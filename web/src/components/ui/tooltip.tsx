import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { cn } from "../../lib/utils";

const TooltipProvider = ({
  delayDuration = 0,
  skipDelayDuration = 100,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) => (
  <TooltipPrimitive.Provider
    delayDuration={delayDuration}
    skipDelayDuration={skipDelayDuration}
    {...props}
  />
);

const Tooltip = TooltipPrimitive.Root;
const TooltipTrigger = TooltipPrimitive.Trigger;

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 6, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        "z-modal overflow-hidden rounded-1 border border-border bg-fg-1 px-2 py-1 text-xs text-app shadow-2",
        "data-[state=delayed-open]:animate-fade-in data-[state=closed]:animate-fade-out",
        "data-[side=bottom]:animate-slide-in-top data-[side=top]:animate-slide-in-bottom",
        "data-[side=left]:animate-slide-in-right data-[side=right]:animate-slide-in-left",
        className,
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
));
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
