/* ============================================================
   app.ts — Application state, openings, board render,
             playback controls, and initialisation.
   NOTE: Built-in opening tree data removed — app is purely
         data-driven from loaded PGN files.
============================================================ */

import {
    Board, Color, CastleState, EP, LegalMove, FullMove,
    FILES, RANKS, GLYPHS,
    initBoard, coordToRC, col, tp,
    legalFor, applyMv, allLegal, isInCheck, uciToSAN,
  } from './chess.js';
  import { HeatMode, computeCtrl, applyHeatOverlay, toggleHeat } from './heatmap.js';
  import {
    TrieNode,
    buildOpeningSANCache, trieToTree, mergeTries, freshTries,
    parsePGN, saveCache, loadCache,
    PGN_FILENAME,
  } from './pgn.js';
  import { renderTree } from './tree.js';
  
  // ── Shared types ──────────────────────────────────────────────
  export interface TreeBranch {
    uci: string;
    san: string;
    name: string;
    freq: number;
    wr: [number, number, number];
    games: number;
    children: TreeBranch[];
  }
  
  export interface ActiveTree {
    branches: TreeBranch[];
  }
  
  export interface Opening {
    name: string;
    desc: string;
    moves: string[];       // UCI strings, e.g. ['e2e4','e7e5',...]
    blackSide?: boolean;   // true → auto-flip board to Black's perspective
  }
  
  // ── Opening definitions (moves only — no built-in tree data) ──
  export const OPENINGS: Opening[] = [
    {
      name: 'Ruy Lopez',
      desc: 'One of the oldest and most classical openings. White attacks the knight defending e5 immediately.',
      moves: ['e2e4','e7e5','g1f3','b8c6','f1b5'],
    },
    {
      name: 'Sicilian Defense',
      blackSide: true,
      desc: "Black's most popular reply to 1.e4, creating asymmetry and fighting for the center from the flank.",
      moves: ['e2e4','c7c5','g1f3','d7d6','d2d4','c5d4','f3d4','g8f6','b1c3'],
    },
    {
      name: "Queen's Gambit",
      desc: 'White offers a pawn to gain central control. One of the most respected openings at all levels.',
      moves: ['d2d4','d7d5','c2c4'],
    },
    {
      name: "King's Indian Defense",
      blackSide: true,
      desc: "Black allows White to build a center then strikes back with ...e5 or ...c5.",
      moves: ['d2d4','g8f6','c2c4','g7g6','b1c3','f8g7','e2e4','d7d6','g1f3','e8g8'],
    },
    {
      name: 'Italian Game',
      desc: 'A classical opening aiming for quick development and control of the center.',
      moves: ['e2e4','e7e5','g1f3','b8c6','f1c4'],
    },
    {
      name: 'French Defense',
      blackSide: true,
      desc: "Black builds a solid pawn chain but can end up with a passive bishop on c8.",
      moves: ['e2e4','e7e6','d2d4','d7d5','b1c3'],
    },
    {
      name: 'Caro-Kann Defense',
      blackSide: true,
      desc: 'A solid defense to 1.e4, supporting d5 with c6 without blocking the c8 bishop.',
      moves: ['e2e4','c7c6','d2d4','d7d5','b1c3'],
    },
    {
      name: "King's Gambit",
      desc: 'An aggressive opening sacrificing a pawn for rapid development and a strong center.',
      moves: ['e2e4','e7e5','f2f4'],
    },
    {
      name: 'London System',
      desc: "A solid, reliable system for White with quick development and a sturdy pawn structure.",
      moves: ['d2d4','d7d5','g1f3','g8f6','c1f4','e7e6','e2e3'],
    },
    {
      name: 'Nimzo-Indian Defense',
      blackSide: true,
      desc: "Black pins the knight on c3 immediately, fighting for e4 and creating structural weaknesses.",
      moves: ['d2d4','g8f6','c2c4','e7e6','b1c3','f8b4'],
    },
    {
      name: 'English Opening',
      desc: "A flexible flank opening. White controls d5 with a pawn on c4 before committing the center.",
      moves: ['c2c4','e7e5','b1c3','g8f6','g1f3','b8c6'],
    },
  ];
  
  // ── Application state ─────────────────────────────────────────
  export let board: Board           = initBoard();
  export let turn: Color            = 'w';
  export let selected: [number,number] | null = null;
  export let legalMoves: LegalMove[] = [];
  export let historyStack: FullMove[] = [];
  export let castleRights: CastleState = { w:{k:true,q:true}, b:{k:true,q:true} };
  export let enPassant: EP          = null;
  export let moveLog: string[]      = [];
  export let openingMoveIndex       = 0;
  export let isPlayingOpening       = false;
  export let freePlay               = false;
  export let currentOpening: Opening = OPENINGS[0];
  export let heatMode: HeatMode     = 'off';
  export let boardFlipped           = false;
  export let treeBoards: Board[]    = [];
  export let pgnTree: TrieNode[] | null = null;
  export let usingPGN               = false;
  export let totalPGNGames          = 0;
  
  let playInterval: ReturnType<typeof setInterval> | null = null;
  
  const speedMs     = [1200, 900, 650, 400, 220];
  const speedLabels = ['Slowest', 'Slow', 'Medium', 'Fast', 'Fastest'];
  
  // ── State setters (used by tree.ts) ──────────────────────────
  export function setBoard(b: Board)               { board = b; }
  export function setTurn(t: Color)                { turn = t; }
  export function setEnPassant(ep: EP)             { enPassant = ep; }
  export function setCastleRights(cr: CastleState) { castleRights = cr; }
  export function setHistoryStack(h: FullMove[])   { historyStack = h; }
  export function setMoveLog(ml: string[])         { moveLog = ml; }
  export function setFreePlay(v: boolean)          { freePlay = v; }
  export function setOpeningMoveIndex(n: number)   { openingMoveIndex = n; }
  export function setPgnTree(t: TrieNode[] | null) { pgnTree = t; }
  export function setUsingPGN(v: boolean)          { usingPGN = v; }
  export function setTotalPGNGames(n: number)      { totalPGNGames = n; }
  export function stopPlaybackExport()             { stopPlayback(); }
  
  // ── Active tree — PGN only, no built-in fallback ─────────────
  export function getActiveTree(): ActiveTree | null {
    const oi = OPENINGS.indexOf(currentOpening);
    if (usingPGN && pgnTree && pgnTree[oi]) {
      const c = buildOpeningSANCache(OPENINGS)[oi];
      return { branches: trieToTree(pgnTree[oi], c.postBoard, c.postTurn, c.postEP, c.postCR, 0) };
    }
    // No PGN loaded — return null so tree shows "load a PGN file" placeholder
    return null;
  }
  
  // ── Playback ──────────────────────────────────────────────────
  function execMove(uci: string): boolean {
    const [fr, fc] = coordToRC(uci.slice(0, 2));
    const [tr, tc] = coordToRC(uci.slice(2, 4));
    const legal = legalFor(board, fr, fc, enPassant, castleRights);
    const found = legal.find(mv => mv[0] === tr && mv[1] === tc);
    if (!found) return false;
    const flag = found[2], p = board[fr][fc]!;
    const san  = uciToSAN(board, uci, turn, enPassant, castleRights);
    const newEP: EP = tp(p) === 'P' && Math.abs(tr - fr) === 2 ? [(fr + tr) / 2, fc] : null;
    if (tp(p) === 'K') { castleRights[col(p)!].k = false; castleRights[col(p)!].q = false; }
    if (p === 'wR' && fr === 7) { if (fc === 7) castleRights.w.k = false; if (fc === 0) castleRights.w.q = false; }
    if (p === 'bR' && fr === 0) { if (fc === 7) castleRights.b.k = false; if (fc === 0) castleRights.b.q = false; }
    historyStack.push([fr, fc, tr, tc]);
    moveLog.push(san);
    board      = applyMv(board, fr, fc, tr, tc, flag, enPassant);
    enPassant  = newEP;
    turn       = turn === 'w' ? 'b' : 'w';
    openingMoveIndex++;
    return true;
  }
  
  function stopPlayback(): void {
    if (playInterval) { clearInterval(playInterval); playInterval = null; }
    isPlayingOpening = false;
    const btn = document.getElementById('btn-play');
    if (btn) btn.textContent = '▶ Play';
  }
  
  function startPlayback(): void {
    if (openingMoveIndex >= currentOpening.moves.length) return;
    isPlayingOpening = true;
    const btn = document.getElementById('btn-play');
    if (btn) btn.textContent = '⏸ Pause';
    const slider = document.getElementById('speed-slider') as HTMLInputElement;
    const spd = speedMs[parseInt(slider.value) - 1];
    playInterval = setInterval(() => {
      if (openingMoveIndex >= currentOpening.moves.length) { stopPlayback(); render(); return; }
      execMove(currentOpening.moves[openingMoveIndex]);
      render();
    }, spd);
  }
  
  export function resetOpening(): void {
    stopPlayback();
    board          = initBoard();
    turn           = 'w';
    selected       = null;
    legalMoves     = [];
    historyStack   = [];
    castleRights   = { w:{k:true,q:true}, b:{k:true,q:true} };
    enPassant      = null;
    moveLog        = [];
    openingMoveIndex = 0;
    freePlay       = false;
    treeBoards     = [JSON.parse(JSON.stringify(board))];
    // Reset tree module state
    (window as any)._treeSelectedPathKey = '';
    (window as any)._treeExpandedNodes   = new Set<string>();
    renderTree();
    render();
  }
  
  // ── Board render ──────────────────────────────────────────────
  export function render(): void {
    const boardEl = document.getElementById('board');
    if (!boardEl) return;
    boardEl.innerHTML = '';
  
    const inCheck = isInCheck(board, turn, enPassant, castleRights);
    let kingR = -1, kingC = -1;
    if (inCheck) {
      for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
        if (board[r][c] === turn + 'K') { kingR = r; kingC = c; }
      }
    }
  
    const lastMove: FullMove | null = historyStack.length
      ? historyStack[historyStack.length - 1]
      : null;
  
    let wMap: number[][] | null = null;
    let bMap: number[][] | null = null;
    if (heatMode !== 'off') {
      const ctrl = computeCtrl(board);
      wMap = ctrl.w;
      bMap = ctrl.b;
    }
  
    const rowOrder = boardFlipped ? [7,6,5,4,3,2,1,0] : [0,1,2,3,4,5,6,7];
    const colOrder = boardFlipped ? [7,6,5,4,3,2,1,0] : [0,1,2,3,4,5,6,7];
  
    for (const r of rowOrder) {
      for (const c of colOrder) {
        const sq = document.createElement('div');
        sq.className = 'sq ' + ((r + c) % 2 === 0 ? 'light' : 'dark');
        const piece = board[r][c];
  
        if (lastMove && (
          (r === lastMove[0] && c === lastMove[1]) ||
          (r === lastMove[2] && c === lastMove[3])
        )) sq.classList.add('last-move');
  
        if (selected && selected[0] === r && selected[1] === c)
          sq.classList.add('selected');
  
        const isLegal = legalMoves.some(mv => mv[0] === r && mv[1] === c);
        if (isLegal) {
          sq.classList.add('legal');
          if (piece) sq.classList.add('has-piece');
        }
  
        if (inCheck && r === kingR && c === kingC)
          sq.classList.add('check-king');
  
        if (heatMode !== 'off' && wMap && bMap)
          applyHeatOverlay(sq, wMap[r][c], bMap[r][c], heatMode);
  
        if (piece) {
          const pl = document.createElement('span');
          pl.className = 'piece-label ' + (col(piece) === 'w' ? 'white-piece' : 'black-piece');
          pl.textContent = GLYPHS[piece];
          sq.appendChild(pl);
        }
  
        sq.addEventListener('click', () => handleClick(r, c));
        boardEl.appendChild(sq);
      }
    }
  
    // Coordinate labels
    const rl = document.getElementById('rank-labels');
    if (rl) {
      rl.innerHTML = '';
      const rankOrder = boardFlipped ? [...RANKS].reverse() : RANKS;
      rankOrder.forEach(rk => {
        const d = document.createElement('div');
        d.className = 'coord';
        d.textContent = rk;
        rl.appendChild(d);
      });
    }
  
    const fl = document.getElementById('file-labels');
    if (fl) {
      fl.innerHTML = '';
      const fileOrder = boardFlipped ? [...FILES].reverse() : FILES;
      fileOrder.forEach(f => {
        const d = document.createElement('div');
        d.className = 'coord';
        d.textContent = f;
        fl.appendChild(d);
      });
    }
  
    // Status bar
    const total  = currentOpening.moves.length;
    const progEl = document.getElementById('move-progress');
    if (progEl) progEl.textContent = `${openingMoveIndex}/${total}`;
  
    const all    = allLegal(board, turn, enPassant, castleRights);
    const status = document.getElementById('status-bar');
    const tName  = turn === 'w' ? 'White' : 'Black';
  
    if (status) {
      if (freePlay || openingMoveIndex >= total) {
        if (all.length === 0) {
          status.innerHTML = inCheck
            ? `<strong>${tName}</strong> is in checkmate!`
            : 'Stalemate — draw!';
        } else {
          status.innerHTML = (inCheck ? '<strong>Check!</strong> ' : '')
            + `<strong>${tName}</strong>'s turn`;
        }
      } else {
        const nextMv    = currentOpening.moves[openingMoveIndex];
        const movingCol = openingMoveIndex % 2 === 0 ? 'White' : 'Black';
        status.innerHTML = isPlayingOpening
          ? `Playing <strong>${currentOpening.name}</strong> — move ${openingMoveIndex + 1}`
          : `Next: <strong>${movingCol}</strong> plays ${nextMv.slice(0,2)}→${nextMv.slice(2,4)}`;
      }
    }
  
    // Move log
    const log = document.getElementById('move-log');
    if (log) {
      const openingHalfMoves = currentOpening.moves.length;
      log.innerHTML = moveLog.map((m, i) => {
        const halfMove  = openingHalfMoves + i;
        const moveNum   = Math.floor(halfMove / 2) + 1;
        const suffix    = halfMove % 2 === 0 ? '.' : '…';
        const isCurrent = freePlay
          ? i === moveLog.length - 1
          : i === openingMoveIndex - 1;
        return `<span class="move-chip${isCurrent ? ' current' : ''}">${moveNum}${suffix} ${m}</span>`;
      }).join('');
      log.scrollTop = log.scrollHeight;
    }
  
    if (openingMoveIndex === total && treeBoards.length === 1) {
      treeBoards[0] = JSON.parse(JSON.stringify(board));
      renderTree();
    }
  }
  
  function handleClick(r: number, c: number): void {
    if (isPlayingOpening) return;
    if (!freePlay && openingMoveIndex < currentOpening.moves.length) return;
    const all = allLegal(board, turn, enPassant, castleRights);
    if (all.length === 0) return;
  
    if (selected) {
      const mv = legalMoves.find(m => m[0] === r && m[1] === c);
      if (mv) {
        const [tr, tc, flag] = mv;
        const fr = selected[0], fc = selected[1];
        const san = uciToSAN(
          board,
          FILES[fc] + RANKS[fr] + FILES[tc] + RANKS[tr],
          turn, enPassant, castleRights
        );
        moveLog.push(san);
        historyStack.push([fr, fc, tr, tc]);
        const newEP: EP = tp(board[fr][fc]) === 'P' && Math.abs(tr - fr) === 2
          ? [(fr + tr) / 2, fc] : null;
        const p = board[fr][fc]!;
        if (tp(p) === 'K') { castleRights[col(p)!].k = false; castleRights[col(p)!].q = false; }
        if (p === 'wR' && fr === 7) { if (fc===7) castleRights.w.k=false; if (fc===0) castleRights.w.q=false; }
        if (p === 'bR' && fr === 0) { if (fc===7) castleRights.b.k=false; if (fc===0) castleRights.b.q=false; }
        board     = applyMv(board, fr, fc, tr, tc, flag, enPassant);
        enPassant = newEP;
        turn      = turn === 'w' ? 'b' : 'w';
        selected  = null;
        legalMoves = [];
        render();
        return;
      }
      if (col(board[r][c]) === turn) {
        selected   = [r, c];
        legalMoves = legalFor(board, r, c, enPassant, castleRights);
        render();
        return;
      }
      selected   = null;
      legalMoves = [];
      render();
      return;
    }
  
    if (col(board[r][c]) === turn) {
      selected   = [r, c];
      legalMoves = legalFor(board, r, c, enPassant, castleRights);
      render();
    }
  }
  
  // ── PGN multi-file loading ────────────────────────────────────
  interface LoadedFile { name: string; games: number; fromCache: boolean; }
  interface FileProgress { done: number; total: number; rate: number; }
  
  let pgnLoadedFiles: LoadedFile[] = [];
  let pgnFileProgresses: Record<string, FileProgress> = {};
  
  function updateDatasetUI(): void {
    const totalGames = pgnLoadedFiles.reduce((s, f) => s + f.games, 0);
    const badge = document.getElementById('data-badge');
    if (badge) {
      badge.className   = 'data-badge pgn';
      badge.textContent = pgnLoadedFiles.length === 1
        ? pgnLoadedFiles[0].name
        : `${pgnLoadedFiles.length} files`;
    }
    const stats = document.getElementById('pgn-stats');
    if (!stats) return;
    stats.style.display = 'block';
    const fileList = pgnLoadedFiles.map(f =>
      `<span style="display:inline-flex;align-items:center;gap:4px;margin-right:8px;">` +
      `<strong style="color:var(--accent)">${f.name}</strong> ` +
      `<span style="color:var(--text-muted)">${f.games.toLocaleString()} games${f.fromCache ? ' ⚡' : ''}</span>` +
      `<span style="cursor:pointer;color:var(--text-dim);font-size:10px;" ` +
      `onclick="window._removeFile('${f.name}')">✕</span></span>`
    ).join('');
    const counts = pgnTree ? pgnTree.map(t => t.w + t.b + t.d) : [];
    stats.innerHTML =
      `<div style="margin-bottom:6px;">${fileList}</div>` +
      `<strong style="color:var(--accent)">${totalGames.toLocaleString()}</strong> total games · ` +
      OPENINGS.map((op, i) =>
        `${op.name}: <strong>${(counts[i] || 0).toLocaleString()}</strong>`
      ).join(' · ');
  }
  
  function updateProgressUI(): void {
    const fill         = document.getElementById('progress-fill');
    const progressText = document.getElementById('progress-text');
    const files = Object.entries(pgnFileProgresses);
    if (!files.length || !fill || !progressText) return;
    const totalDone  = files.reduce((s, [, v]) => s + v.done,  0);
    const totalTotal = files.reduce((s, [, v]) => s + v.total, 0);
    const pct = totalTotal > 0 ? Math.round(totalDone / totalTotal * 100) : 0;
    fill.style.width = pct + '%';
    const lines = files.map(([name, v]) => {
      const fp = v.total > 0 ? Math.round(v.done / v.total * 100) : 0;
      const rate = v.rate ? `${Math.round(v.rate).toLocaleString()}/s` : '';
      return `${name}: ${v.done.toLocaleString()}/${v.total.toLocaleString()} (${fp}%) ${rate}`;
    });
    progressText.textContent = lines.join('  |  ');
  }
  
  function onFileTriesReady(
    tries: TrieNode[], totalGames: number,
    sourceName: string, fromCache: boolean
  ): void {
    if (!pgnTree) pgnTree = freshTries(OPENINGS.length);
    mergeTries(pgnTree, tries);
    usingPGN       = true;
    totalPGNGames += totalGames;
    pgnLoadedFiles.push({ name: sourceName, games: totalGames, fromCache });
    delete pgnFileProgresses[sourceName];
  
    if (Object.keys(pgnFileProgresses).length === 0) {
      document.getElementById('pgn-progress')?.classList.remove('visible');
      updateDatasetUI();
      resetOpening();
    } else {
      updateProgressUI();
      updateDatasetUI();
    }
  }
  
  // Exposed to HTML onclick via window
  (window as any)._removeFile = function(filename: string): void {
    pgnLoadedFiles = pgnLoadedFiles.filter(f => f.name !== filename);
    if (pgnLoadedFiles.length === 0) {
      pgnTree = null; usingPGN = false; totalPGNGames = 0;
      const badge = document.getElementById('data-badge');
      if (badge) { badge.className = 'data-badge builtin'; badge.textContent = 'No data'; }
      const statsEl = document.getElementById('pgn-stats');
      if (statsEl) statsEl.style.display = 'none';
      resetOpening();
      return;
    }
    const merged = freshTries(OPENINGS.length);
    for (const f of pgnLoadedFiles) {
      const cached = loadCache(f.name);
      if (cached) mergeTries(merged, cached.tries);
    }
    pgnTree        = merged;
    totalPGNGames  = pgnLoadedFiles.reduce((s, f) => s + f.games, 0);
    updateDatasetUI();
    resetOpening();
  };
  
  function parseFileText(text: string, sourceName: string): void {
    const t0 = performance.now();
    parsePGN(text, OPENINGS,
      (done, total) => {
        const rate = done / Math.max(0.001, (performance.now() - t0) / 1000);
        pgnFileProgresses[sourceName] = { done, total, rate };
        updateProgressUI();
      },
      (tries, total) => {
        console.log(`[pgn] ${sourceName}: ${total.toLocaleString()} games in ${((performance.now()-t0)/1000).toFixed(1)}s`);
        saveCache(sourceName, tries, total);
        onFileTriesReady(tries, total, sourceName, false);
      }
    );
  }
  
  function loadFileOrCache(file: File): void {
    const cached = loadCache(file.name);
    if (cached) {
      if (pgnLoadedFiles.find(f => f.name === file.name)) return;
      pgnFileProgresses[file.name] = { done: cached.totalGames, total: cached.totalGames, rate: 0 };
      updateProgressUI();
      setTimeout(() => onFileTriesReady(cached.tries, cached.totalGames, file.name, true), 10);
      return;
    }
    pgnFileProgresses[file.name] = { done: 0, total: 1, rate: 0 };
    updateProgressUI();
    const reader = new FileReader();
    reader.onload = e => parseFileText((e.target as FileReader).result as string, file.name);
    reader.readAsText(file);
  }
  
  function handlePGNFiles(files: File[]): void {
    if (!files.length) return;
    document.getElementById('pgn-progress')?.classList.add('visible');
    const statsEl = document.getElementById('pgn-stats');
    if (statsEl) statsEl.style.display = 'none';
    for (const file of files) loadFileOrCache(file);
  }
  
  async function autoLoadPGN(): Promise<void> {
    const titleEl = document.getElementById('pgn-zone-title');
    const filenames = Array.isArray(PGN_FILENAME) ? PGN_FILENAME : [PGN_FILENAME];
  
    for (const filename of filenames) {
      const cached = loadCache(filename);
      if (cached) {
        if (titleEl) titleEl.textContent = '⚡ Loading from cache...';
        pgnFileProgresses[filename] = { done: cached.totalGames, total: cached.totalGames, rate: 0 };
        setTimeout(() => onFileTriesReady(cached.tries, cached.totalGames, filename, true), 50);
        continue;
      }
      try {
        if (titleEl) titleEl.textContent = `⏳ Fetching ${filename}...`;
        const resp = await fetch(filename);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const cl = resp.headers.get('Content-Length');
        let text: string;
        if (cl && resp.body) {
          const total   = parseInt(cl);
          const reader  = resp.body.getReader();
          const decoder = new TextDecoder();
          let received  = 0;
          const chunks: string[] = [];
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(decoder.decode(value, { stream: true }));
            received += value.length;
            if (titleEl) titleEl.textContent = `⏳ Reading ${filename}... ${Math.round(received/total*100)}%`;
          }
          text = chunks.join('');
        } else {
          text = await resp.text();
        }
        pgnFileProgresses[filename] = { done: 0, total: 1, rate: 0 };
        document.getElementById('pgn-progress')?.classList.add('visible');
        parseFileText(text, filename);
      } catch {
        const zoneText = document.getElementById('pgn-zone-text');
        if (zoneText) {
          zoneText.innerHTML =
            `<strong id="pgn-zone-title" style="color:var(--accent)">⬆ Load PGN file(s)</strong>
             Drag &amp; drop one or more .pgn files, or click to browse<br>
             <span style="font-size:10px;color:var(--text-dim);">Multiple files merged. Cached after first parse.</span>`;
        }
      }
    }
  }
  
  export function initPGNListeners(): void {
    const input = document.getElementById('pgn-file') as HTMLInputElement | null;
    if (input) {
      input.setAttribute('multiple', '');
      input.addEventListener('change', e => {
        const files = Array.from((e.target as HTMLInputElement).files ?? []);
        if (files.length) handlePGNFiles(files);
      });
    }
    const zone = document.getElementById('pgn-zone');
    if (zone) {
      zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
      zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
      zone.addEventListener('drop', e => {
        e.preventDefault();
        zone.classList.remove('drag-over');
        const files = Array.from((e as DragEvent).dataTransfer?.files ?? [])
          .filter(f => f.name.endsWith('.pgn'));
        if (files.length) handlePGNFiles(files);
      });
    }
  }
  
  // ── UI init ───────────────────────────────────────────────────
  function updateFlipButton(): void {
    const btn = document.getElementById('btn-flip');
    if (btn) btn.textContent = boardFlipped ? '⟳ White side' : '⟳ Black side';
  }
  
  function populateSelect(): void {
    const sel = document.getElementById('opening-select') as HTMLSelectElement | null;
    if (!sel) return;
    OPENINGS.forEach((op, i) => {
      const opt = document.createElement('option');
      opt.value       = String(i);
      opt.textContent = op.name;
      sel.appendChild(opt);
    });
    sel.addEventListener('change', () => {
      currentOpening = OPENINGS[parseInt(sel.value)];
      const descEl = document.getElementById('opening-desc');
      if (descEl) descEl.textContent = currentOpening.desc;
      boardFlipped = !!currentOpening.blackSide;
      updateFlipButton();
      resetOpening();
    });
    const descEl = document.getElementById('opening-desc');
    if (descEl) descEl.textContent = OPENINGS[0].desc;
  }
  
  // Expose toggleHeat globally for inline onclick in HTML
  (window as any).toggleHeat = (mode: HeatMode): void => {
    heatMode = mode;
    toggleHeat(mode, render);
  };
  
  // ── Button event listeners ────────────────────────────────────
  document.getElementById('btn-play')?.addEventListener('click', () => {
    if (isPlayingOpening) {
      stopPlayback(); render();
    } else {
      if (openingMoveIndex >= currentOpening.moves.length) {
        resetOpening();
        setTimeout(startPlayback, 80);
      } else {
        startPlayback();
      }
    }
  });
  
  document.getElementById('btn-prev')?.addEventListener('click', () => {
    stopPlayback();
    if (openingMoveIndex === 0) return;
    const target = openingMoveIndex - 1;
    board          = initBoard();
    turn           = 'w';
    historyStack   = [];
    moveLog        = [];
    enPassant      = null;
    castleRights   = { w:{k:true,q:true}, b:{k:true,q:true} };
    openingMoveIndex = 0;
    for (let i = 0; i < target; i++) execMove(currentOpening.moves[i]);
    render();
  });
  
  document.getElementById('btn-next')?.addEventListener('click', () => {
    stopPlayback();
    if (openingMoveIndex < currentOpening.moves.length) {
      execMove(currentOpening.moves[openingMoveIndex]);
      if (openingMoveIndex === currentOpening.moves.length)
        treeBoards[0] = JSON.parse(JSON.stringify(board));
      render();
      renderTree();
    }
  });
  
  document.getElementById('btn-reset')?.addEventListener('click', resetOpening);
  
  document.getElementById('btn-flip')?.addEventListener('click', () => {
    boardFlipped = !boardFlipped;
    updateFlipButton();
    render();
  });
  
  document.getElementById('btn-free')?.addEventListener('click', () => {
    freePlay       = true;
    treeBoards[0]  = JSON.parse(JSON.stringify(board));
    renderTree();
    render();
  });
  
  (document.getElementById('speed-slider') as HTMLInputElement | null)
    ?.addEventListener('input', function () {
      const idx = parseInt((this as HTMLInputElement).value) - 1;
      const lbl = document.getElementById('speed-label');
      if (lbl) lbl.textContent = speedLabels[idx];
      if (isPlayingOpening) { stopPlayback(); startPlayback(); }
    });
  
  // ── Bootstrap ─────────────────────────────────────────────────
  populateSelect();
  board            = initBoard();
  turn             = 'w';
  selected         = null;
  legalMoves       = [];
  historyStack     = [];
  castleRights     = { w:{k:true,q:true}, b:{k:true,q:true} };
  enPassant        = null;
  moveLog          = [];
  openingMoveIndex = 0;
  freePlay         = false;
  treeBoards       = [JSON.parse(JSON.stringify(board))];
  initPGNListeners();
  renderTree();
  render();
  autoLoadPGN();