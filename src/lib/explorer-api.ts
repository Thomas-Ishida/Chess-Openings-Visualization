import { Chess, type Square } from 'chess.js'

import type { OpeningDefinition } from './chess-heatmap'

const OPENING_EXPLORER_BASE_URL = 'https://explorer.lichess.ovh'
const CLOUD_EVAL_BASE_URL = 'https://lichess.org/api/cloud-eval'
const MAX_CONTINUATION_DEPTH = 3

export interface ContinuationMove {
  san: string
  uci: string
  averageRating?: number
  white: number
  draws: number
  black: number
  gameCount: number
  percentage: number
  resultingFen: string
  line: string[]
  children: ContinuationMove[]
}

export interface BookLookupResult {
  source: 'book'
  openingName?: string
  eco?: string
  white: number
  draws: number
  black: number
  totalGames: number
  moves: ContinuationMove[]
}

export interface EngineSuggestion {
  uci: string
  line: string[]
  cp?: number
  mate?: number
  resultingFen: string
}

export interface EngineLookupResult {
  source: 'engine'
  depth: number
  knodes: number
  suggestions: EngineSuggestion[]
}

interface OpeningExplorerResponse {
  opening?: {
    eco?: string
    name?: string
  }
  white: number
  draws: number
  black: number
  moves: Array<{
    uci: string
    san: string
    averageRating?: number
    white: number
    draws: number
    black: number
  }>
}

interface CloudEvalResponse {
  fen: string
  knodes: number
  depth: number
  pvs: Array<{
    moves: string
    cp?: number
    mate?: number
  }>
}

export async function fetchBookContinuations(
  fen: string,
  rootLine: string[],
  options?: {
    depth?: number
    moves?: number
    signal?: AbortSignal
  },
): Promise<BookLookupResult | null> {
  const depth = Math.min(options?.depth ?? 3, MAX_CONTINUATION_DEPTH)
  const moveLimit = options?.moves ?? 5

  const explorerResponse = await fetchExplorerNode(
    fen,
    moveLimit,
    options?.signal,
  )

  if (!explorerResponse) {
    return null
  }

  const totalGames =
    explorerResponse.white + explorerResponse.draws + explorerResponse.black

  if (totalGames === 0 || explorerResponse.moves.length === 0) {
    return null
  }

  const moves = await Promise.all(
    explorerResponse.moves.slice(0, moveLimit).map((move) =>
      buildContinuationMove(move, fen, rootLine, totalGames, depth - 1, moveLimit, options?.signal),
    ),
  )

  return {
    source: 'book',
    openingName: explorerResponse.opening?.name,
    eco: explorerResponse.opening?.eco,
    white: explorerResponse.white,
    draws: explorerResponse.draws,
    black: explorerResponse.black,
    totalGames,
    moves,
  }
}

export async function fetchEngineSuggestions(
  fen: string,
  signal?: AbortSignal,
): Promise<EngineLookupResult | null> {
  const url = new URL(CLOUD_EVAL_BASE_URL)
  url.searchParams.set('fen', fen)
  url.searchParams.set('multiPv', '5')

  const response = await fetch(url, { signal })

  if (response.status === 404) {
    return null
  }

  if (!response.ok) {
    throw new Error(`Engine lookup failed with status ${response.status}.`)
  }

  const payload = (await response.json()) as CloudEvalResponse
  const suggestions = payload.pvs.map((variation) => {
    const line = variation.moves.split(' ').filter(Boolean)
    const resultingFen = applyUciMoves(fen, line)

    return {
      uci: line[0] ?? '',
      line,
      cp: variation.cp,
      mate: variation.mate,
      resultingFen,
    }
  })

  return {
    source: 'engine',
    depth: payload.depth,
    knodes: payload.knodes,
    suggestions: suggestions.filter((suggestion) => suggestion.uci !== ''),
  }
}

export function buildInitialMoveHistory(opening: OpeningDefinition): string[] {
  const chess = new Chess()
  const history: string[] = []

  for (const move of opening.moves) {
    const result = chess.move(move)

    if (!result) {
      throw new Error(`Unable to apply move "${move}" for ${opening.name}.`)
    }

    history.push(result.san)
  }

  return history
}

async function fetchExplorerNode(
  fen: string,
  moves: number,
  signal?: AbortSignal,
): Promise<OpeningExplorerResponse | null> {
  const url = new URL('/masters', OPENING_EXPLORER_BASE_URL)
  url.searchParams.set('fen', fen)
  url.searchParams.set('moves', String(moves))
  url.searchParams.set('topGames', '0')
  url.searchParams.set('recentGames', '0')

  const response = await fetch(url, {
    signal,
    headers: {
      Accept: 'application/json',
    },
  })

  if (response.status === 401 || response.status === 404) {
    return null
  }

  if (!response.ok) {
    throw new Error(`Opening explorer lookup failed with status ${response.status}.`)
  }

  return (await response.json()) as OpeningExplorerResponse
}

async function buildContinuationMove(
  move: OpeningExplorerResponse['moves'][number],
  fen: string,
  rootLine: string[],
  totalGames: number,
  remainingDepth: number,
  moveLimit: number,
  signal?: AbortSignal,
): Promise<ContinuationMove> {
  const nextFen = applyUciMoves(fen, [move.uci])
  const nextLine = [...rootLine, move.san]
  const gameCount = move.white + move.draws + move.black

  let children: ContinuationMove[] = []

  if (remainingDepth > 0) {
    const childResponse = await fetchExplorerNode(nextFen, moveLimit, signal)

    if (childResponse) {
      const childTotal =
        childResponse.white + childResponse.draws + childResponse.black

      children = await Promise.all(
        childResponse.moves.slice(0, moveLimit).map((childMove) =>
          buildContinuationMove(
            childMove,
            nextFen,
            nextLine,
            childTotal,
            remainingDepth - 1,
            moveLimit,
            signal,
          ),
        ),
      )
    }
  }

  return {
    san: move.san,
    uci: move.uci,
    averageRating: move.averageRating,
    white: move.white,
    draws: move.draws,
    black: move.black,
    gameCount,
    percentage: totalGames > 0 ? (gameCount / totalGames) * 100 : 0,
    resultingFen: nextFen,
    line: nextLine,
    children,
  }
}

function applyUciMoves(startingFen: string, uciMoves: string[]): string {
  const chess = new Chess(startingFen)

  for (const uciMove of uciMoves) {
    const from = uciMove.slice(0, 2) as Square
    const to = uciMove.slice(2, 4) as Square
    const promotion = uciMove.length > 4 ? uciMove[4] : undefined

    const result = chess.move({ from, to, promotion })

    if (!result) {
      break
    }
  }

  return chess.fen()
}
