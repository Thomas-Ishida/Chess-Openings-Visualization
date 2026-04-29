import { describe, expect, it } from 'vitest'

import type { OpeningDefinition } from './chess-heatmap'
import { buildOpeningTreeBranches, parsePgnTextToBundles } from './pgn-parser'

const openings: OpeningDefinition[] = [
  {
    id: 'ruy-lopez',
    name: 'Ruy Lopez',
    eco: 'C60',
    moves: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5'],
    description: '',
    ideas: [],
    commonMistakes: [],
  },
]

const samplePgn = `[Event "Game 1"]
[Result "1-0"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 1-0

[Event "Game 2"]
[Result "0-1"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 Nf6 0-1
`

const compactPgn = `[Site "Local"]
[Date "2026.04.24"]

1.e4 e5 2.Nf3 Nc6 3.Bb5 a6 1-0
`

describe('pgn parser', () => {
  it('builds opening tries from PGN and returns branches', async () => {
    const parsed = await parsePgnTextToBundles('sample.pgn', samplePgn, openings)
    const branches = buildOpeningTreeBranches(openings[0], parsed.bundles, [])

    expect(parsed.totalGames).toBe(2)
    expect(branches).toHaveLength(2)
    expect(branches.map((branch) => branch.uci).sort()).toEqual(['a7a6', 'g8f6'])
  })

  it('keeps path metadata for replay wiring', async () => {
    const parsed = await parsePgnTextToBundles('sample.pgn', samplePgn, openings)
    const branches = buildOpeningTreeBranches(openings[0], parsed.bundles, [], 4, 6)
    const first = branches[0]

    expect(first.path).toHaveLength(1)
    expect(first.path[0]).toBe(first.uci)
    expect(first.sanPath).toHaveLength(1)
  })

  it('parses compact SAN tokens like 1.e4 format', async () => {
    const parsed = await parsePgnTextToBundles('compact.pgn', compactPgn, openings)
    const branches = buildOpeningTreeBranches(openings[0], parsed.bundles, [])
    expect(parsed.totalGames).toBe(1)
    expect(branches.some((branch) => branch.uci === 'a7a6')).toBe(true)
  })
})
