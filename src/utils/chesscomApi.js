// Chess.com public API helpers.
// Fetches games from current + previous month to maximise recent game coverage.

function getMonthArchiveUrl(username, year, month) {
  const m = String(month).padStart(2, '0');
  return `https://api.chess.com/pub/player/${username}/games/${year}/${m}`;
}

function getPreviousMonth(year, month) {
  if (month === 1) return { year: year - 1, month: 12 };
  return { year, month: month - 1 };
}

// Parse a PGN header block into a key/value map.
export function parsePgnHeaders(pgn) {
  const headers = {};
  const headerRegex = /\[(\w+)\s+"([^"]+)"\]/g;
  let match;
  while ((match = headerRegex.exec(pgn)) !== null) {
    headers[match[1]] = match[2];
  }
  return headers;
}

// Determine which side the local player was on and return opponent info.
function extractGameInfo(game, username) {
  const headers = parsePgnHeaders(game.pgn || '');
  const lc = username.toLowerCase();
  const isWhite = (game.white?.username || '').toLowerCase() === lc;
  const opponent = isWhite ? game.black : game.white;
  const playerResult = isWhite ? game.white?.result : game.black?.result;
  const opponentElo = isWhite
    ? parseInt(headers.BlackElo || game.black?.rating || 0, 10)
    : parseInt(headers.WhiteElo || game.white?.rating || 0, 10);

  let result = 'draw';
  if (playerResult === 'win') result = 'win';
  else if (playerResult === 'checkmated' || playerResult === 'resigned' ||
           playerResult === 'timeout' || playerResult === 'abandoned' ||
           playerResult === 'lose') result = 'loss';

  return {
    id: game.url,
    pgn: game.pgn,
    url: game.url,
    date: headers.Date || '',
    timeControl: game.time_control || headers.TimeControl || '',
    opponent: opponent?.username || 'Unknown',
    opponentElo,
    result,
    playerColor: isWhite ? 'white' : 'black',
  };
}

// Fetch the most recent games for a username (current + previous month).
// Returns an array of game info objects sorted newest-first.
export async function fetchRecentGames(username) {
  const now = new Date();
  const curr = { year: now.getFullYear(), month: now.getMonth() + 1 };
  const prev = getPreviousMonth(curr.year, curr.month);

  const urls = [
    getMonthArchiveUrl(username, curr.year, curr.month),
    getMonthArchiveUrl(username, prev.year, prev.month),
  ];

  const responses = await Promise.allSettled(
    urls.map((url) =>
      fetch(url, {
        headers: { 'User-Agent': 'chess-replay-trainer/1.0' },
      }).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
    )
  );

  const allGames = [];
  for (const r of responses) {
    if (r.status === 'fulfilled' && Array.isArray(r.value?.games)) {
      allGames.push(...r.value.games);
    }
  }

  if (allGames.length === 0) {
    // Could be empty months or bad username — let caller decide
    return [];
  }

  // Sort newest first (end_time unix timestamp)
  allGames.sort((a, b) => (b.end_time || 0) - (a.end_time || 0));

  return allGames.map((g) => extractGameInfo(g, username)).filter((g) => g.pgn);
}
