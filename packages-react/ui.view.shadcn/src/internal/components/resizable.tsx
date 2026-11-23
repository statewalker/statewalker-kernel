import * as Resizable from "react-resizable-panels";
import { cn } from "../cn.js";

export function ResizablePanelGroup({
  className,
  ...props
}: React.ComponentProps<typeof Resizable.Group>): React.ReactElement {
  return (
    <Resizable.Group
      className={cn("flex h-full w-full data-[orientation=vertical]:flex-col", className)}
      {...props}
    />
  );
}

export const ResizablePanel = Resizable.Panel;

export function ResizableHandle({
  className,
  ...props
}: React.ComponentProps<typeof Resizable.Separator>): React.ReactElement {
  return (
    <Resizable.Separator
      className={cn(
        "relative flex w-px shrink-0 items-center justify-center bg-border hover:bg-ring focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring data-[orientation=vertical]:h-px data-[orientation=vertical]:w-full",
        className,
      )}
      {...props}
    />
  );
}
