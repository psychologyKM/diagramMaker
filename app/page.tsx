'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react';

type Tone = 'theme' | 'cause' | 'result' | 'neutral';
type DiagramNode = { id: string; label: string; x: number; y: number; tone: Tone };
type DiagramEdge = { id: string; from: string; to: string };
type Graph = { nodes: DiagramNode[]; edges: DiagramEdge[] };
type Transform = { x: number; y: number; zoom: number };

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
    { id: 'e1', from: 'meeting', to: 'theme' },
    { id: 'e2', from: 'updates', to: 'theme' },
    { id: 'e3', from: 'theme', to: 'owner' },
    { id: 'e4', from: 'theme', to: 'delay' },
    { id: 'e5', from: 'meeting', to: 'owner' },
  ],
};

const toneNames: Record<Tone, string> = {
  theme: 'テーマ',
  cause: '原因',
  result: '結果',
  neutral: '要素',
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

function getEdgePath(edge: DiagramEdge, nodes: DiagramNode[]) {
  const source = nodes.find((node) => node.id === edge.from);
  const target = nodes.find((node) => node.id === edge.to);
  if (!source || !target) return '';

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
  const bend = ((edge.id.charCodeAt(edge.id.length - 1) % 3) - 1) * 20;
  const controlX = (startX + endX) / 2 - uy * bend;
  const controlY = (startY + endY) / 2 + ux * bend;
  return `M ${startX} ${startY} Q ${controlX} ${controlY} ${endX} ${endY}`;
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
  const [historyVersion, setHistoryVersion] = useState(0);
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
      const incoming = graph.edges.filter((edge) => edge.to === node.id).length;
      const outgoing = graph.edges.filter((edge) => edge.from === node.id).length;
      return { node, incoming, outgoing, causeScore: outgoing - incoming, resultScore: incoming - outgoing };
    });
    const rootCause = [...scores].sort((a, b) => b.causeScore - a.causeScore || b.outgoing - a.outgoing)[0];
    const mainResult = [...scores].sort((a, b) => b.resultScore - a.resultScore || b.incoming - a.incoming)[0];
    return { rootCause, mainResult };
  }, [graph]);

  const pushPast = useCallback((snapshot: Graph) => {
    pastRef.current = [...pastRef.current.slice(-39), cloneGraph(snapshot)];
    futureRef.current = [];
    setHistoryVersion((version) => version + 1);
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
    setHistoryVersion((version) => version + 1);
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
    setHistoryVersion((version) => version + 1);
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
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as Graph;
        if (Array.isArray(parsed.nodes) && Array.isArray(parsed.edges)) {
          graphRef.current = parsed;
          setGraph(parsed);
        }
      }
    } catch {
      // Invalid local data falls back to the starter diagram.
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const timer = window.setTimeout(() => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(graph));
      setSavedAt('保存済み');
    }, 220);
    setSavedAt('保存中…');
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
          const edgeId = `edge-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
          commit((current) => ({ ...current, edges: [...current.edges, { id: edgeId, from: connectFrom, to: id }] }));
          setSelectedEdgeId(edgeId);
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

    context.strokeStyle = '#697176';
    context.lineWidth = 2;
    graph.edges.forEach((edge) => {
      const source = graph.nodes.find((node) => node.id === edge.from);
      const target = graph.nodes.find((node) => node.id === edge.to);
      if (!source || !target) return;
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const length = Math.max(1, Math.hypot(dx, dy));
      const ux = dx / length;
      const uy = dy / length;
      const startX = source.x + ux * 92;
      const startY = source.y + uy * 48;
      const endX = target.x - ux * 99;
      const endY = target.y - uy * 52;
      const bend = ((edge.id.charCodeAt(edge.id.length - 1) % 3) - 1) * 20;
      const controlX = (startX + endX) / 2 - uy * bend;
      const controlY = (startY + endY) / 2 + ux * bend;
      context.beginPath();
      context.moveTo(startX, startY);
      context.quadraticCurveTo(controlX, controlY, endX, endY);
      context.stroke();
      const angle = Math.atan2(endY - controlY, endX - controlX);
      context.beginPath();
      context.moveTo(endX, endY);
      context.lineTo(endX - 12 * Math.cos(angle - Math.PI / 6), endY - 12 * Math.sin(angle - Math.PI / 6));
      context.lineTo(endX - 12 * Math.cos(angle + Math.PI / 6), endY - 12 * Math.sin(angle + Math.PI / 6));
      context.closePath();
      context.fillStyle = '#697176';
      context.fill();
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
                <span>入ってくる矢印 <strong>{graph.edges.filter((edge) => edge.to === selectedNode.id).length}</strong></span>
                <span>出ていく矢印 <strong>{graph.edges.filter((edge) => edge.from === selectedNode.id).length}</strong></span>
              </div>
              <button className="danger-button" type="button" onClick={deleteSelection}>要素を削除</button>
            </div>
          ) : selectedEdge ? (
            <div className="panel-section inspector">
              <div className="section-heading"><p className="panel-label">選択中の関係</p><span>矢印</span></div>
              <div className="edge-summary">
                <strong>{fromNode?.label.replaceAll('\n', ' ')}</strong>
                <span>から</span>
                <strong>{toNode?.label.replaceAll('\n', ' ')}</strong>
                <span>へ</span>
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
            <p>{tool === 'connect' ? (connectFrom ? '次に、矢印の行き先を選びます。' : '矢印の出発点になる要素を選びます。') : 'ドラッグで移動、ダブルクリックで名前を編集。空白をドラッグすると表示範囲を動かせます。'}</p>
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
              <button type="button" onClick={undo} disabled={pastRef.current.length === 0} aria-label="元に戻す">↶</button>
              <button type="button" onClick={redo} disabled={futureRef.current.length === 0} aria-label="やり直す">↷</button>
              <button type="button" onClick={deleteSelection} disabled={!selectedNodeId && !selectedEdgeId} aria-label="選択項目を削除">⌫</button>
            </div>
            <div className="toolbar-divider" />
            <button type="button" onClick={fitView}>全体表示</button>
            <button className="export-button" type="button" onClick={exportPng} disabled={graph.nodes.length === 0}>画像に保存</button>
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
                  <marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto" markerUnits="strokeWidth">
                    <path d="M 0 0 L 10 5 L 0 10 z" />
                  </marker>
                </defs>
                {graph.edges.map((edge) => {
                  const path = getEdgePath(edge, graph.nodes);
                  const selected = edge.id === selectedEdgeId;
                  return (
                    <g key={edge.id} className={selected ? 'selected' : ''}>
                      <path className="edge-hit" d={path} onClick={(event) => { event.stopPropagation(); setSelectedEdgeId(edge.id); setSelectedNodeId(null); setTool('select'); setConnectFrom(null); }} />
                      <path className="edge-line" d={path} />
                    </g>
                  );
                })}
              </svg>

              {graph.nodes.map((node) => (
                <button
                  className={`diagram-node ${node.tone} ${selectedNodeId === node.id ? 'selected' : ''} ${connectFrom === node.id ? 'connect-source' : ''}`}
                  key={node.id}
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
                  {tool === 'connect' && <i className="connection-dot" />}
                </button>
              ))}
            </div>

            {graph.nodes.length === 0 ? (
              <button className="empty-state" type="button" onClick={() => addNode()}>
                <strong>最初の要素を追加</strong>
                <span>ここから考えをつないでいきましょう</span>
              </button>
            ) : (
              <p className="canvas-hint">空白をダブルクリックして追加 ・ ⌘ / Ctrl + ホイールで拡大縮小</p>
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
      <span className="sr-only" aria-hidden="true">{historyVersion}</span>
    </main>
  );
}
