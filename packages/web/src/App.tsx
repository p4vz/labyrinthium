import { useEffect } from 'react';
import { connect } from './net/ws.js';
import { CharacterCard } from './components/CharacterCard.js';
import { Toasts } from './components/Toasts.js';
import { useGameStore } from './state/gameStore.js';
import { useProfileStore } from './state/profileStore.js';
import { Editor } from './screens/Editor.js';
import { Game } from './screens/Game.js';
import { Home } from './screens/Home.js';
import { Lobby } from './screens/Lobby.js';
import { Replay } from './screens/Replay.js';
import { Wardrobe } from './screens/Wardrobe.js';

export function App(): JSX.Element {
  const screen = useGameStore((s) => s.screen);

  useEffect(() => {
    connect();
    // mint or load the persistent character (guest profile) silently
    void useProfileStore.getState().bootstrap();
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
      case 'wardrobe':
        return <Wardrobe />;
    }
  })();

  return (
    <>
      {body}
      {/* overlays that ride above every screen */}
      <CharacterCard />
      <Toasts />
    </>
  );
}
