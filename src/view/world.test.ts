import type * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import { worldToIso } from './iso';
import { createSelectionOutline, insetConvex, updateSelectionOutline } from './world';

/** Perpendicular distance from a point to the infinite line through a and b. */
const lineDistance = (
  point: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number },
): number => Math.abs((b.x - a.x) * (a.y - point.y) - (a.x - point.x) * (b.y - a.y))
  / Math.hypot(b.x - a.x, b.y - a.y);

const diamond = (hx: number, hy: number) => [
  worldToIso(-hx, -hy), worldToIso(hx, -hy), worldToIso(hx, hy), worldToIso(-hx, hy),
];

describe('insetConvex', () => {
  it('keeps a constant band width on the squashed iso diamond', () => {
    // The iso projection halves the vertical axis, so a naive scale toward the
    // centre would make the band thinner on the steep edges than the flat.
    const outer = diamond(1.5, 1.5);
    const inner = insetConvex(outer, 3);
    for (let edge = 0; edge < 4; edge++) {
      const a = outer[edge];
      const b = outer[(edge + 1) % 4];
      expect(lineDistance(inner[edge], a, b)).toBeCloseTo(3, 5);
      expect(lineDistance(inner[(edge + 1) % 4], a, b)).toBeCloseTo(3, 5);
    }
  });

  it('moves every corner inward, including on a gate-thin box', () => {
    const outer = diamond(2, 0.5);
    const inner = insetConvex(outer, 2.5);
    for (let index = 0; index < 4; index++) {
      expect(Math.hypot(inner[index].x, inner[index].y))
        .toBeLessThan(Math.hypot(outer[index].x, outer[index].y));
    }
  });
});

describe('updateSelectionOutline', () => {
  // The geometry stores Float32, so compare to pixel precision.
  const expectCorner = (mesh: THREE.Mesh, vertex: number, world: { x: number; y: number }) => {
    const positions = mesh.geometry.getAttribute('position');
    const iso = worldToIso(world.x, world.y);
    expect(positions.getX(vertex)).toBeCloseTo(iso.x, 3);
    expect(positions.getY(vertex)).toBeCloseTo(iso.y, 3);
  };

  it('lays the band on the outline box iso diamond', () => {
    const mesh = createSelectionOutline(0xffffff);
    updateSelectionOutline(mesh, { x: 1.6, y: 1.6 });
    // First triangle starts at the box's north corner, in iso pixels.
    expectCorner(mesh, 0, { x: -1.6, y: -1.6 });
    expectCorner(mesh, 1, { x: 1.6, y: -1.6 });
  });

  it('reshapes when a pooled mesh is handed a different building', () => {
    const mesh = createSelectionOutline(0xffffff);
    updateSelectionOutline(mesh, { x: 1.6, y: 1.6 });
    updateSelectionOutline(mesh, { x: 2, y: 0.5 });
    expectCorner(mesh, 0, { x: -2, y: -0.5 });
  });
});
