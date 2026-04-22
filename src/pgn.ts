/* ============================================================
   pgn.ts — PGN parsing, trie construction, localStorage cache
============================================================ */

import {
    Board, Color, CastleState, EP, MoveFlag,
    initBoard, coordToRC, FILES, RANKS,
    legalFor, applyMv, allLegal, uciToSAN, col, tp,
  } from './chess.js';
  import type { Opening, TreeBranch, ActiveTree } from './app.js';
  
  // ── Constants ────────────────────────────────────────────────
  export const PGN_FILENAME: string | string[] = 'lichess_elite_2025-11.pgn';
  const TREE_DEPTH_LIMIT = 4;
  const MAX_BRANCHES     = 6;
  const CACHE_VERSION    = 3;
  const CHUNK_SIZE       = 2000;
  
  // ── Types ────────────────────────────────────────────────────
  export interface TrieNode {
    children: Map<string, TrieNode>;
    w: number; b: number; d: number;
  }
  export type GameResult = 'w' | 'b' | 'd';
  
  interface TrieJSON {
    w: number; b: number; d: number;
    c: Record<string, TrieJSON>;
  }
  
  export interface OpeningSANEntry {
    sanMoves: string[];
    postBoard: Board;
    postTurn: Color;
    postEP: EP;
    postCR: CastleState;
  }
  
  export interface LoadedFile {
    name: string;
    games: number;
    fromCache: boolean;
  }
  
  // ── Module state (accessed via app.ts globals) ───────────────
  let openingSANCache: OpeningSANEntry[] | null = null;
  export let loadedFiles: LoadedFile[] = [];
  export let fileProgresses: Record<string, { done: number; total: number; rate: number }> = {};
  
  // ── Opening SAN cache ────────────────────────────────────────
  export function buildOpeningSANCache(openings: Opening[]): OpeningSANEntry[] {
    if (openingSANCache) return openingSANCache;
    openingSANCache = openings.map(op => {
      let bd = initBoard(), trn: Color = 'w', ep: EP = null;
      let cr: CastleState = { w:{k:true,q:true}, b:{k:true,q:true} };
      const sanMoves: string[] = [];
      for (const uci of op.moves) {
        const [fr, fc] = coordToRC(uci.slice(0, 2));
        const [tr, tc] = coordToRC(uci.slice(2, 4));
        const legal = legalFor(bd, fr, fc, ep, cr);
        const found = legal.find(mv => mv[0] === tr && mv[1] === tc);
        if (!found) break;
        sanMoves.push(uciToSAN(bd, uci, trn, ep, cr));
        bd = applyMv(bd, fr, fc, tr, tc, found[2], ep);
        ep = tp(bd[tr][tc]) === 'P' && Math.abs(tr-fr) === 2 ? [(fr+tr)/2, fc] : null;
        if (tp(bd[tr][tc]) === 'K') { cr[col(bd[tr][tc])!].k = false; cr[col(bd[tr][tc])!].q = false; }
        if (bd[tr][tc] === 'wR' && fr === 7) { if (fc===7) cr.w.k=false; if (fc===0) cr.w.q=false; }
        if (bd[tr][tc] === 'bR' && fr === 0) { if (fc===7) cr.b.k=false; if (fc===0) cr.b.q=false; }
        trn = trn === 'w' ? 'b' : 'w';
      }
      return { sanMoves, postBoard: bd, postTurn: trn, postEP: ep, postCR: cr };
    });
    return openingSANCache;
  }
  
  // ── SAN normalisation ─────────────────────────────────────────
  function normSAN(san: string): string {
    return san.replace(/[+#!?]/g, '');
  }
  
  // ── SAN → UCI (for branch moves after opening) ───────────────
  export function sanToUCI(
    bd: Board, san: string, turnCol: Color, ep: EP, cr: CastleState
  ): string | null {
    const clean = san.replace(/[+#!?x]/g, '').replace(/=/g, '');
  
    if (clean === 'O-O' || clean === '0-0') {
      const rank = turnCol === 'w' ? 7 : 0;
      return `e${8-rank}g${8-rank}`;
    }
    if (clean === 'O-O-O' || clean === '0-0-0') {
      const rank = turnCol === 'w' ? 7 : 0;
      return `e${8-rank}c${8-rank}`;
    }
  
    const legal = allLegal(bd, turnCol, ep, cr);
    for (const [fr, fc, tr, tc] of legal) {
      const p = bd[fr][fc]; if (!p) continue;
      const pt2 = tp(p)!;
      const dest = FILES[tc] + RANKS[tr];
      if (pt2 === 'P') {
        if (clean === dest || clean === FILES[fc] + dest) {
          const promo = san.includes('=') ? san.slice(san.indexOf('=')+1, san.indexOf('=')+2) : null;
          return FILES[fc]+RANKS[fr]+FILES[tc]+RANKS[tr]+(promo?promo.toLowerCase():'');
        }
      } else {
        const letter = clean[0];
        if (letter !== pt2) continue;
        const rest = clean.slice(1);
        const destStr = rest.slice(-2);
        if (destStr !== dest) continue;
        const disambig = rest.slice(0, -2);
        if (
          disambig.length === 0 ||
          (disambig.length === 1 && (disambig === FILES[fc] || disambig === RANKS[fr])) ||
          disambig === FILES[fc]+RANKS[fr]
        ) return FILES[fc]+RANKS[fr]+FILES[tc]+RANKS[tr];
      }
    }
    const destMatch = clean.slice(-2);
    const dr = 8-parseInt(destMatch[1]), dc = FILES.indexOf(destMatch[0]);
    if (dr >= 0 && dr < 8 && dc >= 0 && dc < 8) {
      for (const [fr, fc, tr, tc] of legal) {
        if (tr !== dr || tc !== dc) continue;
        const p = bd[fr][fc]; if (!p) continue;
        const pt2 = tp(p)!, letter = clean[0];
        if (pt2==='P' && (letter===destMatch[0]||letter===FILES[fc]))
          return FILES[fc]+RANKS[fr]+FILES[tc]+RANKS[tr];
        if (pt2!=='P' && letter===pt2)
          return FILES[fc]+RANKS[fr]+FILES[tc]+RANKS[tr];
      }
    }
    return null;
  }
  
  // ── Trie helpers ─────────────────────────────────────────────
  export function freshTries(count: number): TrieNode[] {
    return Array.from({ length: count }, () => ({ children: new Map(), w:0, b:0, d:0 }));
  }
  
  function insertIntoTrie(trie: TrieNode, uciMoves: string[], result: GameResult): void {
    let node = trie;
    if (result==='w') node.w++; else if (result==='b') node.b++; else node.d++;
    for (const uci of uciMoves) {
      if (!node.children.has(uci)) node.children.set(uci, {children:new Map(),w:0,b:0,d:0});
      node = node.children.get(uci)!;
      if (result==='w') node.w++; else if (result==='b') node.b++; else node.d++;
    }
  }
  
  export function trieToTree(
    node: TrieNode, bd: Board, turnCol: Color, ep: EP, cr: CastleState, depth: number
  ): TreeBranch[] {
    if (depth >= TREE_DEPTH_LIMIT || node.children.size === 0) return [];
    const total = node.w + node.b + node.d;
    const entries = [...node.children.entries()];
    entries.sort((a, b) => (b[1].w+b[1].b+b[1].d)-(a[1].w+a[1].b+a[1].d));
    return entries.slice(0, MAX_BRANCHES).map(([uci, child]) => {
      const childTotal = child.w+child.b+child.d;
      const freq = total>0 ? Math.round(childTotal/total*100) : 0;
      const wr: [number,number,number] = childTotal>0
        ? [Math.round(child.w/childTotal*100), Math.round(child.d/childTotal*100), Math.round(child.b/childTotal*100)]
        : [33, 34, 33];
      const [fr,fc] = coordToRC(uci.slice(0,2));
      const [tr,tc] = coordToRC(uci.slice(2,4));
      const legal = legalFor(bd, fr, fc, ep, cr);
      const found = legal.find(mv => mv[0]===tr && mv[1]===tc);
      const nextBd = found ? applyMv(bd,fr,fc,tr,tc,found[2],ep) : bd;
      const nextEP: EP = found && tp(bd[fr][fc])==='P' && Math.abs(tr-fr)===2 ? [(fr+tr)/2,fc] : null;
      const nextCr: CastleState = JSON.parse(JSON.stringify(cr));
      if (found && tp(bd[fr][fc])==='K') { nextCr[col(bd[fr][fc])!].k=false; nextCr[col(bd[fr][fc])!].q=false; }
      const nextTurn: Color = turnCol==='w' ? 'b' : 'w';
      const san = uciToSAN(bd, uci, turnCol, ep, cr);
      return {
        uci, san, name:`${childTotal.toLocaleString()} games`,
        freq, wr, games: childTotal,
        children: trieToTree(child, nextBd, nextTurn, nextEP, nextCr, depth+1),
      };
    });
  }
  
  // ── Trie merge ───────────────────────────────────────────────
  export function mergeTries(base: TrieNode[], incoming: TrieNode[]): void {
    function mergeNode(b: TrieNode, inc: TrieNode): void {
      b.w+=inc.w; b.b+=inc.b; b.d+=inc.d;
      for (const [uci, child] of inc.children) {
        if (!b.children.has(uci)) b.children.set(uci, {children:new Map(),w:0,b:0,d:0});
        mergeNode(b.children.get(uci)!, child);
      }
    }
    for (let i=0; i<base.length; i++) mergeNode(base[i], incoming[i]);
  }
  
  // ── Cache serialisation ───────────────────────────────────────
  function trieToJSON(node: TrieNode): TrieJSON {
    const obj: TrieJSON = { w:node.w, b:node.b, d:node.d, c:{} };
    for (const [uci, child] of node.children) obj.c[uci] = trieToJSON(child);
    return obj;
  }
  
  function trieFromJSON(obj: TrieJSON): TrieNode {
    const node: TrieNode = { children:new Map(), w:obj.w, b:obj.b, d:obj.d };
    for (const [uci, child] of Object.entries(obj.c||{})) node.children.set(uci, trieFromJSON(child));
    return node;
  }
  
  function cacheKey(filename: string): string {
    return `chess_pgn_cache_v${CACHE_VERSION}_${filename}`;
  }
  
  export function saveCache(filename: string, tries: TrieNode[], totalGames: number): void {
    try {
      const payload = JSON.stringify({ version:CACHE_VERSION, filename, totalGames, tries:tries.map(trieToJSON) });
      localStorage.setItem(cacheKey(filename), payload);
      console.log(`[cache] saved ${(payload.length/1024/1024).toFixed(1)}MB`);
    } catch(e) { console.warn('[cache] save failed:', (e as Error).message); }
  }
  
  export function loadCache(filename: string): { tries: TrieNode[]; totalGames: number } | null {
    try {
      const raw = localStorage.getItem(cacheKey(filename));
      if (!raw) return null;
      const payload = JSON.parse(raw);
      if (payload.version !== CACHE_VERSION || payload.filename !== filename) return null;
      return { tries: payload.tries.map(trieFromJSON), totalGames: payload.totalGames };
    } catch(e) { console.warn('[cache] load failed:', (e as Error).message); return null; }
  }
  
  // ── Fast parser ───────────────────────────────────────────────
  export function parsePGN(
    text: string,
    openings: Opening[],
    onProgress: (done: number, total: number) => void,
    onDone: (tries: TrieNode[], total: number) => void
  ): void {
    const cache = buildOpeningSANCache(openings);
    const openingNorm = cache.map(c => c.sanMoves.map(normSAN));
  
    const games: string[] = [];
    let start = 0;
    for (let i = 1; i < text.length; i++) {
      if (text[i]==='[' && text[i-1]==='\n' && i>1 && text[i-2]==='\n') {
        games.push(text.slice(start, i));
        start = i;
      }
    }
    if (start < text.length) games.push(text.slice(start));
  
    const total = games.length;
    let idx = 0;
    const tries = freshTries(openings.length);
  
    function parseResult(g: string): GameResult | null {
      const i = g.indexOf('[Result "');
      if (i < 0) return null;
      const j = g.indexOf('"', i+9);
      const r = g.slice(i+9, j);
      if (r==='1-0') return 'w';
      if (r==='0-1') return 'b';
      if (r==='1/2-1/2') return 'd';
      return null;
    }
  
    function tokenizeMoves(g: string): string[] {
      let bodyStart = 0;
      for (let i = 0; i < g.length-1; i++) {
        if (g[i]==='\n' && g[i+1]==='\n') { bodyStart = i+2; break; }
      }
      const body = g.slice(bodyStart);
      const tokens: string[] = [];
      let i = 0;
      while (i < body.length) {
        const ch = body[i];
        if (ch===' '||ch==='\n'||ch==='\r'||ch==='\t') { i++; continue; }
        if (ch==='{') { while (i<body.length&&body[i]!=='}') i++; i++; continue; }
        if (ch==='(') { let d=1; i++; while(i<body.length&&d>0){if(body[i]==='(')d++;else if(body[i]===')') d--;i++;} continue; }
        if (ch>='0'&&ch<='9') { while(i<body.length&&body[i]!==' '&&body[i]!=='\n') i++; continue; }
        if (ch==='*') { i++; continue; }
        let end = i;
        while (end<body.length&&body[end]!==' '&&body[end]!=='\n'&&body[end]!=='\r'&&body[end]!=='\t') end++;
        const tok = body.slice(i, end);
        if (tok==='1-0'||tok==='0-1'||tok==='1/2-1/2') { i=end; continue; }
        if (tok.length>0) tokens.push(tok);
        i = end;
      }
      return tokens;
    }
  
    function processChunk(): void {
      const end = Math.min(idx + CHUNK_SIZE, total);
      for (; idx < end; idx++) {
        const g = games[idx];
        if (!g || g.length < 20) continue;
        const result = parseResult(g);
        if (!result) continue;
        const sanTokens = tokenizeMoves(g);
        if (sanTokens.length === 0) continue;
        const normTokens = sanTokens.map(normSAN);
  
        for (let oi = 0; oi < openings.length; oi++) {
          const opNorm = openingNorm[oi];
          const opLen  = opNorm.length;
          if (normTokens.length < opLen) continue;
          let match = true;
          for (let mi = 0; mi < opLen; mi++) {
            if (normTokens[mi] !== opNorm[mi]) { match = false; break; }
          }
          if (!match) continue;
  
          const c = cache[oi];
          let bd: Board = c.postBoard.map(row => [...row]);
          let trn: Color = c.postTurn;
          let ep: EP = c.postEP ? [...c.postEP] as EP : null;
          let cr: CastleState = JSON.parse(JSON.stringify(c.postCR));
  
          const branchUCIs: string[] = [];
          for (let mi = opLen; mi < sanTokens.length && branchUCIs.length < TREE_DEPTH_LIMIT; mi++) {
            const gameUCI = sanToUCI(bd, sanTokens[mi], trn, ep, cr);
            if (!gameUCI) break;
            const [fr,fc] = coordToRC(gameUCI.slice(0,2));
            const [tr2,tc2] = coordToRC(gameUCI.slice(2,4));
            const legal = legalFor(bd, fr, fc, ep, cr);
            const found = legal.find(mv => mv[0]===tr2 && mv[1]===tc2);
            if (!found) break;
            branchUCIs.push(gameUCI.slice(0,4));
            bd = applyMv(bd,fr,fc,tr2,tc2,found[2],ep);
            ep = tp(bd[tr2][tc2])==='P'&&Math.abs(tr2-fr)===2 ? [(fr+tr2)/2,fc] : null;
            if (tp(bd[tr2][tc2])==='K') { cr[col(bd[tr2][tc2])!].k=false; cr[col(bd[tr2][tc2])!].q=false; }
            if (bd[tr2][tc2]==='wR'&&fr===7){if(fc===7)cr.w.k=false;if(fc===0)cr.w.q=false;}
            if (bd[tr2][tc2]==='bR'&&fr===0){if(fc===7)cr.b.k=false;if(fc===0)cr.b.q=false;}
            trn = trn==='w' ? 'b' : 'w';
          }
          insertIntoTrie(tries[oi], branchUCIs, result);
        }
      }
      onProgress(idx, total);
      if (idx < total) {
        const mc = new MessageChannel();
        mc.port1.onmessage = processChunk;
        mc.port2.postMessage(null);
      } else {
        onDone(tries, total);
      }
    }
    processChunk();
  }