// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { DEFAULT_AVATAR, PALETTES, SKIN_TONES } from '@labyrinthium/shared';
import { PixelAvatar, PixelSwatch } from '../src/components/PixelAvatar.js';

describe('PixelAvatar', () => {
  it('renders the bare body from the default avatar', () => {
    const html = renderToStaticMarkup(createElement(PixelAvatar, { avatar: DEFAULT_AVATAR, size: 64 }));
    expect(html).toContain('viewBox="0 0 16 16"');
    expect(html).toContain('width="64"');
    // body pixels use the default skin ramp
    expect(html).toContain(SKIN_TONES['skin-2']![1]);
    // outline color present too
    expect(html).toContain(SKIN_TONES['skin-2']![0]);
  });

  it('overpaints hat and outfit layers with their palettes', () => {
    const html = renderToStaticMarkup(
      createElement(PixelAvatar, {
        avatar: {
          skinToneId: 'skin-4',
          hat: { templateId: 'wizard-hood', paletteId: 'arcane' },
          outfit: { templateId: 'runed-robe', paletteId: 'river' },
        },
        size: 22,
      }),
    );
    expect(html).toContain(PALETTES.arcane![1]); // hood base
    expect(html).toContain(PALETTES.river![1]); // robe base
    expect(html).toContain(SKIN_TONES['skin-4']![1]); // face still visible
  });

  it('falls back to the default avatar when given null', () => {
    const a = renderToStaticMarkup(createElement(PixelAvatar, { avatar: null, size: 22 }));
    const b = renderToStaticMarkup(createElement(PixelAvatar, { avatar: DEFAULT_AVATAR, size: 22 }));
    expect(a).toBe(b);
  });

  it('hires renders the Scale4x rendition on a 64x64 grid, low-res stays 16x16', () => {
    const avatar = { skinToneId: 'skin-2' as const };
    const low = renderToStaticMarkup(createElement(PixelAvatar, { avatar, size: 128 }));
    const high = renderToStaticMarkup(createElement(PixelAvatar, { avatar, size: 128, hires: true }));
    expect(low).toContain('viewBox="0 0 16 16"');
    expect(high).toContain('viewBox="0 0 64 64"');
    expect(high).not.toBe(low); // genuinely different rendition, same source art
    // both renditions use the same palette — Scale4x never invents colors
    expect(high).toContain(SKIN_TONES['skin-2']![1]);
    const swatchHigh = renderToStaticMarkup(
      createElement(PixelSwatch, { templateId: 'miners-helm', paletteId: 'gold', size: 96, hires: true }),
    );
    expect(swatchHigh).toContain(PALETTES.gold![1]);
  });

  it('renders distinct body shapes, both in any skin tone', () => {
    const broad = renderToStaticMarkup(
      createElement(PixelAvatar, { avatar: { skinToneId: 'skin-6', bodyId: 'a' }, size: 64 }),
    );
    const slender = renderToStaticMarkup(
      createElement(PixelAvatar, { avatar: { skinToneId: 'skin-6', bodyId: 'b' }, size: 64 }),
    );
    expect(broad).not.toBe(slender);
    expect(slender).toContain(SKIN_TONES['skin-6']![1]); // same shade applies
    // absent bodyId renders shape 'a'
    const legacy = renderToStaticMarkup(
      createElement(PixelAvatar, { avatar: { skinToneId: 'skin-6' }, size: 64 }),
    );
    expect(legacy).toBe(broad);
  });

  it('PixelSwatch renders a template alone, and a silhouette when undiscovered', () => {
    const colored = renderToStaticMarkup(
      createElement(PixelSwatch, { templateId: 'miners-helm', paletteId: 'gold', size: 40 }),
    );
    expect(colored).toContain(PALETTES.gold![1]);
    const shadow = renderToStaticMarkup(
      createElement(PixelSwatch, { templateId: 'miners-helm', paletteId: 'gold', size: 40, silhouette: true }),
    );
    expect(shadow).not.toContain(PALETTES.gold![1]);
    expect(shadow).toContain('#2a2119');
  });
});

describe('CharacterSheet (the showcase card)', () => {
  it('renders the avatar at showcase scale plus a large plate per worn piece', async () => {
    const { CharacterSheet } = await import('../src/components/CharacterCard.js');
    const html = renderToStaticMarkup(
      createElement(CharacterSheet, {
        name: 'Ariadne',
        avatar: {
          skinToneId: 'skin-4',
          bodyId: 'b',
          hat: { templateId: 'wizard-hood', paletteId: 'arcane' },
          trinket: { templateId: 'crystal-orb', paletteId: 'pearl' },
        },
        haul: [
          { id: 'h1', slot: 'hat', templateId: 'rusted-crown', rarity: 'rare', paletteId: 'gold', name: 'Ancient Crown of the Deep' },
        ],
      }),
    );
    expect(html).toContain('width="320"'); // the big render
    expect(html).toContain('width="96"'); // per-piece plates
    expect(html).toContain('Wizard Hood');
    expect(html).toContain('Crystal Orb');
    expect(html).toContain('slender build');
    expect(html).toContain('nothing worn'); // the empty outfit slot
    expect(html).toContain('Ancient Crown of the Deep'); // the haul
  });

  it('falls back to the default avatar for players without a profile', async () => {
    const { CharacterSheet } = await import('../src/components/CharacterCard.js');
    const html = renderToStaticMarkup(createElement(CharacterSheet, { name: 'Anon', avatar: null }));
    expect(html).toContain('width="320"');
    expect(html).toContain('broad build');
  });
});

describe('profileStore bootstrap', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    const bag = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => bag.get(k) ?? null,
      setItem: (k: string, v: string) => void bag.set(k, v),
      removeItem: (k: string) => void bag.delete(k),
    });
  });

  it('mints a guest profile on first visit and stores the token', async () => {
    const profile = { id: 'p1', displayName: '', username: null, coins: 0, avatar: DEFAULT_AVATAR };
    const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const path = String(url);
      if (path === '/api/profile' && init?.method === 'POST') {
        return new Response(JSON.stringify({ token: 'tok-1', profile }), { status: 201 });
      }
      if (path === '/api/profile') {
        return new Response(
          JSON.stringify({ profile, items: [], collection: { hat: { discovered: [], total: 12 }, outfit: { discovered: [], total: 10 }, trinket: { discovered: [], total: 8 } } }),
          { status: 200 },
        );
      }
      return new Response('{}', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { useProfileStore } = await import('../src/state/profileStore.js');
    await useProfileStore.getState().bootstrap();
    expect(useProfileStore.getState().token).toBe('tok-1');
    expect(localStorage.getItem('labyrinthium:profile')).toBe('tok-1');
    expect(useProfileStore.getState().collection?.hat.total).toBe(12);
  });

  it('recovers from a stale token (401) by minting a fresh guest', async () => {
    localStorage.setItem('labyrinthium:profile', 'stale');
    const profile = { id: 'p2', displayName: '', username: null, coins: 3, avatar: DEFAULT_AVATAR };
    const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const path = String(url);
      const auth = (init?.headers as Record<string, string> | undefined)?.authorization;
      if (path === '/api/profile' && init?.method === 'POST') {
        return new Response(JSON.stringify({ token: 'tok-fresh', profile }), { status: 201 });
      }
      if (path === '/api/profile' && auth === 'Bearer stale') {
        return new Response(JSON.stringify({ error: 'INVALID_TOKEN' }), { status: 401 });
      }
      if (path === '/api/profile') {
        return new Response(JSON.stringify({ profile, items: [], collection: { hat: { discovered: [], total: 12 }, outfit: { discovered: [], total: 10 }, trinket: { discovered: [], total: 8 } } }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { useProfileStore } = await import('../src/state/profileStore.js');
    await useProfileStore.getState().bootstrap();
    expect(useProfileStore.getState().token).toBe('tok-fresh');
    expect(localStorage.getItem('labyrinthium:profile')).toBe('tok-fresh');
  });
});
