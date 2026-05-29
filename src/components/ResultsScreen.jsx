import { useState, useEffect } from 'react';
import { Chess } from 'chess.js';
import { evaluatePosition } from '../utils/stockfish';

// Build the starting FEN for the replay by fast-forwarding through the full PGN
function buildStartFen(pgn, startMoveIndex) {
  if (!pgn || !startMoveIndex) return null;
  try {
    const loader = new Chess();
    loader.loadPgn(pgn);
    const allMoves = loader.history();
    const game = new Chess();
    for (let i = 0; i < startMoveIndex && i < allMoves.length; i++) {
      game.move(allMoves[i]);
    }
    return game.fen();
  } catch {
    return null;
  }
}

// Build a FEN sequence by replaying moves from an optional starting FEN
function buildFenFromMoves(moves, startFen = null) {
  const game = startFen ? new Chess(startFen) : new Chess();
  const fens = [game.fen()];
  for (const san of moves) {
    try {
      game.move(san);
      fens.push(game.fen());
    } catch {
      break;
    }
  }
  return fens;
}

// Compute divergences on the PLAYER'S moves only.
// White plays on half-move indices 0,2,4... / Black plays on 1,3,5...
function computeDivergences(originalMoves, replayMoves, playerColor) {
  const divergences = [];
  const playerStartIndex = playerColor === 'white' ? 0 : 1;
  const len = Math.min(originalMoves.length, replayMoves.length);

  for (let i = playerStartIndex; i < len; i += 2) {
    if (originalMoves[i] !== replayMoves[i]) {
      divergences.push({
        halfMoveIndex: i,
        moveNumber: Math.floor(i / 2) + 1,
        isWhiteMove: i % 2 === 0,
        originalMove: originalMoves[i],
        replayMove: replayMoves[i],
      });
    }
  }
  return divergences;
}

// Evaluate each divergence using the position that actually arose in the replay.
// After the player's move, it's the opponent's turn — a higher score (from side-to-move)
// means more advantage for the OPPONENT, so origScore > replayScore = improvement.
async function evaluateDivergences(divergences, replayMoves, startFen) {
  const results = [];

  for (const div of divergences) {
    // Position BEFORE the player's diverging move — built from the replay's starting FEN
    const movesBeforeThis = replayMoves.slice(0, div.halfMoveIndex);
    const fens = buildFenFromMoves(movesBeforeThis, startFen);
    const positionFen = fens[fens.length - 1];

    // FEN after player's original move (hypothetically, same pre-divergence position)
    const origGame = new Chess(positionFen);
    let origFen = null;
    try {
      origGame.move(div.originalMove);
      origFen = origGame.fen();
    } catch {}

    // FEN after player's actual replay move
    const replayGame = new Chess(positionFen);
    let replayFen = null;
    try {
      replayGame.move(div.replayMove);
      replayFen = replayGame.fen();
    } catch {}

    let origScore = null;
    let replayScore = null;

    try {
      if (origFen) ({ score: origScore } = await evaluatePosition(origFen, 10));
      if (replayFen) ({ score: replayScore } = await evaluatePosition(replayFen, 10));
    } catch {}

    // Verdict: after the player's move, the engine score is from the OPPONENT's perspective.
    // Lower opponent score = better for the player. So origScore > replayScore = improvement.
    let verdict = 'Unknown';
    if (origScore !== null && replayScore !== null) {
      const diff = origScore - replayScore; // positive = new move reduced opponent's advantage
      if (Math.abs(diff) < 30) verdict = 'Same';
      else if (diff > 0) verdict = 'Improvement';
      else verdict = 'Worse';
    }

    results.push({ ...div, origScore, replayScore, verdict });
  }

  return results;
}

function VerdictBadge({ verdict }) {
  const styles = {
    Improvement: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/25',
    Same:        'text-zinc-400  bg-zinc-400/10  border-zinc-400/25',
    Worse:       'text-red-400   bg-red-400/10   border-red-400/25',
    Unknown:     'text-zinc-600  bg-zinc-800     border-zinc-700',
  };
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded border ${styles[verdict] || styles.Unknown}`}>
      {verdict}
    </span>
  );
}

export default function ResultsScreen({ resultData, onRestart, onPlayAnother }) {
  const { originalMoves, replayMoves, playerColor, opponentElo, skillLevel, mistakeInfo, startMoveIndex = 0, pgn } = resultData;

  // Build the FEN at the start of the replay — needed so FEN sequences are built correctly
  const startFen = buildStartFen(pgn, startMoveIndex);

  const [evaluations, setEvaluations] = useState(null);
  const [evaluating, setEvaluating] = useState(true);
  const [activeTab, setActiveTab] = useState('summary');

  // Divergences: half-move indices are relative to startMoveIndex
  // Move numbers shown as real game move numbers
  const divergences = computeDivergences(originalMoves, replayMoves, playerColor).map(d => ({
    ...d,
    moveNumber: Math.floor((startMoveIndex + d.halfMoveIndex) / 2) + 1,
  }));

  const improvementCount = evaluations?.filter((e) => e.verdict === 'Improvement').length ?? 0;
  const worseCount = evaluations?.filter((e) => e.verdict === 'Worse').length ?? 0;

  // Run async engine evaluation after mount — does not block UI
  useEffect(() => {
    let cancelled = false;
    setEvaluating(true);

    evaluateDivergences(divergences, replayMoves, startFen).then((evals) => {
      if (!cancelled) {
        setEvaluations(evals);
        setEvaluating(false);
      }
    }).catch(() => {
      if (!cancelled) setEvaluating(false);
    });

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Lengths for the side-by-side comparison
  const fullMoveCount = Math.ceil(Math.max(originalMoves.length, replayMoves.length) / 2);

  // Quick lookup for divergence by half-move index
  const divergenceMap = new Map(divergences.map((d) => [d.halfMoveIndex, d]));
  const evalMap = new Map((evaluations ?? []).map((e) => [e.halfMoveIndex, e]));

  return (
    <div className="flex flex-col flex-1 px-4 py-8 max-w-2xl mx-auto w-full">
      {/* Header */}
      <div className="mb-8">
        <p className="text-[11px] tracking-[0.2em] text-zinc-500 uppercase mb-2 font-medium">
          Replay Complete
        </p>
        <h2 className="text-2xl font-semibold text-zinc-100 tracking-tight">
          How did you do?
        </h2>
        {mistakeInfo ? (
          <p className="text-zinc-500 text-sm mt-1">
            Started at move {mistakeInfo.moveNumber} — original mistake{' '}
            <span className="font-mono text-zinc-400">{mistakeInfo.san}</span>{' '}
            (−{mistakeInfo.cpl}cp)
          </p>
        ) : (
          <p className="text-zinc-500 text-sm mt-1">
            Started at move {Math.floor(startMoveIndex / 2) + 1} · played {playerColor} · ELO {opponentElo}
          </p>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 text-center">
          <p className="text-2xl font-semibold text-zinc-100">{divergences.length}</p>
          <p className="text-zinc-500 text-xs mt-1">Your divergences</p>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 text-center">
          <p className="text-2xl font-semibold text-emerald-400">{improvementCount}</p>
          <p className="text-zinc-500 text-xs mt-1">Improvements</p>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 text-center">
          <p className="text-2xl font-semibold text-red-400">{worseCount}</p>
          <p className="text-zinc-500 text-xs mt-1">Worse moves</p>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 bg-zinc-900 border border-zinc-800 rounded-xl p-1 mb-6">
        {[
          { id: 'summary', label: 'Divergence Summary' },
          { id: 'comparison', label: 'Side by Side' },
          { id: 'engine', label: 'Engine Eval' },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 text-sm py-2 rounded-lg transition-colors font-medium ${
              activeTab === tab.id
                ? 'bg-zinc-700 text-zinc-100'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 min-h-0 overflow-y-auto">

        {/* --- Divergence Summary --- */}
        {activeTab === 'summary' && (
          <div className="flex flex-col gap-2">
            {divergences.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-zinc-300 text-base font-medium">Perfect replay</p>
                <p className="text-zinc-500 text-sm mt-1">Every one of your moves matched the original game.</p>
              </div>
            ) : (
              divergences.map((div) => {
                const ev = evalMap.get(div.halfMoveIndex);
                return (
                  <div
                    key={div.halfMoveIndex}
                    className="bg-zinc-900 border border-zinc-800 rounded-xl px-5 py-4"
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-zinc-500 text-xs mb-2">
                          Move {div.moveNumber} ({div.isWhiteMove ? 'White' : 'Black'})
                        </p>
                        <div className="flex items-center gap-4">
                          <div>
                            <p className="text-zinc-600 text-xs">Original</p>
                            <p className="text-zinc-300 font-mono text-sm font-medium">{div.originalMove}</p>
                          </div>
                          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="text-zinc-600 shrink-0 mt-3">
                            <path d="M2 7H12M8 3L12 7L8 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                          <div>
                            <p className="text-zinc-600 text-xs">You played</p>
                            <p className="text-zinc-100 font-mono text-sm font-medium">{div.replayMove}</p>
                          </div>
                        </div>
                      </div>
                      {evaluating && !ev ? (
                        <span className="text-zinc-600 text-xs shrink-0">Evaluating...</span>
                      ) : ev ? (
                        <VerdictBadge verdict={ev.verdict} />
                      ) : null}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* --- Side by Side Comparison --- */}
        {activeTab === 'comparison' && (
          <div>
            <div className="grid grid-cols-[3rem_1fr_1fr] gap-2 mb-3 px-2">
              <div />
              <p className="text-zinc-500 text-xs uppercase tracking-wider font-medium">Original</p>
              <p className="text-zinc-500 text-xs uppercase tracking-wider font-medium">Your replay</p>
            </div>
            <div className="flex flex-col gap-0.5">
              {Array.from({ length: fullMoveCount }, (_, i) => {
                const wi = i * 2; // white half-move index
                const bi = i * 2 + 1; // black half-move index
                const wDiv = divergenceMap.has(wi);
                const bDiv = divergenceMap.has(bi);

                return (
                  <div
                    key={i}
                    className="grid grid-cols-[3rem_1fr_1fr] gap-2 px-3 py-1.5 rounded-lg hover:bg-zinc-900/50"
                  >
                    <span className="text-zinc-600 text-sm tabular-nums">{i + 1}.</span>

                    {/* Original column: white + black */}
                    <div className="flex gap-3">
                      <span className={`font-mono text-sm ${wDiv ? 'text-amber-400' : 'text-zinc-400'}`}>
                        {originalMoves[wi] || ''}
                      </span>
                      <span className={`font-mono text-sm ${bDiv ? 'text-amber-400' : 'text-zinc-400'}`}>
                        {originalMoves[bi] || ''}
                      </span>
                    </div>

                    {/* Replay column: white + black */}
                    <div className="flex gap-3">
                      <span className={`font-mono text-sm ${wDiv ? 'text-zinc-100 font-medium' : 'text-zinc-400'}`}>
                        {replayMoves[wi] || ''}
                      </span>
                      <span className={`font-mono text-sm ${bDiv ? 'text-zinc-100 font-medium' : 'text-zinc-400'}`}>
                        {replayMoves[bi] || ''}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* --- Engine Evaluation --- */}
        {activeTab === 'engine' && (
          <div>
            {evaluating && (
              <div className="text-center py-12">
                <div className="w-6 h-6 border-2 border-zinc-700 border-t-zinc-400 rounded-full animate-spin mx-auto mb-4" />
                <p className="text-zinc-400 text-sm">Evaluating your divergences with Stockfish...</p>
                <p className="text-zinc-600 text-xs mt-1">This runs in the background — switch tabs freely</p>
              </div>
            )}

            {!evaluating && divergences.length === 0 && (
              <div className="text-center py-12">
                <p className="text-zinc-300 text-base font-medium">No divergences to evaluate</p>
                <p className="text-zinc-500 text-sm mt-1">You played every move identically to the original game.</p>
              </div>
            )}

            {!evaluating && evaluations && evaluations.length > 0 && (
              <div className="flex flex-col gap-2">
                {evaluations.map((ev) => (
                  <div
                    key={ev.halfMoveIndex}
                    className="bg-zinc-900 border border-zinc-800 rounded-xl px-5 py-4"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-zinc-500 text-xs mb-2">
                          Move {ev.moveNumber} ({ev.isWhiteMove ? 'White' : 'Black'})
                        </p>
                        <div className="flex items-start gap-6">
                          <div>
                            <p className="text-zinc-500 text-xs">Original: <span className="font-mono text-zinc-300">{ev.originalMove}</span></p>
                            <p className="text-zinc-600 text-xs mt-0.5">
                              {ev.origScore !== null
                                ? `Score after: ${ev.origScore > 0 ? '+' : ''}${ev.origScore} cp`
                                : 'Score: n/a'}
                            </p>
                          </div>
                          <div>
                            <p className="text-zinc-400 text-xs font-medium">Replay: <span className="font-mono text-zinc-100">{ev.replayMove}</span></p>
                            <p className="text-zinc-600 text-xs mt-0.5">
                              {ev.replayScore !== null
                                ? `Score after: ${ev.replayScore > 0 ? '+' : ''}${ev.replayScore} cp`
                                : 'Score: n/a'}
                            </p>
                          </div>
                        </div>
                      </div>
                      <VerdictBadge verdict={ev.verdict} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="mt-8 pt-4 border-t border-zinc-800/50 flex flex-col gap-2">
        {onPlayAnother && (
          <button
            onClick={onPlayAnother}
            className="w-full bg-zinc-100 text-zinc-900 font-medium rounded-xl px-5 py-3.5 text-sm hover:bg-white transition-colors cursor-pointer"
          >
            Pick another game
          </button>
        )}
        <button
          onClick={onRestart}
          className="w-full bg-transparent border border-zinc-800 text-zinc-400 font-medium rounded-xl px-5 py-3.5 text-sm hover:border-zinc-600 hover:text-zinc-200 transition-colors cursor-pointer"
        >
          Start over
        </button>
      </div>
    </div>
  );
}
