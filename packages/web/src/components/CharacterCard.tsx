import {
  DEFAULT_AVATAR,
  PALETTES,
  SKIN_TONES,
  bodyById,
  templateById,
  type AvatarConfig,
  type CosmeticItem,
  type Rarity,
} from '@labyrinthium/shared';
import { useGameStore } from '../state/gameStore.js';
import { PixelAvatar, PixelSwatch } from './PixelAvatar.js';

/**
 * The character card: a full-size look at any player's avatar, opened from
 * the lobby roster, the home profile card, the wardrobe, or the finish
 * screen's haul list. Everything renders at showcase scale — the avatar at
 * 20x pixels and every worn piece as its own large plate — so the character
 * everyone built is actually visible, not a 22px pawn.
 */

const RARITY_COLORS: Record<Rarity, string> = {
  common: '#9b8a6f',
  uncommon: '#7dc981',
  rare: '#58a6d8',
  epic: '#b39ddb',
  legendary: '#e0902e',
};

const SLOT_LABELS = { hat: 'Hat', outfit: 'Outfit', trinket: 'Trinket' } as const;

function prettyPalette(id: string): string {
  return id.charAt(0).toUpperCase() + id.slice(1);
}

export interface CharacterSheetProps {
  name: string;
  avatar: AvatarConfig | null;
  haul?: CosmeticItem[];
}

/** The card's content — pure, so tests can render it without the store. */
export function CharacterSheet({ name, avatar, haul }: CharacterSheetProps): JSX.Element {
  const a = avatar ?? DEFAULT_AVATAR;
  const body = bodyById(a.bodyId);
  const skin = SKIN_TONES[a.skinToneId];
  return (
    <div className="char-sheet" data-testid="char-sheet">
      <div className="char-stage">
        <PixelAvatar avatar={a} size={320} hires title={`${name}'s avatar`} />
        <div className="char-floor" />
      </div>
      <div className="char-panels">
        <div className="char-plate">
          <div className="char-plate-art">
            <PixelAvatar avatar={{ skinToneId: a.skinToneId, bodyId: a.bodyId }} size={96} hires />
          </div>
          <div className="char-plate-meta">
            <span className="char-plate-slot">Body</span>
            <span className="char-plate-name">{body.label} build</span>
            <span className="char-plate-dye">
              <i className="dye-dot" style={{ background: (skin ?? PALETTES.soot!)[1] }} /> {a.skinToneId}
            </span>
          </div>
        </div>
        {(['hat', 'outfit', 'trinket'] as const).map((slot) => {
          const piece = a[slot];
          const template = piece ? templateById(piece.templateId) : undefined;
          return (
            <div key={slot} className={`char-plate ${piece ? '' : 'empty'}`}>
              <div className="char-plate-art">
                {piece && template ? (
                  <PixelSwatch templateId={piece.templateId} paletteId={piece.paletteId} size={96} hires title={template.label} />
                ) : (
                  <span className="char-plate-none">∅</span>
                )}
              </div>
              <div className="char-plate-meta">
                <span className="char-plate-slot">{SLOT_LABELS[slot]}</span>
                <span className="char-plate-name">{template?.label ?? 'nothing worn'}</span>
                {piece && (
                  <span className="char-plate-dye">
                    <i className="dye-dot" style={{ background: PALETTES[piece.paletteId]?.[2] ?? '#46392b' }} />{' '}
                    {prettyPalette(piece.paletteId)} dye
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {haul && haul.length > 0 && (
        <div className="char-haul">
          <h3>Brought home this run</h3>
          <div className="char-haul-grid">
            {haul.map((item) => (
              <div key={item.id} className="char-haul-item" style={{ borderColor: RARITY_COLORS[item.rarity] }}>
                <PixelSwatch templateId={item.templateId} paletteId={item.paletteId} size={72} hires title={item.name} />
                <span style={{ color: RARITY_COLORS[item.rarity] }}>{item.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Store-connected overlay; renders nothing while no character is on display. */
export function CharacterCard(): JSX.Element | null {
  const inspect = useGameStore((s) => s.inspect);
  const setInspect = useGameStore((s) => s.setInspect);
  const setScreen = useGameStore((s) => s.setScreen);
  if (!inspect) return null;
  return (
    <div className="modal-backdrop char-backdrop" data-testid="character-card" onClick={() => setInspect(null)}>
      <div className="modal char-modal" onClick={(e) => e.stopPropagation()}>
        <header className="char-header">
          <h1>{inspect.name}</h1>
          <button className="char-close" onClick={() => setInspect(null)} aria-label="close">
            ✕
          </button>
        </header>
        <CharacterSheet name={inspect.name} avatar={inspect.avatar} {...(inspect.haul ? { haul: inspect.haul } : {})} />
        {inspect.own && (
          <div className="button-row modal-actions">
            <button className="primary" onClick={() => setScreen('wardrobe')}>
              open the wardrobe
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
