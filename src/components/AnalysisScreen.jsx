import { useState, useEffect, useRef } from 'react';
import { Chess } from 'chess.js';
import { evaluatePosition, stopEngine } from '../utils/stockfish';

function buildGameSequence(pgn) {
  const loader = new Chess();
  try { loader.loadPgn(pgn); } catch { return { moves: [], fens: [] }; }
  const moves = loader.history();
  const replay = new Chess();
  const fens = [replay.fen()];
  for (const san of moves) {
    try { replay.move(san); fens.push(replay.fen()); } catch { break; }
  }
  return { moves, fens };
}

export default function AnalysisScreen({ gameData, onAnalysisComplete, onBack }) {
  const [phase, setPhase] = useState('scanning'); // 'scanning' | 'found' | 'none'
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState('Building game sequence…');
  const [mistakeFound, setMistakeFound] = useState(null);
  const cancelled = useRef(false);
  const playerColor = gameData.playerColor;

  useEffect(() => {
    cancelled.current = false;
    runAnalysis();
    return () => { cancelled.current = true; stopEngine(); };

    async function runAnalysis() {
      const { moves, fens } = buildGameSequence(gameData.pgn);
      const total = moves.length;

      if (total < 6) {
        onAnalysisComplete({ startMoveIndex: 0, mistakeInfo: null });
        return;
      }

      const midpoint = Math.floor(total / 2);
      const playerOffset = playerColor === 'white' ? 0 : 1;
      const playerMoves = [];
      for (let i = midpoint; i < total; i++) {
        if (i % 2 === playerOffset) playerMoves.push(i);
      }

      if (playerMoves.length === 0) {
        onAnalysisComplete({ startMoveIndex: midpoint, mistakeInfo: null });
        return;
      }

      const THRESHOLD = 200;
      let found = null;

      for (let idx = 0; idx < playerMoves.length; idx++) {
        if (cancelled.current) return;
        const moveIdx = playerMoves[idx];
        const fenBefore = fens[moveIdx];
        const fenAfter = fens[moveIdx + 1];
        if (!fenBefore || !fenAfter) continue;

        const moveNumber = Math.floor(moveIdx / 2) + 1;
        setStatusText(`Scanning move ${moveNumber} of ${Math.floor((total - 1) / 2) + 1}…`);
        setProgress(Math.round(10 + (idx / playerMoves.length) * 85));

        let sb = 0, sa = 0;
        try {
          const [eb, ea] = await Promise.all([evaluatePosition(fenBefore, 10), evaluatePosition(fenAfter, 10)]);
          if (cancelled.current) return;
          sb = eb.score ?? 0;
          sa = ea.score ?? 0;
        } catch { continue; }

        // CPL: scoreBefore (player's pov) + scoreAfter (opponent's pov, positive = opp winning)
        const cpl = Math.max(0, sb + sa);

        if (cpl >= THRESHOLD) {
          found = { moveIndex: moveIdx, moveNumber, san: moves[moveIdx], cpl: Math.round(cpl) };
          setMistakeFound(found);
          setPhase('found');
          break;
        }
      }

      if (cancelled.current) return;
      setProgress(100);

      if (!found) {
        setPhase('none');
        setStatusText('No clear mistake — starting from midpoint');
      }

      await new Promise(r => setTimeout(r, 1000));
      if (cancelled.current) return;

      // Always leave at least 10 half-moves (5 full moves) remaining to replay
      const MIN_REMAINING = 10;
      const latestAllowed = total - MIN_REMAINING;
      const rawStart = found ? found.moveIndex : midpoint;
      const startMoveIndex = Math.min(rawStart, Math.max(midpoint, latestAllowed));

      onAnalysisComplete({ startMoveIndex, mistakeInfo: found });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col items-center justify-center flex-1 px-4 min-h-screen">
      <div className="w-full max-w-sm">
        <button
          onClick={onBack}
          className="text-zinc-600 hover:text-zinc-300 text-sm flex items-center gap-1.5 mb-12 transition-colors cursor-pointer"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M9 2L4 7L9 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Back
        </button>

        <div className="mb-10 text-center">
          <p className="text-[10px] tracking-[0.25em] text-zinc-600 uppercase font-semibold mb-3">Analysing game</p>
          <h2 className="text-3xl font-bold text-zinc-50 tracking-tight mb-1">vs {gameData.opponent}</h2>
          <p className="text-zinc-500 text-sm">{statusText}</p>
        </div>

        {/* Progress track */}
        <div className="relative mb-8">
          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: '#1a1a1f' }}>
            <div
              className="h-full rounded-full transition-all duration-500 ease-out"
              style={{
                width: `${progress}%`,
                background: phase === 'found' ? '#f87171' : phase === 'none' ? '#a1a1aa' : '#6366f1',
              }}
            />
          </div>
          <p className="text-zinc-700 text-[10px] text-right mt-1.5 tabular-nums">{progress}%</p>
        </div>

        {/* Result card */}
        {phase === 'found' && mistakeFound && (
          <div
            className="rounded-2xl px-5 py-4"
            style={{ background: '#111114', border: '1px solid #2a1f1f' }}
          >
            <div className="flex items-start gap-3">
              <div className="w-1 h-12 rounded-full shrink-0 mt-0.5" style={{ background: '#f87171' }} />
              <div className="flex-1">
                <p className="text-zinc-500 text-[10px] uppercase tracking-widest font-bold mb-2">Mistake found</p>
                <p className="text-zinc-100 text-base font-bold">
                  Move {mistakeFound.moveNumber}
                  <span className="font-mono ml-2 text-zinc-300">{mistakeFound.san}</span>
                </p>
                <p className="text-red-400 text-sm font-medium mt-0.5">−{mistakeFound.cpl} centipawns</p>
              </div>
            </div>
            <p className="text-zinc-600 text-xs mt-3 pl-4">Starting replay here — can you find a better move?</p>
          </div>
        )}

        {phase === 'none' && (
          <div className="rounded-2xl px-5 py-4 text-center" style={{ background: '#111114', border: '1px solid #222228' }}>
            <p className="text-zinc-400 text-sm font-medium">No clear mistake detected</p>
            <p className="text-zinc-600 text-xs mt-1">Starting from the second half of the game</p>
          </div>
        )}

        {phase === 'scanning' && (
          <p className="text-zinc-700 text-xs text-center">
            Scanning {playerColor}'s moves in the second half…
          </p>
        )}
      </div>
    </div>
  );
}
