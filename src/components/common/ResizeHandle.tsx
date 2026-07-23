import { useRef } from "react";

interface ResizeHandleProps {
  // Which edge of the screen the panel being resized sits against - not
  // the handle's own position (the handle always sits at the panel's
  // inner edge, facing the center content). Determines the drag sign:
  // dragging right grows a left-edge panel, dragging left grows a
  // right-edge panel.
  panelSide: "left" | "right";
  width: number;
  onResize: (width: number) => void;
  onReset: () => void;
  onDragStateChange?: (dragging: boolean) => void;
}

// A thin drag handle at a panel's inner edge, VSCode-style. Reports raw,
// unclamped widths to `onResize` - the caller's own setter
// (settingsStore's setLeftSidebarWidth/setRightPanelWidth) does the actual
// clamping, so this component doesn't need to know the bounds. Width is
// computed from a fixed start-of-drag snapshot plus cumulative mouse
// delta, not by re-reading the `width` prop each move, so it stays correct
// regardless of React's render timing during the drag.
export default function ResizeHandle({ panelSide, width, onResize, onReset, onDragStateChange }: ResizeHandleProps) {
  const dragState = useRef<{ startX: number; startWidth: number } | null>(null);

  function handleMouseMove(e: MouseEvent) {
    if (!dragState.current) return;
    const delta = e.clientX - dragState.current.startX;
    const signedDelta = panelSide === "left" ? delta : -delta;
    onResize(dragState.current.startWidth + signedDelta);
  }

  function handleMouseUp() {
    dragState.current = null;
    onDragStateChange?.(false);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    window.removeEventListener("mousemove", handleMouseMove);
    window.removeEventListener("mouseup", handleMouseUp);
  }

  function handleMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    dragState.current = { startX: e.clientX, startWidth: width };
    onDragStateChange?.(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  }

  return (
    <div
      onMouseDown={handleMouseDown}
      onDoubleClick={onReset}
      title="Drag to resize (double-click to reset)"
      className="group flex w-1.5 shrink-0 cursor-col-resize items-stretch"
    >
      <div className="mx-auto w-px bg-transparent transition-colors group-hover:bg-teal-500/70" />
    </div>
  );
}
