/**
 * Where the shipped widget data says a thing goes.
 *
 * `widgetui`'s panels are laid out in a 3840x2160 reference space. Every
 * widget states an origin, a size, and the corner that origin belongs to; an
 * `Anchor` widget states an origin alone and hands it to its children. Reading
 * those numbers is how a panel's contents line up with the art drawn behind
 * them. The alternative is nudging CSS until it looks right, which is what put
 * the minimap 42 reference pixels left of its own window and the command grid
 * 54 above its own (issue #35).
 */
import type { UiLayout, UiLayoutWidget } from './assets';

export interface WidgetBox { left: number; top: number; width: number; height: number }

/**
 * Both halves of an alignment, as the shipped files spell them: `TopLeft`,
 * `CentreCentre`, `BottomRight`. Absent means `TopLeft`.
 */
const ALIGNMENT = /^(Top|Bottom|Centre)(Left|Right|Centre)$/;

/**
 * A child's box inside its parent's.
 *
 * `Left` and `Top` measure from that edge and `Centre` from the middle, which
 * is every case the panels we draw actually use. `Right` and `Bottom` are read
 * as an offset from that edge — the reading that makes `BackgroundRight` land
 * inside its collection rather than at a negative coordinate — but nothing we
 * place depends on it, so treat it as inference rather than as something the
 * data settled.
 */
function placeIn(parent: WidgetBox, widget: UiLayoutWidget): WidgetBox | undefined {
  const anchor = widget.Anchor;
  if (anchor) {
    // An anchor is a point, not a box: it positions its children and draws
    // nothing itself.
    return { left: parent.left + anchor.xorigin, top: parent.top + anchor.yorigin, width: 0, height: 0 };
  }
  const port = widget.ViewPort;
  if (!port) return undefined;
  const [, vertical = 'Top', horizontal = 'Left'] = ALIGNMENT.exec(port.alignment ?? 'TopLeft') ?? [];
  const left = horizontal === 'Right' ? parent.left + parent.width - port.xorigin - port.width
    : horizontal === 'Centre' ? parent.left + port.xorigin - port.width / 2
      : parent.left + port.xorigin;
  const top = vertical === 'Bottom' ? parent.top + parent.height - port.yorigin - port.height
    : vertical === 'Centre' ? parent.top + port.yorigin - port.height / 2
      : parent.top + port.yorigin;
  return { left, top, width: port.width, height: port.height };
}

/**
 * The box of the widget named `name`, in reference pixels from the top-left of
 * the widget named `within`.
 *
 * `within` is the widget whose art one of our panels draws, so what comes back
 * is directly a position inside that panel. A collection's own viewport places
 * the panel on screen under a different convention and is deliberately not
 * what this resolves.
 */
export function widgetBox(
  layout: UiLayout | undefined, within: string, name: string,
): WidgetBox | undefined {
  if (!layout) return undefined;
  const origin: WidgetBox = { left: 0, top: 0, width: 0, height: 0 };

  const walk = (widgets: UiLayoutWidget[], parent: WidgetBox, inside: boolean): WidgetBox | undefined => {
    for (const widget of widgets) {
      const box = placeIn(parent, widget) ?? parent;
      if (inside && widget.Name === name) return box;
      // Everything below `within` is measured from its top-left, so the search
      // continues with the origin reset rather than with the panel's own offset
      // inside the collection.
      const entering = !inside && widget.Name === within;
      const found = walk(
        widget.ChildWidgets ?? [],
        entering ? { ...origin, width: box.width, height: box.height } : box,
        inside || entering,
      );
      if (found) return found;
    }
    return undefined;
  };

  return walk(layout.widgets, origin, false);
}
