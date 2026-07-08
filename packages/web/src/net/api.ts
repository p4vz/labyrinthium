import type { AvatarConfig, CosmeticItem, CosmeticSlot, ShopOffer } from '@labyrinthium/shared';

/**
 * Thin typed client for the profile/wardrobe REST API. The bearer token is
 * the profile — the caller (profileStore) owns it.
 */

export interface PublicProfile {
  id: string;
  displayName: string;
  username: string | null;
  coins: number;
  avatar: AvatarConfig;
}

export interface OwnedItem {
  item: CosmeticItem;
  source: 'run' | 'shop';
  gameId: string | null;
  acquiredAt: string;
}

export type Collection = Record<Exclude<CosmeticSlot, 'dye'>, { discovered: string[]; total: number }>;

export interface ShopState {
  date: string;
  offers: ShopOffer[];
  purchasedOfferIds: string[];
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, opts: { method?: string; token?: string | null; body?: unknown } = {}): Promise<T> {
  const res = await fetch(path, {
    method: opts.method ?? 'GET',
    headers: {
      ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
    },
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
  const data: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = data as { error?: string; message?: string };
    throw new ApiError(res.status, err.error ?? 'HTTP_' + res.status, err.message ?? `request failed (${res.status})`);
  }
  return data as T;
}

export const api = {
  createProfile(displayName?: string): Promise<{ token: string; profile: PublicProfile }> {
    return request('/api/profile', { method: 'POST', body: displayName ? { displayName } : {} });
  },
  getProfile(token: string): Promise<{ profile: PublicProfile; items: OwnedItem[]; collection: Collection }> {
    return request('/api/profile', { token });
  },
  upgrade(token: string, username: string, password: string): Promise<{ ok: true; username: string }> {
    return request('/api/profile/upgrade', { method: 'POST', token, body: { username, password } });
  },
  login(username: string, password: string): Promise<{ token: string; profile: PublicProfile }> {
    return request('/api/profile/login', { method: 'POST', body: { username, password } });
  },
  equip(token: string, avatar: AvatarConfig): Promise<{ ok: true; avatar: AvatarConfig }> {
    return request('/api/profile/equipped', { method: 'PUT', token, body: { avatar } });
  },
  setDisplayName(token: string, displayName: string): Promise<{ ok: true }> {
    return request('/api/profile/name', { method: 'PUT', token, body: { displayName } });
  },
  shop(token: string): Promise<ShopState> {
    return request('/api/shop', { token });
  },
  buy(token: string, offerId: string): Promise<{ item: CosmeticItem; coins: number }> {
    return request('/api/shop/buy', { method: 'POST', token, body: { offerId } });
  },
};
