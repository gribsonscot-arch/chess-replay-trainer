// Stockfish singleton — initialized once via Web Worker, reused throughout the app.
// /public/stockfish.js is the stockfish-18-lite-single build (single-threaded WASM).
// /public/stockfish.wasm is the matching WASM binary.

let worker = null;
let ready = false;
let failed = false;
let readyCallbacks = [];

// Single pending resolver for bestmove commands
let pendingBestMove = null;

// Active handler for multi-line eval responses
let pendingEval = null;

// Serialised command queue — the engine processes one command chain at a time
let commandQueue = Promise.resolve();

function createWorker() {
  let w;
  try {
    w = new Worker('/stockfish.js');
  } catch (e) {
    console.warn('[Stockfish] Could not create worker:', e);
    failed = true;
    return null;
  }

  w.onmessage = (e) => {
    const msg = typeof e.data === 'string' ? e.data : String(e.data ?? '');

    if (msg === 'uciok') {
      w.postMessage('isready');
      return;
    }

    if (msg === 'readyok') {
      ready = true;
      readyCallbacks.forEach((cb) => cb());
      readyCallbacks = [];
      return;
    }

    // Route to active eval handler (captures info lines + bestmove)
    if (pendingEval) {
      pendingEval(msg);
    }

    // bestmove resolves getBestMove
    if (pendingBestMove && msg.startsWith('bestmove')) {
      const parts = msg.split(' ');
      const bm = parts[1] && parts[1] !== '(none)' ? parts[1] : null;
      const resolve = pendingBestMove;
      pendingBestMove = null;
      resolve({ bestmove: bm });
    }
  };

  w.onerror = (e) => {
    // Log detailed error info for debugging
    console.error('[Stockfish] Worker error —', e.message || e.type, 'at', e.filename, ':', e.lineno);
    failed = true;
    // Unblock any waiting callers
    readyCallbacks.forEach((cb) => cb());
    readyCallbacks = [];
    if (pendingBestMove) { pendingBestMove({ bestmove: null }); pendingBestMove = null; }
    if (pendingEval) { pendingEval('bestmove 0000'); pendingEval = null; }
  };

  w.postMessage('uci');
  return w;
}

function getWorker() {
  if (!worker && !failed) worker = createWorker();
  return worker;
}

// Resolve immediately if engine failed, otherwise wait for readyok
function ensureReady() {
  return new Promise((resolve) => {
    if (ready || failed) return resolve();
    readyCallbacks.push(resolve);
    getWorker();
  });
}

// Map ELO to Stockfish UCI Skill Level (0–20)
export function eloToSkillLevel(elo) {
  if (elo < 800)  return 1;
  if (elo < 1000) return 3;
  if (elo < 1200) return 5;
  if (elo < 1400) return 7;
  if (elo < 1600) return 10;
  if (elo < 1800) return 13;
  if (elo < 2000) return 16;
  if (elo < 2200) return 18;
  return 20;
}

// Returns whether the engine is available (not failed)
export function isEngineAvailable() {
  return !failed;
}

// Request the best move for a position at a given skill level.
// Returns { bestmove: "e2e4" | null } — null if engine unavailable.
export function getBestMove(fen, skillLevel = 20, movetime = 500) {
  return commandQueue = commandQueue.then(() => _getBestMove(fen, skillLevel, movetime));
}

async function _getBestMove(fen, skillLevel, movetime) {
  await ensureReady();
  const w = getWorker();
  if (!w || failed) return { bestmove: null };

  return new Promise((resolve) => {
    pendingBestMove = resolve;
    w.postMessage(`setoption name Skill Level value ${skillLevel}`);
    w.postMessage(`position fen ${fen}`);
    w.postMessage(`go movetime ${movetime}`);
  });
}

// Evaluate a position, returning { score: centipawns | null }.
export function evaluatePosition(fen, depth = 12) {
  return commandQueue = commandQueue.then(() => _evaluatePosition(fen, depth));
}

async function _evaluatePosition(fen, depth) {
  await ensureReady();
  const w = getWorker();
  if (!w || failed) return { score: null };

  return new Promise((resolve) => {
    let latestScore = null;

    pendingEval = (msg) => {
      if (msg.startsWith('info') && msg.includes('score cp')) {
        const m = msg.match(/score cp (-?\d+)/);
        if (m) latestScore = parseInt(m[1], 10);
      }
      if (msg.startsWith('info') && msg.includes('score mate')) {
        const m = msg.match(/score mate (-?\d+)/);
        if (m) latestScore = parseInt(m[1], 10) > 0 ? 9999 : -9999;
      }
      if (msg.startsWith('bestmove')) {
        pendingEval = null;
        resolve({ score: latestScore });
      }
    };

    w.postMessage('setoption name Skill Level value 20');
    w.postMessage(`position fen ${fen}`);
    w.postMessage(`go depth ${depth}`);
  });
}

// Pre-warm the engine at app startup
export function initStockfish() {
  getWorker();
}
