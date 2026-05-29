import { useState, useEffect } from 'react';
import GameImport from './components/GameImport';
import GameList from './components/GameList';
import AnalysisScreen from './components/AnalysisScreen';
import ReplayBoard from './components/ReplayBoard';
import ResultsScreen from './components/ResultsScreen';
import { initStockfish } from './utils/stockfish';

const SCREENS = {
  IMPORT: 'import',
  LIST: 'list',
  ANALYSIS: 'analysis',
  REPLAY: 'replay',
  RESULTS: 'results',
};

export default function App() {
  const [screen, setScreen] = useState(SCREENS.IMPORT);
  const [visible, setVisible] = useState(true);
  const [games, setGames] = useState([]);
  const [username, setUsername] = useState('');
  const [selectedGame, setSelectedGame] = useState(null);
  const [analysisResult, setAnalysisResult] = useState(null);
  const [resultData, setResultData] = useState(null);

  useEffect(() => {
    initStockfish();
  }, []);

  function transitionTo(nextScreen) {
    setVisible(false);
    setTimeout(() => {
      setScreen(nextScreen);
      setVisible(true);
    }, 200);
  }

  function handleGamesLoaded(loadedGames, user) {
    setGames(loadedGames);
    setUsername(user);
    transitionTo(SCREENS.LIST);
  }

  function handleSelectGame(game) {
    setSelectedGame(game);
    setAnalysisResult(null);
    transitionTo(SCREENS.ANALYSIS);
  }

  function handleAnalysisComplete(result) {
    setAnalysisResult(result);
    transitionTo(SCREENS.REPLAY);
  }

  function handleGameEnd(data) {
    setResultData(data);
    transitionTo(SCREENS.RESULTS);
  }

  function handleRestart() {
    setSelectedGame(null);
    setAnalysisResult(null);
    setResultData(null);
    transitionTo(SCREENS.IMPORT);
  }

  function handlePlayAnother() {
    setSelectedGame(null);
    setAnalysisResult(null);
    setResultData(null);
    transitionTo(SCREENS.LIST);
  }

  return (
    <div
      className="flex flex-col min-h-screen bg-[#0d0d0f]"
      style={{ opacity: visible ? 1 : 0, transition: 'opacity 0.2s ease' }}
    >
      {screen === SCREENS.IMPORT && (
        <GameImport onGamesLoaded={handleGamesLoaded} />
      )}

      {screen === SCREENS.LIST && (
        <GameList
          games={games}
          username={username}
          onSelectGame={handleSelectGame}
          onBack={() => transitionTo(SCREENS.IMPORT)}
        />
      )}

      {screen === SCREENS.ANALYSIS && selectedGame && (
        <AnalysisScreen
          gameData={selectedGame}
          onAnalysisComplete={handleAnalysisComplete}
          onBack={() => transitionTo(SCREENS.LIST)}
        />
      )}

      {screen === SCREENS.REPLAY && selectedGame && analysisResult && (
        <ReplayBoard
          gameData={selectedGame}
          startMoveIndex={analysisResult.startMoveIndex}
          mistakeInfo={analysisResult.mistakeInfo}
          onGameEnd={handleGameEnd}
          onBack={() => transitionTo(SCREENS.LIST)}
        />
      )}

      {screen === SCREENS.RESULTS && resultData && (
        <ResultsScreen
          resultData={resultData}
          onRestart={handleRestart}
          onPlayAnother={handlePlayAnother}
        />
      )}
    </div>
  );
}
