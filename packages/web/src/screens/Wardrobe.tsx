import { useEffect, useMemo, useState } from 'react';
import {
  BODIES,
  FREE_PALETTES,
  PALETTES,
  SETS,
  SKIN_TONES,
  templateById,
  templatesForSlot,
  type AvatarConfig,
  type Rarity,
} from '@labyrinthium/shared';
import { PixelAvatar, PixelSwatch } from '../components/PixelAvatar.js';
import { useGameStore } from '../state/gameStore.js';
import { useProfileStore } from '../state/profileStore.js';

/** Genre-standard rarity ladder mapped onto the theme tokens. */
export const RARITY_COLORS: Record<Rarity, string> = {
  common: '#9b8a6f',
  uncommon: '#7dc981',
  rare: '#58a6d8',
  epic: '#b39ddb',
  legendary: '#e0902e',
};

type Tab = 'equip' | 'collection' | 'shop' | 'account';
type WearableSlot = 'hat' | 'outfit' | 'trinket';

const SLOT_LABELS: Record<WearableSlot, string> = { hat: 'Hats', outfit: 'Outfits', trinket: 'Trinkets' };

const RARITY_RANK: Record<Rarity, number> = { common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4 };

function describeProvenance(item: { name: string; rarity: Rarity; provenance?: { mapSeed?: string; foundOn?: string; extractedAlive?: boolean } }): string {
  const p = item.provenance;
  const bits = [`${item.name} (${item.rarity})`];
  if (p?.mapSeed) bits.push(`found in maze “${p.mapSeed}”`);
  if (p?.extractedAlive) bits.push('carried out alive');
  if (p?.foundOn) bits.push(p.foundOn);
  return bits.join(' — ');
}

export function Wardrobe(): JSX.Element {
  const setScreen = useGameStore((s) => s.setScreen);
  const profile = useProfileStore((s) => s.profile);
  const items = useProfileStore((s) => s.items);
  const collection = useProfileStore((s) => s.collection);
  const avatar = useProfileStore((s) => s.avatar);
  const shop = useProfileStore((s) => s.shop);
  const error = useProfileStore((s) => s.error);
  const store = useProfileStore.getState();
  const [tab, setTab] = useState<Tab>('equip');

  useEffect(() => {
    void store.refresh();
    void store.loadShop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Palettes this profile may dye a given template with. */
  const palettesFor = useMemo(
    () =>
      (templateId: string): string[] => {
        const unlocked = new Set<string>(FREE_PALETTES);
        for (const o of items) {
          if (o.item.slot === 'dye') unlocked.add(o.item.paletteId);
          if (o.item.templateId === templateId) unlocked.add(o.item.paletteId);
        }
        return Object.keys(PALETTES).filter((p) => unlocked.has(p));
      },
    [items],
  );

  const ownedTemplates = (slot: WearableSlot): string[] => {
    const seen = new Set<string>();
    for (const o of items) if (o.item.slot === slot) seen.add(o.item.templateId);
    return templatesForSlot(slot)
      .filter((t) => seen.has(t.id))
      .map((t) => t.id);
  };

  const equipPiece = (slot: WearableSlot, templateId: string | null): void => {
    const next: AvatarConfig = { ...avatar };
    if (templateId === null) delete next[slot];
    else next[slot] = { templateId, paletteId: palettesFor(templateId)[0] ?? 'soot' };
    void store.equip(next);
  };

  const dyePiece = (slot: WearableSlot, paletteId: string): void => {
    const piece = avatar[slot];
    if (!piece) return;
    void store.equip({ ...avatar, [slot]: { ...piece, paletteId } });
  };

  return (
    <div className="wardrobe">
      <header className="wardrobe-header">
        <button onClick={() => setScreen('home')}>← back</button>
        <h1>Wardrobe</h1>
        <div className="coin-balance" title="coins — spend them in the shop">
          🪙 {profile?.coins ?? 0}
        </div>
      </header>

      {error && (
        <div className="wardrobe-error" role="alert">
          {error} <button onClick={() => store.clearError()}>✕</button>
        </div>
      )}

      <nav className="wardrobe-tabs">
        {(['equip', 'collection', 'shop', 'account'] as const).map((t) => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            {t === 'equip' ? 'Equip' : t === 'collection' ? 'Collection' : t === 'shop' ? 'Shop' : 'Account'}
          </button>
        ))}
      </nav>

      {tab === 'equip' && (
        <div className="wardrobe-equip">
          <div className="avatar-stage card">
            <button
              className="avatar-button"
              title="view your character full size"
              onClick={() =>
                useGameStore.getState().setInspect({
                  name: profile?.displayName || 'you',
                  avatar,
                  own: false, // already in the wardrobe — no shortcut needed
                })
              }
            >
              <PixelAvatar avatar={avatar} size={128} hires title="your avatar" />
            </button>
            <div className="body-row">
              {BODIES.map((b) => (
                <button
                  key={b.id}
                  className={`body-pick ${(avatar.bodyId ?? 'a') === b.id ? 'active' : ''}`}
                  title={`${b.label} build`}
                  onClick={() => void store.equip({ ...avatar, bodyId: b.id })}
                >
                  <PixelAvatar avatar={{ skinToneId: avatar.skinToneId, bodyId: b.id }} size={40} hires title={`${b.label} build`} />
                </button>
              ))}
            </div>
            <div className="skin-row">
              {Object.entries(SKIN_TONES).map(([id, ramp]) => (
                <button
                  key={id}
                  className={`skin-dot ${avatar.skinToneId === id ? 'active' : ''}`}
                  style={{ background: ramp[1] }}
                  title={id}
                  onClick={() => void store.equip({ ...avatar, skinToneId: id })}
                />
              ))}
            </div>
            <p className="muted small">
              {items.length === 0
                ? 'Everything you find in the labyrinth ends up here. Go get a hat.'
                : `${items.length} item(s) collected`}
            </p>
          </div>

          {(['hat', 'outfit', 'trinket'] as const).map((slot) => {
            const owned = ownedTemplates(slot);
            const equipped = avatar[slot];
            return (
              <div key={slot} className="card slot-card">
                <h2>{SLOT_LABELS[slot]}</h2>
                {owned.length === 0 ? (
                  <p className="muted small">none found yet — they’re lying in the labyrinth</p>
                ) : (
                  <div className="slot-grid">
                    <button
                      className={`swatch-tile ${!equipped ? 'active' : ''}`}
                      onClick={() => equipPiece(slot, null)}
                      title={`no ${slot}`}
                    >
                      <span className="swatch-none">∅</span>
                    </button>
                    {owned.map((tid) => (
                      <button
                        key={tid}
                        className={`swatch-tile ${equipped?.templateId === tid ? 'active' : ''}`}
                        onClick={() => equipPiece(slot, tid)}
                        title={templateById(tid)?.label}
                      >
                        <PixelSwatch templateId={tid} paletteId={equipped?.templateId === tid ? equipped.paletteId : 'soot'} size={40} hires />
                      </button>
                    ))}
                  </div>
                )}
                {equipped && (
                  <div className="dye-row">
                    <span className="muted small">dye:</span>
                    {palettesFor(equipped.templateId).map((pid) => (
                      <button
                        key={pid}
                        className={`skin-dot ${equipped.paletteId === pid ? 'active' : ''}`}
                        style={{ background: PALETTES[pid]![2] }}
                        title={pid}
                        onClick={() => dyePiece(slot, pid)}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {tab === 'collection' && (
        <div className="wardrobe-collection">
          {(['hat', 'outfit', 'trinket'] as const).map((slot) => {
            const col = collection?.[slot];
            const discovered = new Set(col?.discovered ?? []);
            return (
              <div key={slot} className="card slot-card">
                <h2>
                  {SLOT_LABELS[slot]}{' '}
                  <span className="muted">
                    {discovered.size}/{col?.total ?? templatesForSlot(slot).length} discovered
                  </span>
                </h2>
                <div className="slot-grid">
                  {templatesForSlot(slot).map((t) => {
                    const found = discovered.has(t.id);
                    const best = items
                      .filter((o) => o.item.templateId === t.id)
                      .sort((a, b) => RARITY_RANK[b.item.rarity] - RARITY_RANK[a.item.rarity])[0];
                    return (
                      <div
                        key={t.id}
                        className={`swatch-tile static ${found ? '' : 'undiscovered'}`}
                        style={found && best ? { borderColor: RARITY_COLORS[best.item.rarity] } : {}}
                        title={found && best ? describeProvenance(best.item) : '??? — still hidden in the dark'}
                      >
                        <PixelSwatch templateId={t.id} paletteId={best?.item.paletteId ?? 'soot'} size={40} hires silhouette={!found} />
                        <span className="swatch-label">{found ? t.label : '???'}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
          <div className="card slot-card">
            <h2>Themed sets</h2>
            <div className="sets-grid">
              {SETS.map((s) => {
                const ownedIds = new Set(items.map((o) => o.item.templateId));
                const have = s.templateIds.filter((tid) => ownedIds.has(tid));
                const complete = have.length === s.templateIds.length;
                return (
                  <div key={s.id} className={`set-row ${complete ? 'complete' : ''}`}>
                    <span className="set-name">{complete ? '★' : '☆'} {s.label}</span>
                    <span className="muted small">
                      {s.templateIds.map((tid) => (ownedIds.has(tid) ? '●' : '○')).join(' ')} {have.length}/{s.templateIds.length}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {tab === 'shop' && (
        <div className="wardrobe-shop">
          <p className="muted small">
            Fresh stock every day at midnight UTC. Coins come from the labyrinth — everything here is
            look, not power.
          </p>
          <div className="shop-grid">
            {(shop?.offers ?? []).map((offer) => {
              const bought = shop?.purchasedOfferIds.includes(offer.offerId) ?? false;
              const ownTemplate =
                offer.item.slot !== 'dye' && items.some((o) => o.item.templateId === offer.item.templateId);
              const ownDye =
                offer.item.slot === 'dye' && items.some((o) => o.item.slot === 'dye' && o.item.paletteId === offer.item.paletteId);
              const affordable = (profile?.coins ?? 0) >= offer.price;
              return (
                <div key={offer.offerId} className="card shop-offer" style={{ borderColor: RARITY_COLORS[offer.item.rarity] }}>
                  {offer.item.slot === 'dye' ? (
                    <div className="dye-swatch" style={{ background: PALETTES[offer.item.paletteId]![2] }} />
                  ) : (
                    <PixelSwatch templateId={offer.item.templateId} paletteId={offer.item.paletteId} size={48} hires />
                  )}
                  <div className="offer-name" style={{ color: RARITY_COLORS[offer.item.rarity] }}>
                    {offer.item.name}
                  </div>
                  <div className="muted small">{offer.item.rarity}{ownTemplate || ownDye ? ' · owned' : ''}</div>
                  <button disabled={bought || !affordable} onClick={() => void store.buy(offer.offerId)}>
                    {bought ? 'purchased' : `🪙 ${offer.price}`}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {tab === 'account' && <AccountPanel />}
    </div>
  );
}

function AccountPanel(): JSX.Element {
  const profile = useProfileStore((s) => s.profile);
  const store = useProfileStore.getState();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'upgrade' | 'login'>('upgrade');
  const [notice, setNotice] = useState('');

  if (profile?.username) {
    return (
      <div className="card account-card">
        <h2>Account</h2>
        <p>
          Secured as <strong>{profile.username}</strong>. Your character survives cleared caches and
          follows you to any device — just log in there.
        </p>
        <button onClick={() => store.logout()}>Log out (start a fresh guest here)</button>
      </div>
    );
  }

  const submit = async (): Promise<void> => {
    setNotice('');
    const ok =
      mode === 'upgrade' ? await store.upgrade(username.trim(), password) : await store.login(username.trim(), password);
    if (ok) {
      setNotice(mode === 'upgrade' ? 'Progress secured! This character is now yours everywhere.' : 'Welcome back.');
      setPassword('');
    }
  };

  return (
    <div className="card account-card">
      <h2>Secure your progress</h2>
      <p className="muted small">
        You’re playing as a guest — your character lives only in this browser. Add a username and
        password to keep it safe and use it anywhere. No email needed.
      </p>
      <div className="wardrobe-tabs">
        <button className={mode === 'upgrade' ? 'active' : ''} onClick={() => setMode('upgrade')}>
          Secure this character
        </button>
        <button className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>
          Log in to an existing one
        </button>
      </div>
      <label>
        Username
        <input value={username} onChange={(e) => setUsername(e.target.value)} maxLength={24} placeholder="theseus" />
      </label>
      <label>
        Password
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          maxLength={200}
          placeholder={mode === 'upgrade' ? 'at least 6 characters' : ''}
        />
      </label>
      <button disabled={username.trim().length < (mode === 'upgrade' ? 3 : 1) || password.length < (mode === 'upgrade' ? 6 : 1)} onClick={() => void submit()}>
        {mode === 'upgrade' ? 'Secure progress' : 'Log in'}
      </button>
      {mode === 'login' && (
        <p className="muted small">Heads-up: logging in replaces the guest character in this browser.</p>
      )}
      {notice && <p className="good">{notice}</p>}
    </div>
  );
}
