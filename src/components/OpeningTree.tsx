import { useEffect, useMemo, useRef, useState } from 'react'
import * as d3 from 'd3'

import type { OpeningTreeBranch } from '../lib/opening-tree-types'

/** Max branches at each level */
const TOP_N = 3

const NODE_W = 118
const NODE_H = 76
const H_GAP = 20
const V_GAP = 60
const MARGIN_X = 32
const MARGIN_Y = 28

function toPathKey(path: string[]): string {
  if (path.length === 0) {
    return 'root'
  }
  return `root>${path.join('>')}`
}

function pathsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  return a.every((v, i) => v === b[i])
}

function isPathPrefix(possiblePrefix: string[], full: string[]): boolean {
  if (possiblePrefix.length > full.length) return false
  return possiblePrefix.every((v, i) => v === full[i])
}

function findBranchAtPath(
  level: OpeningTreeBranch[],
  subPath: string[],
): OpeningTreeBranch | undefined {
  return level.find((b) => pathsEqual(b.path, subPath))
}

interface TreeNodeDatum {
  id: string
  pathKey: string
  uci: string
  displaySan: string
  labelShort: string
  games: number
  /** 0–100, rounded to match version2 */
  freq: number
  path: string[]
  isActive: boolean
  isOnActiveLine: boolean
  canExpand: boolean
  isExpanded: boolean
  hasChildren: boolean
  winRate: [number, number, number]
  children: TreeNodeDatum[]
}

function buildTreeData(
  rootLabel: string,
  openingMoveCount: number,
  branches: OpeningTreeBranch[],
  activePath: string[],
  expandedPathKeys: Set<string>,
): TreeNodeDatum | null {
  if (branches.length === 0) return null

  const buildNode = (branch: OpeningTreeBranch): TreeNodeDatum => {
    const pathKey = toPathKey(branch.path)
    const id = branch.path.join('>') || 'leaf'
    const isActive = pathsEqual(branch.path, activePath)
    const isOnActiveLine = isPathPrefix(branch.path, activePath)
    const hasChildren = branch.children.length > 0
    const isExpanded = expandedPathKeys.has(pathKey)
    const isBlackLastMove = (openingMoveCount + branch.path.length - 1) % 2 === 1
    const displaySan = isBlackLastMove ? `...${branch.san}` : branch.san
    const labelShort = displaySan.length > 14 ? `${displaySan.slice(0, 13)}…` : displaySan

    return {
      id,
      pathKey,
      uci: branch.uci,
      displaySan,
      labelShort,
      games: branch.games,
      freq: Math.min(100, Math.round(branch.frequency)),
      path: branch.path,
      isActive,
      isOnActiveLine,
      canExpand: hasChildren,
      isExpanded,
      hasChildren,
      winRate: branch.winRate,
      children:
        hasChildren && isExpanded
          ? branch.children
              .slice(0, TOP_N)
              .map((child) => buildNode(child))
          : [],
    }
  }

  return {
    id: 'root',
    pathKey: 'root',
    uci: 'root',
    displaySan: rootLabel,
    labelShort:
      rootLabel.length > 22 ? `${rootLabel.slice(0, 21)}…` : rootLabel,
    games: 0,
    freq: 100,
    path: [],
    isActive: activePath.length === 0,
    isOnActiveLine: true,
    canExpand: branches.length > 0,
    isExpanded: true,
    hasChildren: branches.length > 0,
    winRate: [0, 0, 0],
    children: branches.slice(0, TOP_N).map((b) => buildNode(b)),
  }
}

function linkColorFromWinRate(wr: [number, number, number] | number[]): string {
  if (!wr || wr.length < 3) return '#c8bfb0'
  const [w, , b] = wr
  if (w > b + 8) return '#3a7bd5'
  if (b > w + 8) return '#c0392b'
  return '#b0a898'
}

interface OpeningTreeProps {
  branches: OpeningTreeBranch[]
  rootLabel: string
  /** Length of the book line in plies, for Black “...SAN” labels */
  openingMoveCount: number
  activePath: string[]
  onSelectPath: (path: string[]) => void
}

export function OpeningTree({
  branches,
  rootLabel,
  openingMoveCount,
  activePath,
  onSelectPath,
}: OpeningTreeProps) {
  const svgRef = useRef<SVGSVGElement | null>(null)
  const [expandedPathKeys, setExpandedPathKeys] = useState<Set<string>>(() => new Set())
  const [tip, setTip] = useState<{
    x: number
    y: number
    d: TreeNodeDatum
  } | null>(null)

  // Expand along current line 
  useEffect(() => {
    if (branches.length === 0) return
    setExpandedPathKeys((prev) => {
      const next = new Set(prev)
      let level: OpeningTreeBranch[] = branches
      for (let i = 0; i < activePath.length; i += 1) {
        const sub = activePath.slice(0, i + 1)
        const found = findBranchAtPath(level, sub)
        if (!found) break
        next.add(toPathKey(found.path))
        level = found.children
      }
      return next
    })
  }, [activePath, branches])

  const data = useMemo(
    () =>
      buildTreeData(
        rootLabel,
        openingMoveCount,
        branches,
        activePath,
        expandedPathKeys,
      ),
    [branches, activePath, expandedPathKeys, rootLabel, openingMoveCount],
  )

  useEffect(() => {
    if (!svgRef.current || !data) return

    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()
    setTip(null)

    const root = d3.hierarchy(data)
    d3
      .tree<TreeNodeDatum>()
      .nodeSize([NODE_W + H_GAP, NODE_H + V_GAP])(
        root,
      )

    const nodes = root.descendants()
    const links = root.links()
    const minX = Math.min(...nodes.map((n) => n.x!))
    const maxX = Math.max(...nodes.map((n) => n.x!))
    const minY = Math.min(...nodes.map((n) => n.y!))
    const maxY = Math.max(...nodes.map((n) => n.y!))

    const svgW = Math.max(maxX - minX + NODE_W + MARGIN_X * 2, 400)
    const svgH = maxY - minY + NODE_H + MARGIN_Y * 2 + 40

    const freqScale = d3.scaleLinear<number>().domain([0, 100]).range([1.5, 7])

    svg
      .attr('viewBox', `0 0 ${svgW} ${svgH}`)
      .attr('class', 'opening-tree-canvas version2-tree')
      .style('font-family', "'DM Mono', ui-monospace, monospace")

    const g = svg
      .append('g')
      .attr('transform', `translate(${-minX + MARGIN_X + NODE_W / 2}, ${-minY + MARGIN_Y})`)

    const linkGen = d3
      .linkVertical<d3.HierarchyPointLink<TreeNodeDatum>, d3.HierarchyPointNode<TreeNodeDatum>>()
      .x((d) => d.x!)
      .y((d) => d.y!)

    g
      .selectAll('path.tree-link-root')
      .data(links.filter((l) => l.target.data.id !== 'root' && l.source.data.id === 'root'))
      .join('path')
      .attr('class', 'tree-link tree-link-root')
      .attr('d', (d) => linkGen(d as d3.HierarchyPointLink<TreeNodeDatum>) ?? '')
      .attr('fill', 'none')
      .attr('stroke', '#c8bfb0')
      .attr('stroke-width', 1.5)
      .attr('stroke-opacity', 0.5)

    g
      .selectAll('path.tree-link')
      .data(
        links.filter(
          (l) => l.target.data.id !== 'root' && l.source.data.id !== 'root',
        ),
      )
      .join('path')
      .attr('class', 'tree-link')
      .attr('d', (d) => linkGen(d as d3.HierarchyPointLink<TreeNodeDatum>) ?? '')
      .attr('fill', 'none')
      .attr('stroke', (d) => linkColorFromWinRate(d.target.data.winRate))
      .attr('stroke-width', (d) => freqScale(d.target.data.freq || 5))
      .attr('stroke-opacity', 0.7)

    const gNodes = g
      .selectAll<SVGGElement, d3.HierarchyPointNode<TreeNodeDatum>>('g.tree-node')
      .data(root.descendants())
      .join('g')
      .attr('class', 'tree-node')
      .attr('transform', (d) => `translate(${d.x},${d.y})`)
      .style('cursor', 'pointer')

    gNodes
      .filter((d) => d.data.id === 'root')
      .append('text')
      .attr('text-anchor', 'middle')
      .attr('dy', '0.35em')
      .attr('fill', '#8b5e2a')
      .attr('font-size', '11px')
      .attr('font-weight', 600)
      .text((d) => d.data.labelShort)

    const bn = gNodes.filter((d) => d.data.id !== 'root')

    const selectedPathKey = toPathKey(activePath)

    bn.append('rect')
      .attr('x', -NODE_W / 2)
      .attr('y', -NODE_H / 2)
      .attr('width', NODE_W)
      .attr('height', NODE_H)
      .attr('rx', 6)
      .attr('class', 'version2-tree-node-rect')
      .attr('fill', (d) => (d.data.pathKey === selectedPathKey ? '#fef9f0' : '#ffffff'))
      .attr('stroke', (d) => (d.data.pathKey === selectedPathKey ? '#8b5e2a' : '#d8d0c4'))
      .attr('stroke-width', (d) => (d.data.pathKey === selectedPathKey ? 2 : 1))

    bn.append('text')
      .attr('text-anchor', 'middle')
      .attr('y', -NODE_H / 2 + 16)
      .attr('fill', '#1a1a1a')
      .attr('font-size', '12px')
      .attr('font-weight', 600)
      .text((d) => d.data.labelShort)

    bn.append('text')
      .attr('text-anchor', 'middle')
      .attr('y', -NODE_H / 2 + 29)
      .attr('fill', '#8b8078')
      .attr('font-size', '8.5px')
      .text((d) => {
        const nm = `${d.data.games.toLocaleString()} games`
        return nm.length > 17 ? `${nm.slice(0, 16)}…` : nm
      })

    const barW = NODE_W - 16
    const wrW = (wr: [number, number, number], i: number): number => (barW * wr[i]) / 100
    const trackY = -NODE_H / 2 + 37
    bn.append('rect')
      .attr('x', -NODE_W / 2 + 8)
      .attr('y', trackY)
      .attr('width', barW)
      .attr('height', 3)
      .attr('rx', 1.5)
      .attr('fill', '#e8e0d4')
    bn.append('rect')
      .attr('x', -NODE_W / 2 + 8)
      .attr('y', trackY)
      .attr('width', (d) => (barW * Math.min(d.data.freq || 0, 100)) / 100)
      .attr('height', 3)
      .attr('rx', 1.5)
      .attr('fill', '#8b5e2a')

    const wrBarY = -NODE_H / 2 + 45
    bn.each(function (d) {
      const wr = d.data.winRate
      if (!wr || wr.length < 3) return
      const [wW, dW, bW] = [wrW(wr, 0), wrW(wr, 1), wrW(wr, 2)]
      const x0 = -NODE_W / 2 + 8
      const grp = d3.select(this)
      grp
        .append('rect')
        .attr('x', x0)
        .attr('y', wrBarY)
        .attr('width', wW)
        .attr('height', 11)
        .attr('fill', '#3a7bd5')
      if (wr[0] >= 15) {
        grp
          .append('text')
          .attr('x', x0 + wW / 2)
          .attr('y', wrBarY + 8)
          .attr('text-anchor', 'middle')
          .attr('font-size', '8px')
          .attr('fill', '#fff')
          .text(`${wr[0]}%`)
      }
      grp
        .append('rect')
        .attr('x', x0 + wW)
        .attr('y', wrBarY)
        .attr('width', dW)
        .attr('height', 11)
        .attr('fill', '#aaa')
      if (wr[1] >= 15) {
        grp
          .append('text')
          .attr('x', x0 + wW + dW / 2)
          .attr('y', wrBarY + 8)
          .attr('text-anchor', 'middle')
          .attr('font-size', '8px')
          .attr('fill', '#fff')
          .text(`${wr[1]}%`)
      }
      grp
        .append('rect')
        .attr('x', x0 + wW + dW)
        .attr('y', wrBarY)
        .attr('width', bW)
        .attr('height', 11)
        .attr('fill', '#c0392b')
      if (wr[2] >= 15) {
        grp
          .append('text')
          .attr('x', x0 + wW + dW + bW / 2)
          .attr('y', wrBarY + 8)
          .attr('text-anchor', 'middle')
          .attr('font-size', '8px')
          .attr('fill', '#fff')
          .text(`${wr[2]}%`)
      }
      grp
        .append('rect')
        .attr('x', x0)
        .attr('y', wrBarY)
        .attr('width', barW)
        .attr('height', 11)
        .attr('fill', 'none')
        .attr('stroke', '#d8d0c4')
        .attr('stroke-width', 0.5)
        .attr('rx', 2)
    })

    bn.append('text')
      .attr('text-anchor', 'middle')
      .attr('y', NODE_H / 2 - 5)
      .attr('fill', '#a89e94')
      .attr('font-size', '8px')
      .text((d) => `${d.data.freq}% of games`)

    bn.filter((d) => d.data.hasChildren && !d.data.isExpanded)
      .append('text')
      .attr('text-anchor', 'middle')
      .attr('y', NODE_H / 2 + 16)
      .attr('fill', '#c49a5a')
      .attr('font-size', '9px')
      .text('▼ click to expand')

    bn.filter((d) => d.data.hasChildren && d.data.isExpanded)
      .append('text')
      .attr('text-anchor', 'middle')
      .attr('y', NODE_H / 2 + 16)
      .attr('fill', '#c49a5a')
      .attr('font-size', '9px')
      .text('▲ collapse')

    bn
      .on('mousemove', (event: MouseEvent, d) => {
        if (!d.data) return
        setTip({ x: event.clientX, y: event.clientY, d: d.data })
      })
      .on('mouseleave', () => setTip(null))
      .on('click', (event: MouseEvent, d) => {
        event.stopPropagation()
        setTip(null)
        if (d.data.hasChildren) {
          setExpandedPathKeys((prev) => {
            const next = new Set(prev)
            const pk = d.data.pathKey
            if (next.has(pk)) {
              // Collapsing — remove this node and all descendants from expanded set,
              // but do NOT call onSelectPath so the active line stays unchanged
              for (const key of [...next]) {
                if (key === pk || key.startsWith(`${pk}>`)) {
                  next.delete(key)
                }
              }
              return next
            } else {
              // Expanding — also navigate to this node
              next.add(pk)
              onSelectPath(d.data.path)
              return next
            }
          })
        } else {
          // Leaf node — always navigate
          onSelectPath(d.data.path)
        }
      })

    d3.select(svgRef.current).on('click', () => {
      setTip(null)
    })

    return () => {
      d3.select(svgRef.current).on('click', null)
    }
  }, [data, onSelectPath, activePath])

  if (!data) {
    return <p className="detail-copy">Load PGN data to render the opening tree.</p>
  }

  return (
    <div className="opening-tree-wrap version2-tree-wrap">
      <svg
        ref={svgRef}
        className="opening-tree-canvas"
        role="img"
        aria-label="Opening tree"
      />
      {tip ? (
        <div
          className="opening-tree-tooltip"
          style={{
            left: tip.x + 14,
            top: tip.y - 10,
          }}
          role="tooltip"
        >
          <div className="opening-tree-tooltip-move">{tip.d.displaySan}</div>
          <div className="opening-tree-tooltip-name">
            {tip.d.games.toLocaleString()} games
          </div>
          <div className="opening-tree-tooltip-stats">
            Played {tip.d.freq}% of the time
          </div>
          {tip.d.winRate.length >= 3 ? (
            <div
              className="opening-tree-tooltip-wr"
              style={{
                display: 'flex',
                width: '100%',
                height: 10,
                borderRadius: 2,
                overflow: 'hidden',
                border: '0.5px solid #d8d0c4',
              }}
            >
              <span
                style={{
                  width: `${tip.d.winRate[0]}%`,
                  background: '#3a7bd5',
                }}
              />
              <span
                style={{ width: `${tip.d.winRate[1]}%`, background: '#aaa' }}
              />
              <span
                style={{
                  width: `${tip.d.winRate[2]}%`,
                  background: '#c0392b',
                }}
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}