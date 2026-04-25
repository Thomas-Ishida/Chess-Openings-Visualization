import type { OpeningDefinition } from './chess-heatmap'

export type PgnGameResult = 'w' | 'b' | 'd'

export interface PgnTrieNode {
  w: number
  b: number
  d: number
  children: Map<string, PgnTrieNode>
}

export interface SerializedPgnTrieNode {
  w: number
  b: number
  d: number
  c: Record<string, SerializedPgnTrieNode>
}

export interface OpeningTrieBundle {
  openingId: string
  openingName: string
  trie: PgnTrieNode
}

export interface PgnFileCachePayload {
  version: number
  fileName: string
  totalGames: number
  openings: Array<{
    openingId: string
    openingName: string
    trie: SerializedPgnTrieNode
  }>
}

export interface PgnProgressSnapshot {
  fileName: string
  done: number
  total: number
  rate: number
}

export interface TreePathSelection {
  moves: string[]
  sanLine: string[]
}

export interface OpeningTreeBranch {
  uci: string
  san: string
  path: string[]
  sanPath: string[]
  games: number
  frequency: number
  winRate: [number, number, number]
  children: OpeningTreeBranch[]
}

export function createEmptyTrieNode(): PgnTrieNode {
  return { w: 0, b: 0, d: 0, children: new Map() }
}

export function createOpeningBundles(
  openings: OpeningDefinition[],
): OpeningTrieBundle[] {
  return openings.map((opening) => ({
    openingId: opening.id,
    openingName: opening.name,
    trie: createEmptyTrieNode(),
  }))
}

export function mergeTrieNode(into: PgnTrieNode, incoming: PgnTrieNode): void {
  into.w += incoming.w
  into.b += incoming.b
  into.d += incoming.d

  for (const [uci, child] of incoming.children) {
    if (!into.children.has(uci)) {
      into.children.set(uci, createEmptyTrieNode())
    }
    mergeTrieNode(into.children.get(uci)!, child)
  }
}

export function serializeTrieNode(node: PgnTrieNode): SerializedPgnTrieNode {
  const serialized: SerializedPgnTrieNode = { w: node.w, b: node.b, d: node.d, c: {} }
  for (const [uci, child] of node.children) {
    serialized.c[uci] = serializeTrieNode(child)
  }
  return serialized
}

export function deserializeTrieNode(node: SerializedPgnTrieNode): PgnTrieNode {
  const deserialized: PgnTrieNode = createEmptyTrieNode()
  deserialized.w = node.w
  deserialized.b = node.b
  deserialized.d = node.d

  for (const [uci, child] of Object.entries(node.c ?? {})) {
    deserialized.children.set(uci, deserializeTrieNode(child))
  }

  return deserialized
}
