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

/** 3×3 arena: coins on the eastward path, the prize hidden in the treasure. */
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
        features: [{ type: 'coins', at: { x: 1, y: 0 }, amount: 9 }],
      },
    ],
    entrance: { level: 0, x: 0, y: 0 },
    spawns: {
      treasure: { level: 0, x: 2, y: 2 },
      // ONE prize, ONE color, hidden inside the treasure — the winner's.
      prize: item('e2e-prize', 'rare', 'Gilded Straw Hat of the Deep'),
      monsters: [],
    },
    metadata: { name: 'e2e loot arena' },
  };
}

test('coins bank on the floor, the prize hides in the treasure, and the winner wears it', async ({
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
  // the lobby is the runway: avatars render next to names, and clicking one
  // opens the full-size character card
  await expect(bob.getByTestId('player-list').locator('svg').first()).toBeVisible();
  await bob.getByTestId('inspect-Alice').click();
  await expect(bob.getByTestId('character-card')).toContainText('Alice');
  await expect(bob.getByTestId('char-sheet').locator('svg[width="320"]')).toBeVisible();
  await bob.getByRole('button', { name: 'close' }).click();
  await expect(bob.getByTestId('character-card')).toHaveCount(0);

  await alice.getByTestId('start-btn').click();
  await expect(alice.getByTestId('turn-indicator')).toContainText('YOUR TURN');

  // Alice walks east: the coin pile banks instantly. One move = one turn.
  await alice.getByTestId('go-E').click();
  await expect(alice.getByTestId('event-ticker')).toContainText(/coin/);
  await expect(bob.getByTestId('turn-indicator')).toContainText('YOUR TURN');
  await bob.getByTestId('go-S').click();

  await alice.getByTestId('go-E').click(); // Alice (1,0)→(2,0), beside the exit
  await bob.getByTestId('go-N').click(); // Bob back to (0,0)

  // Alice probes east: the exit is found. A blocked/locked move is a FREE
  // note — her turn stays open, so she walks out on the same turn.
  await alice.getByTestId('go-E').click();
  await expect(alice.getByTestId('leave-exit-btn')).toBeVisible();
  await alice.getByTestId('leave-exit-btn').click();
  await expect(alice.getByTestId('leave-confirm')).toContainText('forfeit the race');
  await alice.getByTestId('leave-confirm-btn').click();

  // Alice is out; the game continues for Bob alone.
  await expect(alice.getByTestId('turn-indicator')).toContainText('you walked out');
  await expect(bob.getByTestId('turn-indicator')).toContainText('YOUR TURN');

  // Bob fetches the treasure at (2,2) and wins — from (0,0).
  await bob.getByTestId('go-E').click(); // (1,0)
  await bob.getByTestId('go-E').click(); // (2,0)
  await bob.getByTestId('go-S').click(); // (2,1)
  await bob.getByTestId('go-S').click(); // (2,2) — the treasure
  await bob.getByTestId('pickup-btn').click();
  await bob.getByTestId('go-N').click(); // (2,1)
  await bob.getByTestId('go-N').click(); // (2,0)
  await bob.getByTestId('go-E').click(); // out through the exit — win

  // The reveal shows the winner AND the haul: the treasure's hidden prize
  // belongs to Bob; Alice keeps her coins (and the door she left through).
  await expect(bob.getByTestId('reveal')).toContainText('Bob wins');
  await expect(bob.getByTestId('loot-summary')).toContainText('Gilded Straw Hat of the Deep');
  await expect(alice.getByTestId('loot-summary')).toContainText('🪙 9');
  await expect(alice.getByTestId('loot-summary')).toContainText('🚪');

  // Back on the surface, BOB's wardrobe holds the prize; he wears it.
  await bob.getByTestId('reveal').getByRole('button', { name: /back to the surface/ }).click();
  await bob.getByTestId('wardrobe-btn').click();
  await expect(bob.getByText('Hats', { exact: true })).toBeVisible();
  const hatTile = bob.locator('.swatch-tile[title="Straw Hat"]');
  await expect(hatTile).toBeVisible();
  await hatTile.click();
  // collection log ticked over
  await bob.getByRole('button', { name: 'Collection' }).click();
  await expect(bob.locator('.wardrobe-collection')).toContainText('1/12 discovered');

  await aliceCtx.close();
  await bobCtx.close();
});
