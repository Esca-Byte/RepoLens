import type { GraphEdge, GraphNode } from './types';
import type { CanvasPoint } from './canvasLayout';

function escapeXml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

function nodeSize(node: GraphNode): { width: number; height: number } {
  if (node.kind === 'external') return { width: 154, height: 72 };
  if (node.id.startsWith('domain:')) return { width: 202, height: 100 };
  if (node.id.startsWith('api:')) return { width: 182, height: 88 };
  if (node.id.startsWith('function:') || node.kind === 'file') return { width: 176, height: 88 };
  return { width: 190, height: 96 };
}

function colorFor(node: GraphNode): string {
  if (node.kind === 'external') return '#f6b86a';
  if (node.id.startsWith('api:')) return '#6fd4c3';
  if (node.id.startsWith('function:')) return '#73d6ab';
  if (node.kind === 'file') return '#70a9ff';
  if (node.id.startsWith('domain:') || node.score >= 8) return '#ad91ff';
  return '#7185dc';
}

export function mapAsJson(nodes: GraphNode[], edges: GraphEdge[], positions: Record<string, CanvasPoint>): string {
  return JSON.stringify({ exportedAt: new Date().toISOString(), nodes, edges, positions }, null, 2);
}

export function mapAsSvg(nodes: GraphNode[], edges: GraphEdge[], positions: Record<string, CanvasPoint>): string {
  const padding = 80;
  const bounds = nodes.reduce((value, node) => {
    const position = positions[node.id] ?? { x: 0, y: 0 };
    const size = nodeSize(node);
    return {
      minX: Math.min(value.minX, position.x),
      minY: Math.min(value.minY, position.y),
      maxX: Math.max(value.maxX, position.x + size.width),
      maxY: Math.max(value.maxY, position.y + size.height),
    };
  }, { minX: 0, minY: 0, maxX: 1000, maxY: 700 });
  const width = bounds.maxX - bounds.minX + padding * 2;
  const height = bounds.maxY - bounds.minY + padding * 2;
  const translate = (point: CanvasPoint) => ({ x: point.x - bounds.minX + padding, y: point.y - bounds.minY + padding });
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const edgeMarkup = edges.map((edge) => {
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (!source || !target) return '';
    const sourcePosition = translate(positions[source.id] ?? { x: 0, y: 0 });
    const targetPosition = translate(positions[target.id] ?? { x: 0, y: 0 });
    const sourceSize = nodeSize(source);
    const targetSize = nodeSize(target);
    const x1 = sourcePosition.x + sourceSize.width / 2;
    const y1 = sourcePosition.y + sourceSize.height / 2;
    const x2 = targetPosition.x + targetSize.width / 2;
    const y2 = targetPosition.y + targetSize.height / 2;
    return `<path d="M ${x1} ${y1} L ${x2} ${y2}" fill="none" stroke="#667493" stroke-width="2" opacity=".7" marker-end="url(#arrow)"/>`;
  }).join('');
  const nodeMarkup = nodes.map((node) => {
    const position = translate(positions[node.id] ?? { x: 0, y: 0 });
    const size = nodeSize(node);
    const color = colorFor(node);
    return `<g><rect x="${position.x}" y="${position.y}" width="${size.width}" height="${size.height}" rx="12" fill="#141b2d" stroke="${color}" stroke-width="2"/><rect x="${position.x}" y="${position.y}" width="5" height="${size.height}" rx="3" fill="${color}"/><text x="${position.x + 16}" y="${position.y + 24}" fill="${color}" font-family="Arial, sans-serif" font-size="10" font-weight="700">${escapeXml(node.kind.toUpperCase())}</text><text x="${position.x + 16}" y="${position.y + 49}" fill="#e8edf7" font-family="Arial, sans-serif" font-size="14" font-weight="700">${escapeXml(node.label)}</text><text x="${position.x + 16}" y="${position.y + 69}" fill="#a0acc4" font-family="monospace" font-size="10">${escapeXml(node.path)}</text></g>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L6,3 z" fill="#667493"/></marker></defs><rect width="100%" height="100%" fill="#080c17"/>${edgeMarkup}${nodeMarkup}</svg>`;
}

export function downloadTextFile(filename: string, content: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function downloadSvgAsPng(filename: string, svg: string): Promise<void> {
  const svgUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const image = new Image();
    image.src = svgUrl;
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('The map image could not be created.'));
    });
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth || image.width;
    canvas.height = image.naturalHeight || image.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('The map image could not be created.');
    context.fillStyle = '#080c17';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0);
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!png) throw new Error('The map image could not be created.');
    const pngUrl = URL.createObjectURL(png);
    const anchor = document.createElement('a');
    anchor.href = pngUrl;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(pngUrl);
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}
