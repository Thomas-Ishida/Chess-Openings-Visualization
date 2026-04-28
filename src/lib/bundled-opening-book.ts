// import { Chess } from 'chess.js'

// import openingsData from '../data/openings.json'
// import { applyUciMove, createChessFromOpening, type OpeningDefinition } from './chess-heatmap'

// export interface BundledExplorerMove {
//   uci: string
//   san: string
//   averageRating?: number
//   white: number
//   draws: number
//   black: number
//   resultingFen: string
//   children: BundledExplorerMove[]
// }

// export interface BundledBookPosition {
//   openingName?: string
//   eco?: string
//   white: number
//   draws: number
//   black: number
//   moves: BundledExplorerMove[]
// }

// type SeedProfile = 'balanced' | 'whiteEdge' | 'blackCounter'

// interface SeedMove {
//   move: string
//   total: number
//   profile?: SeedProfile
//   children?: SeedMove[]
// }

// interface SeedOpeningBook {
//   openingId: string
//   moves: SeedMove[]
// }

// const openings = openingsData as OpeningDefinition[]

// const PROFILES: Record<SeedProfile, { white: number; draws: number; black: number }> = {
//   balanced: { white: 0.34, draws: 0.36, black: 0.3 },
//   whiteEdge: { white: 0.39, draws: 0.34, black: 0.27 },
//   blackCounter: { white: 0.28, draws: 0.34, black: 0.38 },
// }

// const SEEDED_BOOKS: SeedOpeningBook[] = [
//   {
//     openingId: 'italian-game',
//     moves: [
//       {
//         move: 'd7d6',
//         total: 1560,
//         profile: 'balanced',
//         children: [
//           { move: 'e1g1', total: 620, profile: 'balanced' },
//           { move: 'c4b3', total: 340, profile: 'whiteEdge' },
//           { move: 'b1d2', total: 250, profile: 'balanced' },
//           { move: 'a2a4', total: 190, profile: 'whiteEdge' },
//           { move: 'c1e3', total: 160, profile: 'whiteEdge' },
//         ],
//       },
//       {
//         move: 'e8g8',
//         total: 1360,
//         profile: 'balanced',
//         children: [
//           { move: 'e1g1', total: 470, profile: 'balanced' },
//           { move: 'c4b3', total: 310, profile: 'whiteEdge' },
//           { move: 'b1d2', total: 230, profile: 'balanced' },
//           { move: 'a2a4', total: 190, profile: 'whiteEdge' },
//           { move: 'h2h3', total: 160, profile: 'balanced' },
//         ],
//       },
//       {
//         move: 'a7a6',
//         total: 980,
//         profile: 'balanced',
//         children: [
//           { move: 'a2a4', total: 290, profile: 'whiteEdge' },
//           { move: 'c4b3', total: 250, profile: 'whiteEdge' },
//           { move: 'e1g1', total: 200, profile: 'balanced' },
//           { move: 'b1d2', total: 140, profile: 'balanced' },
//           { move: 'c1e3', total: 100, profile: 'whiteEdge' },
//         ],
//       },
//       {
//         move: 'd7d5',
//         total: 710,
//         profile: 'blackCounter',
//         children: [
//           { move: 'e4d5', total: 260, profile: 'balanced' },
//           { move: 'c4b5', total: 170, profile: 'whiteEdge' },
//           { move: 'e1g1', total: 120, profile: 'balanced' },
//           { move: 'b1d2', total: 90, profile: 'balanced' },
//           { move: 'd3d4', total: 70, profile: 'whiteEdge' },
//         ],
//       },
//       {
//         move: 'h7h6',
//         total: 390,
//         profile: 'whiteEdge',
//         children: [
//           { move: 'c4b3', total: 120, profile: 'whiteEdge' },
//           { move: 'e1g1', total: 100, profile: 'balanced' },
//           { move: 'b1d2', total: 70, profile: 'balanced' },
//           { move: 'a2a4', total: 60, profile: 'whiteEdge' },
//           { move: 'h2h3', total: 40, profile: 'balanced' },
//         ],
//       },
//     ],
//   },
//   {
//     openingId: 'london-system',
//     moves: [
//       {
//         move: 'e8g8',
//         total: 1580,
//         profile: 'balanced',
//         children: [
//           { move: 'f1d3', total: 560, profile: 'whiteEdge' },
//           { move: 'b1d2', total: 380, profile: 'balanced' },
//           { move: 'c2c3', total: 260, profile: 'balanced' },
//           { move: 'f1e2', total: 210, profile: 'balanced' },
//           { move: 'f3e5', total: 170, profile: 'whiteEdge' },
//         ],
//       },
//       {
//         move: 'c7c5',
//         total: 1320,
//         profile: 'balanced',
//         children: [
//           { move: 'c2c3', total: 470, profile: 'balanced' },
//           { move: 'f1d3', total: 310, profile: 'whiteEdge' },
//           { move: 'f1e2', total: 220, profile: 'balanced' },
//           { move: 'b1d2', total: 180, profile: 'balanced' },
//           { move: 'c2c4', total: 140, profile: 'whiteEdge' },
//         ],
//       },
//       {
//         move: 'b7b6',
//         total: 720,
//         profile: 'balanced',
//         children: [
//           { move: 'f1d3', total: 250, profile: 'whiteEdge' },
//           { move: 'b1d2', total: 170, profile: 'balanced' },
//           { move: 'c2c3', total: 120, profile: 'balanced' },
//           { move: 'f1e2', total: 100, profile: 'balanced' },
//           { move: 'c2c4', total: 80, profile: 'whiteEdge' },
//         ],
//       },
//       {
//         move: 'b8c6',
//         total: 610,
//         profile: 'balanced',
//         children: [
//           { move: 'f1d3', total: 230, profile: 'whiteEdge' },
//           { move: 'c2c3', total: 150, profile: 'balanced' },
//           { move: 'b1d2', total: 110, profile: 'balanced' },
//           { move: 'f1e2', total: 70, profile: 'balanced' },
//           { move: 'c2c4', total: 50, profile: 'whiteEdge' },
//         ],
//       },
//       {
//         move: 'd8e7',
//         total: 390,
//         profile: 'balanced',
//         children: [
//           { move: 'f1d3', total: 140, profile: 'whiteEdge' },
//           { move: 'c2c3', total: 90, profile: 'balanced' },
//           { move: 'b1d2', total: 70, profile: 'balanced' },
//           { move: 'f1e2', total: 50, profile: 'balanced' },
//           { move: 'c2c4', total: 40, profile: 'whiteEdge' },
//         ],
//       },
//     ],
//   },
//   {
//     openingId: 'french-defense',
//     moves: [
//       {
//         move: 'e4e5',
//         total: 1890,
//         profile: 'whiteEdge',
//         children: [
//           { move: 'f6d7', total: 860, profile: 'balanced' },
//           { move: 'f6e4', total: 320, profile: 'blackCounter' },
//           { move: 'b8d7', total: 240, profile: 'balanced' },
//           { move: 'h7h6', total: 260, profile: 'blackCounter' },
//           { move: 'f6g8', total: 210, profile: 'whiteEdge' },
//         ],
//       },
//       {
//         move: 'g5f6',
//         total: 860,
//         profile: 'balanced',
//         children: [
//           { move: 'e7f6', total: 410, profile: 'balanced' },
//           { move: 'g7f6', total: 220, profile: 'blackCounter' },
//           { move: 'c7c6', total: 90, profile: 'balanced' },
//           { move: 'e8g8', total: 80, profile: 'balanced' },
//           { move: 'b8d7', total: 60, profile: 'balanced' },
//         ],
//       },
//       {
//         move: 'd1d2',
//         total: 540,
//         profile: 'balanced',
//         children: [
//           { move: 'e8g8', total: 220, profile: 'balanced' },
//           { move: 'h7h6', total: 110, profile: 'blackCounter' },
//           { move: 'c7c5', total: 100, profile: 'balanced' },
//           { move: 'b8d7', total: 70, profile: 'balanced' },
//           { move: 'b7b6', total: 40, profile: 'balanced' },
//         ],
//       },
//       {
//         move: 'h2h4',
//         total: 420,
//         profile: 'whiteEdge',
//         children: [
//           { move: 'h7h6', total: 130, profile: 'balanced' },
//           { move: 'c7c5', total: 110, profile: 'balanced' },
//           { move: 'e8g8', total: 70, profile: 'balanced' },
//           { move: 'b8d7', total: 60, profile: 'balanced' },
//           { move: 'c7c6', total: 50, profile: 'balanced' },
//         ],
//       },
//       {
//         move: 'e4d5',
//         total: 290,
//         profile: 'balanced',
//         children: [
//           { move: 'e6d5', total: 130, profile: 'balanced' },
//           { move: 'f6d5', total: 70, profile: 'blackCounter' },
//           { move: 'e7d6', total: 40, profile: 'balanced' },
//           { move: 'e8g8', total: 30, profile: 'balanced' },
//           { move: 'c7c6', total: 20, profile: 'balanced' },
//         ],
//       },
//     ],
//   },
//   {
//     openingId: 'sicilian-defense',
//     moves: [
//       {
//         move: 'c1e3',
//         total: 1500,
//         profile: 'balanced',
//         children: [
//           { move: 'e7e6', total: 480, profile: 'balanced' },
//           { move: 'e7e5', total: 350, profile: 'blackCounter' },
//           { move: 'b7b5', total: 260, profile: 'blackCounter' },
//           { move: 'b8d7', total: 230, profile: 'balanced' },
//           { move: 'd8c7', total: 180, profile: 'balanced' },
//         ],
//       },
//       {
//         move: 'c1g5',
//         total: 1180,
//         profile: 'balanced',
//         children: [
//           { move: 'e7e6', total: 410, profile: 'balanced' },
//           { move: 'b8d7', total: 260, profile: 'balanced' },
//           { move: 'e7e5', total: 220, profile: 'blackCounter' },
//           { move: 'b7b5', total: 180, profile: 'blackCounter' },
//           { move: 'd8c7', total: 110, profile: 'balanced' },
//         ],
//       },
//       {
//         move: 'f2f3',
//         total: 830,
//         profile: 'balanced',
//         children: [
//           { move: 'e7e5', total: 250, profile: 'blackCounter' },
//           { move: 'e7e6', total: 210, profile: 'balanced' },
//           { move: 'b7b5', total: 150, profile: 'blackCounter' },
//           { move: 'b8d7', total: 120, profile: 'balanced' },
//           { move: 'h7h5', total: 100, profile: 'blackCounter' },
//         ],
//       },
//       {
//         move: 'f1e2',
//         total: 740,
//         profile: 'balanced',
//         children: [
//           { move: 'e7e5', total: 240, profile: 'blackCounter' },
//           { move: 'e7e6', total: 180, profile: 'balanced' },
//           { move: 'b7b5', total: 130, profile: 'blackCounter' },
//           { move: 'd8c7', total: 110, profile: 'balanced' },
//           { move: 'b8d7', total: 80, profile: 'balanced' },
//         ],
//       },
//       {
//         move: 'f1c4',
//         total: 520,
//         profile: 'balanced',
//         children: [
//           { move: 'e7e6', total: 170, profile: 'balanced' },
//           { move: 'e7e5', total: 140, profile: 'blackCounter' },
//           { move: 'b7b5', total: 90, profile: 'blackCounter' },
//           { move: 'b8d7', total: 70, profile: 'balanced' },
//           { move: 'd8c7', total: 50, profile: 'balanced' },
//         ],
//       },
//     ],
//   },
//   {
//     openingId: "queens-gambit",
//     moves: [
//       {
//         move: 'e2e3',
//         total: 1560,
//         profile: 'balanced',
//         children: [
//           { move: 'e8g8', total: 520, profile: 'balanced' },
//           { move: 'h7h6', total: 260, profile: 'balanced' },
//           { move: 'b8d7', total: 320, profile: 'balanced' },
//           { move: 'c7c6', total: 250, profile: 'balanced' },
//           { move: 'b7b6', total: 210, profile: 'balanced' },
//         ],
//       },
//       {
//         move: 'g1f3',
//         total: 1290,
//         profile: 'balanced',
//         children: [
//           { move: 'e8g8', total: 430, profile: 'balanced' },
//           { move: 'h7h6', total: 220, profile: 'balanced' },
//           { move: 'b8d7', total: 250, profile: 'balanced' },
//           { move: 'c7c6', total: 210, profile: 'balanced' },
//           { move: 'b7b6', total: 180, profile: 'balanced' },
//         ],
//       },
//       {
//         move: 'c4d5',
//         total: 760,
//         profile: 'balanced',
//         children: [
//           { move: 'e6d5', total: 300, profile: 'balanced' },
//           { move: 'f6d5', total: 180, profile: 'balanced' },
//           { move: 'e8g8', total: 110, profile: 'balanced' },
//           { move: 'c7c6', total: 90, profile: 'balanced' },
//           { move: 'e7d6', total: 80, profile: 'balanced' },
//         ],
//       },
//       {
//         move: 'd1c2',
//         total: 540,
//         profile: 'balanced',
//         children: [
//           { move: 'e8g8', total: 180, profile: 'balanced' },
//           { move: 'h7h6', total: 100, profile: 'balanced' },
//           { move: 'b8d7', total: 110, profile: 'balanced' },
//           { move: 'c7c6', total: 90, profile: 'balanced' },
//           { move: 'b7b6', total: 60, profile: 'balanced' },
//         ],
//       },
//       {
//         move: 'e2e4',
//         total: 350,
//         profile: 'whiteEdge',
//         children: [
//           { move: 'd5e4', total: 150, profile: 'balanced' },
//           { move: 'e8g8', total: 80, profile: 'balanced' },
//           { move: 'h7h6', total: 50, profile: 'balanced' },
//           { move: 'c7c5', total: 40, profile: 'balanced' },
//           { move: 'b8d7', total: 30, profile: 'balanced' },
//         ],
//       },
//     ],
//   },
// ]

// const bundledIndex = buildBundledBookIndex()

// export function getBundledBookPosition(fen: string): BundledBookPosition | null {
//   return bundledIndex.get(fen) ?? null
// }

// function buildBundledBookIndex(): Map<string, BundledBookPosition> {
//   const index = new Map<string, BundledBookPosition>()

//   for (const seededBook of SEEDED_BOOKS) {
//     const opening = openings.find((candidate) => candidate.id === seededBook.openingId)

//     if (!opening) {
//       throw new Error(`Bundled book references unknown opening "${seededBook.openingId}".`)
//     }

//     const chess = createChessFromOpening(opening)
//     registerNode(index, chess.fen(), seededBook.moves, opening)
//     buildChildNodes(index, chess, seededBook.moves, opening)
//   }

//   return index
// }

// function buildChildNodes(
//   index: Map<string, BundledBookPosition>,
//   chess: ReturnType<typeof createChessFromOpening>,
//   moves: SeedMove[],
//   opening: OpeningDefinition,
// ) {
//   for (const seedMove of moves) {
//     if (!seedMove.children || seedMove.children.length === 0) {
//       continue
//     }

//     const nextChess = new Chess(chess.fen())
//     const nextMove = applyUciMove(nextChess, seedMove.move)

//     if (!nextMove) {
//       throw new Error(
//         `Invalid bundled move "${seedMove.move}" while building ${opening.name}.`,
//       )
//     }

//     registerNode(index, nextChess.fen(), seedMove.children, opening)
//     buildChildNodes(index, nextChess, seedMove.children, opening)
//   }
// }

// function registerNode(
//   index: Map<string, BundledBookPosition>,
//   fen: string,
//   moves: SeedMove[],
//   opening: OpeningDefinition,
// ) {
//   const response = buildExplorerResponse(fen, moves, opening)
//   index.set(fen, response)
// }

// function buildExplorerResponse(
//   fen: string,
//   moves: SeedMove[],
//   opening: OpeningDefinition,
// ): BundledBookPosition {
//   const serializedMoves = moves.map((seedMove: SeedMove) => {
//     const moveChess = new Chess(fen)
//     const moveResult = applyUciMove(moveChess, seedMove.move)

//     if (!moveResult) {
//       throw new Error(
//         `Invalid bundled move "${seedMove.move}" while serializing ${opening.name}.`,
//       )
//     }

//     const stats = buildStats(seedMove.total, seedMove.profile)

//     return {
//       uci: seedMove.move,
//       san: moveResult.san,
//       averageRating: 2200,
//       white: stats.white,
//       draws: stats.draws,
//       black: stats.black,
//       resultingFen: moveChess.fen(),
//       children: seedMove.children
//         ? buildExplorerResponse(moveChess.fen(), seedMove.children, opening).moves
//         : [],
//     }
//   })

//   const totals = serializedMoves.reduce(
//     (aggregate, move) => ({
//       white: aggregate.white + move.white,
//       draws: aggregate.draws + move.draws,
//       black: aggregate.black + move.black,
//     }),
//     { white: 0, draws: 0, black: 0 },
//   )

//   return {
//     openingName: opening.name,
//     eco: opening.eco,
//     white: totals.white,
//     draws: totals.draws,
//     black: totals.black,
//     moves: serializedMoves,
//   }
// }

// function buildStats(total: number, profile: SeedProfile = 'balanced') {
//   const ratios = PROFILES[profile]
//   const white = Math.round(total * ratios.white)
//   const draws = Math.round(total * ratios.draws)
//   const black = total - white - draws

//   return { white, draws, black }
// }
