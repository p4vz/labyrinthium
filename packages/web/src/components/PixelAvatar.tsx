import { memo, useMemo } from 'react';
import {
  DEFAULT_AVATAR,
  PALETTES,
  SKIN_TONES,
  UNDERWEAR_RAMP,
  bodyById,
  scale4x,
  templateById,
  type AvatarConfig,
} from '@labyrinthium/shared';

/**
 * The paper-doll avatar: a 16×16 pixel sprite composed from bitmap layers in
 * the shared catalog (body → outfit → trinket → hat, later layers overpaint)
 * and colored by 4-color ramps. Same procedural-SVG approach as PixelLogo —
 * no image assets.
 *
 * Every asset exists in two renditions from the one catalog source:
 *  - `hires` (Scale4x, 64×64) for the wardrobe and character-card screens
 *  - raw 16×16 for everything in-game (pawns, map stamps, lobby chips)
 */

type Ramp = [string, string, string, string];
type ColorGrid = (string | null)[][];

const FALLBACK_SKIN: Ramp = ['#6b4630', '#d9a06e', '#e8bd8c', '#f4d8b0'];

/** Composite the avatar into a 16×16 color grid; null = transparent. */
function composite(avatar: AvatarConfig): ColorGrid {
  const grid: ColorGrid = Array.from({ length: 16 }, () => Array<string | null>(16).fill(null));
  // Flat, deliberate color only — all shading comes from the authored ramp
  // indices. (An earlier per-pixel "torchlight jitter" read as noise/stains
  // at showcase sizes and was removed.)
  const paint = (y0: number, rows: string[], ramp: Ramp): void => {
    rows.forEach((row, dy) => {
      for (let x = 0; x < 16; x++) {
        const ch = row[x]!;
        if (ch === '0') continue;
        grid[y0 + dy]![x] = ramp[Number(ch) - 1]!;
      }
    });
  };
  const body = bodyById(avatar.bodyId);
  paint(body.bitmap.y, body.bitmap.rows, SKIN_TONES[avatar.skinToneId] ?? FALLBACK_SKIN);
  // linen underwear under everything — nobody explores the labyrinth indecent
  paint(body.underwear.y, body.underwear.rows, UNDERWEAR_RAMP);
  for (const slot of ['outfit', 'trinket', 'hat'] as const) {
    const piece = avatar[slot];
    if (!piece) continue;
    const template = templateById(piece.templateId);
    if (!template) continue;
    paint(template.y, template.rows, PALETTES[piece.paletteId] ?? PALETTES.soot!);
  }
  return grid;
}

/** One cosmetic template alone, painted into a 16×16 grid. */
function templateGrid(templateId: string, paletteId: string, silhouette: boolean): ColorGrid {
  const grid: ColorGrid = Array.from({ length: 16 }, () => Array<string | null>(16).fill(null));
  const template = templateById(templateId);
  if (!template) return grid;
  const ramp = PALETTES[paletteId] ?? PALETTES.soot!;
  template.rows.forEach((row, dy) => {
    for (let x = 0; x < 16; x++) {
      const ch = row[x]!;
      if (ch === '0') continue;
      grid[template.y + dy]![x] = silhouette ? '#2a2119' : ramp[Number(ch) - 1]!;
    }
  });
  return grid;
}

/** Emit one <rect> per horizontal run of same-colored pixels — a Scale4x
 * grid is full of runs, so this keeps hires renders cheap. */
function gridRects(grid: ColorGrid): JSX.Element[] {
  const rects: JSX.Element[] = [];
  grid.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const fill = row[x];
      if (!fill) {
        x++;
        continue;
      }
      let end = x + 1;
      while (end < row.length && row[end] === fill) end++;
      rects.push(<rect key={`${x},${y}`} x={x} y={y} width={end - x} height={1} fill={fill} />);
      x = end;
    }
  });
  return rects;
}

/** Occupied bounds of a grid, or null when fully transparent. */
function bounds(grid: ColorGrid): { minX: number; maxX: number; minY: number; maxY: number } | null {
  let minX = Infinity;
  let maxX = -1;
  let minY = Infinity;
  let maxY = -1;
  grid.forEach((row, y) => {
    row.forEach((c, x) => {
      if (!c) return;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    });
  });
  return maxX < 0 ? null : { minX, maxX, minY, maxY };
}

export interface PixelAvatarProps {
  avatar?: AvatarConfig | null;
  /** rendered square size in px (22 pawn, 28 lobby, 64 home, 128+ wardrobe) */
  size: number;
  /** Scale4x rendition for the wardrobe/character screens; raw 16×16 in-game */
  hires?: boolean;
  title?: string;
}

export const PixelAvatar = memo(function PixelAvatar({ avatar, size, hires, title }: PixelAvatarProps): JSX.Element {
  const grid = useMemo(() => {
    const base = composite(avatar ?? DEFAULT_AVATAR);
    return hires ? scale4x(base) : base;
  }, [avatar, hires]);
  const dim = grid.length;
  return (
    <svg
      viewBox={`0 0 ${dim} ${dim}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      style={{ imageRendering: 'pixelated' }}
      role="img"
      {...(title !== undefined ? { 'aria-label': title } : { 'aria-hidden': true })}
    >
      {title !== undefined ? <title>{title}</title> : null}
      {gridRects(grid)}
    </svg>
  );
});

export interface PixelSwatchProps {
  templateId: string;
  paletteId: string;
  size: number;
  /** Scale4x rendition for the wardrobe/character screens */
  hires?: boolean;
  /** render as a dark silhouette (undiscovered collection entries) */
  silhouette?: boolean;
  title?: string;
}

/** One cosmetic template on its own — the wardrobe/collection item tile. */
export const PixelSwatch = memo(function PixelSwatch({
  templateId,
  paletteId,
  size,
  hires,
  silhouette,
  title,
}: PixelSwatchProps): JSX.Element {
  const grid = useMemo(() => {
    const base = templateGrid(templateId, paletteId, silhouette ?? false);
    return hires ? scale4x(base) : base;
  }, [templateId, paletteId, silhouette, hires]);
  const box = bounds(grid);
  if (!box) return <svg width={size} height={size} />;
  // tight square viewBox around the occupied pixels for a centered tile
  const pad = hires ? 4 : 1;
  const w = box.maxX - box.minX + 1;
  const h = box.maxY - box.minY + 1;
  const side = Math.max(w, h) + pad * 2;
  const vx = box.minX - (side - w) / 2;
  const vy = box.minY - (side - h) / 2;
  return (
    <svg
      viewBox={`${vx} ${vy} ${side} ${side}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      style={{ imageRendering: 'pixelated' }}
      role="img"
      {...(title !== undefined ? { 'aria-label': title } : { 'aria-hidden': true })}
    >
      {title !== undefined ? <title>{title}</title> : null}
      {gridRects(grid)}
    </svg>
  );
});
