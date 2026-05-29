import { useState, useEffect, useCallback, useRef } from 'react';
import { Chess } from 'chess.js';
import { Chessboard } from 'react-chessboard';
import { getBestMove, stopEngine, eloToSkillLevel } from '../utils/stockfish';
import { parsePgnHeaders } from '../utils/chesscomApi';

function extractMovesFromPgn(pgn) {
  const game = new Chess();
  try { game.loadPgn(pgn); } catch { return []; }
  return game.history();
}

function buildChessAtMove(pgn, moveIndex) {
  const allMoves = extractMovesFromPgn(pgn);
  const game = new Chess();
  for (let i = 0; i < moveIndex && i < allMoves.length; i++) {
    try { game.move(allMoves[i]); } catch { break; }
  }
  return game;
}


function getEndReason(chess, playerColor) {
  if (!chess.isGameOver()) return null;
  if (chess.isCheckmate()) {
    // The side to move is in checkmate — the OTHER side won
    const winner = chess.turn() === 'w' ? 'black' : 'white';
    return winner === playerColor ? 'Checkmate — you win!' : 'Checkmate — opponent wins';
  }
  if (chess.isStalemate()) return 'Stalemate — draw';
  if (chess.isThreefoldRepetition()) return 'Draw by repetition';
  if (chess.isInsufficientMaterial()) return 'Draw — insufficient material';
  if (chess.isDraw()) return 'Draw';
  return 'Game over';
}

export default function ReplayBoard({ gameData, startMoveIndex = 0, mistakeInfo = null, onGameEnd, onBack }) {
  const headers = parsePgnHeaders(gameData.pgn);
  const playerColor = gameData.playerColor;

  const opponentSide = playerColor === 'white' ? 'black' : 'white';
  const opponentElo = parseInt(
    headers[opponentSide === 'white' ? 'WhiteElo' : 'BlackElo'] || String(gameData.opponentElo || 1200), 10
  );
  const skillLevel = eloToSkillLevel(opponentElo);

  const originalMoves = useRef(extractMovesFromPgn(gameData.pgn).slice(startMoveIndex));

  const chessRef = useRef(null);
  if (chessRef.current === null) chessRef.current = buildChessAtMove(gameData.pgn, startMoveIndex);

  const [fen, setFen] = useState(chessRef.current.fen());
  const [moveHistory, setMoveHistory] = useState([]);
  const replayMovesRef = useRef([]);
  const [replayMoveCount, setReplayMoveCount] = useState(0);
  const [opponentThinking, setOpponentThinking] = useState(false);
  const gameOverRef = useRef(false);
  const [gameEnded, setGameEnded] = useState(false);
  const [endReason, setEndReason] = useState('');

  const [selectedSquare, setSelectedSquare] = useState(null);
  const [squareStyles, setSquareStyles] = useState({});

  const boardContainerRef = useRef(null);
  const [boardWidth, setBoardWidth] = useState(520);
  useEffect(() => {
    const el = boardContainerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setBoardWidth(Math.floor(e.contentRect.width)));
    ro.observe(el);
    setBoardWidth(Math.floor(el.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, []);

  function endGame() {
    if (gameOverRef.current) return;
    gameOverRef.current = true;
    const reason = getEndReason(chessRef.current, playerColor) || 'Replay complete';
    setEndReason(reason);
    setGameEnded(true);
  }

  const currentTurn = chessRef.current.turn();
  const isMyTurn = currentTurn === playerColor[0];

  // Apply a verbose move object from chess.moves({ verbose:true }) safely.
  // Only passes promotion when the move actually is a promotion.
  function applyVerboseMove(chess, m) {
    try {
      return chess.move({ from: m.from, to: m.to, ...(m.promotion ? { promotion: m.promotion } : {}) });
    } catch { return null; }
  }

  const playOpponentMove = useCallback(async () => {
    if (gameOverRef.current) return;
    const chess = chessRef.current;

    // If the position is already game-over before the opponent moves, wrap up cleanly.
    if (chess.isGameOver()) { endGame(); return; }

    setOpponentThinking(true);

    // --- Step 1: find the move to play (without mutating chess yet) ---
    let pickedMove = null; // verbose move object from chess.moves()

    // Try Stockfish first. Validate the UCI against the current legal moves
    // before committing — Stockfish can return stale/invalid UCI if the engine
    // state drifted (e.g. leftover queue from AnalysisScreen evaluations).
    try {
      const r = await getBestMove(chess.fen(), skillLevel, 1200);
      if (r.bestmove && r.bestmove !== '(none)') {
        const from = r.bestmove.slice(0, 2);
        const to   = r.bestmove.slice(2, 4);
        const promo = r.bestmove[4] || undefined;
        const legal = chess.moves({ verbose: true });
        pickedMove = legal.find(m =>
          m.from === from && m.to === to && (!promo || m.promotion === promo)
        ) ?? null;
      }
    } catch { /* fall through to random */ }

    // Fallback: random legal move. chess.moves() is never empty unless the game
    // is already over — which we checked at the top.
    if (!pickedMove) {
      const legal = chess.moves({ verbose: true });
      if (!legal.length) {
        // Genuinely no moves — game ended while we were waiting for Stockfish.
        setOpponentThinking(false);
        endGame();
        return;
      }
      pickedMove = legal[Math.floor(Math.random() * legal.length)];
    }

    // --- Step 2: thinking delay ---
    await new Promise(r => setTimeout(r, 350));
    if (gameOverRef.current) { setOpponentThinking(false); return; }

    // --- Step 3: apply the move ---
    const move = applyVerboseMove(chess, pickedMove);
    if (!move) {
      // Shouldn't happen — pickedMove came from chess.moves(). If it does,
      // try the first currently-legal move as a last resort.
      const legal = chess.moves({ verbose: true });
      if (!legal.length) { setOpponentThinking(false); if (!gameOverRef.current) endGame(); return; }
      const fb = applyVerboseMove(chess, legal[0]);
      if (!fb) { setOpponentThinking(false); return; }
      replayMovesRef.current = [...replayMovesRef.current, fb.san];
      setFen(chess.fen());
      setReplayMoveCount(replayMovesRef.current.length);
      setMoveHistory(p => [...p, { san: fb.san, player: false }]);
      setOpponentThinking(false);
      if (chess.isGameOver()) endGame();
      return;
    }

    replayMovesRef.current = [...replayMovesRef.current, move.san];
    setFen(chess.fen());
    setReplayMoveCount(replayMovesRef.current.length);
    setMoveHistory(p => [...p, { san: move.san, player: false }]);
    setOpponentThinking(false);
    if (chess.isGameOver()) endGame();
  }, [skillLevel]);

  useEffect(() => {
    if (chessRef.current.turn() !== playerColor[0]) playOpponentMove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function makeMove(from, to) {
    if (!isMyTurn || opponentThinking || gameOverRef.current) return false;
    const chess = chessRef.current;
    let move;
    try { move = chess.move({ from, to, promotion: 'q' }); } catch { return false; }
    if (!move) return false;
    replayMovesRef.current = [...replayMovesRef.current, move.san];
    setFen(chess.fen());
    setReplayMoveCount(replayMovesRef.current.length);
    setMoveHistory(p => [...p, { san: move.san, player: true }]);
    setSelectedSquare(null);
    setSquareStyles({});
    if (chess.isGameOver()) { endGame(); return true; }
    playOpponentMove();
    return true;
  }

  function getOptionSquares(sq) {
    const chess = chessRef.current;
    const moves = chess.moves({ square: sq, verbose: true });
    if (!moves.length) return {};
    const styles = {};
    moves.forEach(m => {
      styles[m.to] = {
        background: chess.get(m.to)
          ? 'radial-gradient(circle, rgba(0,0,0,0) 55%, rgba(80,80,200,0.65) 55%)'
          : 'radial-gradient(circle, rgba(80,80,200,0.65) 28%, transparent 28%)',
        borderRadius: '50%',
        pointerEvents: 'none',
      };
    });
    styles[sq] = { background: 'rgba(120,120,240,0.35)', pointerEvents: 'none' };
    return styles;
  }

  function handleSquareClick({ square }) {
    if (!isMyTurn || opponentThinking || gameEnded) return;
    const chess = chessRef.current;
    const piece = chess.get(square);
    if (piece && piece.color === playerColor[0]) {
      if (selectedSquare === square) { setSelectedSquare(null); setSquareStyles({}); return; }
      setSelectedSquare(square);
      setSquareStyles(getOptionSquares(square));
      return;
    }
    if (selectedSquare) {
      if (!makeMove(selectedSquare, square)) { setSelectedSquare(null); setSquareStyles({}); }
    }
  }

  function handlePieceDrop({ sourceSquare, targetSquare }) {
    return makeMove(sourceSquare, targetSquare);
  }

  function handleViewResults() {
    onGameEnd({
      originalMoves: originalMoves.current,
      replayMoves: replayMovesRef.current,
      playerColor,
      opponentElo,
      skillLevel,
      pgn: gameData.pgn,
      startMoveIndex,
      mistakeInfo,
      endReason,
    });
  }

  const gameHalfNow = startMoveIndex + replayMoveCount;
  const currentFullMove = Math.floor(gameHalfNow / 2) + 1;

  const movePairs = [];
  for (let i = 0; i < moveHistory.length; i += 2) {
    movePairs.push([moveHistory[i], moveHistory[i + 1] ?? null]);
  }

  const isCheckmate = gameEnded && endReason.includes('Checkmate');
  const isPlayerWin = isCheckmate && endReason.includes('you win');

  return (
    <div className="flex flex-col items-center flex-1 px-4 pt-5 pb-8 gap-4">
      {/* Top bar */}
      <div className="w-full max-w-[780px] flex items-center justify-between">
        <button onClick={onBack} className="flex items-center gap-1.5 text-zinc-500 hover:text-zinc-200 text-sm transition-colors cursor-pointer">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M9 2L4 7L9 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Back to games
        </button>
        <div className="text-right">
          <p className="text-zinc-100 text-sm font-semibold">vs {gameData.opponent}</p>
          <p className="text-zinc-500 text-xs">ELO {opponentElo}</p>
        </div>
      </div>

      {/* Mistake banner */}
      {mistakeInfo && !gameEnded && (
        <div className="w-full max-w-[780px] flex items-center gap-3 bg-zinc-900/80 border border-zinc-800 rounded-2xl px-4 py-3">
          <div className="w-1 h-10 rounded-full bg-red-500/70 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-zinc-500 text-[10px] uppercase tracking-widest font-semibold mb-0.5">
              Replaying from move {mistakeInfo.moveNumber}
            </p>
            <p className="text-zinc-200 text-sm">
              Original game had <span className="font-mono font-semibold text-zinc-100">{mistakeInfo.san}</span>
              <span className="text-red-400 ml-2 text-xs font-medium">−{mistakeInfo.cpl}cp</span>
            </p>
          </div>
          <p className="text-zinc-600 text-xs shrink-0 text-right leading-relaxed">Can you<br/>do better?</p>
        </div>
      )}

      {/* Game ended banner */}
      {gameEnded && (
        <div
          className="w-full max-w-[780px] flex items-center justify-between gap-4 rounded-2xl px-5 py-3.5"
          style={{
            background: isPlayerWin ? 'rgba(34,197,94,0.08)' : isCheckmate ? 'rgba(248,113,113,0.08)' : 'rgba(161,161,170,0.08)',
            border: `1px solid ${isPlayerWin ? 'rgba(34,197,94,0.25)' : isCheckmate ? 'rgba(248,113,113,0.25)' : 'rgba(161,161,170,0.2)'}`,
          }}
        >
          <div>
            <p className="text-[10px] uppercase tracking-widest font-semibold mb-0.5" style={{ color: isPlayerWin ? '#4ade80' : isCheckmate ? '#f87171' : '#a1a1aa' }}>
              Game over
            </p>
            <p className="text-zinc-100 text-base font-bold">{endReason}</p>
            <p className="text-zinc-500 text-xs mt-0.5">{replayMoveCount} moves played from move {mistakeInfo?.moveNumber ?? Math.floor(startMoveIndex/2)+1}</p>
          </div>
          <button
            onClick={handleViewResults}
            className="shrink-0 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all cursor-pointer"
            style={{ background: '#f4f4f5', color: '#09090b' }}
          >
            View results →
          </button>
        </div>
      )}

      {/* Board + history */}
      <div className="flex gap-5 w-full max-w-[780px] items-start justify-center">
        {/* Board column */}
        <div className="flex flex-col gap-2.5" style={{ width: '100%', maxWidth: '560px' }}>
          <div ref={boardContainerRef} className="w-full">
            <Chessboard
              options={{
                position: fen,
                onPieceDrop: handlePieceDrop,
                onSquareClick: handleSquareClick,
                boardOrientation: playerColor,
                animationDurationInMs: 180,
                boardWidth: boardWidth || 520,
                boardStyle: {
                  borderRadius: '12px',
                  boxShadow: '0 20px 60px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,255,255,0.04)',
                },
                darkSquareStyle: { backgroundColor: '#3d3d58' },
                lightSquareStyle: { backgroundColor: '#7a7a9a' },
                allowDragging: isMyTurn && !opponentThinking && !gameEnded,
                squareStyles,
              }}
            />
          </div>

          {/* Status bar */}
          {!gameEnded && (
            <div className="flex items-stretch gap-2 mt-0.5">
              <div className={`flex-1 flex items-center px-4 rounded-xl border transition-all duration-300 ${
                isMyTurn && !opponentThinking ? 'bg-zinc-800/60 border-zinc-600' : 'bg-zinc-900 border-zinc-800'
              }`} style={{ minHeight: 44 }}>
                <div className="flex items-center gap-2.5">
                  {opponentThinking && <div className="w-3.5 h-3.5 rounded-full border-2 border-zinc-600 border-t-zinc-300 animate-spin shrink-0" />}
                  {!opponentThinking && isMyTurn && <div className="w-2 h-2 rounded-full bg-emerald-400 shrink-0 animate-pulse" />}
                  <span className={`text-sm font-medium ${isMyTurn && !opponentThinking ? 'text-zinc-100' : 'text-zinc-400'}`}>
                    {opponentThinking ? 'Opponent thinking…' : isMyTurn ? 'Your move' : '—'}
                  </span>
                </div>
              </div>
              <div className="flex flex-col items-center justify-center bg-zinc-900 border border-zinc-800 rounded-xl px-4" style={{ minHeight: 44 }}>
                <span className="text-zinc-100 text-base font-bold tabular-nums leading-none">{currentFullMove}</span>
                <span className="text-zinc-600 text-[10px] leading-none mt-0.5">move</span>
              </div>
              <div className="flex flex-col items-center justify-center bg-zinc-900 border border-zinc-800 rounded-xl px-3.5" style={{ minHeight: 44 }}>
                <div className={`w-5 h-5 rounded-full border-2 ${playerColor === 'white' ? 'bg-zinc-100 border-zinc-400' : 'bg-zinc-800 border-zinc-500'}`} />
                <span className="text-zinc-600 text-[9px] uppercase tracking-wider mt-0.5 font-medium">{playerColor[0].toUpperCase()}</span>
              </div>
            </div>
          )}
        </div>

        {/* Move history panel */}
        <div
          className="hidden lg:flex flex-col w-[148px] shrink-0 rounded-2xl overflow-hidden"
          style={{ background: '#111114', border: '1px solid #222228', maxHeight: 600 }}
        >
          <div className="px-3 py-2.5 shrink-0" style={{ borderBottom: '1px solid #1e1e24' }}>
            <p className="text-zinc-500 text-[10px] uppercase tracking-widest font-bold">Moves</p>
          </div>
          <div className="flex-1 overflow-y-auto min-h-0 p-2">
            {movePairs.length === 0 && <p className="text-zinc-700 text-[11px] px-1 pt-1 italic">No moves yet</p>}
            {movePairs.map((pair, i) => {
              const mNum = Math.floor((startMoveIndex + i * 2) / 2) + 1;
              return (
                <div key={i} className="flex items-center gap-1 py-[3px] text-[11px] font-mono">
                  <span className="text-zinc-700 w-[18px] tabular-nums text-right shrink-0">{mNum}.</span>
                  <span className={`flex-1 truncate ${pair[0]?.player ? 'text-zinc-100 font-medium' : 'text-zinc-500'}`}>{pair[0]?.san ?? ''}</span>
                  <span className={`flex-1 truncate ${pair[1]?.player ? 'text-zinc-100 font-medium' : 'text-zinc-500'}`}>{pair[1]?.san ?? ''}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
