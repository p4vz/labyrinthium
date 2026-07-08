import { expect, test } from '@playwright/test';
import {
  createEdgeGrid,
  setEdge,
  type MapDocument,
} from '@labyrinthium/shared';

/** Same deterministic 3×3 arena the server integration tests use. */
function arena(): MapDocument {
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
    levels: [{ width: 3, height: 3, edges, features: [] }],
    entrance: { level: 0, x: 0, y: 0 },
    spawns: { treasure: { level: 0, x: 1, y: 0 }, monsters: [] },
    metadata: { name: 'e2e arena' },
  };
}

test('two players race through the labyrinth in real browsers', async ({ browser, request }) => {
  const stored = await request.post('/api/maps', { data: arena() });
  const { id: mapId } = (await stored.json()) as { id: string };

  // Two separate contexts = two devices with their own localStorage.
  const aliceCtx = await browser.newContext();
  const bobCtx = await browser.newContext();
  const alice = await aliceCtx.newPage();
  const bob = await bobCtx.newPage();

  // Alice creates the room on the stored map.
  await alice.goto('/');
  await alice.getByTestId('name-input').fill('Alice');
  await alice.getByTestId('mapid-input').fill(mapId);
  await alice.getByTestId('create-btn').click();
  const roomCode = (await alice.getByTestId('room-code').textContent())!.trim();
  expect(roomCode).toMatch(/^[A-Z2-9]{6}$/);

  // Bob joins from his own device.
  await bob.goto('/');
  await bob.getByTestId('name-input').fill('Bob');
  await bob.getByTestId('code-input').fill(roomCode);
  await bob.getByTestId('join-btn').click();
  await expect(bob.getByTestId('player-list')).toContainText('Alice');
  await expect(bob.getByTestId('player-list')).toContainText('Bob');
  await expect(alice.getByTestId('player-list')).toContainText('Bob');

  // The host starts the descent.
  await alice.getByTestId('start-btn').click();
  await expect(alice.getByTestId('turn-indicator')).toContainText('YOUR TURN');
  await expect(bob.getByTestId('turn-indicator')).toContainText("Alice's turn");

  // Alice walks east onto the treasure. Default table rules are OPEN
  // information: Bob hears her move announced and the GM's reply too.
  await alice.getByTestId('go-E').click();
  await expect(alice.getByTestId('event-feed')).toContainText('TREASURE');
  await expect(bob.getByTestId('event-feed')).toContainText('Alice moves east');
  await expect(bob.getByTestId('event-feed')).toContainText('Alice ▸');

  // Alice charts a claim: "nothing here" on the entrance cell (gradeable later).
  await alice.getByTitle('nothing here').click();
  await alice.locator('[data-cell="0,0"]').click();

  // Bob idles south; Alice lifts the loot (her action) and keeps going east.
  await expect(bob.getByTestId('turn-indicator')).toContainText('YOUR TURN');
  await bob.getByTestId('go-S').click();
  await expect(alice.getByTestId('turn-indicator')).toContainText('YOUR TURN');
  await alice.getByTestId('pickup-btn').click();
  await expect(alice.getByTestId('event-feed')).toContainText('you found the TREASURE');
  await alice.getByTestId('go-E').click();
  await expect(bob.getByTestId('turn-indicator')).toContainText('YOUR TURN');
  await bob.getByTestId('go-N').click();
  await expect(alice.getByTestId('turn-indicator')).toContainText('YOUR TURN');
  await alice.getByTestId('go-E').click();

  // The reveal: both see the winner and the true map.
  await expect(alice.getByTestId('reveal')).toContainText('Alice wins');
  await expect(bob.getByTestId('reveal')).toContainText('Alice wins');
  await expect(bob.getByTestId('reveal').locator('svg')).toBeVisible();

  // The reckoning: Alice grades her map against the truth.
  await alice.getByTestId('compare-btn').click();
  await expect(alice.getByTestId('compare-section')).toBeVisible();
  await expect(alice.getByTestId('compare-section')).toContainText('claims were true');

  await aliceCtx.close();
  await bobCtx.close();
});

test('players can draw on their map while playing', async ({ browser, request }) => {
  const stored = await request.post('/api/maps', { data: arena() });
  const { id: mapId } = (await stored.json()) as { id: string };

  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto('/');
  await page.getByTestId('name-input').fill('Solo');
  await page.getByTestId('mapid-input').fill(mapId);
  await page.getByTestId('create-btn').click();
  await page.getByTestId('start-btn').click();
  await expect(page.getByTestId('turn-indicator')).toContainText('YOUR TURN');

  // Draw a wall on the belief map: wall tool is default, click an edge.
  // (the hit target is an intentionally transparent SVG line — force it)
  await page.locator('[data-edge="h:1,1"]').click({ force: true });
  // Stamp a treasure belief on a cell.
  await page.getByRole('button', { name: /treasure/ }).click();
  await page.locator('[data-cell="2,2"]').click();
  // The stamp is rendered in the SVG.
  await expect(page.locator('svg text', { hasText: '💰' }).first()).toBeVisible();

  // Aux map lifecycle: create one and merge it back.
  await page.getByRole('button', { name: '+ new auxiliary map' }).click();
  await expect(page.locator('.aux-banner')).toContainText('Aux 1');

  await ctx.close();
});

test('editor: generate, validate, save', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Map editor' }).click();
  await page.getByRole('button', { name: /generate a base/ }).click();
  await expect(page.getByTestId('editor-status')).toContainText('generated');
  await page.getByTestId('validate-btn').click();
  await expect(page.getByTestId('editor-status')).toContainText('solvable');
  await page.getByTestId('save-btn').click();
  await expect(page.getByTestId('editor-status')).toContainText('saved');
});
