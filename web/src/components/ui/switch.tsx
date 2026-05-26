import * as React from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn } from "../../lib/utils";

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    className={cn(
      "peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-border-strong transition-colors duration-fast",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
      "disabled:cursor-not-allowed disabled:opacity-50",
      "data-[state=checked]:bg-accent data-[state=checked]:border-accent",
      "data-[state=unchecked]:bg-surface-alt",
      className,
    )}
    {...props}
  >
    <SwitchPrimitive.Thumb
      className={cn(
        "pointer-events-none block h-4 w-4 rounded-full bg-surface-elev shadow-1 ring-0 transition-transform duration-fast",
        "data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0.5",
      )}
    />
  </SwitchPrimitive.Root>
));
Switch.displayName = SwitchPrimitive.Root.displayName;

export { Switch };
