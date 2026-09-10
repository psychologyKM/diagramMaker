'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react';

type Tone = 'theme' | 'cause' | 'result' | 'neutral';
type EdgeDirection = 'forward' | 'reverse' | 'both' | 'none';
type EdgeShape = 'straight' | 'curved';
type EdgeLineStyle = 'solid' | 'dashed' | 'dotted' | 'double';
type DiagramNode = { id: string; label: string; x: number; y: number; tone: Tone };
type DiagramEdge = {
  id: string;
  from: string;
  to: string;
  direction: EdgeDirection;
  shape: EdgeShape;
  lineStyle: EdgeLineStyle;
};
type Graph = { nodes: DiagramNode[]; edges: DiagramEdge[] };
type Transform = { x: number; y: number; zoom: number };
type EdgeGeometry = {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  controlX: number;
  controlY: number;
};

const STORAGE_KEY = 'relation-map-v1';
const NODE_WIDTH = 176;
const NODE_HEIGHT = 86;
const WORLD_WIDTH = 2200;
const WORLD_HEIGHT = 1500;

const initialGraph: Graph = {
  nodes: [
    { id: 'theme', label: 'チームの進捗が\n見えにくい', x: 670, y: 390, tone: 'theme' },
    { id: 'meeting', label: '定例会議が\n長い', x: 330, y: 210, tone: 'cause' },
    { id: 'updates', label: '更新タイミングが\nバラバラ', x: 300, y: 555, tone: 'cause' },
    { id: 'owner', label: '担当者が\n曖昧', x: 1040, y: 205, tone: 'result' },
    { id: 'delay', label: '判断が\n遅れる', x: 1080, y: 550, tone: 'result' },
  ],
  edges: [
    { id: 'e1', from: 'meeting', to: 'theme', direction: 'forward', shape: 'straight', lineStyle: 'solid' },
    { id: 'e2', from: 'updates', to: 'theme', direction: 'forward', shape: 'curved', lineStyle: 'solid' },
    { id: 'e3', from: 'theme', to: 'owner', direction: 'forward', shape: 'straight', lineStyle: 'solid' },
    { id: 'e4', from: 'theme', to: 'delay', direction: 'forward', shape: 'curved', lineStyle: 'dashed' },
    { id: 'e5', from: 'meeting', to: 'owner', direction: 'both', shape: 'curved', lineStyle: 'dotted' },
  ],
};

const toneNames: Record<Tone, string> = {
  theme: 'テーマ',
  cause: '原因',
  result: '結果',
  neutral: '要素',
};

const directionNames: Record<EdgeDirection, string> = {
  forward: '順方向',
  reverse: '逆方向',
  both: '両方向',
  none: '矢印なし',
};

const shapeNames: Record<EdgeShape, string> = {
  straight: '直線',
  curved: '曲線',
};

const lineStyleNames: Record<EdgeLineStyle, string> = {
  solid: '実線',
  dashed: '破線',
  dotted: '点線',
  double: '二重線',
};

const toneColors: Record<Tone, { fill: string; stroke: string; text: string }> = {
  theme: { fill: '#276a57', stroke: '#276a57', text: '#ffffff' },
  cause: { fill: '#fff2d7', stroke: '#e5cf9f', text: '#624d2a' },
  result: { fill: '#e2ecf7', stroke: '#bed0e1', text: '#37526b' },
  neutral: { fill: '#e3eee9', stroke: '#bed1c8', text: '#29483f' },
};

function cloneGraph(graph: Graph): Graph {
  return {
    nodes: graph.nodes.map((node) => ({ ...node })),
    edges: graph.edges.map((edge) => ({ ...edge })),
  };
}

function isEdgeDirection(value: unknown): value is EdgeDirection {
  return value === 'forward' || value === 'reverse' || value === 'both' || value === 'none';
}

function isEdgeShape(value: unknown): value is EdgeShape {
  return value === 'straight' || value === 'curved';
}

function isEdgeLineStyle(value: unknown): value is EdgeLineStyle {
  return value === 'solid' || value === 'dashed' || value === 'dotted' || value === 'double';
}

function normalizeGraph(value: Graph): Graph {
  return {
    nodes: value.nodes,
    edges: value.edges.map((edge) => ({
      ...edge,
      direction: isEdgeDirection(edge.direction) ? edge.direction : 'forward',
      shape: isEdgeShape(edge.shape) ? edge.shape : 'curved',
      lineStyle: isEdgeLineStyle(edge.lineStyle) ? edge.lineStyle : 'solid',
    })),
  };
}

function makeEdge(from: string, to: string): DiagramEdge {
  return {
    id: `edge-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
    from,
    to,
    direction: 'forward',
    shape: 'straight',
    lineStyle: 'solid',
  };
}

function getEdgeGeometry(edge: DiagramEdge, nodes: DiagramNode[]): EdgeGeometry | null {
  const source = nodes.find((node) => node.id === edge.from);
  const target = nodes.find((node) => node.id === edge.to);
  if (!source || !target) return null;

  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const length = Math.max(1, Math.hypot(dx, dy));
  const ux = dx / length;
  const uy = dy / length;
  const sourceOffset = Math.min(NODE_WIDTH / 2, NODE_HEIGHT / 2 / Math.max(Math.abs(uy), 0.55));
  const targetOffset = Math.min(NODE_WIDTH / 2 + 5, NODE_HEIGHT / 2 / Math.max(Math.abs(uy), 0.55) + 7);
  const startX = source.x + ux * sourceOffset;
  const startY = source.y + uy * sourceOffset;
  const endX = target.x - ux * targetOffset;
  const endY = target.y - uy * targetOffset;
  const bend = edge.shape === 'curved' ? 58 : 0;
  const controlX = (startX + endX) / 2 - uy * bend;
  const controlY = (startY + endY) / 2 + ux * bend;
  return { startX, startY, endX, endY, controlX, controlY };
}

function getEdgePath(edge: DiagramEdge, nodes: DiagramNode[]) {
  const geometry = getEdgeGeometry(edge, nodes);
  if (!geometry) return '';
  const { startX, startY, endX, endY, controlX, controlY } = geometry;
  if (edge.shape === 'straight') return `M ${startX} ${startY} L ${endX} ${endY}`;
  return `M ${startX} ${startY} Q ${controlX} ${controlY} ${endX} ${endY}`;
}

function hasStartArrow(direction: EdgeDirection) {
  return direction === 'reverse' || direction === 'both';
}

function hasEndArrow(direction: EdgeDirection) {
  return direction === 'forward' || direction === 'both';
}

function pointOnQuadratic(geometry: EdgeGeometry, t: number) {
  const inverse = 1 - t;
  return {
    x: inverse * inverse * geometry.startX + 2 * inverse * t * geometry.controlX + t * t * geometry.endX,
    y: inverse * inverse * geometry.startY + 2 * inverse * t * geometry.controlY + t * t * geometry.endY,
  };
}

function wrapCanvasText(context: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const explicitLines = text.split('\n');
  const lines: string[] = [];
  explicitLines.forEach((explicitLine) => {
    if (context.measureText(explicitLine).width <= maxWidth) {
      lines.push(explicitLine);
      return;
    }
    let current = '';
    Array.from(explicitLine).forEach((character) => {
      const next = current + character;
      if (current && context.measureText(next).width > maxWidth) {
        lines.push(current);
        current = character;
      } else {
        current = next;
      }
    });
    if (current) lines.push(current);
  });
  return lines.slice(0, 3);
}

export default function Home() {
  const [graph, setGraph] = useState<Graph>(initialGraph);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [tool, setTool] = useState<'select' | 'connect'>('select');
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const [transform, setTransform] = useState<Transform>({ x: 20, y: 15, zoom: 0.82 });
  const [hydrated, setHydrated] = useState(false);
  const [savedAt, setSavedAt] = useState('準備中');
  const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false });
  const [relationDrag, setRelationDrag] = useState<null | { from: string; x: number; y: number; targetId: string | null }>(null);
  const [exportingPptx, setExportingPptx] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<Graph>(initialGraph);
  const pastRef = useRef<Graph[]>([]);
  const futureRef = useRef<Graph[]>([]);
  const dragRef = useRef<null | {
    kind: 'node' | 'pan';
    id?: string;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    snapshot?: Graph;
    moved: boolean;
  }>(null);

  const selectedNode = graph.nodes.find((node) => node.id === selectedNodeId) ?? null;
  const selectedEdge = graph.edges.find((edge) => edge.id === selectedEdgeId) ?? null;

  const stats = useMemo(() => {
    const scores = graph.nodes.map((node) => {
      const incoming = graph.edges.reduce((count, edge) => count
        + (edge.to === node.id && hasEndArrow(edge.direction) ? 1 : 0)
        + (edge.from === node.id && hasStartArrow(edge.direction) ? 1 : 0), 0);
      const outgoing = graph.edges.reduce((count, edge) => count
        + (edge.from === node.id && hasEndArrow(edge.direction) ? 1 : 0)
        + (edge.to === node.id && hasStartArrow(edge.direction) ? 1 : 0), 0);
      return { node, incoming, outgoing, causeScore: outgoing - incoming, resultScore: incoming - outgoing };
    });
    const rootCause = [...scores].sort((a, b) => b.causeScore - a.causeScore || b.outgoing - a.outgoing)[0];
    const mainResult = [...scores].sort((a, b) => b.resultScore - a.resultScore || b.incoming - a.incoming)[0];
    return { rootCause, mainResult };
  }, [graph]);

  const pushPast = useCallback((snapshot: Graph) => {
    pastRef.current = [...pastRef.current.slice(-39), cloneGraph(snapshot)];
    futureRef.current = [];
    setHistoryState({ canUndo: true, canRedo: false });
  }, []);

  const commit = useCallback((updater: (current: Graph) => Graph) => {
    const current = graphRef.current;
    pushPast(current);
    const next = updater(current);
    graphRef.current = next;
    setGraph(next);
  }, [pushPast]);

  const undo = useCallback(() => {
    const previous = pastRef.current.at(-1);
    if (!previous) return;
    futureRef.current = [cloneGraph(graphRef.current), ...futureRef.current].slice(0, 40);
    pastRef.current = pastRef.current.slice(0, -1);
    graphRef.current = cloneGraph(previous);
    setGraph(graphRef.current);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    setConnectFrom(null);
    setTool('select');
    setHistoryState({ canUndo: pastRef.current.length > 0, canRedo: true });
  }, []);

  const redo = useCallback(() => {
    const next = futureRef.current[0];
    if (!next) return;
    pastRef.current = [...pastRef.current, cloneGraph(graphRef.current)].slice(-40);
    futureRef.current = futureRef.current.slice(1);
    graphRef.current = cloneGraph(next);
    setGraph(graphRef.current);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    setHistoryState({ canUndo: true, canRedo: futureRef.current.length > 0 });
  }, []);

  const deleteSelection = useCallback(() => {
    if (selectedNodeId) {
      commit((current) => ({
        nodes: current.nodes.filter((node) => node.id !== selectedNodeId),
        edges: current.edges.filter((edge) => edge.from !== selectedNodeId && edge.to !== selectedNodeId),
      }));
      setSelectedNodeId(null);
      setConnectFrom((id) => id === selectedNodeId ? null : id);
      return;
    }
    if (selectedEdgeId) {
      commit((current) => ({ ...current, edges: current.edges.filter((edge) => edge.id !== selectedEdgeId) }));
      setSelectedEdgeId(null);
    }
  }, [commit, selectedEdgeId, selectedNodeId]);

  useEffect(() => {
    let storedGraph: Graph | null = null;
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as Graph;
        if (Array.isArray(parsed.nodes) && Array.isArray(parsed.edges)) {
          storedGraph = normalizeGraph(parsed);
        }
      }
    } catch {
      // Invalid local data falls back to the starter diagram.
    }
    const frame = window.requestAnimationFrame(() => {
      if (storedGraph) {
        graphRef.current = storedGraph;
        setGraph(storedGraph);
      }
      setHydrated(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const timer = window.setTimeout(() => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(graph));
      setSavedAt('保存済み');
    }, 220);
    return () => window.clearTimeout(timer);
  }, [graph, hydrated]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, [contenteditable="true"]')) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo(); else undo();
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        redo();
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        if (selectedNodeId || selectedEdgeId) {
          event.preventDefault();
          deleteSelection();
        }
      } else if (event.key === 'Escape') {
        setTool('select');
        setConnectFrom(null);
        setSelectedEdgeId(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [deleteSelection, redo, selectedEdgeId, selectedNodeId, undo]);

  const viewportToWorld = (clientX: number, clientY: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 600, y: 400 };
    return {
      x: (clientX - rect.left - transform.x) / transform.zoom,
      y: (clientY - rect.top - transform.y) / transform.zoom,
    };
  };

  const addNode = (position?: { x: number; y: number }) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    const center = position ?? viewportToWorld(
      (rect?.left ?? 0) + (rect?.width ?? 900) / 2,
      (rect?.top ?? 0) + (rect?.height ?? 600) / 2,
    );
    const id = `node-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    commit((current) => ({
      ...current,
      nodes: [...current.nodes, { id, label: '新しい要素', x: center.x, y: center.y, tone: 'neutral' }],
    }));
    setSelectedNodeId(id);
    setSelectedEdgeId(null);
    setTool('select');
  };

  const startConnecting = () => {
    setTool((current) => current === 'connect' ? 'select' : 'connect');
    setConnectFrom(null);
    setSelectedEdgeId(null);
  };

  const handleNodeClick = (id: string) => {
    if (tool === 'connect') {
      if (!connectFrom) {
        setConnectFrom(id);
        setSelectedNodeId(id);
        return;
      }
      if (connectFrom !== id) {
        const exists = graph.edges.some((edge) => edge.from === connectFrom && edge.to === id);
        if (!exists) {
          const edge = makeEdge(connectFrom, id);
          commit((current) => ({ ...current, edges: [...current.edges, edge] }));
          setSelectedEdgeId(edge.id);
          setSelectedNodeId(null);
        }
      }
      setConnectFrom(null);
      setTool('select');
      return;
    }
    setSelectedNodeId(id);
    setSelectedEdgeId(null);
  };

  const handleNodeDoubleClick = (node: DiagramNode) => {
    const label = window.prompt('要素の名前を入力してください', node.label.replaceAll('\n', ' '));
    if (label?.trim()) {
      commit((current) => ({
        ...current,
        nodes: current.nodes.map((item) => item.id === node.id ? { ...item, label: label.trim() } : item),
      }));
    }
  };

  const nodeAtPoint = (clientX: number, clientY: number) => {
    const element = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>('[data-node-id]');
    return element?.dataset.nodeId ?? null;
  };

  const handleRelationPointerDown = (event: ReactPointerEvent<HTMLElement>, node: DiagramNode) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setRelationDrag({ from: node.id, x: node.x, y: node.y, targetId: null });
    setSelectedNodeId(node.id);
    setSelectedEdgeId(null);
    setTool('select');
    setConnectFrom(null);
  };

  const handleRelationPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const point = viewportToWorld(event.clientX, event.clientY);
    const targetId = nodeAtPoint(event.clientX, event.clientY);
    setRelationDrag((current) => current ? { ...current, x: point.x, y: point.y, targetId } : null);
  };

  const handleRelationPointerUp = (event: ReactPointerEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const targetId = nodeAtPoint(event.clientX, event.clientY);
    const sourceId = relationDrag?.from;
    if (sourceId && targetId && sourceId !== targetId) {
      const exists = graphRef.current.edges.some((edge) => edge.from === sourceId && edge.to === targetId);
      if (!exists) {
        const edge = makeEdge(sourceId, targetId);
        commit((current) => ({ ...current, edges: [...current.edges, edge] }));
        setSelectedEdgeId(edge.id);
        setSelectedNodeId(null);
      }
    }
    setRelationDrag(null);
  };

  const handleNodePointerDown = (event: ReactPointerEvent<HTMLButtonElement>, node: DiagramNode) => {
    event.stopPropagation();
    if (tool === 'connect') return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      kind: 'node',
      id: node.id,
      startX: event.clientX,
      startY: event.clientY,
      originX: node.x,
      originY: node.y,
      snapshot: cloneGraph(graph),
      moved: false,
    };
    setSelectedNodeId(node.id);
    setSelectedEdgeId(null);
  };

  const handleCanvasPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as Element).closest('.diagram-node, .edge-hit')) return;
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    if (tool === 'connect') {
      setConnectFrom(null);
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      kind: 'pan',
      startX: event.clientX,
      startY: event.clientY,
      originX: transform.x,
      originY: transform.y,
      moved: false,
    };
  };

  const handlePointerMove = (event: ReactPointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    if (drag.kind === 'pan') {
      setTransform((current) => ({ ...current, x: drag.originX + dx, y: drag.originY + dy }));
    } else if (drag.id) {
      setGraph((current) => {
        const next = {
          ...current,
          nodes: current.nodes.map((node) => node.id === drag.id
            ? { ...node, x: drag.originX + dx / transform.zoom, y: drag.originY + dy / transform.zoom }
            : node),
        };
        graphRef.current = next;
        return next;
      });
    }
  };

  const handlePointerUp = () => {
    const drag = dragRef.current;
    if (drag?.kind === 'node' && drag.moved && drag.snapshot) pushPast(drag.snapshot);
    dragRef.current = null;
  };

  const setZoom = (nextZoom: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    const zoom = Math.min(1.65, Math.max(0.35, nextZoom));
    if (!rect) {
      setTransform((current) => ({ ...current, zoom }));
      return;
    }
    setTransform((current) => {
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;
      const worldX = (centerX - current.x) / current.zoom;
      const worldY = (centerY - current.y) / current.zoom;
      return { zoom, x: centerX - worldX * zoom, y: centerY - worldY * zoom };
    });
  };

  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    setZoom(transform.zoom * (event.deltaY > 0 ? 0.9 : 1.1));
  };

  const fitView = () => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect || graph.nodes.length === 0) {
      setTransform({ x: 20, y: 20, zoom: 0.8 });
      return;
    }
    const minX = Math.min(...graph.nodes.map((node) => node.x)) - NODE_WIDTH;
    const maxX = Math.max(...graph.nodes.map((node) => node.x)) + NODE_WIDTH;
    const minY = Math.min(...graph.nodes.map((node) => node.y)) - NODE_HEIGHT;
    const maxY = Math.max(...graph.nodes.map((node) => node.y)) + NODE_HEIGHT;
    const zoom = Math.min(1.15, Math.max(0.35, Math.min(rect.width / (maxX - minX), rect.height / (maxY - minY))));
    setTransform({
      zoom,
      x: (rect.width - (minX + maxX) * zoom) / 2,
      y: (rect.height - (minY + maxY) * zoom) / 2,
    });
  };

  const exportPng = () => {
    if (graph.nodes.length === 0) return;
    const padding = 100;
    const minX = Math.min(...graph.nodes.map((node) => node.x - NODE_WIDTH / 2)) - padding;
    const maxX = Math.max(...graph.nodes.map((node) => node.x + NODE_WIDTH / 2)) + padding;
    const minY = Math.min(...graph.nodes.map((node) => node.y - NODE_HEIGHT / 2)) - padding;
    const maxY = Math.max(...graph.nodes.map((node) => node.y + NODE_HEIGHT / 2)) + padding;
    const sourceWidth = maxX - minX;
    const sourceHeight = maxY - minY;
    const scale = Math.min(2, 2800 / Math.max(sourceWidth, sourceHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(sourceWidth * scale);
    canvas.height = Math.ceil(sourceHeight * scale);
    const context = canvas.getContext('2d');
    if (!context) return;
    context.scale(scale, scale);
    context.translate(-minX, -minY);
    context.fillStyle = '#fcfdfc';
    context.fillRect(minX, minY, sourceWidth, sourceHeight);
    context.fillStyle = '#d8dfdb';
    for (let x = Math.floor(minX / 24) * 24; x < maxX; x += 24) {
      for (let y = Math.floor(minY / 24) * 24; y < maxY; y += 24) {
        context.beginPath(); context.arc(x, y, 1, 0, Math.PI * 2); context.fill();
      }
    }

    const traceEdge = (edge: DiagramEdge, geometry: EdgeGeometry) => {
      context.beginPath();
      context.moveTo(geometry.startX, geometry.startY);
      if (edge.shape === 'curved') {
        context.quadraticCurveTo(geometry.controlX, geometry.controlY, geometry.endX, geometry.endY);
      } else {
        context.lineTo(geometry.endX, geometry.endY);
      }
    };

    const drawArrow = (x: number, y: number, angle: number) => {
      context.beginPath();
      context.moveTo(x, y);
      context.lineTo(x - 13 * Math.cos(angle - Math.PI / 6), y - 13 * Math.sin(angle - Math.PI / 6));
      context.lineTo(x - 13 * Math.cos(angle + Math.PI / 6), y - 13 * Math.sin(angle + Math.PI / 6));
      context.closePath();
      context.fillStyle = '#697176';
      context.fill();
    };

    graph.edges.forEach((edge) => {
      const geometry = getEdgeGeometry(edge, graph.nodes);
      if (!geometry) return;
      context.strokeStyle = '#697176';
      context.lineCap = edge.lineStyle === 'dotted' ? 'round' : 'butt';
      context.setLineDash(edge.lineStyle === 'dashed' ? [11, 7] : edge.lineStyle === 'dotted' ? [2, 7] : []);
      if (edge.lineStyle === 'double') {
        context.lineWidth = 6;
        traceEdge(edge, geometry);
        context.stroke();
        context.strokeStyle = '#fcfdfc';
        context.lineWidth = 2.2;
        traceEdge(edge, geometry);
        context.stroke();
      } else {
        context.lineWidth = 2;
        traceEdge(edge, geometry);
        context.stroke();
      }
      context.setLineDash([]);
      const startAngle = edge.shape === 'curved'
        ? Math.atan2(geometry.startY - geometry.controlY, geometry.startX - geometry.controlX)
        : Math.atan2(geometry.startY - geometry.endY, geometry.startX - geometry.endX);
      const endAngle = edge.shape === 'curved'
        ? Math.atan2(geometry.endY - geometry.controlY, geometry.endX - geometry.controlX)
        : Math.atan2(geometry.endY - geometry.startY, geometry.endX - geometry.startX);
      if (hasStartArrow(edge.direction)) drawArrow(geometry.startX, geometry.startY, startAngle);
      if (hasEndArrow(edge.direction)) drawArrow(geometry.endX, geometry.endY, endAngle);
    });

    graph.nodes.forEach((node) => {
      const colors = toneColors[node.tone];
      const width = node.tone === 'theme' ? 188 : NODE_WIDTH;
      const height = node.tone === 'theme' ? 96 : NODE_HEIGHT;
      const x = node.x - width / 2;
      const y = node.y - height / 2;
      context.beginPath();
      context.roundRect(x, y, width, height, 18);
      context.fillStyle = colors.fill;
      context.fill();
      context.lineWidth = node.tone === 'theme' ? 2.5 : 1.5;
      context.strokeStyle = colors.stroke;
      context.stroke();
      context.fillStyle = colors.text;
      context.font = `600 ${node.tone === 'theme' ? 15 : 14}px system-ui, sans-serif`;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      const lines = wrapCanvasText(context, node.label, width - 28);
      lines.forEach((line, index) => context.fillText(line, node.x, node.y + (index - (lines.length - 1) / 2) * 21));
    });

    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `連関図-${new Date().toISOString().slice(0, 10)}.png`;
      anchor.click();
      URL.revokeObjectURL(url);
    }, 'image/png');
  };

  const exportPptx = async () => {
    if (graph.nodes.length === 0 || exportingPptx) return;
    setExportingPptx(true);
    try {
      const { default: PptxGenJS } = await import('pptxgenjs');
      const pptx = new PptxGenJS();
      pptx.layout = 'LAYOUT_WIDE';
      pptx.author = 'diagramMaker';
      pptx.company = 'diagramMaker';
      pptx.subject = '連関図';
      pptx.title = '連関図';

      const slide = pptx.addSlide();
      slide.background = { color: 'FCFDFC' };
      const slideWidth = 13.333;
      const slideHeight = 7.5;
      const margin = 0.5;
      const minX = Math.min(...graph.nodes.map((node) => node.x - (node.tone === 'theme' ? 94 : NODE_WIDTH / 2)));
      const maxX = Math.max(...graph.nodes.map((node) => node.x + (node.tone === 'theme' ? 94 : NODE_WIDTH / 2)));
      const minY = Math.min(...graph.nodes.map((node) => node.y - (node.tone === 'theme' ? 48 : NODE_HEIGHT / 2)));
      const maxY = Math.max(...graph.nodes.map((node) => node.y + (node.tone === 'theme' ? 48 : NODE_HEIGHT / 2)));
      const contentWidth = Math.max(1, maxX - minX);
      const contentHeight = Math.max(1, maxY - minY);
      const scale = Math.min((slideWidth - margin * 2) / contentWidth, (slideHeight - margin * 2) / contentHeight);
      const offsetX = (slideWidth - contentWidth * scale) / 2 - minX * scale;
      const offsetY = (slideHeight - contentHeight * scale) / 2 - minY * scale;
      const toSlide = (point: { x: number; y: number }) => ({ x: point.x * scale + offsetX, y: point.y * scale + offsetY });

      const addLine = (
        start: { x: number; y: number },
        end: { x: number; y: number },
        edge: DiagramEdge,
        arrowAtStart: boolean,
        arrowAtEnd: boolean,
        railOffset = 0,
      ) => {
        let startPoint = toSlide(start);
        let endPoint = toSlide(end);
        if (railOffset) {
          const dx = endPoint.x - startPoint.x;
          const dy = endPoint.y - startPoint.y;
          const length = Math.max(0.001, Math.hypot(dx, dy));
          const offsetX = -dy / length * railOffset;
          const offsetY = dx / length * railOffset;
          startPoint = { x: startPoint.x + offsetX, y: startPoint.y + offsetY };
          endPoint = { x: endPoint.x + offsetX, y: endPoint.y + offsetY };
        }
        const dx = endPoint.x - startPoint.x;
        const dy = endPoint.y - startPoint.y;
        const x = Math.min(startPoint.x, endPoint.x);
        const y = Math.min(startPoint.y, endPoint.y);
        const p1IsHead = dx > 0 || (Math.abs(dx) < 0.0001 && dy >= 0);
        const beginArrow = p1IsHead ? arrowAtStart : arrowAtEnd;
        const endArrow = p1IsHead ? arrowAtEnd : arrowAtStart;
        const dashType: 'solid' | 'dash' | 'sysDot' = edge.lineStyle === 'dashed'
          ? 'dash'
          : edge.lineStyle === 'dotted' ? 'sysDot' : 'solid';
        slide.addShape(pptx.ShapeType.line, {
          x,
          y,
          w: Math.max(0.001, Math.abs(dx)),
          h: Math.max(0.001, Math.abs(dy)),
          flipV: dx * dy < 0,
          line: {
            color: '697176',
            width: edge.lineStyle === 'double' ? 1 : 1.5,
            dashType,
            beginArrowType: beginArrow ? 'triangle' : 'none',
            endArrowType: endArrow ? 'triangle' : 'none',
          },
        });
      };

      graph.edges.forEach((edge) => {
        const geometry = getEdgeGeometry(edge, graph.nodes);
        if (!geometry) return;
        const points = edge.shape === 'curved'
          ? Array.from({ length: 7 }, (_, index) => pointOnQuadratic(geometry, index / 6))
          : [
              { x: geometry.startX, y: geometry.startY },
              { x: geometry.endX, y: geometry.endY },
            ];
        points.slice(0, -1).forEach((point, index) => {
          const nextPoint = points[index + 1];
          const arrowAtStart = index === 0 && hasStartArrow(edge.direction);
          const arrowAtEnd = index === points.length - 2 && hasEndArrow(edge.direction);
          if (edge.lineStyle === 'double') {
            addLine(point, nextPoint, edge, arrowAtStart, arrowAtEnd, -0.025);
            addLine(point, nextPoint, edge, arrowAtStart, arrowAtEnd, 0.025);
          } else {
            addLine(point, nextPoint, edge, arrowAtStart, arrowAtEnd);
          }
        });
      });

      graph.nodes.forEach((node) => {
        const colors = toneColors[node.tone];
        const width = (node.tone === 'theme' ? 188 : NODE_WIDTH) * scale;
        const height = (node.tone === 'theme' ? 96 : NODE_HEIGHT) * scale;
        const center = toSlide(node);
        slide.addText(node.label.replaceAll('\n', ' '), {
          x: center.x - width / 2,
          y: center.y - height / 2,
          w: width,
          h: height,
          shape: pptx.ShapeType.roundRect,
          fill: { color: colors.fill.slice(1) },
          line: { color: colors.stroke.slice(1), width: node.tone === 'theme' ? 1.8 : 1 },
          color: colors.text.slice(1),
          fontFace: 'Yu Gothic',
          fontSize: Math.max(9, Math.min(15, 14 * scale / 0.012)),
          bold: true,
          align: 'center',
          valign: 'middle',
          margin: 0.08,
          breakLine: false,
          fit: 'shrink',
        });
      });

      await pptx.writeFile({ fileName: `連関図-${new Date().toISOString().slice(0, 10)}.pptx`, compression: true });
    } catch (error) {
      console.error(error);
      window.alert('PowerPointの書き出しに失敗しました。もう一度お試しください。');
    } finally {
      setExportingPptx(false);
    }
  };

  const resetGraph = () => {
    if (!window.confirm('現在の連関図を消して、最初の例に戻しますか？')) return;
    commit(() => cloneGraph(initialGraph));
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    setTransform({ x: 20, y: 15, zoom: 0.82 });
  };

  const updateSelectedNode = (patch: Partial<Pick<DiagramNode, 'label' | 'tone'>>) => {
    if (!selectedNodeId) return;
    commit((current) => ({
      ...current,
      nodes: current.nodes.map((node) => node.id === selectedNodeId ? { ...node, ...patch } : node),
    }));
  };

  const updateSelectedEdge = (patch: Partial<Pick<DiagramEdge, 'direction' | 'shape' | 'lineStyle'>>) => {
    if (!selectedEdgeId) return;
    commit((current) => ({
      ...current,
      edges: current.edges.map((edge) => edge.id === selectedEdgeId ? { ...edge, ...patch } : edge),
    }));
  };

  const fromNode = selectedEdge ? graph.nodes.find((node) => node.id === selectedEdge.from) : null;
  const toNode = selectedEdge ? graph.nodes.find((node) => node.id === selectedEdge.to) : null;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">RELATION MAP</p>
          <h1>連関図</h1>
        </div>
        <div className="save-status" aria-live="polite"><span />{savedAt}・この端末のみ</div>
      </header>

      <section className="workspace" aria-label="連関図エディター">
        <aside className="side-panel">
          <div className="panel-section">
            <p className="panel-label">編集</p>
            <button className="primary-button" type="button" onClick={() => addNode()}>＋ 要素を追加</button>
            <button className={`secondary-button ${tool === 'connect' ? 'active' : ''}`} type="button" onClick={startConnecting}>↗ 関係をつなぐ</button>
          </div>

          {selectedNode ? (
            <div className="panel-section inspector">
              <div className="section-heading"><p className="panel-label">選択中の要素</p><span>{toneNames[selectedNode.tone]}</span></div>
              <label className="field-label" htmlFor="node-label">内容</label>
              <textarea id="node-label" value={selectedNode.label} onChange={(event) => updateSelectedNode({ label: event.target.value })} rows={3} />
              <p className="field-label">種類</p>
              <div className="tone-picker">
                {(Object.keys(toneNames) as Tone[]).map((tone) => (
                  <button key={tone} className={selectedNode.tone === tone ? 'selected' : ''} type="button" onClick={() => updateSelectedNode({ tone })}>
                    <i className={tone} />{toneNames[tone]}
                  </button>
                ))}
              </div>
              <div className="node-degree">
                <span>入ってくる矢印 <strong>{graph.edges.reduce((count, edge) => count + (edge.to === selectedNode.id && hasEndArrow(edge.direction) ? 1 : 0) + (edge.from === selectedNode.id && hasStartArrow(edge.direction) ? 1 : 0), 0)}</strong></span>
                <span>出ていく矢印 <strong>{graph.edges.reduce((count, edge) => count + (edge.from === selectedNode.id && hasEndArrow(edge.direction) ? 1 : 0) + (edge.to === selectedNode.id && hasStartArrow(edge.direction) ? 1 : 0), 0)}</strong></span>
              </div>
              <button className="danger-button" type="button" onClick={deleteSelection}>要素を削除</button>
            </div>
          ) : selectedEdge ? (
            <div className="panel-section inspector">
              <div className="section-heading"><p className="panel-label">選択中の関係</p><span>コネクタ</span></div>
              <div className="edge-summary">
                <strong>{fromNode?.label.replaceAll('\n', ' ')}</strong>
                <span>{directionNames[selectedEdge.direction]}</span>
                <strong>{toNode?.label.replaceAll('\n', ' ')}</strong>
              </div>
              <p className="field-label">形状</p>
              <div className="edge-option-grid two-columns">
                {(Object.keys(shapeNames) as EdgeShape[]).map((shape) => (
                  <button key={shape} className={selectedEdge.shape === shape ? 'selected' : ''} type="button" onClick={() => updateSelectedEdge({ shape })}>
                    <span className={`shape-preview ${shape}`} />{shapeNames[shape]}
                  </button>
                ))}
              </div>
              <p className="field-label">矢印</p>
              <div className="edge-option-grid direction-grid">
                {(Object.keys(directionNames) as EdgeDirection[]).map((direction) => (
                  <button key={direction} className={selectedEdge.direction === direction ? 'selected' : ''} type="button" onClick={() => updateSelectedEdge({ direction })} title={directionNames[direction]}>
                    <span className="direction-preview" aria-hidden="true">{{ forward: '→', reverse: '←', both: '↔', none: '—' }[direction]}</span>
                    <small>{directionNames[direction]}</small>
                  </button>
                ))}
              </div>
              <p className="field-label">線</p>
              <div className="edge-option-grid line-style-grid">
                {(Object.keys(lineStyleNames) as EdgeLineStyle[]).map((lineStyle) => (
                  <button key={lineStyle} className={selectedEdge.lineStyle === lineStyle ? 'selected' : ''} type="button" onClick={() => updateSelectedEdge({ lineStyle })}>
                    <span className={`line-preview ${lineStyle}`} />{lineStyleNames[lineStyle]}
                  </button>
                ))}
              </div>
              <button className="danger-button" type="button" onClick={deleteSelection}>関係を削除</button>
            </div>
          ) : (
            <div className="panel-section">
              <p className="panel-label">図の読み取り</p>
              <div className="metric"><span>要素</span><strong>{graph.nodes.length}</strong></div>
              <div className="metric"><span>関係</span><strong>{graph.edges.length}</strong></div>
              {graph.nodes.length > 0 && (
                <div className="analysis-card">
                  <span>主要原因の候補</span>
                  <strong>{stats.rootCause?.node.label.replaceAll('\n', ' ')}</strong>
                  <span>主要結果の候補</span>
                  <strong>{stats.mainResult?.node.label.replaceAll('\n', ' ')}</strong>
                </div>
              )}
            </div>
          )}

          <div className="tip-card">
            <span className="tip-mark">?</span>
            <p>{tool === 'connect' ? (connectFrom ? '次に、矢印の行き先を選びます。' : '矢印の出発点になる要素を選びます。') : '要素右端の＋を別の要素へドラッグすると、関係を直接追加できます。'}</p>
          </div>
          <button className="reset-button" type="button" onClick={resetGraph}>最初の例に戻す</button>
        </aside>

        <div className="canvas-wrap">
          <div className="canvas-toolbar">
            <div className="toolbar-group mobile-tools">
              <button type="button" onClick={() => addNode()} aria-label="要素を追加">＋ <span>要素</span></button>
              <button type="button" className={tool === 'connect' ? 'active' : ''} onClick={startConnecting}>↗ <span>接続</span></button>
            </div>
            <div className="toolbar-spacer" />
            <div className="toolbar-group">
              <button type="button" onClick={undo} disabled={!historyState.canUndo} aria-label="元に戻す">↶</button>
              <button type="button" onClick={redo} disabled={!historyState.canRedo} aria-label="やり直す">↷</button>
              <button type="button" onClick={deleteSelection} disabled={!selectedNodeId && !selectedEdgeId} aria-label="選択項目を削除">⌫</button>
            </div>
            <div className="toolbar-divider" />
            <button type="button" onClick={fitView}>全体表示</button>
            <button className="export-button" type="button" onClick={exportPng} disabled={graph.nodes.length === 0}>PNG</button>
            <button className="export-button pptx-button" type="button" title="Keynoteでも開いて編集できます" onClick={exportPptx} disabled={graph.nodes.length === 0 || exportingPptx}>{exportingPptx ? '作成中…' : 'PowerPoint'}</button>
          </div>

          <div
            className={`diagram-canvas ${tool === 'connect' ? 'connecting' : ''}`}
            ref={canvasRef}
            onDoubleClick={(event) => {
              if (!(event.target as Element).closest('.diagram-node, .edge-hit')) addNode(viewportToWorld(event.clientX, event.clientY));
            }}
            onPointerDown={handleCanvasPointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onWheel={handleWheel}
            style={{
              backgroundPosition: `${transform.x}px ${transform.y}px`,
              backgroundSize: `${24 * transform.zoom}px ${24 * transform.zoom}px`,
            }}
          >
            <div className="scene" style={{ width: WORLD_WIDTH, height: WORLD_HEIGHT, transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.zoom})` }}>
              <svg className="edges" width={WORLD_WIDTH} height={WORLD_HEIGHT} aria-label="関係を表す矢印">
                <defs>
                  <marker id="arrow" markerWidth="12" markerHeight="12" refX="9" refY="5" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
                  </marker>
                </defs>
                {graph.edges.map((edge) => {
                  const path = getEdgePath(edge, graph.nodes);
                  const selected = edge.id === selectedEdgeId;
                  const markerStart = hasStartArrow(edge.direction) ? 'url(#arrow)' : undefined;
                  const markerEnd = hasEndArrow(edge.direction) ? 'url(#arrow)' : undefined;
                  return (
                    <g key={edge.id} className={selected ? 'selected' : ''}>
                      <path className="edge-hit" d={path} onClick={(event) => { event.stopPropagation(); setSelectedEdgeId(edge.id); setSelectedNodeId(null); setTool('select'); setConnectFrom(null); }} />
                      {edge.lineStyle === 'double' ? (
                        <>
                          <path className="edge-line edge-double-outer" d={path} markerStart={markerStart} markerEnd={markerEnd} />
                          <path className="edge-line edge-double-inner" d={path} />
                        </>
                      ) : (
                        <path className={`edge-line ${edge.lineStyle}`} d={path} markerStart={markerStart} markerEnd={markerEnd} />
                      )}
                    </g>
                  );
                })}
                {relationDrag && (
                  <path className="edge-preview" d={`M ${graph.nodes.find((node) => node.id === relationDrag.from)?.x ?? relationDrag.x} ${graph.nodes.find((node) => node.id === relationDrag.from)?.y ?? relationDrag.y} L ${relationDrag.x} ${relationDrag.y}`} markerEnd="url(#arrow)" />
                )}
              </svg>

              {graph.nodes.map((node) => (
                <button
                  className={`diagram-node ${node.tone} ${selectedNodeId === node.id ? 'selected' : ''} ${connectFrom === node.id ? 'connect-source' : ''} ${relationDrag?.targetId === node.id && relationDrag.from !== node.id ? 'connect-target' : ''}`}
                  key={node.id}
                  data-node-id={node.id}
                  style={{ left: node.x, top: node.y }}
                  type="button"
                  aria-label={`${node.label.replaceAll('\n', ' ')}、${toneNames[node.tone]}`}
                  onClick={() => handleNodeClick(node.id)}
                  onDoubleClick={(event) => { event.stopPropagation(); handleNodeDoubleClick(node); }}
                  onPointerDown={(event) => handleNodePointerDown(event, node)}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerCancel={handlePointerUp}
                >
                  {node.label.split('\n').map((line, index) => <span key={`${line}-${index}`}>{line || ' '}</span>)}
                  <span
                    className="connection-handle"
                    title="別の要素へドラッグして関係を追加"
                    aria-hidden="true"
                    onClick={(event) => event.stopPropagation()}
                    onPointerDown={(event) => handleRelationPointerDown(event, node)}
                    onPointerMove={handleRelationPointerMove}
                    onPointerUp={handleRelationPointerUp}
                    onPointerCancel={() => setRelationDrag(null)}
                  >＋</span>
                </button>
              ))}
            </div>

            {graph.nodes.length === 0 ? (
              <button className="empty-state" type="button" onClick={() => addNode()}>
                <strong>最初の要素を追加</strong>
                <span>ここから考えをつないでいきましょう</span>
              </button>
            ) : (
              <p className="canvas-hint">右端の＋をドラッグして接続 ・ 空白をダブルクリックして追加 ・ ⌘ / Ctrl + ホイールで拡大縮小</p>
            )}

            {tool === 'connect' && (
              <div className="mode-banner"><span />{connectFrom ? '行き先の要素を選択' : '出発点の要素を選択'}<button type="button" onClick={() => { setTool('select'); setConnectFrom(null); }}>終了</button></div>
            )}

            <div className="zoom-control" aria-label="表示倍率">
              <button type="button" onClick={() => setZoom(transform.zoom - 0.1)} aria-label="縮小">−</button>
              <span>{Math.round(transform.zoom * 100)}%</span>
              <button type="button" onClick={() => setZoom(transform.zoom + 0.1)} aria-label="拡大">＋</button>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
