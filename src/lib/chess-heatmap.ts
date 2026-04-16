import { Chess, type Color, type PieceSymbol, type Square } from 'chess.js'

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const
const RANKS = ['1', '2', '3', '4', '5', '6', '7', '8'] as const

export const BOARD_SQUARES = RANKS.flatMap((rank) =>
  FILES.map((file) => `${file}${rank}` as Square),
)

export type HeatmapMode = 'white' | 'black' | 'difference'

export interface OpeningDefinition {
  id: string
  name: string
  eco: string
  moves: string[]
  description: string
  ideas: string[]
  commonMistakes: string[]
}

export interface PiecePlacement {
  square: Square
  color: Color
  type: PieceSymbol
}

export interface SquareAttacker {
  color: Color
  from: Square
  type: PieceSymbol
}

export interface SquareControl {
  square: Square
  whiteCount: number
  blackCount: number
  difference: number
  totalPressure: number
  whiteAttackers: SquareAttacker[]
  blackAttackers: SquareAttacker[]
}

export interface PositionSnapshot {
  fen: string
  moveSequence: string[]
  turn: Color
  fullmoveNumber: number
  pieces: PiecePlacement[]
  controlMap: Record<Square, SquareControl>
  controls: SquareControl[]
  maxWhiteControl: number
  maxBlackControl: number
  maxAbsDifference: number
}

interface Coordinates {
  x: number
  y: number
}

const KNIGHT_STEPS: Coordinates[] = [
  { x: -2, y: -1 },
  { x: -2, y: 1 },
  { x: -1, y: -2 },
  { x: -1, y: 2 },
  { x: 1, y: -2 },
  { x: 1, y: 2 },
  { x: 2, y: -1 },
  { x: 2, y: 1 },
]

const KING_STEPS: Coordinates[] = [
  { x: -1, y: -1 },
  { x: -1, y: 0 },
  { x: -1, y: 1 },
  { x: 0, y: -1 },
  { x: 0, y: 1 },
  { x: 1, y: -1 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
]

const BISHOP_DIRECTIONS: Coordinates[] = [
  { x: -1, y: -1 },
  { x: -1, y: 1 },
  { x: 1, y: -1 },
  { x: 1, y: 1 },
]

const ROOK_DIRECTIONS: Coordinates[] = [
  { x: -1, y: 0 },
  { x: 1, y: 0 },
  { x: 0, y: -1 },
  { x: 0, y: 1 },
]

export function buildPositionSnapshot(opening: OpeningDefinition): PositionSnapshot {
  const chess = new Chess()

  for (const move of opening.moves) {
    const result = chess.move(move)

    if (!result) {
      throw new Error(`Unable to apply move "${move}" for ${opening.name}.`)
    }
  }

  const pieces = getPiecePlacements(chess)
  const controlMap = createEmptyControlMap()

  for (const piece of pieces) {
    const attackedSquares = getPseudoLegalAttacks(piece, chess)

    for (const targetSquare of attackedSquares) {
      const currentSquare = controlMap[targetSquare]
      const attacker = {
        color: piece.color,
        from: piece.square,
        type: piece.type,
      }

      if (piece.color === 'w') {
        currentSquare.whiteCount += 1
        currentSquare.whiteAttackers.push(attacker)
      } else {
        currentSquare.blackCount += 1
        currentSquare.blackAttackers.push(attacker)
      }
    }
  }

  const controls = BOARD_SQUARES.map((square) => {
    const currentSquare = controlMap[square]

    currentSquare.difference = currentSquare.whiteCount - currentSquare.blackCount
    currentSquare.totalPressure =
      currentSquare.whiteCount + currentSquare.blackCount

    return currentSquare
  })

  return {
    fen: chess.fen(),
    moveSequence: opening.moves,
    turn: chess.turn(),
    fullmoveNumber: chess.moveNumber(),
    pieces,
    controlMap,
    controls,
    maxWhiteControl: Math.max(...controls.map((control) => control.whiteCount), 0),
    maxBlackControl: Math.max(...controls.map((control) => control.blackCount), 0),
    maxAbsDifference: Math.max(
      ...controls.map((control) => Math.abs(control.difference)),
      0,
    ),
  }
}

export function formatMoveLine(moves: string[]): string {
  return moves.reduce((line, move, index) => {
    const moveNumber = Math.floor(index / 2) + 1
    const prefix = index % 2 === 0 ? `${moveNumber}. ` : ''
    const separator = index === moves.length - 1 ? '' : ' '

    return `${line}${prefix}${move}${separator}`
  }, '')
}

export function describePiece(type: PieceSymbol): string {
  const names: Record<PieceSymbol, string> = {
    p: 'Pawn',
    n: 'Knight',
    b: 'Bishop',
    r: 'Rook',
    q: 'Queen',
    k: 'King',
  }

  return names[type]
}

export function squareToCoordinates(square: Square): Coordinates {
  const file = square.charCodeAt(0) - 97
  const rank = Number(square[1]) - 1

  return { x: file, y: rank }
}

export function coordinatesToSquare(x: number, y: number): Square | null {
  if (x < 0 || x > 7 || y < 0 || y > 7) {
    return null
  }

  return `${FILES[x]}${RANKS[y]}` as Square
}

function createEmptyControlMap(): Record<Square, SquareControl> {
  return BOARD_SQUARES.reduce(
    (map, square) => {
      map[square] = {
        square,
        whiteCount: 0,
        blackCount: 0,
        difference: 0,
        totalPressure: 0,
        whiteAttackers: [],
        blackAttackers: [],
      }

      return map
    },
    {} as Record<Square, SquareControl>,
  )
}

function getPiecePlacements(chess: Chess): PiecePlacement[] {
  return BOARD_SQUARES.flatMap((square) => {
    const piece = chess.get(square)

    if (!piece) {
      return []
    }

    return [
      {
        square,
        color: piece.color,
        type: piece.type,
      },
    ]
  })
}

function getPseudoLegalAttacks(piece: PiecePlacement, chess: Chess): Square[] {
  switch (piece.type) {
    case 'p':
      return getPawnAttacks(piece)
    case 'n':
      return getStepAttacks(piece.square, KNIGHT_STEPS)
    case 'b':
      return getSlidingAttacks(piece.square, chess, BISHOP_DIRECTIONS)
    case 'r':
      return getSlidingAttacks(piece.square, chess, ROOK_DIRECTIONS)
    case 'q':
      return getSlidingAttacks(piece.square, chess, [
        ...BISHOP_DIRECTIONS,
        ...ROOK_DIRECTIONS,
      ])
    case 'k':
      return getStepAttacks(piece.square, KING_STEPS)
    default:
      return []
  }
}

function getPawnAttacks(piece: PiecePlacement): Square[] {
  const { x, y } = squareToCoordinates(piece.square)
  const step = piece.color === 'w' ? 1 : -1

  return [-1, 1]
    .map((fileOffset) => coordinatesToSquare(x + fileOffset, y + step))
    .filter((square): square is Square => Boolean(square))
}

function getStepAttacks(square: Square, directions: Coordinates[]): Square[] {
  const { x, y } = squareToCoordinates(square)

  return directions
    .map((direction) => coordinatesToSquare(x + direction.x, y + direction.y))
    .filter((targetSquare): targetSquare is Square => Boolean(targetSquare))
}

function getSlidingAttacks(
  square: Square,
  chess: Chess,
  directions: Coordinates[],
): Square[] {
  const { x, y } = squareToCoordinates(square)
  const attacks: Square[] = []

  for (const direction of directions) {
    let step = 1

    while (true) {
      const targetSquare = coordinatesToSquare(
        x + direction.x * step,
        y + direction.y * step,
      )

      if (!targetSquare) {
        break
      }

      attacks.push(targetSquare)

      if (chess.get(targetSquare)) {
        break
      }

      step += 1
    }
  }

  return attacks
}
