/** Owned notification geometry and the general confirmation viewport (#58). */
import { materialUrl, type UiAssets, type UiLayoutWidget } from './assets';
import { widgetBox } from './layout';

export function findWidget(widgets: UiLayoutWidget[], name: string): UiLayoutWidget | undefined {
  for (const widget of widgets) {
    if (widget.Name === name) return widget;
    const child = findWidget(widget.ChildWidgets ?? [], name);
    if (child) return child;
  }
}

const px = (value: number): string => `calc(${value}px * var(--ui-scale))`;
const rgba = (v: number[]): string => `rgba(${v[0]}, ${v[1]}, ${v[2]}, ${v[3] / 255})`;

export function installUiColors(root: HTMLElement, ui: UiAssets | undefined, palette = 'default'): void {
  const colors = ui?.colorPalettes?.[palette];
  for (const [name, value] of Object.entries(ui?.colorTags ?? {})) root.style.setProperty(`--ui-${name}`, rgba(value));
  for (const [name, value] of Object.entries({ ...ui?.colors?.PresetColors, ...colors?.PresetColors })) {
    root.style.setProperty(`--ui-${name}`, rgba(value));
  }
  for (const [name, table] of Object.entries(ui?.colors?.ColorTables ?? {})) {
    for (const [role, value] of Object.entries({ ...table, ...colors?.ColorTables?.[name] })) {
      root.style.setProperty(`--ui-${name}-${role}`, rgba(value));
    }
  }
}

function font(element: HTMLElement, widget: UiLayoutWidget | undefined): void {
  const value = widget?.StateMaterials?.StateTextNormal?.Font ?? widget?.StateMaterials?.StateNormal?.Font;
  if (!value) return;
  element.style.fontSize = `calc(${value.PointSize}px * var(--text-scale))`;
  element.style.fontWeight = value.Style === 'Bold' ? 'bold' : 'normal';
  if (value.TextColor) {
    const { r, g, b, a } = value.TextColor;
    element.style.color = rgba([r, g, b, a]);
  }
}

export function placeFeedback(root: HTMLElement, ui: UiAssets | undefined): void {
  const messages = root.querySelector<HTMLElement>('#game-message')!;
  const notification = ui?.layouts.notificationpanel;
  const background = notification && findWidget(notification.widgets, 'EventBackground');
  const text = background && findWidget(background.ChildWidgets ?? [], 'TextBox');
  if (notification && background?.ViewPort && text?.ViewPort) {
    const port = notification.viewPort;
    messages.classList.add('owned-notifications');
    messages.style.left = px(port.xorigin);
    messages.style.top = px(port.yorigin);
    messages.style.width = px(background.ViewPort.width);
    messages.style.height = px(background.ViewPort.height);
    messages.style.padding = `${px(text.ViewPort.yorigin)} ${px(text.ViewPort.xorigin)}`;
    // A Surround is nine independently textured cells, not a stretched centre.
    const surround = document.createElement('div');
    surround.className = 'notification-surround';
    const step = background.Box?.gridstep ?? 0;
    surround.style.gridTemplateColumns = `${px(step)} 1fr ${px(step)}`;
    surround.style.gridTemplateRows = `${px(step)} 1fr ${px(step)}`;
    for (const cell of ['TL', 'TC', 'TR', 'CL', 'CC', 'CR', 'BL', 'BC', 'BR']) {
      const part = document.createElement('span');
      const material = background.StateMaterials?.[`State${cell}Normal`]?.Material;
      const url = material && materialUrl(ui, material);
      if (url) part.style.backgroundImage = `url('${url}')`;
      surround.append(part);
    }
    messages.prepend(surround);
    const lines = messages.querySelector<HTMLElement>('.message-lines')!;
    font(lines, text);
    // The template's brown text is not readable on its black Surround. The
    // runtime's multicolour substitution is inferred; see the #58 ledger.
    lines.style.color = 'var(--ui-White, white)';
  }
  const dialog = root.querySelector<HTMLDialogElement>('#confirm-dialog')!;
  const viewport = ui?.layouts.dialogyesnoboxgeneral?.viewPort;
  const controls = ui?.layouts.dialogconfirmrestartreplay;
  if (viewport && controls) {
    dialog.classList.add('owned-confirmation');
    dialog.style.width = px(viewport.width);
    dialog.style.height = px(viewport.height);
    for (const [selector, name] of [['#confirm-message', 'Message'], ['[data-answer="yes"]', 'ButtonYes'], ['[data-answer="no"]', 'ButtonNo']]) {
      const element = dialog.querySelector<HTMLElement>(selector)!;
      const box = widgetBox(controls, 'Background', name);
      if (box) Object.assign(element.style, {
        position: 'absolute', left: px(box.left), top: px(box.top), width: px(box.width), height: px(box.height),
      });
      const widget = findWidget(controls.widgets, name);
      font(element, widget);
      for (const [state, css] of [['StateNormal', '--normal'], ['StateHover', '--hover'], ['StatePressed', '--pressed']]) {
        const material = widget?.StateMaterials?.[state]?.Material;
        const url = material && materialUrl(ui, material);
        if (url) element.style.setProperty(css, `url('${url}')`);
      }
    }
    const material = findWidget(controls.widgets, 'Background')?.StateMaterials?.StateNormal?.Material;
    const url = material && materialUrl(ui, material);
    if (url) dialog.style.backgroundImage = `url('${url}')`;
  }
}
