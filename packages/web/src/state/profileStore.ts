import { create } from 'zustand';
import { DEFAULT_AVATAR, type AvatarConfig } from '@labyrinthium/shared';
import { api, ApiError, type Collection, type OwnedItem, type PublicProfile, type ShopState } from '../net/api.js';

/**
 * The persistent character. A guest profile is minted silently on first
 * visit; its bearer token lives in localStorage — SEPARATE from the
 * game-scoped session key, which is cleared on every room leave. Upgrading
 * to username+password later secures the same profile across devices.
 */

const PROFILE_KEY = 'labyrinthium:profile';

export function loadProfileToken(): string | null {
  try {
    return localStorage.getItem(PROFILE_KEY);
  } catch {
    return null;
  }
}

function saveProfileToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(PROFILE_KEY, token);
    else localStorage.removeItem(PROFILE_KEY);
  } catch {
    /* private mode etc — profile just won't persist */
  }
}

export interface ProfileStoreState {
  token: string | null;
  profile: PublicProfile | null;
  items: OwnedItem[];
  collection: Collection | null;
  avatar: AvatarConfig;
  shop: ShopState | null;
  /** last profile-API failure, for inline display in the wardrobe */
  error: string | null;

  bootstrap(): Promise<void>;
  refresh(): Promise<void>;
  equip(avatar: AvatarConfig): Promise<boolean>;
  setDisplayName(name: string): Promise<void>;
  loadShop(): Promise<void>;
  buy(offerId: string): Promise<boolean>;
  upgrade(username: string, password: string): Promise<boolean>;
  login(username: string, password: string): Promise<boolean>;
  logout(): void;
  clearError(): void;
}

export const useProfileStore = create<ProfileStoreState>((set, get) => ({
  token: null,
  profile: null,
  items: [],
  collection: null,
  avatar: DEFAULT_AVATAR,
  shop: null,
  error: null,

  async bootstrap() {
    const existing = loadProfileToken();
    if (existing) {
      try {
        const data = await api.getProfile(existing);
        set({
          token: existing,
          profile: data.profile,
          items: data.items,
          collection: data.collection,
          avatar: data.profile.avatar,
        });
        return;
      } catch (err) {
        // Stale token (wiped db, revoked by login elsewhere): fall through
        // and mint a fresh guest. Anything else (offline) keeps the token.
        if (!(err instanceof ApiError && err.status === 401)) return;
      }
    }
    try {
      const created = await api.createProfile();
      saveProfileToken(created.token);
      set({ token: created.token, profile: created.profile, avatar: created.profile.avatar, items: [], collection: null });
      // fetch the (empty) collection so the wardrobe renders totals
      const data = await api.getProfile(created.token);
      set({ collection: data.collection });
    } catch {
      /* server unreachable: play anonymously, retry on next bootstrap */
    }
  },

  async refresh() {
    const { token } = get();
    if (!token) return;
    try {
      const data = await api.getProfile(token);
      set({ profile: data.profile, items: data.items, collection: data.collection, avatar: data.profile.avatar });
    } catch {
      /* transient; keep showing what we have */
    }
  },

  async equip(avatar) {
    const { token } = get();
    if (!token) return false;
    try {
      await api.equip(token, avatar);
      set({ avatar, profile: get().profile ? { ...get().profile!, avatar } : null, error: null });
      return true;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'equip failed' });
      return false;
    }
  },

  async setDisplayName(name) {
    const { token, profile } = get();
    if (!token || !name.trim() || name === profile?.displayName) return;
    try {
      await api.setDisplayName(token, name.trim());
      set({ profile: profile ? { ...profile, displayName: name.trim() } : null });
    } catch {
      /* cosmetic */
    }
  },

  async loadShop() {
    const { token } = get();
    if (!token) return;
    try {
      set({ shop: await api.shop(token) });
    } catch {
      /* transient */
    }
  },

  async buy(offerId) {
    const { token } = get();
    if (!token) return false;
    try {
      const res = await api.buy(token, offerId);
      set({
        profile: get().profile ? { ...get().profile!, coins: res.coins } : null,
        error: null,
      });
      await Promise.all([get().refresh(), get().loadShop()]);
      return true;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'purchase failed' });
      return false;
    }
  },

  async upgrade(username, password) {
    const { token } = get();
    if (!token) return false;
    try {
      await api.upgrade(token, username, password);
      set({ profile: get().profile ? { ...get().profile!, username } : null, error: null });
      return true;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'could not secure the account' });
      return false;
    }
  },

  async login(username, password) {
    try {
      const res = await api.login(username, password);
      saveProfileToken(res.token);
      set({ token: res.token, profile: res.profile, avatar: res.profile.avatar, error: null });
      await get().refresh();
      return true;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'login failed' });
      return false;
    }
  },

  logout() {
    saveProfileToken(null);
    set({ token: null, profile: null, items: [], collection: null, avatar: DEFAULT_AVATAR, shop: null, error: null });
    void get().bootstrap(); // straight into a fresh guest
  },

  clearError() {
    set({ error: null });
  },
}));
