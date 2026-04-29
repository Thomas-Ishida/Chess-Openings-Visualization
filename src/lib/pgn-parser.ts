import { Chess, type Square } from 'chess.js'

import { applyUciMove, createChessFromOpening, type OpeningDefinition } from './chess-heatmap'
import {
  createEmptyTrieNode,
  createOpeningBundles,
  deserializeTrieNode,
  mergeTrieNode,
  serializeTrieNode,
  type OpeningTreeBranch,
  type OpeningTrieBundle,
  type PgnFileCachePayload,
  type PgnGameResult,
  type PgnProgressSnapshot,
  type PgnTrieNode,
} from './opening-tree-types'

const CACHE_VERSION = 4
const CACHE_PREFIX = 'opening_tree_cache'
const CHUNK_SIZE = 200

export async function parsePgnTextToBundles(
  fileName: string,
  pgnText: string,
  openings: OpeningDefinition[],
  onProgress?: (progress: PgnProgressSnapshot) => void,
): Promise<{ bundles: OpeningTrieBundle[]; totalGames: number }> {
  const normalizedOpenings = openings.map((opening) => {
    const chess = new Chess()
    const sanMoves: string[] = []
    for (const move of opening.moves) {
      try {
        const result = chess.move(move)
        if (!result) break
        sanMoves.push(normalizeSan(result.san))
      } catch {
        console.warn(`Skipping invalid move "${move}" in opening: ${opening.name}`)
        break
      }
    }
    return { opening, sanMoves }
  })

  const bundles = createOpeningBundles(openings)
  const games = splitGames(pgnText)
  const startedAt = performance.now()

  for (let index = 0; index < games.length; index += CHUNK_SIZE) {
    const chunk = games.slice(index, index + CHUNK_SIZE)
    for (const game of chunk) {
      consumeGame(game, bundles, normalizedOpenings)
    }

    onProgress?.({
      fileName,
      done: Math.min(index + CHUNK_SIZE, games.length),
      total: games.length,
      rate: Math.min(index + CHUNK_SIZE, games.length) / Math.max((performance.now() - startedAt) / 1000, 0.001),
    })

    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }

  return { bundles, totalGames: games.length }
}

export function saveParsedFileCache(
  fileName: string,
  bundles: OpeningTrieBundle[],
  totalGames: number,
): void {
  const payload: PgnFileCachePayload = {
    version: CACHE_VERSION,
    fileName,
    totalGames,
    openings: bundles.map((bundle) => ({
      openingId: bundle.openingId,
      openingName: bundle.openingName,
      trie: serializeTrieNode(bundle.trie),
    })),
  }

  localStorage.setItem(cacheKey(fileName), JSON.stringify(payload))
}

export function loadParsedFileCache(fileName: string): {
  bundles: OpeningTrieBundle[]
  totalGames: number
} | null {
  const raw = localStorage.getItem(cacheKey(fileName))
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw) as PgnFileCachePayload
    if (parsed.version !== CACHE_VERSION || parsed.fileName !== fileName) return null
    return {
      totalGames: parsed.totalGames,
      bundles: parsed.openings.map((entry) => ({
        openingId: entry.openingId,
        openingName: entry.openingName,
        trie: deserializeTrieNode(entry.trie),
      })),
    }
  } catch {
    return null
  }
}

export function removeParsedFileCache(fileName: string): void {
  localStorage.removeItem(cacheKey(fileName))
}

export function mergeOpeningBundles(
  into: OpeningTrieBundle[],
  incoming: OpeningTrieBundle[],
): OpeningTrieBundle[] {
  const incomingById = new Map(incoming.map((bundle) => [bundle.openingId, bundle]))
  return into.map((bundle) => {
    const matching = incomingById.get(bundle.openingId)
    if (!matching) return bundle
    mergeTrieNode(bundle.trie, matching.trie)
    return bundle
  })
}

export function buildOpeningTreeBranches(
  opening: OpeningDefinition,
  allBundles: OpeningTrieBundle[] | null,
  rootMoves: string[],
  maxDepth = 4,
  maxBranches = 6,
): OpeningTreeBranch[] {
  const bundle = allBundles?.find((entry) => entry.openingId === opening.id)
  if (!bundle) return []

  let rootNode: PgnTrieNode = bundle.trie
  for (const move of rootMoves) {
    const child = rootNode.children.get(move)
    if (!child) return []
    rootNode = child
  }

  const chess = createChessFromOpening(opening, rootMoves)
  const total = rootNode.w + rootNode.b + rootNode.d

  return buildBranchesRecursive(rootNode, chess, total, [], [], maxDepth, maxBranches)
}

function buildBranchesRecursive(
  node: PgnTrieNode,
  chess: Chess,
  parentTotal: number,
  path: string[],
  sanPath: string[],
  remainingDepth: number,
  maxBranches: number,
): OpeningTreeBranch[] {
  if (remainingDepth <= 0) return []

  return [...node.children.entries()]
    .sort((left, right) => countNode(right[1]) - countNode(left[1]))
    .slice(0, maxBranches)
    .flatMap(([uci, child]) => {
      const childChess = new Chess(chess.fen())
      const move = applyUciMove(childChess, uci)
      if (!move) return []

      const childTotal = countNode(child)
      const frequency = parentTotal > 0 ? (childTotal / parentTotal) * 100 : 0
      const nextPath = [...path, uci]
      const nextSanPath = [...sanPath, move.san]

      return [
        {
          uci,
          san: move.san,
          path: nextPath,
          sanPath: nextSanPath,
          games: childTotal,
          frequency,
          winRate: toWinRate(child),
          children: buildBranchesRecursive(
            child,
            childChess,
            childTotal,
            nextPath,
            nextSanPath,
            remainingDepth - 1,
            maxBranches,
          ),
        },
      ]
    })
}

function splitGames(pgn: string): string[] {
  return pgn
    .split(/(?=\[Event\s+")/g)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
}

function consumeGame(
  game: string,
  bundles: OpeningTrieBundle[],
  normalizedOpenings: Array<{ opening: OpeningDefinition; sanMoves: string[] }>,
): void {
  const result = parseGameResult(game)
  if (!result) return
  const sanTokens = tokenizeMoves(game)
  if (sanTokens.length === 0) return
  const normalizedHistory = sanTokens.map(normalizeSan)

  let bestMatch: { entry: typeof normalizedOpenings[0]; index: number } | null = null

  normalizedOpenings.forEach((entry, index) => {
    if (normalizedHistory.length < entry.sanMoves.length) return
    for (let i = 0; i < entry.sanMoves.length; i += 1) {
      if (normalizedHistory[i] !== entry.sanMoves[i]) return
    }
    if (!bestMatch || entry.sanMoves.length > bestMatch.entry.sanMoves.length) {
      bestMatch = { entry, index }
    }
  })

  if (bestMatch) {
    const { entry, index } = bestMatch as {
      entry: { opening: OpeningDefinition; sanMoves: string[] }
      index: number
    }
    const branchMoves = parseBranchMoves(entry.opening, sanTokens, entry.sanMoves.length, 4)
    insertIntoTrie(bundles[index].trie, branchMoves, result)
  }
}

function parseGameResult(game: string): PgnGameResult | null {
  const match = game.match(/\[Result\s+"([^"]+)"\]/)
  const token = match?.[1] ?? game.match(/\b(1-0|0-1|1\/2-1\/2)\b/)?.[1]
  if (!token) return null
  if (token === '1-0') return 'w'
  if (token === '0-1') return 'b'
  if (token === '1/2-1/2') return 'd'
  return null
}

function insertIntoTrie(root: PgnTrieNode, moves: string[], result: PgnGameResult): void {
  incrementNode(root, result)
  let current = root
  for (const uci of moves) {
    if (!current.children.has(uci)) {
      current.children.set(uci, createEmptyTrieNode())
    }
    current = current.children.get(uci)!
    incrementNode(current, result)
  }
}

function incrementNode(node: PgnTrieNode, result: PgnGameResult): void {
  if (result === 'w') node.w += 1
  else if (result === 'b') node.b += 1
  else node.d += 1
}

function normalizeSan(san: string): string {
  return san.replace(/[+#?!]/g, '')
}

function tokenizeMoves(game: string): string[] {
  const body = game.replace(/\[.*?\]/g, ' ')
  const withoutComments = body
    .replace(/\{[^}]*\}/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\$\d+/g, ' ')

  return withoutComments
    .split(/\s+/)
    .map((token) => stripMoveNumberPrefix(token.trim()))
    .filter(Boolean)
    .filter((token) => !/^\d+\.(\.\.)?$/.test(token))
    .filter((token) => token !== '*' && token !== '1-0' && token !== '0-1' && token !== '1/2-1/2')
}

function parseBranchMoves(
  opening: OpeningDefinition,
  sanTokens: string[],
  startIndex: number,
  maxDepth: number,
): string[] {
  const chess = createChessFromOpening(opening, [])
  const branchMoves: string[] = []

  for (let index = startIndex; index < sanTokens.length && branchMoves.length < maxDepth; index += 1) {
    const token = sanitizeSanTokenForMove(sanTokens[index])
    if (!token) break

    try {
      const move = chess.move(token)
      if (!move) break
      branchMoves.push(`${move.from}${move.to}${move.promotion ?? ''}`)
    } catch {
      break
    }
  }

  return branchMoves
}

function sanitizeSanTokenForMove(token: string): string {
  return token
    .replace(/[?!+#]+$/g, '')
    .replace(/e\.p\./gi, '')
    .trim()
}

function stripMoveNumberPrefix(token: string): string {
  return token.replace(/^\d+\.(\.\.)?/, '')
}

function countNode(node: PgnTrieNode): number {
  return node.w + node.b + node.d
}

function toWinRate(node: PgnTrieNode): [number, number, number] {
  const total = countNode(node)
  if (total === 0) return [33, 34, 33]
  return [
    Math.round((node.w / total) * 100),
    Math.round((node.d / total) * 100),
    Math.round((node.b / total) * 100),
  ]
}

function cacheKey(fileName: string): string {
  return `${CACHE_PREFIX}_v${CACHE_VERSION}_${fileName}`
}

export function parseUciMove(uci: string): { from: Square; to: Square; promotion?: string } {
  return {
    from: uci.slice(0, 2) as Square,
    to: uci.slice(2, 4) as Square,
    promotion: uci.length > 4 ? uci.slice(4) : undefined,
  }
}