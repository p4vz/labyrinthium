import { useEffect, useState } from 'react';
import { PixelAvatar } from '../components/PixelAvatar.js';
import { PixelLogo } from '../components/PixelLogo.js';
import { send } from '../net/ws.js';
import { useGameStore } from '../state/gameStore.js';
import { useProfileStore } from '../state/profileStore.js';

export function Home(): JSX.Element {
  const connected = useGameStore((s) => s.connected);
  const setScreen = useGameStore((s) => s.setScreen);
  const profile = useProfileStore((s) => s.profile);
  const avatar = useProfileStore((s) => s.avatar);
  const profileToken = useProfileStore((s) => s.token);
  const itemCount = useProfileStore((s) => s.items.length);
  const [name, setName] = useState('');

  // the character remembers its name — pre-fill once the profile loads
  useEffect(() => {
    if (!name && profile?.displayName) setName(profile.displayName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.displayName]);
  const [code, setCode] = useState('');
  const [preset, setPreset] = useState<'small' | 'medium' | 'large'>('medium');
  const [complexity, setComplexity] = useState<'classic' | 'advanced' | 'full'>('classic');
  const [seed, setSeed] = useState('');
  const [mapId, setMapId] = useState('');
  const [showRules, setShowRules] = useState(false);
  const [botCount, setBotCount] = useState(2);
  const [botLevel, setBotLevel] = useState<'easy' | 'medium' | 'hard' | 'mixed'>('medium');
  const [openInfo, setOpenInfo] = useState(true);
  const [timer, setTimer] = useState(0);
  const [dropAll, setDropAll] = useState(false);
  const [borderGrenade, setBorderGrenade] = useState(false);
  const [drift, setDrift] = useState(false);
  const [doubleAmmo, setDoubleAmmo] = useState(false);
  const [allowLeave, setAllowLeave] = useState(true);
  const [hardRivers, setHardRivers] = useState(false);

  return (
    <div className="home">
      <PixelLogo />
      <p className="tagline">
        The computer draws a maze it will never show you. Move blind, listen to what it says, and
        draw your own map. First one out with the treasure wins.
      </p>
      <div className={`conn-dot ${connected ? 'up' : 'down'}`}>{connected ? 'connected' : 'connecting…'}</div>

      <div className="profile-card card" data-testid="profile-card">
        <button className="avatar-button" title="open the wardrobe" onClick={() => setScreen('wardrobe')}>
          <PixelAvatar avatar={avatar} size={64} title="your avatar" />
        </button>
        <div className="profile-meta">
          <label>
            Your name
            <input
              data-testid="name-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => void useProfileStore.getState().setDisplayName(name)}
              placeholder="Ariadne"
              maxLength={40}
            />
          </label>
          <div className="profile-stats muted small">
            🪙 {profile?.coins ?? 0} · {itemCount} treasure{itemCount === 1 ? '' : 's'} collected
            {profile?.username ? ` · ${profile.username}` : ''}
          </div>
        </div>
        <button data-testid="wardrobe-btn" onClick={() => setScreen('wardrobe')}>
          Wardrobe
        </button>
      </div>

      <div className="home-cards">
        <div className="card">
          <h2>Create a game</h2>
          <label>
            Size
            <select value={preset} onChange={(e) => setPreset(e.target.value as typeof preset)}>
              <option value="small">small (3–5)</option>
              <option value="medium">medium (6–9)</option>
              <option value="large">large (10–15)</option>
            </select>
          </label>
          <label>
            Complexity
            <select value={complexity} onChange={(e) => setComplexity(e.target.value as typeof complexity)}>
              <option value="classic">classic — the original game</option>
              <option value="advanced">advanced — layers, mines, traps</option>
              <option value="full">full — everything, dialed up</option>
            </select>
          </label>
          <label>
            Difficulty
            <select
              data-testid="difficulty-select"
              value={hardRivers ? 'hard' : 'easy'}
              onChange={(e) => setHardRivers(e.target.value === 'hard')}
            >
              <option value="easy">easy — the GM says which way currents drag you</option>
              <option value="hard">hard — currents drag you who-knows-where</option>
            </select>
          </label>
          <label>
            Seed <small>(optional — same seed, same maze)</small>
            <input value={seed} onChange={(e) => setSeed(e.target.value)} placeholder="random" />
          </label>
          <label>
            Map id <small>(optional — play a saved editor map)</small>
            <input data-testid="mapid-input" value={mapId} onChange={(e) => setMapId(e.target.value)} placeholder="from the editor" />
          </label>
          <button className="rules-toggle" onClick={() => setShowRules(!showRules)}>
            {showRules ? '▾' : '▸'} house rules & extras
          </button>
          {showRules && (
            <div className="rules-box" data-testid="rules-box">
              <label className="check">
                <input type="checkbox" checked={openInfo} onChange={(e) => setOpenInfo(e.target.checked)} />
                open table — everyone hears all moves & GM replies (track your enemies!)
              </label>
              <label className="check">
                <input type="checkbox" checked={dropAll} onChange={(e) => setDropAll(e.target.checked)} />
                shot players drop ALL gear, not just the treasure
              </label>
              <label className="check">
                <input type="checkbox" checked={borderGrenade} onChange={(e) => setBorderGrenade(e.target.checked)} />
                grenades can breach the outer wall
              </label>
              <label className="check">
                <input type="checkbox" checked={drift} onChange={(e) => setDrift(e.target.checked)} />
                dropped treasure drifts down rivers
              </label>
              <label className="check">
                <input type="checkbox" checked={doubleAmmo} onChange={(e) => setDoubleAmmo(e.target.checked)} />
                double ammo (grenades / bullets / mines)
              </label>
              <label className="check">
                <input type="checkbox" checked={allowLeave} onChange={(e) => setAllowLeave(e.target.checked)} />
                players may walk out early to keep rare finds (forfeits the race)
              </label>
              <label>
                turn timer
                <select value={timer} onChange={(e) => setTimer(Number(e.target.value))}>
                  <option value={0}>off — take your time</option>
                  <option value={15}>15 seconds</option>
                  <option value={30}>30 seconds</option>
                  <option value={60}>60 seconds</option>
                  <option value={120}>2 minutes</option>
                </select>
              </label>
            </div>
          )}
          <button
            data-testid="create-btn"
            disabled={!connected || !name}
            onClick={() =>
              send({
                type: 'room.create',
                name,
                preset,
                complexity,
                ...(seed ? { seed } : {}),
                ...(mapId ? { mapId } : {}),
                ...(profileToken ? { profileToken } : {}),
                rules: {
                  openInformation: openInfo,
                  turnTimerSeconds: timer,
                  dropAllOnShot: dropAll,
                  allowBorderGrenade: borderGrenade,
                  treasureDrifts: drift,
                  doubleAmmo,
                  allowLeave,
                  hardRivers,
                },
              })
            }
          >
            Create room
          </button>
        </div>

        <div className="card">
          <h2>Join a game</h2>
          <label>
            Room code
            <input data-testid="code-input" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="AB12CD" maxLength={8} />
          </label>
          <button
            data-testid="join-btn"
            disabled={!connected || !name || code.length < 4}
            onClick={() => send({ type: 'room.join', roomCode: code, name, ...(profileToken ? { profileToken } : {}) })}
          >
            Join as a player
          </button>
        </div>

        <div className="card">
          <h2>👁 Observe a game</h2>
          <p className="hint">
            See everything the players can't: the true map, every piece moving live, and each
            player's hand-drawn map (tap their name in the game).
          </p>
          <label>
            Room code
            <input
              data-testid="observe-code-input"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="AB12CD"
              maxLength={8}
            />
          </label>
          <button
            data-testid="observe-btn"
            disabled={!connected || code.length < 4}
            onClick={() => send({ type: 'room.spectate', roomCode: code })}
          >
            👁 Observe
          </button>

          <h2 className="bot-match-title">🤖 …or watch a bot match</h2>
          <p className="hint">
            No code needed: bots explore a fresh maze (size &amp; complexity from “Create a game”)
            while you watch everything — including their maps taking shape.
          </p>
          <label>
            Bots
            <select value={botCount} onChange={(e) => setBotCount(Number(e.target.value))}>
              <option value={2}>2 bots</option>
              <option value={3}>3 bots</option>
              <option value={4}>4 bots</option>
            </select>
          </label>
          <label>
            Skill
            <select value={botLevel} onChange={(e) => setBotLevel(e.target.value as typeof botLevel)}>
              <option value="easy">easy — headless chickens</option>
              <option value="medium">medium — methodical explorers</option>
              <option value="hard">hard — armed and dangerous</option>
              <option value="mixed">mixed — one of each</option>
            </select>
          </label>
          <button
            data-testid="botmatch-btn"
            disabled={!connected}
            onClick={() => {
              const pool: ('easy' | 'medium' | 'hard')[] =
                botLevel === 'mixed'
                  ? ['easy', 'medium', 'hard', 'medium']
                  : Array.from({ length: 4 }, () => botLevel);
              send({
                type: 'room.createBotMatch',
                bots: pool.slice(0, botCount),
                preset,
                complexity,
                ...(seed ? { seed } : {}),
              });
            }}
          >
            ▶ Start bot match &amp; observe
          </button>
        </div>

        <div className="card">
          <h2>Workshop</h2>
          <button onClick={() => setScreen('editor')}>Map editor</button>
          <button onClick={() => setScreen('replay')}>Replay a finished game</button>
        </div>
      </div>
    </div>
  );
}
