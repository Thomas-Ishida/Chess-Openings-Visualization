import { useEffect, useMemo, useState } from 'react'

import type { Square } from 'chess.js'

import './App.css'
import openingsData from './data/openings.json'
import defaultPgnUrl from './data/lichess_elite_2025-11-top50-capped-1000.pgn?url'
import { ChessHeatmapBoard } from './components/ChessHeatmapBoard'
import { OpeningTree } from './components/OpeningTree'
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
import {
  buildOpeningTreeBranches,
  loadParsedFileCache,
  mergeOpeningBundles,
  parsePgnTextToBundles,
  saveParsedFileCache,
} from './lib/pgn-parser'
import type { OpeningTrieBundle, PgnProgressSnapshot } from './lib/opening-tree-types'

const openings = openingsData as OpeningDefinition[]
const DEFAULT_PGN_FILE_NAME = 'lichess_elite_2025-11-top50-capped-1000.pgn'

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

type SuggestionSourceMode = 'auto' | 'statistics' | 'engine'

const SUGGESTION_SOURCE_COPY: Record<SuggestionSourceMode, string> = {
  auto: 'Auto',
  statistics: 'Statistics',
  engine: 'Engine',
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
  const [selectedEngineIndex, setSelectedEngineIndex] = useState(0)
  const [suggestionSourceMode, setSuggestionSourceMode] =
    useState<SuggestionSourceMode>('auto')
  const [openingTreeEnabled, setOpeningTreeEnabled] = useState(true)
  const [openingTries, setOpeningTries] = useState<OpeningTrieBundle[] | null>(null)
  const [pgnProgress, setPgnProgress] = useState<PgnProgressSnapshot[]>([])
  const [loadedPgnFiles, setLoadedPgnFiles] = useState<string[]>([])
  const [pgnTotalGames, setPgnTotalGames] = useState(0)
  const [pgnError, setPgnError] = useState<string | null>(null)
  const [isDefaultPgnLoading, setIsDefaultPgnLoading] = useState(true)
  const [isAutoPlaying, setIsAutoPlaying] = useState(false)

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
    let cancelled = false
    let timeoutId: number | null = null

    async function loadDefaultPgnDataset() {
      setPgnError(null)
      setIsDefaultPgnLoading(true)

      try {
        const fromCache = loadParsedFileCache(DEFAULT_PGN_FILE_NAME)
        if (fromCache) {
          if (cancelled) {
            return
          }

          setOpeningTreeEnabled(true)
          setOpeningTries(fromCache.bundles)
          setLoadedPgnFiles([DEFAULT_PGN_FILE_NAME])
          setPgnTotalGames(fromCache.totalGames)
          return
        }

        const response = await fetch(defaultPgnUrl)
        if (!response.ok) {
          throw new Error(`Could not fetch ${DEFAULT_PGN_FILE_NAME}.`)
        }
        const defaultPgnText = await response.text()

        const parsed = await parsePgnTextToBundles(
          DEFAULT_PGN_FILE_NAME,
          defaultPgnText,
          openings,
          (progress) => {
            if (cancelled) {
              return
            }
            setPgnProgress((current) => {
              const next = current.filter((entry) => entry.fileName !== progress.fileName)
              next.push(progress)
              return next
            })
          },
        )
        saveParsedFileCache(DEFAULT_PGN_FILE_NAME, parsed.bundles, parsed.totalGames)

        if (cancelled) {
          return
        }

        setOpeningTreeEnabled(true)
        setOpeningTries(parsed.bundles)
        setLoadedPgnFiles([DEFAULT_PGN_FILE_NAME])
        setPgnTotalGames(parsed.totalGames)
      } catch (error) {
        if (cancelled) {
          return
        }
        setPgnError(
          error instanceof Error
            ? error.message
            : `Could not process ${DEFAULT_PGN_FILE_NAME}.`,
        )
      } finally {
        if (!cancelled) {
          setPgnProgress((current) =>
            current.filter((entry) => entry.fileName !== DEFAULT_PGN_FILE_NAME),
          )
          setIsDefaultPgnLoading(false)
        }
      }
    }

    // Defer heavy PGN parsing until after the first paint.
    timeoutId = window.setTimeout(() => {
      void loadDefaultPgnDataset()
    }, 0)

    return () => {
      cancelled = true
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId)
      }
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()

    async function loadBook() {
      setBookStatus('loading')
      setBookError(null)
      setBookData(null)
      setEngineData(null)
      setEngineStatus('idle')
      setEngineError(null)
      setSelectedEngineIndex(0)

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
  /** Full tree from the end of the book opening — stable while you navigate (does not re-root on each click). */
  const pgnTreeBranchesAtTabiya = useMemo(
    () => buildOpeningTreeBranches(selectedOpening, openingTries, []),
    [openingTries, selectedOpening],
  )
  /** One step ahead from the current position (board line) — for “next move” and autoplay. */
  const pgnBranchesAtPosition = useMemo(
    () => buildOpeningTreeBranches(selectedOpening, openingTries, userMoves),
    [openingTries, selectedOpening, userMoves],
  )
  const canUndo = userMoves.length > 0
  const resolvedSuggestionSource = useMemo(() => {
    if (suggestionSourceMode === 'statistics') {
      return inBook ? 'statistics' : 'none'
    }

    if (suggestionSourceMode === 'engine') {
      return engineData ? 'engine' : 'none'
    }

    if (inBook) {
      return 'statistics'
    }

    if (engineData) {
      return 'engine'
    }

    return 'none'
  }, [engineData, inBook, suggestionSourceMode])
  const selectedEngineSuggestion = useMemo(
    () => engineData?.suggestions[selectedEngineIndex] ?? engineData?.suggestions[0] ?? null,
    [engineData, selectedEngineIndex],
  )
  const selectedEngineFirstMove = useMemo(() => {
    if (!selectedEngineSuggestion) {
      return null
    }

    return snapshot.legalMoves.find(
      (move) => move.uci === selectedEngineSuggestion.uci,
    ) ?? null
  }, [selectedEngineSuggestion, snapshot.legalMoves])
  const enginePreview = useMemo(() => {
    if (!selectedEngineSuggestion) {
      return null
    }

    const previewChess = createChessFromOpening(selectedOpening, userMoves)
    const firstMove = applyUciMove(previewChess, selectedEngineSuggestion.uci)

    if (!firstMove) {
      return null
    }

    return {
      snapshot: buildPositionSnapshotFromChess(previewChess),
      arrow: {
        from: firstMove.from,
        to: firstMove.to,
      },
      firstMoveSan: firstMove.san,
    }
  }, [selectedEngineSuggestion, selectedOpening, userMoves])
  const importantSquares = useMemo(() => {
    if (pieceEmphasisMode === 'off') {
      return []
    }

    return snapshot.pieces.flatMap((piece) => {
      const continuationScore = continuationScores[piece.square] ?? 0
      const controlScore = controlScores[piece.square] ?? 0
      let strength = 0
      let color = '#7c3aed'

      if (pieceEmphasisMode === 'continuation') {
        strength = continuationScore
        color = '#f97316'
      } else if (pieceEmphasisMode === 'control') {
        strength = controlScore
        color = '#2563eb'
      } else if (pieceEmphasisMode === 'both') {
        strength = (continuationScore + controlScore) / 2
        color = '#7c3aed'
      }

      if (strength < 0.45) {
        return []
      }

      return [
        {
          square: piece.square,
          color,
          strength,
        },
      ]
    })
  }, [continuationScores, controlScores, pieceEmphasisMode, snapshot.pieces])
  const keyPieces = useMemo(() => {
    const ranked = snapshot.pieces
      .map((piece) => {
        const continuationScore = continuationScores[piece.square] ?? 0
        const controlScore = controlScores[piece.square] ?? 0
        const score =
          pieceEmphasisMode === 'continuation'
            ? continuationScore
            : pieceEmphasisMode === 'control'
              ? controlScore
              : pieceEmphasisMode === 'both'
                ? (continuationScore + controlScore) / 2
                : 0

        return {
          piece,
          score,
          continuationScore,
          controlScore,
        }
      })
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score)

    return ranked.slice(0, 3)
  }, [continuationScores, controlScores, pieceEmphasisMode, snapshot.pieces])
  const keyPieceTitle =
    pieceEmphasisMode === 'continuation'
      ? 'Likely movers'
      : pieceEmphasisMode === 'control'
        ? 'Most influential pieces'
        : pieceEmphasisMode === 'both'
          ? 'Key pieces'
          : 'Piece emphasis'

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

  function handleApplyEngineMove(suggestion: EngineSuggestion) {
    const legalMove = snapshot.legalMoves.find(
      (candidate) => candidate.uci === suggestion.uci,
    )

    if (!legalMove) {
      setEngineError(
        'This engine preview is no longer valid for the current board state.',
      )
      return
    }

    setUserMoves((moves) => [...moves, legalMove.uci])
    setSelectedSquare(null)
    setHoveredSquare(null)
    setEngineError(null)
  }

  function handleReset() {
    setUserMoves([])
    setSelectedSquare(null)
    setHoveredSquare(null)
  }

  async function handleLoadPgnFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) {
      return
    }

    setPgnError(null)
    const files = Array.from(fileList)
    let mergedBundles: OpeningTrieBundle[] | null = null
    const nextLoadedFiles: string[] = []
    let nextTotalGames = 0

    for (const file of files) {
      try {
        const fromCache = loadParsedFileCache(file.name)
        if (fromCache) {
          mergedBundles = mergedBundles
            ? mergeOpeningBundles(mergedBundles, fromCache.bundles)
            : fromCache.bundles
          nextLoadedFiles.push(file.name)
          nextTotalGames += fromCache.totalGames
          continue
        }

        const text = await file.text()
        const parsed = await parsePgnTextToBundles(file.name, text, openings, (progress) => {
          setPgnProgress((current) => {
            const next = current.filter((entry) => entry.fileName !== progress.fileName)
            next.push(progress)
            return next
          })
        })
        saveParsedFileCache(file.name, parsed.bundles, parsed.totalGames)
        mergedBundles = mergedBundles
          ? mergeOpeningBundles(mergedBundles, parsed.bundles)
          : parsed.bundles
        nextLoadedFiles.push(file.name)
        nextTotalGames += parsed.totalGames
      } catch (error) {
        setPgnError(
          error instanceof Error ? error.message : `Could not process ${file.name}.`,
        )
      } finally {
        setPgnProgress((current) =>
          current.filter((entry) => entry.fileName !== file.name),
        )
      }
    }

    if (mergedBundles) {
      setOpeningTreeEnabled(true)
      setOpeningTries(mergedBundles)
      setLoadedPgnFiles(nextLoadedFiles)
      setPgnTotalGames(nextTotalGames)
    }
  }

  function handleApplyTreePath(path: string[]) {
    if (!path.length) {
      return
    }

    // `path` is the full PGN line after the book opening; replace (do not append) so the tree stays the same shape.
    setUserMoves([...path])
    setHoveredSquare(null)
    setSelectedSquare(null)
  }

  useEffect(() => {
    if (!isAutoPlaying) {
      return
    }

    const timer = window.setInterval(() => {
      const topBranch = pgnBranchesAtPosition[0]
      if (!topBranch) {
        setIsAutoPlaying(false)
        return
      }
      setUserMoves((moves) => [...moves, topBranch.uci])
    }, 900)

    return () => {
      window.clearInterval(timer)
    }
  }, [isAutoPlaying, pgnBranchesAtPosition])

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
                ? bookData?.source === 'live-book'
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
                  setSelectedEngineIndex(0)
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

        <div className="toolbar-group">
          <span className="toolbar-label">PGN dataset</span>
          <input
            type="file"
            accept=".pgn"
            multiple
            onChange={(event) => void handleLoadPgnFiles(event.target.files)}
          />
          <div className="mode-toggle">
            <button
              type="button"
              className={`mode-button ${openingTreeEnabled ? 'active' : ''}`}
              onClick={() => setOpeningTreeEnabled((enabled) => !enabled)}
            >
              {openingTreeEnabled ? 'Tree on' : 'Tree off'}
            </button>
          </div>
          <p className="toolbar-description">
            {loadedPgnFiles.length > 0
              ? `${loadedPgnFiles.length} file(s), ${pgnTotalGames.toLocaleString()} total games`
              : 'Load one or more PGN files to build local continuation trees.'}
          </p>
          {isDefaultPgnLoading ? (
            <p className="toolbar-loading-note">Loading default dataset...</p>
          ) : null}
          {pgnProgress.length > 0 ? (
            <p className="toolbar-description">
              {pgnProgress
                .map(
                  (entry) =>
                    `${entry.fileName}: ${entry.done.toLocaleString()}/${entry.total.toLocaleString()} (${Math.round((entry.done / Math.max(entry.total, 1)) * 100)}%)`,
                )
                .join(' | ')}
            </p>
          ) : null}
          {pgnError ? <p className="error-text">{pgnError}</p> : null}
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
              importantSquares={importantSquares}
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
              <button
                type="button"
                className="action-button"
                onClick={() => setIsAutoPlaying((playing) => !playing)}
                disabled={pgnBranchesAtPosition.length === 0}
              >
                {isAutoPlaying ? 'Pause autoplay' : 'Autoplay top line'}
              </button>
              <button
                type="button"
                className="action-button"
                onClick={() => {
                  const next = pgnBranchesAtPosition[0]
                  if (next) {
                    setUserMoves((moves) => [...moves, next.uci])
                  }
                }}
                disabled={pgnBranchesAtPosition.length === 0}
              >
                Next move
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

          {openingTreeEnabled ? (
            <section className="detail-card pgn-tree-card">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">PGN continuation tree</p>
                  <h2>Interactive tree</h2>
                </div>
                <span className="detail-badge subtle">
                  {pgnTreeBranchesAtTabiya.length > 0
                    ? `${pgnTreeBranchesAtTabiya.length} root branches`
                    : 'No tree data'}
                </span>
              </div>
              <OpeningTree
                key={selectedOpeningId}
                rootLabel={selectedOpening.name}
                openingMoveCount={selectedOpening.moves.length}
                activePath={userMoves}
                branches={pgnTreeBranchesAtTabiya}
                onSelectPath={handleApplyTreePath}
              />
            </section>
          ) : null}
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
                <h2>Suggestions</h2>
              </div>
              <span
                className={`detail-badge ${inBook ? 'in-book' : 'out-of-book'}`}
              >
                {bookStatus === 'loading'
                  ? 'Loading book data'
                  : resolvedSuggestionSource === 'statistics'
                    ? bookData?.source === 'live-book'
                      ? 'Live book'
                      : 'Bundled book'
                    : resolvedSuggestionSource === 'engine'
                      ? 'Engine'
                      : 'No data'}
              </span>
            </div>
            <div className="suggestion-toggle" role="tablist" aria-label="Suggestion source">
              {(Object.keys(SUGGESTION_SOURCE_COPY) as SuggestionSourceMode[]).map((sourceMode) => (
                <button
                  key={sourceMode}
                  type="button"
                  className={`mode-button ${sourceMode === suggestionSourceMode ? 'active' : ''}`}
                  onClick={() => setSuggestionSourceMode(sourceMode)}
                >
                  {SUGGESTION_SOURCE_COPY[sourceMode]}
                </button>
              ))}
            </div>

            {suggestionSourceMode === 'statistics' && !inBook && bookStatus === 'ready' ? (
              <p className="detail-copy">
                No statistical suggestions are available for this position. Switch to Engine
                or Auto to see engine analysis.
              </p>
            ) : suggestionSourceMode === 'engine' &&
              !engineData &&
              engineStatus !== 'loading' ? (
              <p className="detail-copy">
                No cloud engine evaluation is available for this position. Switch to
                Statistics or Auto if opening-book data exists.
              </p>
            ) : bookStatus === 'loading' && suggestionSourceMode !== 'engine' ? (
              <p className="detail-copy">Looking up real-game continuations for this position.</p>
            ) : bookStatus === 'error' && suggestionSourceMode !== 'engine' ? (
              <p className="error-text">
                {bookError ?? 'The real-game continuation service could not be reached.'}
              </p>
            ) : resolvedSuggestionSource === 'statistics' && inBook && bookData ? (
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
            ) : engineStatus === 'loading' && suggestionSourceMode !== 'statistics' ? (
              <p className="detail-copy">Requesting cloud engine suggestions.</p>
            ) : resolvedSuggestionSource === 'engine' &&
              engineStatus === 'ready' &&
              engineData ? (
              <>
                <div className="engine-mode-note">
                  <strong>Engine mode</strong>
                  <p>
                    This position is outside the opening book, so these are engine
                    suggestions rather than popularity-based next moves.
                  </p>
                  <span className="engine-source-label">
                    Source: {engineData.sourceLabel}
                  </span>
                </div>

                {enginePreview ? (
                  <div className="engine-preview-card">
                    <div className="card-row">
                      <div>
                        <h3>Previewing {enginePreview.firstMoveSan}</h3>
                        <p className="detail-copy">
                          The arrow shows the first engine move on the board.
                        </p>
                      </div>
                      <span className="eval-pill">
                        {selectedEngineSuggestion
                          ? formatEngineScore(selectedEngineSuggestion)
                          : 'No eval'}
                      </span>
                    </div>
                    <ChessHeatmapBoard
                      snapshot={enginePreview.snapshot}
                      mode={mode}
                      size={360}
                      hoveredSquare={null}
                      selectedSquare={null}
                      legalTargets={[]}
                      pieceEmphasisMap={{}}
                      previewArrow={enginePreview.arrow}
                    />
                    <div className="move-buttons engine-preview-actions">
                      <button
                        type="button"
                        className="action-button"
                        onClick={() =>
                          selectedEngineSuggestion
                            ? handleApplyEngineMove(selectedEngineSuggestion)
                            : undefined
                        }
                        disabled={!selectedEngineFirstMove}
                      >
                        Apply first move
                      </button>
                    </div>
                  </div>
                ) : null}

                <div className="analysis-list">
                  {engineData.suggestions.map((suggestion, index) => (
                    <article
                      key={`${suggestion.uci}-${index}`}
                      className={`analysis-card ${
                        index === selectedEngineIndex ? 'active' : ''
                      }`}
                    >
                      <div className="card-row">
                        <div>
                          <h3>Line {index + 1}</h3>
                          <p className="detail-copy">
                            {formatEngineLine(selectedOpening, userMoves, suggestion)}
                          </p>
                        </div>
                        <span className="eval-pill">
                          {formatEngineScore(suggestion)}
                        </span>
                      </div>
                      <div className="move-buttons">
                        <button
                          type="button"
                          className="action-button"
                          onClick={() => setSelectedEngineIndex(index)}
                        >
                          Preview line
                        </button>
                        <button
                          type="button"
                          className="action-button"
                          onClick={() => handleApplyEngineMove(suggestion)}
                        >
                          Apply first move
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              </>
            ) : (
              <p className="detail-copy">
                {resolvedSuggestionSource === 'engine'
                  ? engineError ?? 'No cloud evaluation was available for this position.'
                  : 'No suggestions are available for this position yet.'}
              </p>
            )}
          </section>

          {pieceEmphasisMode !== 'off' ? (
            <section className="detail-card">
              <div className="detail-group-header">
                <h3>{keyPieceTitle}</h3>
                <span className="source-label blue">
                  {pieceEmphasisMode === 'continuation'
                    ? 'Based on likely next moves'
                    : pieceEmphasisMode === 'control'
                      ? 'Based on current board control'
                      : 'Blending move likelihood and control'}
                </span>
              </div>
              {keyPieces.length > 0 ? (
                <div className="key-piece-list">
                  {keyPieces.map((entry) => (
                    <div key={entry.piece.square} className="key-piece-row">
                      <div className="key-piece-copy">
                        <strong>
                          {describePiece(entry.piece.type)} on {entry.piece.square}
                        </strong>
                        <span className="detail-copy">
                          {pieceEmphasisMode === 'continuation'
                            ? `${(entry.continuationScore * 100).toFixed(0)}% continuation relevance`
                            : pieceEmphasisMode === 'control'
                              ? `${(entry.controlScore * 100).toFixed(0)}% control contribution`
                              : `${(entry.score * 100).toFixed(0)}% blended relevance`}
                        </span>
                      </div>
                      <span className="score-pill">
                        {(entry.score * 100).toFixed(0)}%
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="detail-copy">
                  No standout pieces were identified for this emphasis mode in the current
                  position.
                </p>
              )}
            </section>
          ) : null}

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

function formatEngineLine(
  opening: OpeningDefinition,
  userMoves: string[],
  suggestion: EngineSuggestion,
): string {
  const chess = createChessFromOpening(opening, userMoves)
  const sanMoves: string[] = []

  for (const uciMove of suggestion.line) {
    const move = applyUciMove(chess, uciMove)

    if (!move) {
      break
    }

    sanMoves.push(move.san)
  }

  return sanMoves.length > 0 ? formatMoveLine(sanMoves) : suggestion.line.join(' ')
}
