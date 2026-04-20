import { useEffect, useMemo, useState } from 'react'

import type { Square } from 'chess.js'

import './App.css'
import openingsData from './data/openings.json'
import { ChessHeatmapBoard } from './components/ChessHeatmapBoard'
import {
  applyUciMove,
  buildPositionSnapshotFromChess,
  createChessFromOpening,
  describePiece,
  formatMoveLine,
  getLegalMovesForSquare,
  type HeatmapMode,
  type OpeningDefinition,
  type PieceEmphasisMode,
  type SquareAttacker,
  type SquareControl,
} from './lib/chess-heatmap'
import {
  fetchBookContinuations,
  fetchEngineSuggestions,
  type BookLookupResult,
  type ContinuationMove,
  type EngineSuggestion,
} from './lib/explorer-api'

const openings = openingsData as OpeningDefinition[]

const MODE_COPY: Record<
  HeatmapMode,
  { label: string; description: string; summary: string }
> = {
  white: {
    label: 'White pressure',
    description: 'Blue squares show how many White pieces influence each square.',
    summary: 'Blue intensity = more White attackers on that square.',
  },
  black: {
    label: 'Black pressure',
    description: 'Orange squares show how many Black pieces influence each square.',
    summary: 'Orange intensity = more Black attackers on that square.',
  },
  difference: {
    label: 'Whole board',
    description:
      'Blue favors White, orange favors Black, and muted gray marks balanced control.',
    summary: 'This mode reveals neutral zones and the side that owns more space overall.',
  },
}

const EMPHASIS_COPY: Record<PieceEmphasisMode, string> = {
  off: 'Off',
  continuation: 'Continuation likelihood',
  control: 'Current control',
  both: 'Both',
}

function App() {
  const [selectedOpeningId, setSelectedOpeningId] = useState(openings[0].id)
  const [mode, setMode] = useState<HeatmapMode>('white')
  const [pieceEmphasisMode, setPieceEmphasisMode] =
    useState<PieceEmphasisMode>('off')
  const [hoveredSquare, setHoveredSquare] = useState<SquareControl | null>(null)
  const [selectedSquare, setSelectedSquare] = useState<Square | null>(null)
  const [userMoves, setUserMoves] = useState<string[]>([])
  const [bookData, setBookData] = useState<BookLookupResult | null>(null)
  const [bookStatus, setBookStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>(
    'idle',
  )
  const [bookError, setBookError] = useState<string | null>(null)
  const [engineData, setEngineData] = useState<Awaited<
    ReturnType<typeof fetchEngineSuggestions>
  > | null>(null)
  const [engineStatus, setEngineStatus] = useState<
    'idle' | 'loading' | 'ready' | 'unavailable' | 'error'
  >('idle')
  const [engineError, setEngineError] = useState<string | null>(null)

  const selectedOpening = useMemo(
    () =>
      openings.find((opening) => opening.id === selectedOpeningId) ?? openings[0],
    [selectedOpeningId],
  )
  const chess = useMemo(
    () => createChessFromOpening(selectedOpening, userMoves),
    [selectedOpening, userMoves],
  )
  const snapshot = useMemo(
    () => buildPositionSnapshotFromChess(chess),
    [chess],
  )
  const currentLine = useMemo(() => {
    const chessForLine = createChessFromOpening(selectedOpening, [])
    const sanMoves = [...selectedOpening.moves]

    for (const uciMove of userMoves) {
      const move = applyUciMove(chessForLine, uciMove)
      sanMoves.push(move?.san ?? uciMove)
    }

    return sanMoves
  }, [selectedOpening, userMoves])

  useEffect(() => {
    const controller = new AbortController()

    async function loadBook() {
      setBookStatus('loading')
      setBookError(null)
      setBookData(null)
      setEngineData(null)
      setEngineStatus('idle')
      setEngineError(null)

      try {
        const result = await fetchBookContinuations(snapshot.fen, currentLine, {
          depth: 3,
          moves: 5,
          signal: controller.signal,
        })

        if (controller.signal.aborted) {
          return
        }

        if (result) {
          setBookData(result)
          setBookStatus('ready')
          return
        }

        setBookData(null)
        setBookStatus('ready')
      } catch (error) {
        if (controller.signal.aborted) {
          return
        }

        setBookStatus('error')
        setBookError(error instanceof Error ? error.message : 'Book lookup failed.')
      }
    }

    void loadBook()

    return () => {
      controller.abort()
    }
  }, [currentLine, snapshot.fen])

  useEffect(() => {
    if (bookStatus !== 'ready' || bookData) {
      return
    }

    const controller = new AbortController()

    async function loadEngine() {
      setEngineStatus('loading')
      setEngineError(null)
      setEngineData(null)

      try {
        const result = await fetchEngineSuggestions(snapshot.fen, controller.signal)

        if (controller.signal.aborted) {
          return
        }

        if (result) {
          setEngineData(result)
          setEngineStatus('ready')
        } else {
          setEngineStatus('unavailable')
          setEngineError('No cloud evaluation is available for this position.')
        }
      } catch (error) {
        if (controller.signal.aborted) {
          return
        }

        setEngineStatus('error')
        setEngineError(
          error instanceof Error ? error.message : 'Engine suggestion lookup failed.',
        )
      }
    }

    void loadEngine()

    return () => {
      controller.abort()
    }
  }, [bookData, bookStatus, snapshot.fen])

  const whiteCoverage = useMemo(
    () => snapshot.controls.filter((control) => control.whiteCount > 0).length,
    [snapshot.controls],
  )
  const blackCoverage = useMemo(
    () => snapshot.controls.filter((control) => control.blackCount > 0).length,
    [snapshot.controls],
  )
  const topWhiteSquares = useMemo(
    () => getTopSquares(snapshot.controls, 'whiteCount'),
    [snapshot.controls],
  )
  const topBlackSquares = useMemo(
    () => getTopSquares(snapshot.controls, 'blackCount'),
    [snapshot.controls],
  )
  const topContestedSquares = useMemo(
    () => getTopSquares(snapshot.controls, 'totalPressure'),
    [snapshot.controls],
  )

  const legalMovesFromSelection = useMemo(
    () =>
      selectedSquare ? getLegalMovesForSquare(snapshot, selectedSquare) : [],
    [selectedSquare, snapshot],
  )
  const legalTargets = useMemo(
    () => legalMovesFromSelection.map((move) => move.to),
    [legalMovesFromSelection],
  )

  const continuationScores = useMemo(() => {
    const scores: Partial<Record<Square, number>> = {}
    const moves = bookData?.moves ?? []

    if (moves.length === 0) {
      return scores
    }

    let maxScore = 0

    for (const move of moves) {
      const legalMove = snapshot.legalMoves.find((candidate) => candidate.uci === move.uci)

      if (legalMove) {
        scores[legalMove.from] = (scores[legalMove.from] ?? 0) + move.percentage
        maxScore = Math.max(maxScore, scores[legalMove.from] ?? 0)
        for (const child of move.children) {
          const childChess = createChessFromOpening(selectedOpening, userMoves)

          if (!applyUciMove(childChess, move.uci)) {
            continue
          }

          const childSnapshot = buildPositionSnapshotFromChess(childChess)
          const childMove = childSnapshot.legalMoves.find(
            (candidate) => candidate.uci === child.uci,
          )

          if (childMove) {
            scores[childMove.from] = (scores[childMove.from] ?? 0) + child.percentage
            maxScore = Math.max(maxScore, scores[childMove.from] ?? 0)
          }
        }
      }
    }

    if (maxScore === 0) {
      return scores
    }

    return Object.fromEntries(
      Object.entries(scores).map(([square, score]) => [square, score / maxScore]),
    ) as Partial<Record<Square, number>>
  }, [bookData, selectedOpening, snapshot.legalMoves, userMoves])

  const controlScores = useMemo(() => {
    const scores: Partial<Record<Square, number>> = {}
    let maxScore = 0

    for (const piece of snapshot.pieces) {
      const contribution = snapshot.controls.reduce((count, control) => {
        const attackers = piece.color === 'w' ? control.whiteAttackers : control.blackAttackers

        return count + attackers.filter((attacker) => attacker.from === piece.square).length
      }, 0)

      scores[piece.square] = contribution
      maxScore = Math.max(maxScore, contribution)
    }

    if (maxScore === 0) {
      return scores
    }

    return Object.fromEntries(
      Object.entries(scores).map(([square, score]) => [square, score / maxScore]),
    ) as Partial<Record<Square, number>>
  }, [snapshot.controls, snapshot.pieces])

  const pieceEmphasisMap = useMemo(() => {
    return Object.fromEntries(
      snapshot.pieces.map((piece) => {
        const continuationScore = continuationScores[piece.square] ?? 0
        const controlScore = controlScores[piece.square] ?? 0
        let score = 1

        if (pieceEmphasisMode === 'continuation') {
          score = 0.18 + continuationScore * 0.82
        } else if (pieceEmphasisMode === 'control') {
          score = 0.18 + controlScore * 0.82
        } else if (pieceEmphasisMode === 'both') {
          score = 0.18 + ((continuationScore + controlScore) / 2) * 0.82
        }

        return [piece.square, score]
      }),
    ) as Partial<Record<Square, number>>
  }, [continuationScores, controlScores, pieceEmphasisMode, snapshot.pieces])

  const inBook = Boolean(bookData && bookData.moves.length > 0)
  const canUndo = userMoves.length > 0

  function handleSelectSquare(square: Square) {
    const piece = chess.get(square)

    if (!selectedSquare) {
      if (piece && piece.color === snapshot.turn) {
        setSelectedSquare(square)
      }
      return
    }

    if (selectedSquare === square) {
      setSelectedSquare(null)
      return
    }

    const legalMove = legalMovesFromSelection.find((move) => move.to === square)

    if (legalMove) {
      setUserMoves((moves) => [...moves, legalMove.uci])
      setSelectedSquare(null)
      setHoveredSquare(null)
      return
    }

    if (piece && piece.color === snapshot.turn) {
      setSelectedSquare(square)
      return
    }

    setSelectedSquare(null)
  }

  function handleApplyContinuation(move: ContinuationMove) {
    const legalMove = snapshot.legalMoves.find((candidate) => candidate.uci === move.uci)

    if (!legalMove) {
      return
    }

    setUserMoves((moves) => [...moves, legalMove.uci])
    setSelectedSquare(null)
    setHoveredSquare(null)
  }

  function handleReset() {
    setUserMoves([])
    setSelectedSquare(null)
    setHoveredSquare(null)
  }

  function handleUndo() {
    if (!canUndo) {
      return
    }

    setUserMoves((moves) => moves.slice(0, -1))
    setSelectedSquare(null)
  }

  return (
    <div className="app-shell">
      <header className="hero-panel">
        <div className="hero-copy">
          <p className="eyebrow">Phase 2 opening explorer</p>
          <h1>Play legal moves and compare heatmaps to real-game continuations.</h1>
          <p className="hero-description">
            Start from a curated opening, move pieces legally on the board, and
            watch the heatmap, likely continuations, and out-of-book engine
            suggestions update around the live position.
          </p>
        </div>

        <div className="hero-highlights">
          <div className="highlight-card">
            <span className="highlight-label">Opening</span>
            <strong>{selectedOpening.name}</strong>
            <span>{selectedOpening.eco}</span>
          </div>
          <div className="highlight-card">
            <span className="highlight-label">View</span>
            <strong>{MODE_COPY[mode].label}</strong>
            <span>{MODE_COPY[mode].summary}</span>
          </div>
          <div className="highlight-card">
            <span className="highlight-label">Position status</span>
            <strong>{inBook ? 'In book' : 'Out of book'}</strong>
            <span>
              {inBook
                ? bookData?.source === 'book'
                  ? 'Continuation probabilities come from the live real-game explorer.'
                  : 'Continuation probabilities come from the bundled opening-book fallback.'
                : 'Showing engine suggestions because the position is outside the book.'}
            </span>
          </div>
        </div>
      </header>

      <section className="toolbar">
        <div className="toolbar-group">
          <span className="toolbar-label">Choose an opening</span>
          <div className="chip-list" role="tablist" aria-label="Available openings">
            {openings.map((opening) => (
              <button
                key={opening.id}
                type="button"
                className={`chip ${opening.id === selectedOpeningId ? 'active' : ''}`}
                onClick={() => {
                  setSelectedOpeningId(opening.id)
                  setUserMoves([])
                  setHoveredSquare(null)
                  setSelectedSquare(null)
                  setBookData(null)
                  setBookStatus('idle')
                  setBookError(null)
                  setEngineData(null)
                  setEngineStatus('idle')
                  setEngineError(null)
                }}
              >
                {opening.name}
              </button>
            ))}
          </div>
        </div>

        <div className="toolbar-group">
          <span className="toolbar-label">Heatmap mode</span>
          <div className="mode-toggle" role="tablist" aria-label="Heatmap modes">
            {(Object.keys(MODE_COPY) as HeatmapMode[]).map((viewMode) => (
              <button
                key={viewMode}
                type="button"
                className={`mode-button ${viewMode === mode ? 'active' : ''}`}
                onClick={() => setMode(viewMode)}
              >
                {MODE_COPY[viewMode].label}
              </button>
            ))}
          </div>
          <p className="toolbar-description">{MODE_COPY[mode].description}</p>
        </div>

        <div className="toolbar-group">
          <span className="toolbar-label">Piece emphasis</span>
          <div className="mode-toggle" role="tablist" aria-label="Piece emphasis modes">
            {(Object.keys(EMPHASIS_COPY) as PieceEmphasisMode[]).map((emphasisMode) => (
              <button
                key={emphasisMode}
                type="button"
                className={`mode-button ${emphasisMode === pieceEmphasisMode ? 'active' : ''}`}
                onClick={() => setPieceEmphasisMode(emphasisMode)}
              >
                {EMPHASIS_COPY[emphasisMode]}
              </button>
            ))}
          </div>
          <p className="toolbar-description">
            Continuation mode emphasizes pieces in likely next moves, while control mode
            emphasizes pieces driving the current heatmap.
          </p>
        </div>
      </section>

      <main className="content-grid">
        <section className="board-column">
          <div className="board-card">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Interactive board</p>
                <h2>{selectedOpening.name}</h2>
              </div>
              <div className="fen-block">
                <span>FEN</span>
                <code>{snapshot.fen}</code>
              </div>
            </div>

            <ChessHeatmapBoard
              snapshot={snapshot}
              mode={mode}
              hoveredSquare={hoveredSquare?.square ?? null}
              onHoverSquare={setHoveredSquare}
              selectedSquare={selectedSquare}
              legalTargets={legalTargets}
              onSelectSquare={handleSelectSquare}
              pieceEmphasisMap={pieceEmphasisMap}
            />

            <div className="board-actions">
              <button type="button" className="action-button" onClick={handleReset}>
                Reset to opening
              </button>
              <button
                type="button"
                className="action-button"
                onClick={handleUndo}
                disabled={!canUndo}
              >
                Undo move
              </button>
            </div>

            <div className="legend">
              <div className="legend-ramp legend-ramp-blue" aria-hidden="true" />
              <div className="legend-ramp legend-ramp-neutral" aria-hidden="true" />
              <div className="legend-ramp legend-ramp-orange" aria-hidden="true" />
            </div>
            <div className="legend-labels">
              <span>White control</span>
              <span>Neutral balance</span>
              <span>Black control</span>
            </div>
            <p className="small-note">
              Click a piece for the side to move, then click one of the highlighted
              targets to play a legal move.
            </p>
          </div>

          <div className="metric-grid">
            <article className="metric-card">
              <span className="metric-label">White coverage</span>
              <strong>{whiteCoverage} squares</strong>
              <p>Strongest pressure: {formatSquareList(topWhiteSquares)}</p>
            </article>

            <article className="metric-card">
              <span className="metric-label">Black coverage</span>
              <strong>{blackCoverage} squares</strong>
              <p>Strongest pressure: {formatSquareList(topBlackSquares)}</p>
            </article>

            <article className="metric-card">
              <span className="metric-label">Most contested</span>
              <strong>{formatSquareList(topContestedSquares)}</strong>
              <p>Squares with the heaviest combined pressure from both sides.</p>
            </article>
          </div>
        </section>

        <aside className="detail-column">
          <section className="detail-card">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Opening profile</p>
                <h2>{selectedOpening.name}</h2>
              </div>
              <span className="detail-badge">{selectedOpening.eco}</span>
            </div>

            <p className="detail-copy">{selectedOpening.description}</p>

            <div className="detail-group">
              <h3>Key ideas</h3>
              <ul>
                {selectedOpening.ideas.map((idea) => (
                  <li key={idea}>{idea}</li>
                ))}
              </ul>
            </div>

            <div className="detail-group">
              <h3>Typical mistakes</h3>
              <ul>
                {selectedOpening.commonMistakes.map((mistake) => (
                  <li key={mistake}>{mistake}</li>
                ))}
              </ul>
            </div>

            <div className="detail-group">
              <h3>Current line</h3>
              <p className="move-line">{formatMoveLine(currentLine)}</p>
            </div>
          </section>

          <section className="detail-card">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Continuation explorer</p>
                <h2>{inBook ? 'Real-game next moves' : 'Engine fallback'}</h2>
              </div>
              <span
                className={`detail-badge ${inBook ? 'in-book' : 'out-of-book'}`}
              >
                {bookStatus === 'loading'
                  ? 'Loading book data'
                  : inBook
                    ? bookData?.source === 'book'
                      ? 'Live book'
                      : 'Bundled book'
                    : 'Out of book'}
              </span>
            </div>

            {bookStatus === 'loading' ? (
              <p className="detail-copy">Looking up real-game continuations for this position.</p>
            ) : bookStatus === 'error' ? (
              <p className="error-text">
                {bookError ?? 'The real-game continuation service could not be reached.'}
              </p>
            ) : inBook && bookData ? (
              <div className="continuation-list">
                {bookData.moves.map((move) => (
                  <article key={move.uci} className="continuation-card">
                    <div className="card-row">
                      <div>
                        <h3>{move.san}</h3>
                        <p className="detail-copy">
                          {move.gameCount.toLocaleString()} games
                        </p>
                      </div>
                      <span className="percentage-pill">{move.percentage.toFixed(1)}%</span>
                    </div>

                    <div className="line-row">
                      <div className="move-buttons">
                        <button
                          type="button"
                          className="action-button"
                          onClick={() => handleApplyContinuation(move)}
                        >
                          Play move
                        </button>
                      </div>
                      <div className="detail-copy">
                        W {move.white} / D {move.draws} / B {move.black}
                      </div>
                    </div>

                    {move.children.length > 0 ? (
                      <ul className="subline-list">
                        {move.children.map((child) => (
                          <li key={`${move.uci}-${child.uci}`}>
                            <strong>{child.san}</strong> - {child.percentage.toFixed(1)}%
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </article>
                ))}
              </div>
            ) : engineStatus === 'loading' ? (
              <p className="detail-copy">Requesting cloud engine suggestions.</p>
            ) : engineStatus === 'ready' && engineData ? (
              <div className="analysis-list">
                {engineData.suggestions.map((suggestion, index) => (
                  <article key={`${suggestion.uci}-${index}`} className="analysis-card">
                    <div className="card-row">
                      <div>
                        <h3>Line {index + 1}</h3>
                        <p className="detail-copy">
                          {formatEngineLine(suggestion)}
                        </p>
                      </div>
                      <span className="eval-pill">
                        {formatEngineScore(suggestion)}
                      </span>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <p className="detail-copy">
                {engineError ?? 'No cloud evaluation was available for this position.'}
              </p>
            )}
          </section>

          <section className="detail-card">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Square inspector</p>
                <h2>{hoveredSquare ? hoveredSquare.square : 'Hover any square'}</h2>
              </div>
              <span className="detail-badge subtle">
                Move {snapshot.fullmoveNumber}, {snapshot.turn === 'w' ? 'White' : 'Black'} to
                move
              </span>
            </div>

            {hoveredSquare ? (
              <div className="inspector">
                <div className="inspector-metrics">
                  <div>
                    <span>White attackers</span>
                    <strong>{hoveredSquare.whiteCount}</strong>
                  </div>
                  <div>
                    <span>Black attackers</span>
                    <strong>{hoveredSquare.blackCount}</strong>
                  </div>
                  <div>
                    <span>Difference</span>
                    <strong>{hoveredSquare.difference}</strong>
                  </div>
                </div>

                <div className="attacker-columns">
                  <div>
                    <h3>White pressure</h3>
                    <ul>
                      {hoveredSquare.whiteAttackers.length > 0 ? (
                        hoveredSquare.whiteAttackers.map((attacker) => (
                          <li key={`w-${attacker.from}-${attacker.type}`}>
                            {formatAttacker(attacker)}
                          </li>
                        ))
                      ) : (
                        <li>No White attackers on this square.</li>
                      )}
                    </ul>
                  </div>

                  <div>
                    <h3>Black pressure</h3>
                    <ul>
                      {hoveredSquare.blackAttackers.length > 0 ? (
                        hoveredSquare.blackAttackers.map((attacker) => (
                          <li key={`b-${attacker.from}-${attacker.type}`}>
                            {formatAttacker(attacker)}
                          </li>
                        ))
                      ) : (
                        <li>No Black attackers on this square.</li>
                      )}
                    </ul>
                  </div>
                </div>
              </div>
            ) : (
              <p className="detail-copy">
                Hover any square on the board to inspect exactly which pieces are
                contributing pressure there.
              </p>
            )}
          </section>
        </aside>
      </main>
    </div>
  )
}

export default App

function getTopSquares(
  squareControls: SquareControl[],
  key: 'whiteCount' | 'blackCount' | 'totalPressure',
): SquareControl[] {
  const highestValue = Math.max(...squareControls.map((control) => control[key]), 0)

  if (highestValue === 0) {
    return []
  }

  return squareControls.filter((control) => control[key] === highestValue).slice(0, 3)
}

function formatSquareList(squareControls: SquareControl[]): string {
  if (squareControls.length === 0) {
    return '—'
  }

  return squareControls.map((control) => control.square).join(', ')
}

function formatAttacker(attacker: SquareAttacker): string {
  return `${describePiece(attacker.type)} from ${attacker.from}`
}

function formatEngineScore(suggestion: EngineSuggestion): string {
  if (typeof suggestion.mate === 'number') {
    return `Mate ${suggestion.mate > 0 ? 'in' : ''} ${suggestion.mate}`
  }

  if (typeof suggestion.cp === 'number') {
    const pawns = suggestion.cp / 100
    const sign = pawns > 0 ? '+' : ''
    return `${sign}${pawns.toFixed(2)}`
  }

  return 'No eval'
}

function formatEngineLine(suggestion: EngineSuggestion): string {
  return suggestion.line.join(' ')
}
