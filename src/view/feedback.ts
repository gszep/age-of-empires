/** Owned notification geometry and the general confirmation viewport (#58). */
import { materialUrl, type UiAssets, type UiLayout, type UiLayoutWidget } from './assets';
import { widgetBox } from './layout';
import { placeNativeFeedback } from './native-feedback';

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
  const value = widget?.StateMaterials?.StateTextNormal?.Font ?? widget?.StateMaterials?.StateNormal?.Font
    ?? widget?.StateMaterials?.StateDisabled?.Font;
  if (!value) return;
  element.style.fontSize = `calc(${value.PointSize}px * var(--text-scale))`;
  element.style.fontWeight = value.Style === 'Bold' ? 'bold' : 'normal';
  if (value.TextColor) {
    const { r, g, b, a } = value.TextColor;
    element.style.color = rgba([r, g, b, a]);
  }
}

function surround(element: HTMLElement, background: UiLayoutWidget, ui: UiAssets | undefined): void {
  const frame = document.createElement('div');
  frame.className = 'notification-surround';
  const step = background.Box?.gridstep ?? 0;
  frame.style.gridTemplateColumns = `${px(step)} 1fr ${px(step)}`;
  frame.style.gridTemplateRows = `min(${px(step)}, 50%) 1fr min(${px(step)}, 50%)`;
  for (const cell of ['TL', 'TC', 'TR', 'CL', 'CC', 'CR', 'BL', 'BC', 'BR']) {
    const part = document.createElement('span');
    const material = background.StateMaterials?.[`State${cell}Normal`]?.Material;
    const url = material && materialUrl(ui, material);
    if (url) part.style.backgroundImage = `url('${url}')`;
    frame.append(part);
  }
  element.prepend(frame);
}

function placeChild(element: HTMLElement, name: string, layout: UiLayout, ui: UiAssets | undefined): void {
  const box = widgetBox(layout, 'Background', name);
  if (box) Object.assign(element.style, {
    position: 'absolute', left: px(box.left), top: px(box.top), width: px(box.width), height: px(box.height),
  });
  font(element, findWidget(layout.widgets, name));
  for (const [state, css] of [['StateNormal', '--normal'], ['StateHover', '--hover'], ['StatePressed', '--pressed']]) {
    const value = findWidget(layout.widgets, name)?.StateMaterials?.[state];
    const material = value?.Material;
    const url = material && materialUrl(ui, material);
    if (url) element.style.setProperty(css, `url('${url}')`);
    if (value?.Font) element.style.setProperty(`${css}-font-size`, `calc(${value.Font.PointSize}px * var(--text-scale))`);
  }
  if (element instanceof HTMLButtonElement) element.style.fontSize = 'var(--active-font-size, var(--normal-font-size))';
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
    messages.style.maxHeight = px(background.ViewPort.height);
    messages.style.padding = `${px(text.ViewPort.yorigin)} ${px(text.ViewPort.xorigin)}`;
    // A Surround is nine independently textured cells, not a stretched centre.
    surround(messages, background, ui);
    const lines = messages.querySelector<HTMLElement>('.message-lines')!;
    font(lines, text);
    lines.style.fontWeight = 'bold';
    lines.style.lineHeight = px(text.TextBox?.linesize ?? 40);
    lines.style.maxHeight = px(text.ViewPort.height);
    // The template's brown text is not readable on its black Surround. The
    // runtime's multicolour substitution is inferred; see the #58 ledger.
    lines.style.color = 'var(--ui-White, white)';
  }
  const dialog = root.querySelector<HTMLDialogElement>('#confirm-dialog')!;
  const viewport = ui?.layouts.dialogyesnoboxgeneral?.viewPort;
  const controls = ui?.layouts.dialogconfirmrestartreplay;
  if (viewport && controls && !ui?.nativeFeedback) {
    dialog.classList.add('owned-confirmation');
    dialog.style.width = px(viewport.width);
    dialog.style.height = px(viewport.height);
    for (const [selector, name] of [['#confirm-message', 'Message'], ['[data-answer="yes"]', 'ButtonYes'], ['[data-answer="no"]', 'ButtonNo']]) {
      const element = dialog.querySelector<HTMLElement>(selector)!;
      placeChild(element, name, controls, ui);
    }
    const material = findWidget(controls.widgets, 'Background')?.StateMaterials?.StateNormal?.Material;
    const url = material && materialUrl(ui, material);
    if (url) dialog.style.backgroundImage = `url('${url}')`;
  }
  placeNativeFeedback(root, ui);

  const popup = root.querySelector<HTMLDialogElement>('#popup-dialog')!;
  const popupLayout = ui?.layouts.popupmessage;
  if (popupLayout) {
    popup.classList.add('owned-popup');
    popup.style.width = px(popupLayout.viewPort.width);
    popup.style.height = px(popupLayout.viewPort.height);
    placeChild(popup.querySelector('#popup-message')!, 'MessageBox', popupLayout, ui);
    placeChild(popup.querySelector('button')!, 'ButtonOk', popupLayout, ui);
    const material = findWidget(popupLayout.widgets, 'Background')?.StateMaterials?.StateNormal?.Material;
    const url = material && materialUrl(ui, material);
    if (url) popup.style.backgroundImage = `url('${url}')`;
  }

  const defeat = root.querySelector<HTMLElement>('#defeat-notification')!;
  const defeatLayout = ui?.layouts.GameNotificationPanel;
  const defeatBackground = defeatLayout && findWidget(defeatLayout.widgets, 'Background');
  if (defeatLayout && defeatBackground) {
    defeat.classList.add('owned-defeat');
    const port = defeatLayout.viewPort;
    Object.assign(defeat.style, { left: px(port.xorigin), top: px(port.yorigin), width: px(port.width), height: px(port.height) });
    surround(defeat, defeatBackground, ui);
    for (const [selector, name] of [['.defeat-civ', 'PlayerCivIcon'], ['.defeat-number', 'ButtonPlayerNumberIcon'], ['.defeat-text', 'PlayerName']]) {
      placeChild(defeat.querySelector<HTMLElement>(selector)!, name, defeatLayout, ui);
    }
  }
  const warning = root.querySelector<HTMLElement>('#production-warning')!;
  if (background) surround(warning, background, ui);
  const resources = ui?.layouts.resourcepanel;
  const flashBox = widgetBox(resources, 'Background', 'PopulationFlash');
  const flashColor = resources && findWidget(resources.widgets, 'PopulationFlash')?.StateMaterials?.StateNormal?.Color;
  if (flashBox && flashColor) {
    const flash = root.querySelector<HTMLElement>('#population-flash')!;
    Object.assign(flash.style, { left: px(flashBox.left), top: px(flashBox.top), width: px(flashBox.width), height: px(flashBox.height),
      background: `rgba(${flashColor.r * 255}, ${flashColor.g * 255}, ${flashColor.b * 255}, ${flashColor.a})` });
  }
  const production = ui?.layouts.technologyprogresspanel;
  const port = production && findWidget(production.widgets, 'Background')?.ViewPort;
  if (port) {
    const queue = root.querySelector<HTMLElement>('#global-production')!;
    queue.style.left = px(port.xorigin); queue.style.top = px(port.yorigin);
    queue.style.maxWidth = px(port.width);
    queue.style.setProperty('--queue-cell', px(port.height / 2));
  }
}
