import { memo, useMemo } from 'react';
import {
  BODY_BITMAP,
  DEFAULT_AVATAR,
  PALETTES,
  SKIN_TONES,
  UNDERWEAR_BITMAP,
  UNDERWEAR_RAMP,
  templateById,
  type AvatarConfig,
} from '@labyrinthium/shared';

/**
 * The paper-doll avatar: a 16×16 pixel sprite composed from bitmap layers in
 * the shared catalog (body → outfit → trinket → hat, later layers overpaint)
 * and colored by 4-color ramps. Same procedural-SVG approach as PixelLogo —
 * no image assets, crisp at any size from 12px pawns to the 128px wardrobe.
 */

type Ramp = [string, string, string, string];

const FALLBACK_SKIN: Ramp = ['#6b4630', '#d9a06e', '#e8bd8c', '#f4d8b0'];

/** Composite the avatar into a 16×16 color grid; null = transparent. */
function composite(avatar: AvatarConfig): (string | null)[][] {
  const grid: (string | null)[][] = Array.from({ length: 16 }, () => Array<string | null>(16).fill(null));
  const paint = (y0: number, rows: string[], ramp: Ramp): void => {
    rows.forEach((row, dy) => {
      for (let x = 0; x < 16; x++) {
        const ch = row[x]!;
        if (ch === '0') continue;
        const y = y0 + dy;
        // subtle deterministic texture: some base pixels catch the torchlight
        const idx = Number(ch) - 1;
        const lit = idx === 1 && (x * 7 + y * 13) % 11 === 0;
        grid[y]![x] = ramp[lit ? 2 : idx]!;
      }
    });
  };
  paint(BODY_BITMAP.y, BODY_BITMAP.rows, SKIN_TONES[avatar.skinToneId] ?? FALLBACK_SKIN);
  // linen briefs under everything — nobody explores the labyrinth indecent
  paint(UNDERWEAR_BITMAP.y, UNDERWEAR_BITMAP.rows, UNDERWEAR_RAMP);
  for (const slot of ['outfit', 'trinket', 'hat'] as const) {
    const piece = avatar[slot];
    if (!piece) continue;
    const template = templateById(piece.templateId);
    if (!template) continue;
    paint(template.y, template.rows, PALETTES[piece.paletteId] ?? PALETTES.soot!);
  }
  return grid;
}

export interface PixelAvatarProps {
  avatar?: AvatarConfig | null;
  /** rendered square size in px (22 pawn, 28 lobby, 64 home, 128 wardrobe) */
  size: number;
  title?: string;
}

export const PixelAvatar = memo(function PixelAvatar({ avatar, size, title }: PixelAvatarProps): JSX.Element {
  const grid = useMemo(() => composite(avatar ?? DEFAULT_AVATAR), [avatar]);
  const rects: JSX.Element[] = [];
  grid.forEach((row, y) => {
    row.forEach((fill, x) => {
      if (!fill) return;
      rects.push(<rect key={`${x},${y}`} x={x} y={y} width={1} height={1} fill={fill} />);
    });
  });
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      shapeRendering="crispEdges"
      style={{ imageRendering: 'pixelated' }}
      role="img"
      {...(title !== undefined ? { 'aria-label': title } : { 'aria-hidden': true })}
    >
      {title !== undefined ? <title>{title}</title> : null}
      {rects}
    </svg>
  );
});

export interface PixelSwatchProps {
  templateId: string;
  paletteId: string;
  size: number;
  /** render as a dark silhouette (undiscovered collection entries) */
  silhouette?: boolean;
  title?: string;
}

/** One cosmetic template on its own — the wardrobe/collection item tile. */
export const PixelSwatch = memo(function PixelSwatch({
  templateId,
  paletteId,
  size,
  silhouette,
  title,
}: PixelSwatchProps): JSX.Element {
  const template = templateById(templateId);
  const ramp = PALETTES[paletteId] ?? PALETTES.soot!;
  if (!template) return <svg width={size} height={size} />;
  // tight viewBox around the bitmap's occupied columns for a centered tile
  let minX = 16;
  let maxX = 0;
  template.rows.forEach((row) => {
    for (let x = 0; x < 16; x++) {
      if (row[x] !== '0') {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
      }
    }
  });
  const rects: JSX.Element[] = [];
  template.rows.forEach((row, dy) => {
    for (let x = 0; x < 16; x++) {
      const ch = row[x]!;
      if (ch === '0') continue;
      rects.push(
        <rect
          key={`${x},${dy}`}
          x={x}
          y={template.y + dy}
          width={1}
          height={1}
          fill={silhouette ? '#2a2119' : ramp[Number(ch) - 1]!}
        />,
      );
    }
  });
  const pad = 1;
  const w = maxX - minX + 1 + pad * 2;
  const yMid = template.y + template.rows.length / 2;
  const side = Math.max(w, template.rows.length + pad * 2);
  return (
    <svg
      viewBox={`${minX - (side - (maxX - minX + 1)) / 2} ${yMid - side / 2} ${side} ${side}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      style={{ imageRendering: 'pixelated' }}
      role="img"
      {...(title !== undefined ? { 'aria-label': title } : { 'aria-hidden': true })}
    >
      {title !== undefined ? <title>{title}</title> : null}
      {rects}
    </svg>
  );
});
