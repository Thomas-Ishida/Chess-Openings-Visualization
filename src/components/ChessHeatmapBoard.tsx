import { useEffect, useRef } from 'react'
import * as d3 from 'd3'

import type { Square } from 'chess.js'

import {
  BOARD_SQUARES,
  type HeatmapMode,
  type PiecePlacement,
  type PositionSnapshot,
  type SquareControl,
  squareToCoordinates,
} from '../lib/chess-heatmap'

interface ChessHeatmapBoardProps {
  snapshot: PositionSnapshot
  mode: HeatmapMode
  size?: number
  hoveredSquare: Square | null
  onHoverSquare?: (square: SquareControl | null) => void
  selectedSquare?: Square | null
  legalTargets?: Square[]
  onSelectSquare?: (square: Square) => void
  pieceEmphasisMap?: Partial<Record<Square, number>>
  previewArrow?: {
    from: Square
    to: Square
    color?: string
  } | null
}

const BOARD_MARGIN = 28

interface BoardSquareDatum {
  square: Square
  x: number
  y: number
  coordinates: {
    x: number
    y: number
  }
  control: SquareControl
}

interface PieceDatum extends PiecePlacement {
  displayX: number
  displayY: number
  emphasis: number
}

const PIECE_GLYPHS = {
  w: {
    p: '♙',
    n: '♘',
    b: '♗',
    r: '♖',
    q: '♕',
    k: '♔',
  },
  b: {
    p: '♟',
    n: '♞',
    b: '♝',
    r: '♜',
    q: '♛',
    k: '♚',
  },
}

export function ChessHeatmapBoard({
  snapshot,
  mode,
  size = 580,
  hoveredSquare,
  onHoverSquare,
  selectedSquare = null,
  legalTargets = [],
  onSelectSquare,
  pieceEmphasisMap = {},
  previewArrow = null,
}: ChessHeatmapBoardProps) {
  const svgRef = useRef<SVGSVGElement | null>(null)

  useEffect(() => {
    if (!svgRef.current) {
      return
    }

    const totalSize = size + BOARD_MARGIN * 2
    const squareSize = size / 8
    const svg = d3.select(svgRef.current)
    const fileLabels = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const
    const rankLabels = ['8', '7', '6', '5', '4', '3', '2', '1'] as const

    svg.selectAll('*').remove()
    svg.attr('viewBox', `0 0 ${totalSize} ${totalSize}`)

    const root = svg
      .append('g')
      .attr('transform', `translate(${BOARD_MARGIN}, ${BOARD_MARGIN})`)

    const boardSquares: BoardSquareDatum[] = BOARD_SQUARES.map((square) => {
      const coordinates = squareToCoordinates(square)
      const displayRank = 7 - coordinates.y
      const control = snapshot.controlMap[square]

      return {
        square,
        x: coordinates.x * squareSize,
        y: displayRank * squareSize,
        coordinates,
        control,
      }
    })
    const legalTargetSet = new Set(legalTargets)
    const pieceData: PieceDatum[] = snapshot.pieces.map((piece) => {
      const coordinates = squareToCoordinates(piece.square)

      return {
        ...piece,
        displayX: coordinates.x * squareSize + squareSize / 2,
        displayY: (7 - coordinates.y) * squareSize + squareSize * 0.69,
        emphasis: pieceEmphasisMap[piece.square] ?? 1,
      }
    })

    const whiteScale = d3
      .scaleLinear<string>()
      .domain([0, Math.max(snapshot.maxWhiteControl, 1)])
      .range(['#dbeafe', '#1d4ed8'])
      .clamp(true)

    const blackScale = d3
      .scaleLinear<string>()
      .domain([0, Math.max(snapshot.maxBlackControl, 1)])
      .range(['#fed7aa', '#ea580c'])
      .clamp(true)

    const differenceScale = d3
      .scaleLinear<string>()
      .domain([
        -Math.max(snapshot.maxAbsDifference, 1),
        0,
        Math.max(snapshot.maxAbsDifference, 1),
      ])
      .range(['#f97316', '#e7e5e4', '#2563eb'])
      .clamp(true)

    const intensityScale = d3
      .scaleSqrt()
      .domain([0, Math.max(snapshot.maxWhiteControl, snapshot.maxBlackControl, 1)])
      .range([0, 0.86])
      .clamp(true)

    const differenceOpacityScale = d3
      .scaleSqrt()
      .domain([0, Math.max(snapshot.maxAbsDifference, 1)])
      .range([0.18, 0.88])
      .clamp(true)

    root
      .append('rect')
      .attr('width', size)
      .attr('height', size)
      .attr('rx', 18)
      .attr('fill', '#fafaf9')

    root
      .selectAll('rect.board-square')
      .data(boardSquares)
      .enter()
      .append('rect')
      .attr('class', 'board-square')
      .attr('x', (datum: BoardSquareDatum) => datum.x)
      .attr('y', (datum: BoardSquareDatum) => datum.y)
      .attr('width', squareSize)
      .attr('height', squareSize)
      .attr('fill', (datum: BoardSquareDatum) =>
        (datum.coordinates.x + datum.coordinates.y) % 2 === 0 ? '#f5efe4' : '#b9b39b',
      )

    root
      .selectAll('rect.heat-square')
      .data(boardSquares)
      .enter()
      .append('rect')
      .attr('class', 'heat-square')
      .attr('x', (datum: BoardSquareDatum) => datum.x)
      .attr('y', (datum: BoardSquareDatum) => datum.y)
      .attr('width', squareSize)
      .attr('height', squareSize)
      .attr('fill', (datum: BoardSquareDatum) => getSquareFill(datum.control))
      .attr('opacity', (datum: BoardSquareDatum) => getSquareOpacity(datum.control))

    root
      .selectAll('rect.active-square')
      .data(
        boardSquares.filter(
          (datum) => datum.square === hoveredSquare || datum.square === selectedSquare,
        ),
      )
      .enter()
      .append('rect')
      .attr('class', 'active-square')
      .attr('x', (datum: BoardSquareDatum) => datum.x + 2)
      .attr('y', (datum: BoardSquareDatum) => datum.y + 2)
      .attr('width', squareSize - 4)
      .attr('height', squareSize - 4)
      .attr('rx', 10)
      .attr('fill', 'none')
      .attr('stroke', (datum: BoardSquareDatum) =>
        datum.square === selectedSquare ? '#2563eb' : '#111827',
      )
      .attr('stroke-width', 3)
      .attr('stroke-opacity', 0.8)

    root
      .selectAll('circle.legal-target')
      .data(boardSquares.filter((datum) => legalTargetSet.has(datum.square)))
      .enter()
      .append('circle')
      .attr('class', 'legal-target')
      .attr('cx', (datum: BoardSquareDatum) => datum.x + squareSize / 2)
      .attr('cy', (datum: BoardSquareDatum) => datum.y + squareSize / 2)
      .attr('r', squareSize * 0.16)
      .attr('fill', '#0f172a')
      .attr('opacity', 0.48)

    if (previewArrow) {
      const from = squareToCoordinates(previewArrow.from)
      const to = squareToCoordinates(previewArrow.to)
      const arrowColor = previewArrow.color ?? '#7c3aed'
      const startX = from.x * squareSize + squareSize / 2
      const startY = (7 - from.y) * squareSize + squareSize / 2
      const endX = to.x * squareSize + squareSize / 2
      const endY = (7 - to.y) * squareSize + squareSize / 2

      const defs = root.append('defs')
      defs
        .append('marker')
        .attr('id', 'preview-arrow-head')
        .attr('viewBox', '0 0 12 12')
        .attr('refX', 10)
        .attr('refY', 6)
        .attr('markerWidth', 10)
        .attr('markerHeight', 10)
        .attr('orient', 'auto-start-reverse')
        .append('path')
        .attr('d', 'M 0 0 L 12 6 L 0 12 z')
        .attr('fill', arrowColor)

      root
        .append('line')
        .attr('x1', startX)
        .attr('y1', startY)
        .attr('x2', endX)
        .attr('y2', endY)
        .attr('stroke', arrowColor)
        .attr('stroke-width', Math.max(squareSize * 0.12, 6))
        .attr('stroke-linecap', 'round')
        .attr('stroke-opacity', 0.72)
        .attr('marker-end', 'url(#preview-arrow-head)')
    }

    root
      .selectAll('text.file-label')
      .data(fileLabels)
      .enter()
      .append('text')
      .attr('class', 'file-label')
      .attr('x', (_: string, index: number) => index * squareSize + squareSize / 2)
      .attr('y', size + 18)
      .attr('text-anchor', 'middle')
      .attr('font-size', squareSize * 0.18)
      .attr('font-weight', 700)
      .attr('fill', '#4b5563')
      .text((label: string) => label)

    root
      .selectAll('text.rank-label')
      .data(rankLabels)
      .enter()
      .append('text')
      .attr('class', 'rank-label')
      .attr('x', -12)
      .attr('y', (_: string, index: number) => index * squareSize + squareSize / 2 + 5)
      .attr('text-anchor', 'middle')
      .attr('font-size', squareSize * 0.18)
      .attr('font-weight', 700)
      .attr('fill', '#4b5563')
      .text((label: string) => label)

    root
      .append('g')
      .selectAll('text.piece')
      .data(pieceData)
      .enter()
      .append('text')
      .attr('class', 'piece')
      .attr('x', (piece: PieceDatum) => piece.displayX)
      .attr('y', (piece: PieceDatum) => piece.displayY)
      .attr('text-anchor', 'middle')
      .attr('font-size', squareSize * 0.76)
      .attr('font-family', 'Georgia, serif')
      .attr('fill', (piece: PieceDatum) => (piece.color === 'w' ? '#fff7ed' : '#111827'))
      .attr('stroke', (piece: PieceDatum) => (piece.color === 'w' ? '#1f2937' : '#f9fafb'))
      .attr('stroke-width', (piece: PieceDatum) =>
        piece.square === selectedSquare ? 1.2 : 0.6,
      )
      .attr('fill-opacity', (piece: PieceDatum) => piece.emphasis)
      .attr('stroke-opacity', (piece: PieceDatum) => Math.min(piece.emphasis + 0.15, 1))
      .attr('paint-order', 'stroke')
      .text((piece: PieceDatum) => PIECE_GLYPHS[piece.color][piece.type])

    root
      .selectAll('rect.hit-area')
      .data(boardSquares)
      .enter()
      .append('rect')
      .attr('class', 'hit-area')
      .attr('x', (datum: BoardSquareDatum) => datum.x)
      .attr('y', (datum: BoardSquareDatum) => datum.y)
      .attr('width', squareSize)
      .attr('height', squareSize)
      .attr('fill', 'transparent')
      .style('cursor', onSelectSquare ? 'pointer' : 'crosshair')
      .on('mouseenter', (_: MouseEvent, datum: BoardSquareDatum) => {
        onHoverSquare?.(datum.control)
      })
      .on('mouseleave', () => {
        onHoverSquare?.(null)
      })
      .on('click', (_: MouseEvent, datum: BoardSquareDatum) => {
        onSelectSquare?.(datum.square)
      })

    function getSquareFill(control: SquareControl) {
      if (mode === 'white') {
        return whiteScale(control.whiteCount)
      }

      if (mode === 'black') {
        return blackScale(control.blackCount)
      }

      return differenceScale(control.difference)
    }

    function getSquareOpacity(control: SquareControl) {
      if (mode === 'white') {
        return control.whiteCount === 0 ? 0 : intensityScale(control.whiteCount)
      }

      if (mode === 'black') {
        return control.blackCount === 0 ? 0 : intensityScale(control.blackCount)
      }

      return differenceOpacityScale(Math.abs(control.difference))
    }
  }, [
    hoveredSquare,
    legalTargets,
    mode,
    onHoverSquare,
    onSelectSquare,
    pieceEmphasisMap,
    previewArrow,
    selectedSquare,
    size,
    snapshot,
  ])

  return (
    <svg
      ref={svgRef}
      className="chess-heatmap-board"
      role="img"
      aria-label="Chess opening board with a control heatmap overlay"
    />
  )
}
