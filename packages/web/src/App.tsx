import { useEffect } from 'react';
import { connect } from './net/ws.js';
import { Toasts } from './components/Toasts.js';
import { useGameStore } from './state/gameStore.js';
import { Editor } from './screens/Editor.js';
import { Game } from './screens/Game.js';
import { Home } from './screens/Home.js';
import { Lobby } from './screens/Lobby.js';
import { Replay } from './screens/Replay.js';

export function App(): JSX.Element {
  const screen = useGameStore((s) => s.screen);

  useEffect(() => {
    connect();
  }, []);

  const body = (() => {
    switch (screen) {
      case 'home':
        return <Home />;
      case 'lobby':
        return <Lobby />;
      case 'game':
        return <Game />;
      case 'editor':
        return <Editor />;
      case 'replay':
        return <Replay />;
    }
  })();

  return (
    <>
      {body}
      <Toasts />
    </>
  );
}
