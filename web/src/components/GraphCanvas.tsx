import { useEffect, useRef, useState } from "react";
import { GraphEngine, type GraphInput } from "../graph/engine";

interface Props {
  data: GraphInput | null;
  focusId?: string | null;
  alwaysLabels?: boolean;
  folders?: string[];
  onOpen: (id: string) => void;
  onLegend?: (legend: Array<{ folder: string; color: string }>) => void;
  fitSignal?: number;
  className?: string;
}

export function GraphCanvas({ data, focusId, alwaysLabels, folders, onOpen, onLegend, fitSignal, className }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<GraphEngine | null>(null);
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    if (!hostRef.current) return;
    let engine: GraphEngine;
    try {
      engine = new GraphEngine(hostRef.current, { onOpen: (id) => onOpenRef.current(id) });
    } catch (e) {
      setFailed(e instanceof Error ? e.message : String(e));
      return;
    }
    engineRef.current = engine;
    return () => {
      engine.destroy();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    engineRef.current?.setOptions({ focusId: focusId ?? null, alwaysLabels, folders });
  }, [focusId, alwaysLabels, folders]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || !data) return;
    engine.setData(data);
    onLegend?.(engine.folderLegend());
  }, [data, onLegend]);

  useEffect(() => {
    if (fitSignal) engineRef.current?.zoomToFit();
  }, [fitSignal]);

  return (
    <div ref={hostRef} className={className ?? "graph-host"}>
      {failed ? <p className="muted graph-message">This browser cannot draw the graph: {failed}</p> : null}
    </div>
  );
}
