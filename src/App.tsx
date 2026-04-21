import { useMemo, useState } from 'react'

import './App.css'
import openingsData from './data/openings.json'
import { ChessHeatmapBoard } from './components/ChessHeatmapBoard'
import {
  buildPositionSnapshot,
  describePiece,
  formatMoveLine,
  type HeatmapMode,
  type OpeningDefinition,
  type SquareAttacker,
  type SquareControl,
} from './lib/chess-heatmap'

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

function App() {
  const [selectedOpeningId, setSelectedOpeningId] = useState(openings[0].id)
  const [mode, setMode] = useState<HeatmapMode>('white')
  const [hoveredSquare, setHoveredSquare] = useState<SquareControl | null>(null)

  const selectedOpening = useMemo(
    () =>
      openings.find((opening) => opening.id === selectedOpeningId) ?? openings[0],
    [selectedOpeningId],
  )

  const snapshot = useMemo(
    () => buildPositionSnapshot(selectedOpening),
    [selectedOpening],
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
  const whiteCoverage = useMemo(
    () =>
      snapshot.controls.filter((squareControl) => squareControl.whiteCount > 0).length,
    [snapshot.controls],
  )
  const blackCoverage = useMemo(
    () =>
      snapshot.controls.filter((squareControl) => squareControl.blackCount > 0).length,
    [snapshot.controls],
  )

  return (
    <div className="app-shell">
      <header className="hero-panel">
        <div className="hero-copy">
          <p className="eyebrow">Phase 1 opening explorer</p>
          <h1>See how openings claim space on the board.</h1>
          <p className="hero-description">
            Pick a curated opening line and inspect how each side pressures the
            board. The board uses pseudo-legal influence, so defended squares and
            contested central zones remain visible even before tactics are legal.
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
            <span className="highlight-label">Line</span>
            <strong>{selectedOpening.moves.length} plies</strong>
            <span>{formatMoveLine(selectedOpening.moves)}</span>
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
                  setHoveredSquare(null)
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
      </section>

      <main className="content-grid">

        {/* LEFT COLUMN */}
        <section className="left-column">
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
              <h3>Reference line</h3>
              <p className="move-line">{formatMoveLine(selectedOpening.moves)}</p>
            </div>
          </section>
        </section>

        {/* CENTER COLUMN */}
        <section className="center-column">
          <div className="board-card">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Control heatmap</p>
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
            />

            <div className="legend">
              <div className="legend-ramp legend-ramp-blue" />
              <div className="legend-ramp legend-ramp-neutral" />
              <div className="legend-ramp legend-ramp-orange" />
            </div>

            <div className="legend-labels">
              <span>White control</span>
              <span>Neutral balance</span>
              <span>Black control</span>
            </div>
          </div>
        </section>

        {/* RIGHT COLUMN */}
        <aside className="right-column">
          <section className="detail-card">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Square inspector</p>
                <h2>{hoveredSquare ? hoveredSquare.square : 'Hover any square'}</h2>
              </div>
              <span className="detail-badge subtle">
                Move {snapshot.fullmoveNumber}, {snapshot.turn === 'w' ? 'White' : 'Black'} to move
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
                Hover any square on the board to inspect exactly which pieces are contributing pressure there.
              </p>
            )}
          </section>
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
