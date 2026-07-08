import { expect, test } from '@playwright/test';
import {
  createEdgeGrid,
  setEdge,
  type CosmeticItem,
  type MapDocument,
} from '@labyrinthium/shared';

function item(id: string, rarity: CosmeticItem['rarity'], name: string): CosmeticItem {
  return { id, slot: 'hat', templateId: 'straw-hat', rarity, paletteId: 'moss', name };
}

/** 3×3 arena with loot on the eastward path and the treasure parked far away. */
function lootArena(): MapDocument {
  const edges = createEdgeGrid(3, 3, 'open');
  for (let x = 0; x < 3; x++) {
    setEdge(edges, { x, y: 0 }, 'N', 'wall');
    setEdge(edges, { x, y: 2 }, 'S', 'wall');
  }
  for (let y = 0; y < 3; y++) {
    setEdge(edges, { x: 0, y }, 'W', 'wall');
    setEdge(edges, { x: 2, y }, 'E', 'wall');
  }
  setEdge(edges, { x: 2, y: 0 }, 'E', 'exit');
  return {
    version: 1,
    levels: [
      {
        width: 3,
        height: 3,
        edges,
        features: [
          { type: 'coins', at: { x: 1, y: 0 }, amount: 9 },
          { type: 'cosmetic', at: { x: 1, y: 0 }, item: item('e2e-common', 'common', 'Straw Hat') },
          { type: 'cosmetic', at: { x: 2, y: 0 }, item: item('e2e-rare', 'rare', 'Gilded Straw Hat of the Deep') },
        ],
      },
    ],
    entrance: { level: 0, x: 0, y: 0 },
    spawns: { treasure: { level: 0, x: 2, y: 2 }, monsters: [] },
    metadata: { name: 'e2e loot arena' },
  };
}

test('a guest character is minted, loots the maze, walks out, and wears the spoils', async ({
  browser,
  request,
}) => {
  const stored = await request.post('/api/maps', { data: lootArena() });
  const { id: mapId } = (await stored.json()) as { id: string };

  const aliceCtx = await browser.newContext();
  const bobCtx = await browser.newContext();
  const alice = await aliceCtx.newPage();
  const bob = await bobCtx.newPage();

  // First visit: a guest profile appears with the default avatar, no login.
  await alice.goto('/');
  await expect(alice.getByTestId('profile-card')).toBeVisible();
  const token = await alice.evaluate(() => localStorage.getItem('labyrinthium:profile'));
  expect(token).toBeTruthy();

  await alice.getByTestId('name-input').fill('Alice');
  await alice.getByTestId('mapid-input').fill(mapId);
  await alice.getByTestId('create-btn').click();
  const roomCode = (await alice.getByTestId('room-code').textContent())!.trim();

  await bob.goto('/');
  await bob.getByTestId('name-input').fill('Bob');
  await bob.getByTestId('code-input').fill(roomCode);
  await bob.getByTestId('join-btn').click();
  // the lobby is the runway: avatars render next to names
  await expect(bob.getByTestId('player-list').locator('svg').first()).toBeVisible();

  await alice.getByTestId('start-btn').click();
  await expect(alice.getByTestId('turn-indicator')).toContainText('YOUR TURN');

  // Alice walks east: coins + a common hat bank instantly.
  await alice.getByTestId('go-E').click();
  await expect(alice.getByTestId('event-ticker')).toContainText(/coin|Straw Hat/);
  await expect(bob.getByTestId('turn-indicator')).toContainText('YOUR TURN');
  await bob.getByTestId('go-S').click();

  // Second step east: the rare — the at-risk chip lights up.
  await alice.getByTestId('go-E').click();
  await expect(alice.getByTestId('rare-chip')).toContainText('carrying 1 rare find');
  await bob.getByTestId('go-N').click();

  // Alice probes east and finds the exit; the walk-out button appears.
  await alice.getByTestId('go-E').click(); // bump: exit found (free note)
  await expect(alice.getByTestId('leave-exit-btn')).toBeVisible();
  await alice.getByTestId('leave-exit-btn').click();
  await expect(alice.getByTestId('leave-confirm')).toContainText('Gilded Straw Hat of the Deep');
  await alice.getByTestId('leave-confirm-btn').click();

  // Alice is out; the game continues for Bob alone.
  await expect(alice.getByTestId('turn-indicator')).toContainText('you walked out');
  await expect(bob.getByTestId('turn-indicator')).toContainText('YOUR TURN');

  // Bob fetches the treasure at (2,2) and wins.
  await bob.getByTestId('go-E').click();
  await bob.getByTestId('go-E').click();
  await bob.getByTestId('go-S').click();
  await bob.getByTestId('go-S').click();
  await bob.getByTestId('pickup-btn').click();
  await bob.getByTestId('go-N').click();
  await bob.getByTestId('go-N').click();
  await bob.getByTestId('go-E').click();

  // The reveal shows the winner AND the haul.
  await expect(bob.getByTestId('reveal')).toContainText('Bob wins');
  await expect(alice.getByTestId('loot-summary')).toContainText('Gilded Straw Hat of the Deep');
  await expect(alice.getByTestId('loot-summary')).toContainText('🪙 9');
  await expect(alice.getByTestId('loot-summary')).toContainText('🚪');

  // Back on the surface, Alice's wardrobe holds the extracted rare;
  // she equips it and her avatar changes.
  await alice.getByTestId('reveal').getByRole('button', { name: /back to the surface/ }).click();
  await alice.getByTestId('wardrobe-btn').click();
  await expect(alice.getByText('Hats', { exact: true })).toBeVisible();
  const hatTile = alice.locator('.swatch-tile[title="Straw Hat"]');
  await expect(hatTile).toBeVisible();
  await hatTile.click();
  // collection log ticked over
  await alice.getByRole('button', { name: 'Collection' }).click();
  await expect(alice.locator('.wardrobe-collection')).toContainText('1/12 discovered');

  await aliceCtx.close();
  await bobCtx.close();
});
