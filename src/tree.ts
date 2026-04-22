/* ============================================================
   tree.ts — D3 opening tree diagram (vertical top-down)
============================================================ */

import {
    Board, Color, CastleState, EP, MoveFlag,
    initBoard, coordToRC, col, tp,
    legalFor, applyMv, uciToSAN,
  } from './chess.js';
  import {
    OPENINGS, currentOpening,
    board, turn, enPassant, castleRights, historyStack, moveLog, freePlay, usingPGN,
    setBoard, setTurn, setEnPassant, setCastleRights,
    setHistoryStack, setMoveLog, setFreePlay, setOpeningMoveIndex,
    getActiveTree, render, stopPlaybackExport as stopPlayback,
  } from './app.js';
  import type { TreeBranch } from './app.js';
  
  // D3 is loaded globally via CDN — declare minimal types needed
  declare const d3: any;
  
  // ── Module state ──────────────────────────────────────────────
  export const TOP_N = 3;
  
  // Store on window so app.ts resetOpening() can clear them without a circular import
  function getSelectedPathKey(): string      { return (window as any)._treeSelectedPathKey ?? ''; }
  function setSelectedPathKey(v: string)     { (window as any)._treeSelectedPathKey = v; }
  function getExpandedNodes(): Set<string>   { 
    if (!(window as any)._treeExpandedNodes) (window as any)._treeExpandedNodes = new Set<string>();
    return (window as any)._treeExpandedNodes as Set<string>;
  }
  
  // ── D3 node data shape ────────────────────────────────────────
  interface NodeData {
    uci: string;
    san: string;
    sanSequence: string[];
    name: string;
    freq: number;
    wr: [number,number,number] | number[];
    games: number;
    turnCol: Color | 'root';
    pathKey: string;
    hasChildren: boolean;
    isExpanded: boolean;
    bd: Board;
    ep: EP;
    cr: CastleState;
    fr: number; fc: number; tr: number; tc: number;
    flag: MoveFlag;
    children: NodeData[];
  }
  
  // ── Build tree data ───────────────────────────────────────────
  function buildD3Data(): NodeData | null {
    const tree = getActiveTree();
    if (!tree || !tree.branches || tree.branches.length === 0) return null;
  
    // Replay opening to get exact board state at branch point
    let rootBd: Board = initBoard();
    let rootTurn: Color = 'w';
    let cr0: CastleState = { w:{k:true,q:true}, b:{k:true,q:true} };
    let ep0: EP = null;
    for (const uci of currentOpening.moves) {
      const [fr, fc] = coordToRC(uci.slice(0, 2));
      const [tr, tc] = coordToRC(uci.slice(2, 4));
      const legal = legalFor(rootBd, fr, fc, ep0, cr0);
      const found = legal.find(mv => mv[0]===tr && mv[1]===tc);
      if (!found) break;
      rootBd = applyMv(rootBd, fr, fc, tr, tc, found[2], ep0);
      ep0 = tp(rootBd[tr][tc])==='P' && Math.abs(tr-fr)===2 ? [(fr+tr)/2,fc] : null;
      if (tp(rootBd[tr][tc])==='K'){cr0[col(rootBd[tr][tc])!].k=false;cr0[col(rootBd[tr][tc])!].q=false;}
      if (rootBd[tr][tc]==='wR'&&fr===7){if(fc===7)cr0.w.k=false;if(fc===0)cr0.w.q=false;}
      if (rootBd[tr][tc]==='bR'&&fr===0){if(fc===7)cr0.b.k=false;if(fc===0)cr0.b.q=false;}
      rootTurn = rootTurn==='w' ? 'b' : 'w';
    }
  
    function buildNode(
      br: TreeBranch, bd: Board, turnCol: Color, ep: EP, cr: CastleState,
      pathKey: string, sansSoFar: string[]
    ): NodeData {
      const [fr, fc] = coordToRC(br.uci.slice(0, 2));
      const [tr, tc] = coordToRC(br.uci.slice(2, 4));
      const legal    = legalFor(bd, fr, fc, ep, cr);
      const found    = legal.find(mv => mv[0]===tr && mv[1]===tc);
      const nextBd   = found ? applyMv(bd,fr,fc,tr,tc,found[2],ep) : bd;
      const nextEP: EP = found && tp(bd[fr][fc])==='P' && Math.abs(tr-fr)===2 ? [(fr+tr)/2,fc] : null;
      const nextCr: CastleState = JSON.parse(JSON.stringify(cr));
      if (found) {
        if (tp(bd[fr][fc])==='K'){nextCr[col(bd[fr][fc])!].k=false;nextCr[col(bd[fr][fc])!].q=false;}
        if (bd[fr][fc]==='wR'&&fr===7){if(fc===7)nextCr.w.k=false;if(fc===0)nextCr.w.q=false;}
        if (bd[fr][fc]==='bR'&&fr===0){if(fc===7)nextCr.b.k=false;if(fc===0)nextCr.b.q=false;}
      }
      const nextTurn: Color = turnCol==='w' ? 'b' : 'w';
      const san      = uciToSAN(bd, br.uci, turnCol, ep, cr);
      const sanLabel = turnCol==='b' ? '...'+san : san;
      const mySans   = [...sansSoFar, sanLabel];
      const allKids  = br.children || [];
      const isExpanded = getExpandedNodes().has(pathKey);
  
      return {
        uci: br.uci, san: sanLabel, sanSequence: mySans,
        name: br.name, freq: br.freq, wr: br.wr, games: br.games||0,
        turnCol, pathKey,
        hasChildren: allKids.length>0, isExpanded,
        bd: nextBd, ep: nextEP, cr: nextCr,
        fr, fc, tr, tc, flag: found?found[2]:undefined,
        children: getExpandedNodes().has(pathKey)
          ? allKids.slice(0,TOP_N).map(c =>
              buildNode(c, nextBd, nextTurn, nextEP, nextCr, pathKey+'>'+c.uci, mySans))
          : [],
      };
    }
  
    return {
      uci:'root', san:currentOpening.name, sanSequence:[],
      name:'', freq:100, wr:[], games:0,
      turnCol:'root', pathKey:'root',
      hasChildren: tree.branches.length>0, isExpanded:true,
      bd:rootBd, ep:ep0, cr:cr0, fr:0, fc:0, tr:0, tc:0, flag:undefined,
      children: tree.branches.slice(0,TOP_N).map(br =>
        buildNode(br, rootBd, rootTurn, ep0, cr0, 'root>'+br.uci, [])
      ),
    };
  }
  
  // ── Play path to node ─────────────────────────────────────────
  function playPathToNode(d: any): void {
    stopPlayback();
    setFreePlay(true);
  
    const uciSequence: string[] = d.data.pathKey
      .split('>').filter((s: string) => s && s!=='root');
    const sanSequence: string[] = d.data.sanSequence || [];
  
    setHistoryStack([]);
    setMoveLog([]);
  
    let bd2: Board = initBoard();
    let trn2: Color = 'w';
    let ep2: EP = null;
    let cr2: CastleState = { w:{k:true,q:true}, b:{k:true,q:true} };
  
    for (const uci of currentOpening.moves) {
      const [fr,fc] = coordToRC(uci.slice(0,2));
      const [tr,tc] = coordToRC(uci.slice(2,4));
      const legal = legalFor(bd2,fr,fc,ep2,cr2);
      const found = legal.find(mv => mv[0]===tr && mv[1]===tc);
      if (!found) break;
      bd2 = applyMv(bd2,fr,fc,tr,tc,found[2],ep2);
      ep2 = tp(bd2[tr][tc])==='P'&&Math.abs(tr-fr)===2 ? [(fr+tr)/2,fc] : null;
      if (tp(bd2[tr][tc])==='K'){cr2[col(bd2[tr][tc])!].k=false;cr2[col(bd2[tr][tc])!].q=false;}
      if (bd2[tr][tc]==='wR'&&fr===7){if(fc===7)cr2.w.k=false;if(fc===0)cr2.w.q=false;}
      if (bd2[tr][tc]==='bR'&&fr===0){if(fc===7)cr2.b.k=false;if(fc===0)cr2.b.q=false;}
      trn2 = trn2==='w' ? 'b' : 'w';
    }
  
    const newHistory: [number,number,number,number][] = [];
    const newLog: string[] = [];
  
    uciSequence.forEach((uci, i) => {
      const [pfr,pfc] = coordToRC(uci.slice(0,2));
      const [ptr,ptc] = coordToRC(uci.slice(2,4));
      const pl = legalFor(bd2,pfr,pfc,ep2,cr2);
      const pf = pl.find(mv => mv[0]===ptr && mv[1]===ptc);
      if (pf) {
        newHistory.push([pfr,pfc,ptr,ptc]);
        newLog.push(sanSequence[i] || uci);
        bd2 = applyMv(bd2,pfr,pfc,ptr,ptc,pf[2],ep2);
        ep2 = tp(bd2[ptr][ptc])==='P'&&Math.abs(ptr-pfr)===2 ? [(pfr+ptr)/2,pfc] : null;
        if (tp(bd2[ptr][ptc])==='K'){cr2[col(bd2[ptr][ptc])!].k=false;cr2[col(bd2[ptr][ptc])!].q=false;}
      }
      trn2 = trn2==='w' ? 'b' : 'w';
    });
  
    setBoard(bd2); setTurn(trn2); setEnPassant(ep2); setCastleRights(cr2);
    setHistoryStack(newHistory); setMoveLog(newLog);
    setOpeningMoveIndex(currentOpening.moves.length);
    render();
  }
  
  // ── Main render ───────────────────────────────────────────────
  export function renderTree(): void {
    const wrap = document.getElementById('tree-svg-wrap')!;
    const data = buildD3Data();
    if (!data || data.children.length===0) {
      const msg = usingPGN
        ? 'Play through an opening to explore continuations'
        : 'Load a PGN file to see the opening tree';
      wrap.innerHTML = `<div id="tree-placeholder" style="text-align:center;padding:32px;font-size:11px;color:#a89e94;">${msg}</div>`;
      return;
    }
    const ph = document.getElementById('tree-placeholder');
    if (ph) ph.remove();
    d3.select('#tree-svg-wrap svg').remove();
  
    const nodeW=118, nodeH=76, hGap=20, vGap=60, marginX=32, marginY=28;
    const root = d3.hierarchy(data);
    d3.tree().nodeSize([nodeW+hGap, nodeH+vGap])(root);
  
    let minX=Infinity, maxX=-Infinity, minY=Infinity, maxY=-Infinity;
    root.each((n: any) => {
      minX=Math.min(minX,n.x); maxX=Math.max(maxX,n.x);
      minY=Math.min(minY,n.y); maxY=Math.max(maxY,n.y);
    });
  
    const svgW = Math.max((maxX-minX)+nodeW+marginX*2, 400);
    const svgH = (maxY-minY)+nodeH+marginY*2+40;
  
    const svg = d3.select('#tree-svg-wrap').append('svg')
      .attr('width',svgW).attr('height',svgH)
      .attr('font-family',"'DM Mono', monospace");
    const g = svg.append('g')
      .attr('transform',`translate(${-minX+marginX+nodeW/2}, ${-minY+marginY})`);
  
    const freqScale = d3.scaleLinear().domain([0,100]).range([1.5,7]);
    const linkGen   = d3.linkVertical().x((d: any) => d.x).y((d: any) => d.y);
  
    g.selectAll('.tree-link')
      .data(root.links().filter((l: any) => l.source.data.uci!=='root'))
      .join('path').attr('class','tree-link').attr('d',linkGen)
      .attr('stroke', (d: any) => {
        const wr = d.target.data.wr;
        if (!wr||!wr.length) return '#c8bfb0';
        if (wr[0]>wr[2]+8) return '#3a7bd5';
        if (wr[2]>wr[0]+8) return '#c0392b';
        return '#b0a898';
      })
      .attr('stroke-width',(d: any) => freqScale(d.target.data.freq||5))
      .attr('stroke-opacity',0.7);
  
    g.selectAll('.tree-link-root')
      .data(root.links().filter((l: any) => l.source.data.uci==='root'))
      .join('path').attr('class','tree-link tree-link-root').attr('d',linkGen)
      .attr('stroke','#c8bfb0').attr('stroke-width',1.5).attr('stroke-opacity',0.5);
  
    const tooltip = d3.select('#tree-tooltip');
    const nodes = g.selectAll('.tree-node')
      .data(root.descendants())
      .join('g').attr('class','tree-node')
      .attr('transform',(d: any) => `translate(${d.x},${d.y})`);
  
    nodes.filter((d: any) => d.data.uci==='root')
      .append('text').attr('text-anchor','middle').attr('dy','0.35em')
      .attr('fill','#8b5e2a').attr('font-size','11px').attr('font-weight','600')
      .text((d: any) => d.data.san.length>22 ? d.data.san.slice(0,21)+'…' : d.data.san);
  
    const bn = nodes.filter((d: any) => d.data.uci!=='root');
  
    bn.append('rect')
      .attr('x',-nodeW/2).attr('y',-nodeH/2)
      .attr('width',nodeW).attr('height',nodeH).attr('rx',6)
      .attr('fill',(d: any) => d.data.pathKey===getSelectedPathKey() ? '#fef9f0' : '#ffffff')
      .attr('stroke',(d: any) => d.data.pathKey===getSelectedPathKey() ? '#8b5e2a' : '#d8d0c4')
      .attr('stroke-width',(d: any) => d.data.pathKey===getSelectedPathKey() ? 2 : 1)
      .attr('filter','drop-shadow(0 1px 3px rgba(0,0,0,0.10))');
  
    bn.append('text').attr('text-anchor','middle').attr('y',-nodeH/2+16)
      .attr('fill','#1a1a1a').attr('font-size','12px').attr('font-weight','600')
      .text((d: any) => d.data.san.length>14 ? d.data.san.slice(0,13)+'…' : d.data.san);
  
    bn.append('text').attr('text-anchor','middle').attr('y',-nodeH/2+29)
      .attr('fill','#8b8078').attr('font-size','8.5px')
      .text((d: any) => {
        const nm = usingPGN ? `${d.data.games.toLocaleString()} games` : (d.data.name||'');
        return nm.length>17 ? nm.slice(0,16)+'…' : nm;
      });
  
    bn.append('rect').attr('x',-nodeW/2+8).attr('y',-nodeH/2+37)
      .attr('width',nodeW-16).attr('height',3).attr('rx',1.5).attr('fill','#e8e0d4');
    bn.append('rect').attr('x',-nodeW/2+8).attr('y',-nodeH/2+37)
      .attr('width',(d: any) => (nodeW-16)*Math.min(d.data.freq||0,100)/100)
      .attr('height',3).attr('rx',1.5).attr('fill','#8b5e2a');
  
    const wrBarY=-nodeH/2+45, wrW=nodeW-16;
    bn.each(function(this: any, d: any) {
      const wr = d.data.wr as number[];
      if (!wr||wr.length<3) return;
      const grp=d3.select(this), x0=-nodeW/2+8;
      const wW=wrW*wr[0]/100, dW=wrW*wr[1]/100, bW=wrW*wr[2]/100;
      grp.append('rect').attr('x',x0).attr('y',wrBarY).attr('width',wW).attr('height',11).attr('fill','#3a7bd5');
      if(wr[0]>=15)grp.append('text').attr('x',x0+wW/2).attr('y',wrBarY+8).attr('text-anchor','middle').attr('font-size','8px').attr('fill','#fff').text(wr[0]+'%');
      grp.append('rect').attr('x',x0+wW).attr('y',wrBarY).attr('width',dW).attr('height',11).attr('fill','#aaa');
      if(wr[1]>=15)grp.append('text').attr('x',x0+wW+dW/2).attr('y',wrBarY+8).attr('text-anchor','middle').attr('font-size','8px').attr('fill','#fff').text(wr[1]+'%');
      grp.append('rect').attr('x',x0+wW+dW).attr('y',wrBarY).attr('width',bW).attr('height',11).attr('fill','#c0392b');
      if(wr[2]>=15)grp.append('text').attr('x',x0+wW+dW+bW/2).attr('y',wrBarY+8).attr('text-anchor','middle').attr('font-size','8px').attr('fill','#fff').text(wr[2]+'%');
      grp.append('rect').attr('x',x0).attr('y',wrBarY).attr('width',wrW).attr('height',11)
        .attr('fill','none').attr('stroke','#d8d0c4').attr('stroke-width',0.5).attr('rx',2);
    });
  
    bn.append('text').attr('text-anchor','middle').attr('y',nodeH/2-5)
      .attr('fill','#a89e94').attr('font-size','8px')
      .text((d: any) => `${d.data.freq}% of games`);
  
    bn.filter((d: any) => d.data.hasChildren && !d.data.isExpanded)
      .append('text').attr('text-anchor','middle').attr('y',nodeH/2+16)
      .attr('fill','#c49a5a').attr('font-size','9px').text('▼ click to expand');
  
    bn.filter((d: any) => d.data.hasChildren && d.data.isExpanded)
      .append('text').attr('text-anchor','middle').attr('y',nodeH/2+16)
      .attr('fill','#c49a5a').attr('font-size','9px').text('▲ collapse');
  
    bn.on('mousemove', function(event: MouseEvent, d: any) {
      const wr = d.data.wr as number[]||[];
      document.getElementById('tt-move')!.textContent = d.data.san;
      document.getElementById('tt-name')!.textContent = usingPGN
        ? `${d.data.games.toLocaleString()} games` : (d.data.name||'');
      document.getElementById('tt-stats')!.textContent = `Played ${d.data.freq}% of the time`;
      document.getElementById('tt-wr')!.innerHTML = wr.length ? `
        <div class="tt-wr-w" style="width:${wr[0]}%">${wr[0]>=15?wr[0]+'%':''}</div>
        <div class="tt-wr-d" style="width:${wr[1]}%">${wr[1]>=15?wr[1]+'%':''}</div>
        <div class="tt-wr-b" style="width:${wr[2]}%">${wr[2]>=15?wr[2]+'%':''}</div>` : '';
      tooltip.style('opacity',1)
        .style('left',(event.clientX+14)+'px').style('top',(event.clientY-10)+'px');
    }).on('mouseleave', () => tooltip.style('opacity',0));
  
    bn.on('click', function(event: MouseEvent, d: any) {
      event.stopPropagation();
      tooltip.style('opacity',0);
      if (d.data.hasChildren) {
        const en = getExpandedNodes();
        if (en.has(d.data.pathKey)) {
          for (const key of [...en]) {
            if (key===d.data.pathKey || key.startsWith(d.data.pathKey+'>')) en.delete(key);
          }
        } else { en.add(d.data.pathKey); }
      }
      setSelectedPathKey(d.data.pathKey);
      playPathToNode(d);
      renderTree();
    });
  
    svg.on('click', () => tooltip.style('opacity',0));
  }