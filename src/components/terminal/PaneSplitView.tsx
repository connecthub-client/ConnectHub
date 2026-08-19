import { useEffect, useRef, useState } from "react";
import { Host } from "../../lib/tauri-bridge";
import { computeLayout, PaneNode } from "../../lib/paneTree";
import { useSessionsStore } from "../../state/sessionsStore";
import PaneResizeDivider from "../common/PaneResizeDivider";
import TerminalView from "./TerminalView";

interface PaneSplitViewProps {
  tabId: string;
  node: PaneNode;
  totalPaneCount: number;
  broadcastEnabled: boolean;
  onToggleBroadcast: () => void;
  onSplit: (
    paneId: string,
    direction: "row" | "column",
    host?: Host,
  ) => Promise<{ ok: boolean; message?: string }>;
  onClosePane: (paneId: string) => void;
}

// Renders a tab's split tree (see lib/paneTree.ts) as a flat list of
// absolutely-positioned panes and dividers instead of nesting a DOM
// container per split level. Nesting per level was tried first, but it
// means a leaf's position in the *render* tree (not just its visual rect)
// changes whenever any other pane elsewhere is split or closed - and
// React remounts a component whenever its own rendered element type
// changes shape, so a sibling split collapsing into its surviving leaf
// (or a tab collapsing down to its last pane) was silently killing and
// reconnecting *other* panes' SSH sessions and clearing their scrollback.
// Flat + absolute positioning keyed by paneId/splitId sidesteps this:
// every pane is always a direct, stable sibling under one container, so
// editing the tree only ever changes rects, never identity.
export default function PaneSplitView({
  tabId,
  node,
  totalPaneCount,
  broadcastEnabled,
  onToggleBroadcast,
  onSplit,
  onClosePane,
}: PaneSplitViewProps) {
  const resizePaneSplit = useSessionsStore((s) => s.resizePaneSplit);
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const { leaves, dividers } = computeLayout(node, { left: 0, top: 0, width: size.width, height: size.height });

  return (
    <div ref={containerRef} className="relative h-full w-full">
      {leaves.map((leaf) => (
        <div
          key={leaf.paneId}
          style={{
            position: "absolute",
            left: leaf.rect.left,
            top: leaf.rect.top,
            width: leaf.rect.width,
            height: leaf.rect.height,
          }}
          className="overflow-hidden"
        >
          <TerminalView
            host={leaf.host}
            tabId={tabId}
            paneId={leaf.paneId}
            paneCount={totalPaneCount}
            broadcastEnabled={broadcastEnabled}
            onSplit={(direction, host) => onSplit(leaf.paneId, direction, host)}
            onToggleBroadcast={onToggleBroadcast}
            onClose={() => onClosePane(leaf.paneId)}
          />
        </div>
      ))}
      {dividers.map((divider) => (
        <div
          key={divider.splitId}
          style={{
            position: "absolute",
            left: divider.rect.left,
            top: divider.rect.top,
            width: divider.rect.width,
            height: divider.rect.height,
          }}
        >
          <PaneResizeDivider
            axis={divider.direction}
            ratio={divider.ratio}
            availablePx={divider.availablePx}
            onResize={(ratio) => resizePaneSplit(tabId, divider.splitId, ratio)}
            onReset={() => resizePaneSplit(tabId, divider.splitId, 0.5)}
          />
        </div>
      ))}
    </div>
  );
}
