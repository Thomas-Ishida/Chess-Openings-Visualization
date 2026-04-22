/* ============================================================
   chess.ts — Pure chess engine (no DOM dependencies)
============================================================ */

export type Color = 'w' | 'b';
export type PieceType = 'K' | 'Q' | 'R' | 'B' | 'N' | 'P';
export type Piece = string; // e.g. 'wK', 'bP'
export type Board = (Piece | null)[][];
export type MoveFlag = 'castle-k' | 'castle-q' | undefined;
export type LegalMove = [number, number, MoveFlag]; // [toRow, toCol, flag]
export type FullMove = [number, number, number, number]; // [fr, fc, tr, tc]
export interface CastleRights { k: boolean; q: boolean; }
export interface CastleState { w: CastleRights; b: CastleRights; }
export type EP = [number, number] | null;

export const FILES: string[] = ['a','b','c','d','e','f','g','h'];
export const RANKS: string[] = ['8','7','6','5','4','3','2','1'];
export const GLYPHS: Record<string, string> = {
  wK:'♔', wQ:'♕', wR:'♖', wB:'♗', wN:'♘', wP:'♙',
  bK:'♚', bQ:'♛', bR:'♜', bB:'♝', bN:'♞', bP:'♟',
};

export function initBoard(): Board {
  return [
    ['bR','bN','bB','bQ','bK','bB','bN','bR'],
    ['bP','bP','bP','bP','bP','bP','bP','bP'],
    [null,null,null,null,null,null,null,null],
    [null,null,null,null,null,null,null,null],
    [null,null,null,null,null,null,null,null],
    [null,null,null,null,null,null,null,null],
    ['wP','wP','wP','wP','wP','wP','wP','wP'],
    ['wR','wN','wB','wQ','wK','wB','wN','wR'],
  ];
}

export function col(p: Piece | null): Color | null { return p ? p[0] as Color : null; }
export function tp(p: Piece | null): PieceType | null { return p ? p[1] as PieceType : null; }
function inB(r: number, c: number): boolean { return r >= 0 && r < 8 && c >= 0 && c < 8; }

export function coordToRC(sq: string): [number, number] {
  return [8 - parseInt(sq[1]), FILES.indexOf(sq[0])];
}

export function pieceMoves(
  bd: Board, r: number, c: number,
  ep: EP, cr: CastleState | null,
  forCheck: boolean
): LegalMove[] {
  const p = bd[r][c]; if (!p) return [];
  const pc = col(p)!, pt = tp(p)!;
  const dir = pc === 'w' ? -1 : 1;
  const m: LegalMove[] = [];

  if (pt === 'P') {
    if (inB(r + dir, c) && !bd[r + dir][c]) {
      m.push([r + dir, c, undefined]);
      const sr = pc === 'w' ? 6 : 1;
      if (r === sr && !bd[r + 2 * dir][c]) m.push([r + 2 * dir, c, undefined]);
    }
    for (const dc of [-1, 1]) {
      if (!inB(r + dir, c + dc)) continue;
      if (bd[r + dir][c + dc] && col(bd[r + dir][c + dc]) !== pc)
        m.push([r + dir, c + dc, undefined]);
      if (ep && ep[0] === r + dir && ep[1] === c + dc)
        m.push([r + dir, c + dc, undefined]);
    }
  }

  if (pt === 'N') {
    for (const [dr, dc] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]) {
      const nr = r + dr, nc = c + dc;
      if (inB(nr, nc) && col(bd[nr][nc]) !== pc) m.push([nr, nc, undefined]);
    }
  }

  const slides: Partial<Record<PieceType, [number,number][]>> = {
    B: [[-1,-1],[-1,1],[1,-1],[1,1]],
    R: [[-1,0],[1,0],[0,-1],[0,1]],
    Q: [[-1,-1],[-1,1],[1,-1],[1,1],[-1,0],[1,0],[0,-1],[0,1]],
  };
  if (slides[pt]) {
    for (const [dr, dc] of slides[pt]!) {
      let nr = r + dr, nc = c + dc;
      while (inB(nr, nc)) {
        if (col(bd[nr][nc]) === pc) break;
        m.push([nr, nc, undefined]);
        if (bd[nr][nc]) break;
        nr += dr; nc += dc;
      }
    }
  }

  if (pt === 'K') {
    for (const [dr, dc] of [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]) {
      const nr = r + dr, nc = c + dc;
      if (inB(nr, nc) && col(bd[nr][nc]) !== pc) m.push([nr, nc, undefined]);
    }
    if (!forCheck && cr) {
      const rank = pc === 'w' ? 7 : 0;
      if (cr[pc].k && !bd[rank][5] && !bd[rank][6] && !isInCheck(bd, pc, ep, cr)) {
        if (!sqAtt(bd, rank, 5, pc) && !sqAtt(bd, rank, 6, pc))
          m.push([rank, 6, 'castle-k']);
      }
      if (cr[pc].q && !bd[rank][3] && !bd[rank][2] && !bd[rank][1] && !isInCheck(bd, pc, ep, cr)) {
        if (!sqAtt(bd, rank, 3, pc) && !sqAtt(bd, rank, 2, pc))
          m.push([rank, 2, 'castle-q']);
      }
    }
  }
  return m;
}

export function sqAtt(bd: Board, r: number, c: number, byOppOf: Color): boolean {
  const opp: Color = byOppOf === 'w' ? 'b' : 'w';
  for (let rr = 0; rr < 8; rr++) for (let cc = 0; cc < 8; cc++) {
    if (col(bd[rr][cc]) !== opp) continue;
    if (pieceMoves(bd, rr, cc, null, null, true).some(mv => mv[0] === r && mv[1] === c))
      return true;
  }
  return false;
}

export function isInCheck(bd: Board, pc: Color, ep: EP, cr: CastleState | null): boolean {
  let kr = -1, kc = -1;
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    if (bd[r][c] === pc + 'K') { kr = r; kc = c; }
  }
  return sqAtt(bd, kr, kc, pc);
}

export function legalFor(bd: Board, r: number, c: number, ep: EP, cr: CastleState): LegalMove[] {
  return pieceMoves(bd, r, c, ep, cr, false).filter(mv => {
    const nb = applyMv(bd, r, c, mv[0], mv[1], mv[2], ep);
    return !isInCheck(nb, col(bd[r][c])!, null, null);
  });
}

export function applyMv(
  bd: Board, fr: number, fc: number, tr: number, tc: number,
  flag: MoveFlag, ep: EP
): Board {
  const nb: Board = bd.map(row => [...row]);
  const p = nb[fr][fc];
  nb[tr][tc] = p; nb[fr][fc] = null;
  if (flag === 'castle-k') { nb[fr][5] = nb[fr][7]; nb[fr][7] = null; }
  if (flag === 'castle-q') { nb[fr][3] = nb[fr][0]; nb[fr][0] = null; }
  if (tp(p) === 'P' && ep && tr === ep[0] && tc === ep[1]) nb[fr][tc] = null;
  if (tp(p) === 'P' && (tr === 0 || tr === 7)) nb[tr][tc] = col(p) + 'Q';
  return nb;
}

export function allLegal(bd: Board, pc: Color, ep: EP, cr: CastleState): [number,number,number,number,MoveFlag][] {
  const m: [number,number,number,number,MoveFlag][] = [];
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    if (col(bd[r][c]) !== pc) continue;
    for (const mv of legalFor(bd, r, c, ep, cr)) m.push([r, c, mv[0], mv[1], mv[2]]);
  }
  return m;
}

export function uciToSAN(bd: Board, uci: string, turnCol: Color, ep: EP, cr: CastleState): string {
  const [fr, fc] = coordToRC(uci.slice(0, 2));
  const [tr, tc] = coordToRC(uci.slice(2, 4));
  const p = bd[fr][fc]; if (!p) return uci;
  const pt2 = tp(p)!, dest = FILES[tc] + RANKS[tr];
  const isCapture = !!(bd[tr][tc]) || (pt2 === 'P' && fc !== tc);

  if (pt2 === 'K' && Math.abs(fc - tc) === 2) return tc > fc ? 'O-O' : 'O-O-O';

  const legal = legalFor(bd, fr, fc, ep, cr);
  const found = legal.find(mv => mv[0] === tr && mv[1] === tc);
  if (!found) return uci;

  if (pt2 === 'P') {
    let san = isCapture ? FILES[fc] + 'x' + dest : dest;
    const promo = uci[4]; if (promo) san += '=' + promo.toUpperCase();
    const nb = applyMv(bd, fr, fc, tr, tc, found[2], ep);
    const opp: Color = turnCol === 'w' ? 'b' : 'w';
    if (isInCheck(nb, opp, null, null)) {
      const ol = allLegal(nb, opp, null, { w:{k:true,q:true}, b:{k:true,q:true} });
      san += ol.length === 0 ? '#' : '+';
    }
    return san;
  }

  const ambig: [number,number][] = [];
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    if (r === fr && c === fc) continue;
    if (bd[r][c] !== p) continue;
    if (legalFor(bd, r, c, ep, cr).some(mv => mv[0] === tr && mv[1] === tc))
      ambig.push([r, c]);
  }
  let disambig = '';
  if (ambig.length > 0) {
    const sameFile = ambig.some(([, c]) => c === fc);
    const sameRank = ambig.some(([r]) => r === fr);
    if (!sameFile) disambig = FILES[fc];
    else if (!sameRank) disambig = RANKS[fr];
    else disambig = FILES[fc] + RANKS[fr];
  }

  let san = pt2 + disambig + (isCapture ? 'x' : '') + dest;
  const nb = applyMv(bd, fr, fc, tr, tc, found[2], ep);
  const opp: Color = turnCol === 'w' ? 'b' : 'w';
  if (isInCheck(nb, opp, null, null)) {
    const ol = allLegal(nb, opp, null, { w:{k:true,q:true}, b:{k:true,q:true} });
    san += ol.length === 0 ? '#' : '+';
  }
  return san;
}