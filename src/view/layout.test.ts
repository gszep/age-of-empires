import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { widgetBox } from './layout';
import type { UiAssets, UiLayout } from './assets';

const UI_MANIFEST = 'public/imported/aoe2/ui/manifest.json';
const imported: UiAssets | undefined = existsSync(UI_MANIFEST)
  ? JSON.parse(readFileSync(UI_MANIFEST, 'utf8')) as UiAssets
  : undefined;

describe('widget geometry', () => {
  it('measures a TopLeft child from its parent corner', () => {
    const layout: UiLayout = {
      viewPort: { xorigin: 0, yorigin: 0, width: 100, height: 100 },
      widgets: [{
        Name: 'Panel', ViewPort: { xorigin: 10, yorigin: 0, width: 80, height: 60, alignment: 'TopLeft' },
        ChildWidgets: [{ Name: 'Child', ViewPort: { xorigin: 5, yorigin: 7, width: 20, height: 20, alignment: 'TopLeft' } }],
      }],
    };
    // Relative to Panel, not to the collection: Panel's own offset of 10 is
    // dropped, because Panel is what our own element draws.
    expect(widgetBox(layout, 'Panel', 'Child')).toEqual({ left: 5, top: 7, width: 20, height: 20 });
  });

  it('reads a CentreCentre origin as the middle of the child', () => {
    const layout: UiLayout = {
      viewPort: { xorigin: 0, yorigin: 0, width: 100, height: 100 },
      widgets: [{
        Name: 'Panel', ViewPort: { xorigin: 0, yorigin: 0, width: 100, height: 50, alignment: 'TopLeft' },
        ChildWidgets: [{ Name: 'Child', ViewPort: { xorigin: 50, yorigin: 25, width: 40, height: 10, alignment: 'CentreCentre' } }],
      }],
    };
    expect(widgetBox(layout, 'Panel', 'Child')).toEqual({ left: 30, top: 20, width: 40, height: 10 });
  });

  it('carries an anchor down to the children hanging off it', () => {
    const layout: UiLayout = {
      viewPort: { xorigin: 0, yorigin: 0, width: 100, height: 100 },
      widgets: [{
        Name: 'Panel', ViewPort: { xorigin: 0, yorigin: 0, width: 100, height: 100, alignment: 'TopLeft' },
        ChildWidgets: [{
          Name: 'Group', Type: 'Anchor', Anchor: { xorigin: 45, yorigin: 90 },
          ChildWidgets: [{ Name: 'First', ViewPort: { xorigin: 0, yorigin: 0, width: 80, height: 80, alignment: 'TopLeft' } }],
        }],
      }],
    };
    expect(widgetBox(layout, 'Panel', 'Group')).toEqual({ left: 45, top: 90, width: 0, height: 0 });
    expect(widgetBox(layout, 'Panel', 'First')).toEqual({ left: 45, top: 90, width: 80, height: 80 });
  });

  it('says nothing about a widget or a layout it does not have', () => {
    expect(widgetBox(undefined, 'Panel', 'Child')).toBeUndefined();
    const layout: UiLayout = {
      viewPort: { xorigin: 0, yorigin: 0, width: 10, height: 10 },
      widgets: [{ Name: 'Panel', ViewPort: { xorigin: 0, yorigin: 0, width: 10, height: 10 } }],
    };
    expect(widgetBox(layout, 'Panel', 'Missing')).toBeUndefined();
    expect(widgetBox(layout, 'Absent', 'Panel')).toBeUndefined();
  });

  // The numbers these assert are the reason the issue existed: the hand-tuned
  // CSS had the minimap at left 70 against the data's 112, and the command
  // grid at top 36 against its 90.
  it.skipIf(!imported)('places the minimap where the shipped map panel puts it', () => {
    expect(widgetBox(imported!.layouts.mappanel, 'Background', 'MapView'))
      .toEqual({ left: 112, top: 16, width: 720, height: 400 });
  });

  it.skipIf(!imported)('places the command grid where the shipped command panel puts it', () => {
    const grid = widgetBox(imported!.layouts.commandpanel, 'BackgroundLeft', 'Buttons');
    expect(grid).toEqual({ left: 45, top: 90, width: 0, height: 0 });
    // Five columns of 80 on a 94 stride: the gap between buttons is 14.
    const first = widgetBox(imported!.layouts.commandpanel, 'BackgroundLeft', 'Button11')!;
    const second = widgetBox(imported!.layouts.commandpanel, 'BackgroundLeft', 'Button21')!;
    expect(first).toEqual({ left: 45, top: 90, width: 80, height: 80 });
    expect(second.left - first.left - first.width).toBe(14);
  });
});
