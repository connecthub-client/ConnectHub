import { useRef } from "react";

interface PaneResizeDividerProps {
  // "row": a vertical divider between side-by-side panes (drag reads
  // clientX). "column": a horizontal divider between stacked panes (drag
  // reads clientY) - matches the split node's own `direction` naming.
  axis: "row" | "column";
  ratio: number;
  // The pixel size available to divide between the two sides, excluding
  // the divider's own thickness - computed by PaneSplitView's flat layout
  // pass (see lib/paneTree.ts::computeLayout) rather than measured from
  // this divider's own DOM parent, since in that flat layout the parent is
  // just this divider's own absolutely-positioned slot, not the split's
  // full container.
  availablePx: number;
  onResize: (ratio: number) => void;
  onReset: () => void;
}

// Same drag mechanics as ResizeHandle.tsx (mousedown snapshot of
// start-of-drag position + ratio, window-level mousemove/mouseup rather
// than per-move state reads, so it stays correct regardless of React's
// render timing), generalized to both axes and to a relative 0-1 ratio
// instead of an absolute pixel width.
export default function PaneResizeDivider({ axis, ratio, availablePx, onResize, onReset }: PaneResizeDividerProps) {
  const dragState = useRef<{ startPos: number; startRatio: number; availablePx: number } | null>(null);

  function handleMouseMove(e: MouseEvent) {
    if (!dragState.current) return;
    const pos = axis === "row" ? e.clientX : e.clientY;
    const delta = pos - dragState.current.startPos;
    const deltaRatio = delta / dragState.current.availablePx;
    onResize(dragState.current.startRatio + deltaRatio);
  }

  function handleMouseUp() {
    dragState.current = null;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    window.removeEventListener("mousemove", handleMouseMove);
    window.removeEventListener("mouseup", handleMouseUp);
  }

  function handleMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    dragState.current = {
      startPos: axis === "row" ? e.clientX : e.clientY,
      startRatio: ratio,
      availablePx: Math.max(1, availablePx),
    };
    document.body.style.cursor = axis === "row" ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  }

  return (
    <div
      onMouseDown={handleMouseDown}
      onDoubleClick={onReset}
      title="Drag to resize (double-click to reset)"
      className={
        axis === "row"
          ? "group flex h-full w-full cursor-col-resize items-stretch"
          : "group flex h-full w-full cursor-row-resize justify-stretch"
      }
    >
      <div
        className={
          axis === "row"
            ? "mx-auto w-px bg-transparent transition-colors group-hover:bg-teal-500/70"
            : "my-auto h-px w-full bg-transparent transition-colors group-hover:bg-teal-500/70"
        }
      />
    </div>
  );
}
