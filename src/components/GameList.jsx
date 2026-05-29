function formatDate(dateStr) {
  if (!dateStr) return '';
  const parts = dateStr.replace(/\./g, '-').split('-');
  if (parts.length < 3) return dateStr;
  const d = new Date(`${parts[0]}-${parts[1]}-${parts[2]}`);
  return isNaN(d) ? dateStr : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatTimeControl(tc) {
  if (!tc) return '';
  const [base, inc] = tc.split('+').map(Number);
  const mins = Math.floor(base / 60);
  const secs = base % 60;
  const baseStr = secs > 0 ? `${mins}:${String(secs).padStart(2, '0')}` : `${mins}m`;
  return inc ? `${baseStr}+${inc}s` : baseStr;
}

const RESULT_CONFIG = {
  win:  { label: 'W', color: '#4ade80', bg: 'rgba(74,222,128,0.08)', border: 'rgba(74,222,128,0.2)' },
  loss: { label: 'L', color: '#f87171', bg: 'rgba(248,113,113,0.08)', border: 'rgba(248,113,113,0.2)' },
  draw: { label: 'D', color: '#a1a1aa', bg: 'rgba(161,161,170,0.08)', border: 'rgba(161,161,170,0.2)' },
};

function ResultBadge({ result }) {
  const cfg = RESULT_CONFIG[result] || RESULT_CONFIG.draw;
  return (
    <div
      className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold shrink-0"
      style={{ color: cfg.color, background: cfg.bg, border: `1px solid ${cfg.border}` }}
    >
      {cfg.label}
    </div>
  );
}

export default function GameList({ games, username, onSelectGame, onBack }) {
  return (
    <div className="flex flex-col flex-1 px-4 py-8 max-w-xl mx-auto w-full">
      {/* Header */}
      <button
        onClick={onBack}
        className="text-zinc-500 hover:text-zinc-200 text-sm mb-8 flex items-center gap-1.5 transition-colors cursor-pointer w-fit"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M9 2L4 7L9 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        Back
      </button>

      <div className="mb-6">
        <p className="text-[10px] tracking-[0.25em] text-zinc-600 uppercase font-semibold mb-1">{username}</p>
        <h2 className="text-2xl font-bold text-zinc-50 tracking-tight">Pick a game to replay</h2>
        <p className="text-zinc-600 text-sm mt-1">{games.length} {games.length === 1 ? 'game' : 'games'} found</p>
      </div>

      <div className="flex flex-col gap-2">
        {games.map((game) => (
          <button
            key={game.id}
            onClick={() => onSelectGame(game)}
            className="group w-full text-left rounded-2xl px-4 py-4 transition-all duration-150 cursor-pointer"
            style={{ background: '#111114', border: '1px solid #1e1e24' }}
            onMouseEnter={e => e.currentTarget.style.borderColor = '#3f3f46'}
            onMouseLeave={e => e.currentTarget.style.borderColor = '#1e1e24'}
          >
            <div className="flex items-center gap-3">
              <ResultBadge result={game.result} />
              <div className="flex-1 min-w-0">
                <p className="text-zinc-100 font-semibold text-sm truncate">vs {game.opponent}</p>
                <p className="text-zinc-600 text-xs mt-0.5">
                  {formatDate(game.date)}{game.timeControl ? ` · ${formatTimeControl(game.timeControl)}` : ''}
                </p>
              </div>
              <div className="shrink-0 text-right mr-1">
                <p className="text-zinc-400 text-xs">ELO</p>
                <p className="text-zinc-200 text-sm font-bold">{game.opponentElo || '—'}</p>
              </div>
              <svg
                className="text-zinc-700 group-hover:text-zinc-400 transition-colors shrink-0"
                width="16" height="16" viewBox="0 0 16 16" fill="none"
              >
                <path d="M6 3L11 8L6 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
