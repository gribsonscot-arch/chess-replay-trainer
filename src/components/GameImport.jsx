import { useState } from 'react';
import { Chess } from 'chess.js';
import { fetchRecentGames, parsePgnHeaders } from '../utils/chesscomApi';

function parsePgnToGame(pgn, playerColor) {
  const chess = new Chess();
  chess.loadPgn(pgn);
  const headers = parsePgnHeaders(pgn);
  const opponentSide = playerColor === 'white' ? 'black' : 'white';
  const opponentName = headers[opponentSide === 'white' ? 'White' : 'Black'] || 'Unknown';
  const rawElo = parseInt(headers[opponentSide === 'white' ? 'WhiteElo' : 'BlackElo'] || '1200', 10);
  const opponentElo = isNaN(rawElo) ? 1200 : rawElo;
  const res = headers.Result || '*';
  let result = 'draw';
  if ((res === '1-0' && playerColor === 'white') || (res === '0-1' && playerColor === 'black')) result = 'win';
  else if ((res === '0-1' && playerColor === 'white') || (res === '1-0' && playerColor === 'black')) result = 'loss';
  const playerName = headers[playerColor === 'white' ? 'White' : 'Black'] || 'You';
  return { id: `pgn-${Date.now()}`, pgn, url: '', date: headers.Date || '', timeControl: headers.TimeControl || '', opponent: opponentName, opponentElo, result, playerColor, _playerName: playerName };
}

export default function GameImport({ onGamesLoaded }) {
  const [tab, setTab] = useState('username');
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [pgnText, setPgnText] = useState('');
  const [pgnColor, setPgnColor] = useState('white');
  const [pgnError, setPgnError] = useState(null);

  async function handleUsernameSubmit(e) {
    e.preventDefault();
    const trimmed = username.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    try {
      const games = await fetchRecentGames(trimmed);
      if (games.length === 0) setError('No recent games found for this username.');
      else onGamesLoaded(games, trimmed);
    } catch (err) {
      if (err.message?.includes('404') || err.message?.includes('HTTP 4')) setError('Username not found on Chess.com.');
      else setError('Failed to reach Chess.com. Check your connection and try again.');
    } finally { setLoading(false); }
  }

  function handlePgnSubmit(e) {
    e.preventDefault();
    const pgn = pgnText.trim();
    if (!pgn) return;
    setPgnError(null);
    try {
      const game = parsePgnToGame(pgn, pgnColor);
      onGamesLoaded([game], game._playerName);
    } catch { setPgnError('Invalid PGN — paste the full game text and try again.'); }
  }

  function switchTab(t) { setTab(t); setError(null); setPgnError(null); }

  return (
    <div className="flex flex-col items-center justify-center flex-1 px-4 py-12 min-h-screen">
      {/* Hero */}
      <div className="mb-10 text-center max-w-md">
        <p className="text-[10px] tracking-[0.25em] text-zinc-600 uppercase mb-4 font-semibold">Chess Replay Trainer</p>
        <h1 className="text-[2.6rem] sm:text-5xl font-bold tracking-tight text-zinc-50 leading-[1.1] mb-4">
          Play your<br/>losses again.
        </h1>
        <p className="text-zinc-500 text-base leading-relaxed max-w-xs mx-auto">
          We find your first mistake and put you back in that exact position. No hints. No engine arrows.
        </p>
      </div>

      {/* Tabs */}
      <div className="w-full max-w-sm mb-4">
        <div className="flex p-1 gap-1 rounded-2xl" style={{ background: '#111114', border: '1px solid #1e1e24' }}>
          {[['username', 'Chess.com'], ['pgn', 'Paste PGN']].map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => switchTab(id)}
              className="flex-1 py-2.5 text-sm font-semibold rounded-xl transition-all duration-200 cursor-pointer"
              style={{
                background: tab === id ? '#222228' : 'transparent',
                color: tab === id ? '#f4f4f5' : '#52525b',
                boxShadow: tab === id ? '0 1px 3px rgba(0,0,0,0.4)' : 'none',
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Username form */}
      {tab === 'username' && (
        <form onSubmit={handleUsernameSubmit} className="w-full max-w-sm flex flex-col gap-2.5">
          <input
            type="text"
            value={username}
            onChange={e => setUsername(e.target.value)}
            placeholder="Chess.com username"
            disabled={loading}
            autoFocus
            className="w-full rounded-xl px-5 py-4 text-base text-zinc-100 placeholder-zinc-600 focus:outline-none transition-all duration-150 disabled:opacity-50"
            style={{ background: '#111114', border: '1px solid #222228' }}
            onFocus={e => e.target.style.borderColor = '#3f3f46'}
            onBlur={e => e.target.style.borderColor = '#222228'}
          />
          <button
            type="submit"
            disabled={loading || !username.trim()}
            className="w-full py-4 text-base font-bold rounded-xl transition-all duration-150 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: '#f4f4f5', color: '#09090b' }}
          >
            {loading ? 'Loading…' : 'Load recent games →'}
          </button>
          {error && (
            <div className="rounded-xl px-4 py-3 text-center mt-1" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
              <p className="text-red-400 text-sm">{error}</p>
            </div>
          )}
        </form>
      )}

      {/* PGN form */}
      {tab === 'pgn' && (
        <form onSubmit={handlePgnSubmit} className="w-full max-w-sm flex flex-col gap-2.5">
          <textarea
            value={pgnText}
            onChange={e => setPgnText(e.target.value)}
            placeholder={'Paste your PGN here…\n\n[Event "Game"]\n[White "You"]\n[Black "Opponent"]\n\n1. e4 e5 ...'}
            rows={7}
            autoFocus
            className="w-full rounded-xl px-5 py-4 text-sm font-mono text-zinc-300 placeholder-zinc-700 focus:outline-none resize-none leading-relaxed transition-all duration-150"
            style={{ background: '#111114', border: '1px solid #222228' }}
            onFocus={e => e.target.style.borderColor = '#3f3f46'}
            onBlur={e => e.target.style.borderColor = '#222228'}
          />
          <div className="flex items-center gap-3">
            <span className="text-zinc-500 text-sm shrink-0">I played as</span>
            <div className="flex gap-2 flex-1">
              {['white', 'black'].map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setPgnColor(c)}
                  className="flex-1 py-2.5 text-sm font-semibold rounded-xl capitalize transition-all duration-150 cursor-pointer"
                  style={{
                    background: pgnColor === c ? (c === 'white' ? '#f4f4f5' : '#222228') : 'transparent',
                    color: pgnColor === c ? (c === 'white' ? '#09090b' : '#f4f4f5') : '#52525b',
                    border: pgnColor === c ? (c === 'white' ? '1px solid #e4e4e7' : '1px solid #3f3f46') : '1px solid #222228',
                  }}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
          <button
            type="submit"
            disabled={!pgnText.trim()}
            className="w-full py-4 text-base font-bold rounded-xl transition-all duration-150 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: '#f4f4f5', color: '#09090b' }}
          >
            Analyse game →
          </button>
          {pgnError && (
            <div className="rounded-xl px-4 py-3 text-center mt-1" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
              <p className="text-red-400 text-sm">{pgnError}</p>
            </div>
          )}
          <p className="text-zinc-700 text-xs text-center mt-1">
            Chess.com: Game Review → Share → Copy PGN
          </p>
        </form>
      )}
    </div>
  );
}
