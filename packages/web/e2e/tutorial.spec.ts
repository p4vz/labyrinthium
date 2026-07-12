import { expect, test } from '@playwright/test';

/**
 * The guided first game, clicked through end to end in a real browser:
 * bump a wall, draw it, ride the river, chart it, grenade the shortcut,
 * scoop the coins, lift the treasure, walk out, graduate. The whole game
 * master runs in the page — the server only serves the static app.
 */
test('the tutorial walks a newcomer from blank map to victory', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('tutorial-btn').click();

  const card = page.getByTestId('tutorial-card');
  await expect(card).toBeVisible();
  await expect(card).toContainText('Welcome to the labyrinth');
  await page.getByTestId('tutorial-next').click();

  // the bare sample map, everything visible…
  await expect(card).toContainText('A sample labyrinth');
  await expect(page.getByTestId('tutorial-map')).toBeVisible();
  await expect(page.getByTestId('tutorial-map').locator('svg')).toBeVisible();
  await page.getByTestId('tutorial-next').click();

  // …then it hides: same picture, drained away
  await expect(card).toContainText('Now the maze hides');
  await expect(page.getByTestId('tutorial-map')).toHaveClass(/vanished/);
  await page.getByTestId('tutorial-next').click();

  // lesson: blocked moves are free — walk into the south wall
  await expect(card).toContainText('Feeling the walls');
  await page.getByTestId('go-S').click();
  await expect(page.getByTestId('event-ticker')).toContainText('a wall blocks the way south');

  // lesson: chart it (the S edge of the entrance is addressed as h:0,3;
  // the hit-line is a transparent SVG stroke, so force past the visibility check)
  await expect(card).toContainText('Draw what you learned');
  await page.locator('[data-edge="h:0,3"]').click({ force: true });

  // lesson: a real step — the river drags you north
  await expect(card).toContainText('Take a real step');
  await page.getByTestId('go-E').click();
  await expect(card).toContainText('The river takes you');
  await page.getByTestId('tutorial-next').click();

  // lesson: chart the river with the river tool
  await expect(card).toContainText('Chart the river');
  await page.getByTitle(/^river — hold on a tile/).click();
  await page.locator('[data-cell="1,2"]').click();

  // lesson: find the grenade wall the hard way
  await expect(card).toContainText('Onward');
  await page.getByTestId('go-E').click();

  // lesson: one action per turn — blast it, then still walk through
  await expect(card).toContainText('argue back');
  await page.getByRole('button', { name: '💥 grenade' }).click();
  await page.getByTestId('go-E').click();
  await expect(card).toContainText('Walk the rubble');
  await page.getByTestId('go-E').click();

  // lesson: loot banks on touch
  await expect(card).toContainText('Loot!');
  await page.getByTestId('tutorial-next').click();

  // lesson: the treasure announces itself, lifting it costs the action
  await expect(card).toContainText('It glitters ahead');
  await page.getByTestId('go-E').click();
  await expect(card).toContainText('Lift it');
  await page.getByTestId('pickup-btn').click();

  // lesson: carry it home — west, west, west, south, out the gate
  await expect(card).toContainText('Run for daylight');
  for (const dir of ['W', 'W', 'W', 'S', 'W'] as const) {
    await page.getByTestId(`go-${dir}`).click();
  }

  // the reveal modal appears underneath, the graduation card on top
  await expect(page.getByTestId('reveal')).toBeVisible();
  await expect(page.getByTestId('reveal')).toContainText('wins');
  await expect(card).toContainText('You know the ropes');
  await page.getByTestId('tutorial-next').click();

  // finishing the tutorial lands back on the home screen
  await expect(page.getByTestId('tutorial-btn')).toBeVisible();
});

test('leaving mid-tutorial cleans up back to the home screen', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('tutorial-btn').click();
  await expect(page.getByTestId('tutorial-card')).toBeVisible();
  await page.getByTestId('tutorial-exit').click();
  await expect(page.getByTestId('tutorial-btn')).toBeVisible();
  // and it can start again, fresh
  await page.getByTestId('tutorial-btn').click();
  await expect(page.getByTestId('tutorial-card')).toContainText('Welcome to the labyrinth');
});
