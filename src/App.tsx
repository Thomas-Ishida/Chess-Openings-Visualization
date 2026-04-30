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
  fetchEngineSuggestions,
  type EngineSuggestion,
} from './lib/explorer-api'
import {
  buildOpeningTreeBranches,
  loadParsedFileCache,
  mergeOpeningBundles,
  parsePgnTextToBundles,
  saveParsedFileCache,
  removeParsedFileCache,
} from './lib/pgn-parser'
import type {
  OpeningTreeBranch,
  OpeningTrieBundle,
  PgnProgressSnapshot,
} from './lib/opening-tree-types'

const openings = openingsData as OpeningDefinition[]
const DEFAULT_PGN_FILE_NAME = 'lichess_elite_2025-11-top50-capped-1000.pgn'

// Updated MODE_COPY to handle 'none'
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
  none: {
    label: 'No heatmap',
    description: 'Shows the standard chessboard without any control overlays.',
    summary: 'Standard view.',
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
  const [openingTries, setOpeningTries] = useState<OpeningTrieBundle[] | null>(null)
  const [pgnProgress, setPgnProgress] = useState<PgnProgressSnapshot[]>([])
  const [loadedPgnFiles, setLoadedPgnFiles] = useState<string[]>([])
  const [pgnTotalGames, setPgnTotalGames] = useState(0)
  const [pgnError, setPgnError] = useState<string | null>(null)
  const [isDefaultPgnLoading, setIsDefaultPgnLoading] = useState(true)
  const [isAutoPlaying, setIsAutoPlaying] = useState(false)
  const [isSuggestionsOpen, setIsSuggestionsOpen] = useState(false)
  const [isWelcomeOpen, setIsWelcomeOpen] = useState(true)
  const [isDecisionTreeOpen, setIsDecisionTreeOpen] = useState(false)
  const [isProfileOpen, setIsProfileOpen] = useState(false)

  const openingTreeEnabled = openingTries !== null

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

  const openingColorLabel = useMemo(() => {
    const isBlackOpening =
      selectedOpening.name.includes('Defense') ||
      selectedOpening.name.includes('Declined')
    return isBlackOpening ? "Black's opening" : "White's opening"
  }, [selectedOpening.name])
  
  // Calculate if the board should be flipped
  const isFlipped = openingColorLabel === "Black's opening"

  const openingStats = useMemo(() => {
    if (!openingTries) return null
    const bundle = openingTries.find((b) => b.openingId === selectedOpeningId)
    if (!bundle) return null

    const total = bundle.trie.w + bundle.trie.d + bundle.trie.b
    if (total === 0) return null

    return {
      white: (bundle.trie.w / total) * 100,
      draw: (bundle.trie.d / total) * 100,
      black: (bundle.trie.b / total) * 100,
      total,
    }
  }, [openingTries, selectedOpeningId])

  useEffect(() => {
    let cancelled = false
    let timeoutId: number | null = null

    async function loadDefaultPgnDataset() {
      setPgnError(null)
      setIsDefaultPgnLoading(true)

      try {
        const fromCache = loadParsedFileCache(DEFAULT_PGN_FILE_NAME)
        if (fromCache) {
          if (cancelled) return
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
            if (cancelled) return
            setPgnProgress((current) => {
              const next = current.filter((entry) => entry.fileName !== progress.fileName)
              next.push(progress)
              return next
            })
          },
        )
        saveParsedFileCache(DEFAULT_PGN_FILE_NAME, parsed.bundles, parsed.totalGames)

        if (cancelled) return
        setOpeningTries(parsed.bundles)
        setLoadedPgnFiles([DEFAULT_PGN_FILE_NAME])
        setPgnTotalGames(parsed.totalGames)
      } catch (error) {
        if (cancelled) return
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

    async function loadEngine() {
      setEngineStatus('loading')
      setEngineError(null)
      setEngineData(null)
      setSelectedEngineIndex(0)

      try {
        const result = await fetchEngineSuggestions(snapshot.fen, controller.signal)

        if (controller.signal.aborted) return

        if (result) {
          setEngineData(result)
          setEngineStatus('ready')
        } else {
          setEngineStatus('unavailable')
          setEngineError('No cloud evaluation is available for this position.')
        }
      } catch (error) {
        if (controller.signal.aborted) return

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
  }, [snapshot.fen])

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

  const pgnTreeBranchesAtTabiya = useMemo(
    () => buildOpeningTreeBranches(selectedOpening, openingTries, []),
    [openingTries, selectedOpening],
  )
  const pgnBranchesAtPosition = useMemo(
    () => buildOpeningTreeBranches(selectedOpening, openingTries, userMoves),
    [openingTries, selectedOpening, userMoves],
  )
  const inBook = pgnBranchesAtPosition.length > 0
  const canUndo = userMoves.length > 0
  const resolvedSuggestionSource = useMemo(() => {
    if (suggestionSourceMode === 'statistics') return inBook ? 'statistics' : 'none'
    if (suggestionSourceMode === 'engine') return engineData ? 'engine' : 'none'
    if (inBook) return 'statistics'
    if (engineData) return 'engine'
    return 'none'
  }, [engineData, inBook, suggestionSourceMode])

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
    const branches = pgnBranchesAtPosition

    if (branches.length === 0) return scores

    let maxScore = 0

    for (const branch of branches) {
      const legalMove = snapshot.legalMoves.find((candidate) => candidate.uci === branch.uci)

      if (legalMove) {
        scores[legalMove.from] = (scores[legalMove.from] ?? 0) + branch.frequency
        maxScore = Math.max(maxScore, scores[legalMove.from] ?? 0)
      }

      for (const child of branch.children) {
        const childChess = createChessFromOpening(selectedOpening, userMoves)

        if (!applyUciMove(childChess, branch.uci)) continue

        const childSnapshot = buildPositionSnapshotFromChess(childChess)
        const childMove = childSnapshot.legalMoves.find(
          (candidate) => candidate.uci === child.uci,
        )

        if (childMove) {
          scores[childMove.from] = (scores[childMove.from] ?? 0) + child.frequency * 0.5
          maxScore = Math.max(maxScore, scores[childMove.from] ?? 0)
        }
      }
    }

    if (maxScore === 0) return scores

    return Object.fromEntries(
      Object.entries(scores).map(([square, score]) => [square, score / maxScore]),
    ) as Partial<Record<Square, number>>
  }, [pgnBranchesAtPosition, selectedOpening, snapshot.legalMoves, userMoves])

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

    if (maxScore === 0) return scores

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

  const selectedEngineSuggestion = useMemo(
    () => engineData?.suggestions[selectedEngineIndex] ?? engineData?.suggestions[0] ?? null,
    [engineData, selectedEngineIndex],
  )
  const selectedEngineFirstMove = useMemo(() => {
    if (!selectedEngineSuggestion) return null
    return snapshot.legalMoves.find(
      (move) => move.uci === selectedEngineSuggestion.uci,
    ) ?? null
  }, [selectedEngineSuggestion, snapshot.legalMoves])
  const enginePreview = useMemo(() => {
    if (!selectedEngineSuggestion) return null

    const previewChess = createChessFromOpening(selectedOpening, userMoves)
    const firstMove = applyUciMove(previewChess, selectedEngineSuggestion.uci)

    if (!firstMove) return null

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
    if (pieceEmphasisMode === 'off') return []

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

      if (strength < 0.45) return []

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

  function handleApplyContinuation(move: OpeningTreeBranch) {
    const legalMove = snapshot.legalMoves.find((candidate) => candidate.uci === move.uci)

    if (!legalMove) return

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
    if (!fileList || fileList.length === 0) return

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
      setOpeningTries(mergedBundles)
      setLoadedPgnFiles(nextLoadedFiles)
      setPgnTotalGames(nextTotalGames)
    }
  }

  function handleRemovePgnFile(fileNameToRemove: string) {
    removeParsedFileCache(fileNameToRemove)

    const nextLoadedFiles = loadedPgnFiles.filter((name) => name !== fileNameToRemove)

    let mergedBundles: OpeningTrieBundle[] | null = null
    let nextTotalGames = 0

    for (const fileName of nextLoadedFiles) {
      const fromCache = loadParsedFileCache(fileName)
      if (fromCache) {
        mergedBundles = mergedBundles
          ? mergeOpeningBundles(mergedBundles, fromCache.bundles)
          : fromCache.bundles
        nextTotalGames += fromCache.totalGames
      }
    }

    setLoadedPgnFiles(nextLoadedFiles)
    setOpeningTries(mergedBundles)
    setPgnTotalGames(nextTotalGames)
  }

  function handleApplyTreePath(path: string[]) {
    if (!path.length) return
    setUserMoves([...path])
    setHoveredSquare(null)
    setSelectedSquare(null)
  }

  useEffect(() => {
    if (!isAutoPlaying) return

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
    if (!canUndo) return
    setUserMoves((moves) => moves.slice(0, -1))
    setSelectedSquare(null)
  }

  return (
    <div className="app-shell">
      {isWelcomeOpen && (
        <div className="welcome-overlay" onClick={() => setIsWelcomeOpen(false)}>
          <div className="welcome-modal" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="welcome-close"
              onClick={() => setIsWelcomeOpen(false)}
              aria-label="Close welcome"
            >
              ✕
            </button>

            <div className="hero-copy">
              <p className="eyebrow">Chess Opening Visualization</p>
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
                    ? 'Continuation probabilities come from the live Lichess masters explorer.'
                    : 'Showing engine suggestions because the position is outside the book.'}
                </span>
              </div>
            </div>

            <button
              type="button"
              className="welcome-start"
              onClick={() => setIsWelcomeOpen(false)}
            >
              Start exploring →
            </button>
          </div>
        </div>
      )}

      {/* ── Opening profile bar (overlaying drawer) ───────────────────── */}
      <div className="profile-bar-wrapper">
        <button
          type="button"
          className="profile-bar-toggle"
          onClick={() => setIsProfileOpen((o) => !o)}
          aria-expanded={isProfileOpen}
        >
          <p className="eyebrow" style={{ margin: 0 }}>Opening profile</p>
          <strong className="profile-bar-name">{selectedOpening.name}</strong>
          <span className="detail-badge">{selectedOpening.eco}</span>
          <span className="detail-badge subtle">{openingColorLabel}</span>
          <span className="dropdown-chevron" style={{ marginLeft: 'auto', fontSize: '0.9rem' }}>
            {isProfileOpen ? '▲' : '▼'}
          </span>
        </button>

        {isProfileOpen && (
          <div className="profile-drawer">
            <p className="detail-copy">{selectedOpening.description}</p>
            <div className="drawer-grid">
              <div className="drawer-section">
                <h3>Key ideas</h3>
                <ul>
                  {selectedOpening.ideas.map((idea) => (
                    <li key={idea}>{idea}</li>
                  ))}
                </ul>
              </div>
              <div className="drawer-section">
                <h3>Typical mistakes</h3>
                <ul>
                  {selectedOpening.commonMistakes.map((mistake) => (
                    <li key={mistake}>{mistake}</li>
                  ))}
                </ul>
              </div>
              <div className="drawer-section">
                <h3>Win rate</h3>
                {openingStats ? (
                  <div className="opening-winrate">
                    <div className="opening-winrate-bar">
                      <div className="opening-winrate-segment opening-winrate-white" style={{ width: `${openingStats.white}%` }}>
                        {openingStats.white > 10 ? `${Math.round(openingStats.white)}%` : ''}
                      </div>
                      <div className="opening-winrate-segment opening-winrate-draw" style={{ width: `${openingStats.draw}%` }}>
                        {openingStats.draw > 10 ? `${Math.round(openingStats.draw)}%` : ''}
                      </div>
                      <div className="opening-winrate-segment opening-winrate-black" style={{ width: `${openingStats.black}%` }}>
                        {openingStats.black > 10 ? `${Math.round(openingStats.black)}%` : ''}
                      </div>
                    </div>
                    <div className="opening-winrate-legend">
                      <div className="opening-winrate-legend-item">
                        <div className="opening-winrate-dot opening-winrate-dot-white"></div>
                        <span>White</span>
                      </div>
                      <div className="opening-winrate-legend-item">
                        <div className="opening-winrate-dot opening-winrate-dot-draw"></div>
                        <span>Draw</span>
                      </div>
                      <div className="opening-winrate-legend-item">
                        <div className="opening-winrate-dot opening-winrate-dot-black"></div>
                        <span>Black</span>
                      </div>
                    </div>
                    <p className="detail-copy" style={{ fontSize: '0.85rem', marginTop: '0.2rem' }}>
                      Based on {openingStats.total.toLocaleString()} games.
                    </p>
                  </div>
                ) : (
                  <p className="detail-copy" style={{ fontSize: '0.85rem' }}>
                    Load PGN data to see win rates.
                  </p>
                )}

                <h3 style={{ marginTop: '1.25rem' }}>Current line</h3>
                <p className="move-line">{formatMoveLine(currentLine)}</p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── 3-column main layout ───────────────────────────────────────── */}
      <main className="content-grid">

        {/* Left sidebar */}
        <aside className="left-sidebar">
          <div className="sidebar-card">

            <div className="sidebar-group">
              <span className="toolbar-label">Opening</span>
              <select
                className="opening-select"
                value={selectedOpeningId}
                onChange={(e) => {
                  setSelectedOpeningId(e.target.value)
                  setUserMoves([])
                  setHoveredSquare(null)
                  setSelectedSquare(null)
                  setEngineData(null)
                  setEngineStatus('idle')
                  setEngineError(null)
                  setSelectedEngineIndex(0)
                }}
              >
                {openings.map((opening) => (
                  <option key={opening.id} value={opening.id}>
                    {opening.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="sidebar-group">
              <span className="toolbar-label">Heatmap mode</span>
              <div className="mode-toggle" role="tablist" aria-label="Heatmap modes">
                <button
                  type="button"
                  className={`mode-button piece-btn ${mode === 'white' ? 'active' : ''}`}
                  onClick={() => setMode('white')}
                  title="White pressure"
                >
                  ♙
                </button>
                <button
                  type="button"
                  className={`mode-button piece-btn ${mode === 'black' ? 'active' : ''}`}
                  onClick={() => setMode('black')}
                  title="Black pressure"
                >
                  ♟
                </button>
                <button
                  type="button"
                  className={`mode-button piece-btn ${mode === 'difference' ? 'active' : ''}`}
                  onClick={() => setMode('difference')}
                  title="Whole board"
                >
                  ♙♟
                </button>
                <button
                  type="button"
                  className={`mode-button ${mode === 'none' ? 'active' : ''}`}
                  onClick={() => setMode('none')}
                  title="No heatmap"
                  style={{ fontSize: '1.1rem', fontWeight: 600, padding: '0.3rem 0.9rem' }}
                >
                  ✕
                </button>
              </div>
              <p className="toolbar-description">{MODE_COPY[mode].description}</p>
            </div>

            <div className="sidebar-group">
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

            <div className="sidebar-group">
              <span className="toolbar-label">PGN dataset</span>
              <input
                type="file"
                accept=".pgn"
                multiple
                onChange={(event) => void handleLoadPgnFiles(event.target.files)}
              />
              <div className="toolbar-description">
                {loadedPgnFiles.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                    <span>{loadedPgnFiles.length} file(s), {pgnTotalGames.toLocaleString()} total games:</span>
                    <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                      {loadedPgnFiles.map((fileName) => (
                        <li key={fileName} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <button
                            type="button"
                            onClick={() => handleRemovePgnFile(fileName)}
                            style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '0 4px', fontSize: '1.1rem', lineHeight: 1 }}
                            aria-label={`Remove ${fileName}`}
                          >✕</button>
                          <span style={{ fontSize: '0.82rem', wordBreak: 'break-all' }}>{fileName}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  'Load one or more PGN files to build local continuation trees.'
                )}
              </div>
              {isDefaultPgnLoading ? (
                <p className="toolbar-loading-note">Loading default dataset...</p>
              ) : null}
              {pgnProgress.length > 0 ? (
                <p className="toolbar-description">
                  {pgnProgress.map((entry) =>
                    `${entry.fileName}: ${entry.done.toLocaleString()}/${entry.total.toLocaleString()} (${Math.round((entry.done / Math.max(entry.total, 1)) * 100)}%)`
                  ).join(' | ')}
                </p>
              ) : null}
              {pgnError ? <p className="error-text">{pgnError}</p> : null}
            </div>

          </div>
        </aside>

        {/* Center: board */}
        <section className="board-column">
          <div className="board-card">
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
              flipped={isFlipped}
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

          {openingTreeEnabled ? (
            <button
              type="button"
              className="decision-tree-button"
              onClick={() => setIsDecisionTreeOpen(true)}
            >
              Decision Tree
            </button>
          ) : null}
        </section>

        {/* Right: continuation explorer + square inspector */}
        <aside className="detail-column">
          <section className="detail-card">
            <button
              type="button"
              className="dropdown-toggle-header"
              onClick={() => setIsSuggestionsOpen((open) => !open)}
              aria-expanded={isSuggestionsOpen}
            >
              <div className="section-heading" style={{ marginBottom: 0 }}>
                <div>
                  <p className="eyebrow">Continuation explorer</p>
                  <h2>Suggestions</h2>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span className={`detail-badge ${inBook ? 'in-book' : 'out-of-book'}`}>
                    {isDefaultPgnLoading
                      ? 'Loading PGN'
                      : resolvedSuggestionSource === 'statistics'
                        ? 'PGN stats'
                        : resolvedSuggestionSource === 'engine'
                          ? 'Engine'
                          : 'No data'}
                  </span>
                  <span className="dropdown-chevron">{isSuggestionsOpen ? '▲' : '▼'}</span>
                </div>
              </div>
            </button>

            {isSuggestionsOpen && (
            <><div className="suggestion-toggle" role="tablist" aria-label="Suggestion source">
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

            {suggestionSourceMode === 'statistics' && !inBook && !isDefaultPgnLoading ? (
              <p className="detail-copy">
                No statistical suggestions are available for this position. Switch to Engine
                or Auto to see engine analysis.
              </p>
            ) : suggestionSourceMode === 'engine' &&
              !engineData &&
              engineStatus !== 'loading' ? (
              <p className="detail-copy">
                No cloud engine evaluation is available for this position. Switch to
                Statistics or Auto if PGN tree data exists.
              </p>
            ) : isDefaultPgnLoading && suggestionSourceMode !== 'engine' ? (
              <p className="detail-copy">Loading PGN tree data for statistical suggestions.</p>
            ) : pgnError && suggestionSourceMode !== 'engine' ? (
              <p className="error-text">
                {pgnError ?? 'The PGN dataset could not be processed.'}
              </p>
            ) : resolvedSuggestionSource === 'statistics' && inBook ? (
              <div className="continuation-list">
                {pgnBranchesAtPosition.map((move) => (
                  <article key={move.uci} className="continuation-card">
                    <div className="card-row">
                      <div>
                        <h3>{move.san}</h3>
                        <p className="detail-copy">{move.games.toLocaleString()} games</p>
                      </div>
                      <span className="percentage-pill">{move.frequency.toFixed(1)}%</span>
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
                        W {move.winRate[0].toFixed(0)} / D {move.winRate[1].toFixed(0)} / B{' '}
                        {move.winRate[2].toFixed(0)}
                      </div>
                    </div>
                    {move.children.length > 0 ? (
                      <ul className="subline-list">
                        {move.children.map((child) => (
                          <li key={`${move.uci}-${child.uci}`}>
                            <strong>{child.san}</strong> - {child.frequency.toFixed(1)}%
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
                      flipped={isFlipped}
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
                      className={`analysis-card ${index === selectedEngineIndex ? 'active' : ''}`}
                    >
                      <div className="card-row">
                        <div>
                          <h3>Line {index + 1}</h3>
                          <p className="detail-copy">
                            {formatEngineLine(selectedOpening, userMoves, suggestion)}
                          </p>
                        </div>
                        <span className="eval-pill">{formatEngineScore(suggestion)}</span>
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
            </>
            )}
          </section>

          {pieceEmphasisMode !== 'off' ? (
            <section className="detail-card">
              <div className="detail-group-header">
                <h3>{keyPieceTitle}</h3>
                <span className="source-label blue">
                  {pieceEmphasisMode === 'continuation'
                    ? 'Based on tree continuation percentages'
                    : pieceEmphasisMode === 'control'
                      ? 'Based on current board control'
                      : 'Blending tree continuation and control'}
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
                            ? `${(entry.continuationScore * 100).toFixed(0)}% of local continuations involve this piece`
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
                Hover any square on the board to inspect exactly which pieces are
                contributing pressure there.
              </p>
            )}
          </section>

          <div className="metric-grid metric-grid-stacked">
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

      {isDecisionTreeOpen && (
        <div className="decision-tree-overlay">
          <div className="decision-tree-page">
            <div className="decision-tree-header">
              <div>
                <p className="eyebrow">PGN continuation tree</p>
                <h2>{selectedOpening.name} — Decision Tree</h2>
              </div>
              <button
                type="button"
                className="decision-tree-close"
                onClick={() => setIsDecisionTreeOpen(false)}
                aria-label="Close decision tree"
              >
                ✕ Close
              </button>
            </div>
            <div className="decision-tree-body">
              <div className="decision-tree-left">
                <OpeningTree
                  key={selectedOpeningId}
                  rootLabel={selectedOpening.name}
                  openingMoveCount={selectedOpening.moves.length}
                  activePath={userMoves}
                  branches={pgnTreeBranchesAtTabiya}
                  onSelectPath={(path) => {
                    handleApplyTreePath(path)
                  }}
                />
              </div>
              <div className="decision-tree-right">
                <div className="decision-tree-board-wrap">
                  <p className="eyebrow" style={{ marginBottom: '0.5rem' }}>Current position</p>
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
                    size={440}
                    flipped={isFlipped}
                  />
                  <div className="board-actions" style={{ marginTop: '0.75rem' }}>
                    <button type="button" className="action-button" onClick={handleReset}>
                      Reset
                    </button>
                    <button
                      type="button"
                      className="action-button"
                      onClick={handleUndo}
                      disabled={!canUndo}
                    >
                      Undo
                    </button>
                    <button
                      type="button"
                      className="action-button"
                      onClick={() => {
                        const next = pgnBranchesAtPosition[0]
                        if (next) setUserMoves((moves) => [...moves, next.uci])
                      }}
                      disabled={pgnBranchesAtPosition.length === 0}
                    >
                      Next move
                    </button>
                  </div>
                  <p className="move-line" style={{ marginTop: '0.5rem', fontSize: '0.8rem' }}>
                    {formatMoveLine(currentLine)}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App

function getTopSquares(
  squareControls: SquareControl[],
  key: 'whiteCount' | 'blackCount' | 'totalPressure',
): SquareControl[] {
  const highestValue = Math.max(...squareControls.map((control) => control[key]), 0)

  if (highestValue === 0) return []

  return squareControls.filter((control) => control[key] === highestValue).slice(0, 3)
}

function formatSquareList(squareControls: SquareControl[]): string {
  if (squareControls.length === 0) return '—'

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

    if (!move) break

    sanMoves.push(move.san)
  }

  return sanMoves.length > 0 ? formatMoveLine(sanMoves) : suggestion.line.join(' ')
}