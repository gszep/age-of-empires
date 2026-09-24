/** Native WPFG resources, imported separately from the legacy widget layouts. */
import type { NativeSlices, UiAssets } from './assets';
import { seedFrom } from '../sim/random';

const px = (n: number): string => `calc(${n}px * var(--ui-scale))`;
const color = (s: string): string => s.length === 9 ? `#${s.slice(3)}${s.slice(1, 3)}` : s;
const gradient = (stops: { color: string; offset: number }[]): string =>
  `linear-gradient(to top, ${stops.map(s => `${color(s.color)} ${s.offset * 100}%`).join(', ')})`;

function slices(target: HTMLElement, definition: NativeSlices, ui: UiAssets, inverted = false): void {
  target.replaceChildren();
  target.classList.add('native-frame');
  target.style.gridTemplateColumns = inverted
    ? `1fr ${px(definition.columns[1])} 1fr`
    : `${px(definition.columns[0])} 1fr ${px(definition.columns[2])}`;
  target.style.gridTemplateRows = `${px(definition.rows[0])} 1fr ${px(definition.rows[2])}`;
  for (const path of definition.images) {
    const part = document.createElement('span');
    part.style.backgroundImage = `url('${ui.base}${path}')`;
    target.append(part);
  }
}

export function buttonText(button: HTMLElement, text: string): void {
  const label = document.createElement('span');
  label.textContent = text;
  button.replaceChildren(label);
}

export function placeNativeFeedback(root: HTMLElement, ui: UiAssets | undefined): void {
  const data = ui?.nativeFeedback;
  if (!ui || !data) return;
  if (!document.getElementById('aoe2-native-fonts')) {
    const style = document.createElement('style'); style.id = 'aoe2-native-fonts';
    style.textContent = Object.entries(data.fonts).map(([name, path]) =>
      `@font-face { font-family: 'AoE2 ${name}'; src: url('${ui.base}${path}'); font-weight: ${name === 'heading' ? 'normal' : 'bold'}; font-display: swap; }`).join('\n');
    document.head.append(style);
  }
  root.style.setProperty('--native-button-height', px(data.button.height));
  root.style.setProperty('--native-button-font', px(data.button.fontSize));
  root.style.setProperty('--native-button-border', px(data.button.border));
  root.style.setProperty('--native-border-color', data.button.borderColor);
  root.style.setProperty('--native-button-gradient', gradient(data.button.gradient));
  for (const state of ['normal', 'hover', 'active', 'disable']) {
    root.style.setProperty(`--native-button-${state}`, `url('${ui.base}${data.images[`button_large_${state}`]}')`);
  }
  const dialog = root.querySelector<HTMLElement>('#confirm-dialog')!;
  const c = data.confirm;
  dialog.classList.add('native-confirmation');
  dialog.style.width = px(2 * c.side + 2 * (c.buttonWidth + c.buttonMargin[2]));
  dialog.style.padding = `${px(Number(c.rows[0]))} ${px(c.side)} ${px(Number(c.rows.at(-1)))}`;
  dialog.style.setProperty('--native-message-width', px(c.messageWidth));
  dialog.style.setProperty('--native-message-font', px(c.fontSize));
  dialog.style.setProperty('--native-message-gradient', gradient(c.gradient));
  const frame = document.createElement('div'); slices(frame, c.frame, ui); dialog.prepend(frame);
  const actions = dialog.querySelector<HTMLElement>('.confirm-actions')!;
  actions.style.marginTop = px(Number(c.rows[3]) + c.buttonMargin[1]);
  actions.style.gap = px(c.buttonMargin[2]);
  for (const button of actions.querySelectorAll<HTMLElement>('button')) {
    button.classList.add('native-button'); button.style.width = px(c.buttonWidth);
  }
  const close = dialog.querySelector<HTMLElement>('[data-confirm-cancel]')!;
  close.classList.add('native-button');
  close.style.width = px(c.close[0]); close.style.height = px(c.close[1]);
  close.style.backgroundImage = `url('${ui.base}${data.images.button_close_cross}'), var(--native-button-normal)`;
}

export function placeEndScreen(root: HTMLElement, ui: UiAssets | undefined, victory: boolean): void {
  const data = ui?.nativeFeedback;
  if (!data || !ui) return;
  const dialog = root.querySelector<HTMLElement>('#end-dialog')!;
  dialog.classList.add('native-end');
  const e = data.end;
  const frame = dialog.querySelector<HTMLElement>('.end-frame')!;
  slices(frame, victory ? e.victory : e.defeat, ui, true);
  // Shiny2 keeps the crest's central width and stretches the outer columns.
  Object.assign(frame.style, { left: `calc(50% - ${px(e.frame.width / 2)})`, top: px(e.frame.top), width: px(e.frame.width), height: px(e.frame.height) });
  const content = dialog.querySelector<HTMLElement>('.end-content')!;
  content.style.top = px(e.gridTop); content.style.height = px(e.gridHeight);
  content.style.gridTemplateRows = e.rows.map(row => row.Height === '*' ? `minmax(${px(Number(row.MinHeight ?? 0))}, 1fr)`
    : row.Height.toLowerCase() === 'auto' ? 'auto' : px(Number(row.Height))).join(' ');
  const titleSpace = dialog.querySelector<HTMLElement>('.end-title-space')!;
  titleSpace.style.gridTemplateRows = e.titleRows.map(v => v.endsWith('*') ? `${v.slice(0, -1)}fr` : v.toLowerCase()).join(' ');
  const title = dialog.querySelector<HTMLElement>('#end-title')!;
  title.style.fontSize = px(e.fontSize);
  title.style.backgroundImage = gradient(victory ? e.victoryGradient : e.defeatGradient);
  const separator = dialog.querySelector<HTMLElement>('.end-separator')!;
  separator.style.width = px(e.separator[0]); separator.style.height = px(e.separator[1]);
  separator.style.backgroundImage = `url('${ui.base}${data.images[victory ? 'seperator' : 'seperator_grey']}')`;
  const actions = dialog.querySelector<HTMLElement>('.end-actions')!;
  actions.style.gap = px(e.buttonGap);
  for (const button of actions.querySelectorAll<HTMLElement>('button')) {
    button.classList.add('native-button'); button.style.width = px(e.buttonWidth);
  }
}

/** Procedural overlay, matching emberwindow's alpha/additive separation.
 * The owned ember shader supplies a quadratic distance fade, but its runtime
 * emitter values are absent. Distribution/velocity/count are visual inference
 * from the supplied capture, isolated from simulation RNG (ledger #58).
 */
export function animateEmbers(canvas: HTMLCanvasElement): () => void {
  const ctx = canvas.getContext('2d')!;
  const start = performance.now();
  let handle = 0;
  let lastFrame = -Infinity;
  const motes = Array.from({ length: 900 }, (_, i) => ({
    a: seedFrom(i + 58000) / 0x1_0000_0000, b: seedFrom(i + 59000) / 0x1_0000_0000,
  }));
  // Rasterize the shader's quadratic capsule falloff once. Per-particle canvas
  // filters allocate full-surface intermediates on SwiftShader and are costly.
  const sprites = [[255, 100, 0], [255, 160, 0], [255, 230, 211]].map(rgb => {
    const sprite = document.createElement('canvas'); sprite.width = 64; sprite.height = 16;
    const painter = sprite.getContext('2d')!;
    const pixels = painter.createImageData(64, 16);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 64; x++) {
      const dx = x + 0.5 - Math.max(8, Math.min(56, x + 0.5));
      const dy = y + 0.5 - 8;
      const p = (y * 64 + x) * 4;
      pixels.data.set(rgb, p); pixels.data[p + 3] = 255 * Math.max(0, 1 - (dx * dx + dy * dy) / 64);
    }
    painter.putImageData(pixels, 0, 0); return sprite;
  });
  const draw = (now: number) => {
    handle = requestAnimationFrame(draw);
    if (now - lastFrame < 1000 / 30) return;
    lastFrame = now;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    ctx.clearRect(0, 0, w, h);
    const t = (now - start) / 1000, scale = w / 2000;
    for (const layer of ['source-over', 'lighter'] as const) {
      ctx.globalCompositeOperation = layer;
      for (let i = 0; i < motes.length; i++) {
        if ((i % 3 === 0) !== (layer === 'source-over')) continue;
        const { a, b } = motes[i];
        const plume = i % 3 ? a * 0.72 + 0.1 + Math.sin(b * 6 + t * 0.2) * 0.18 : a;
        const x = (((plume + t * (0.035 + b * 0.055)) % 1 + 1) % 1) * w;
        const y = ((b - t * (0.025 + a * 0.04)) % 1 + 1) % 1 * h;
        ctx.globalAlpha = 0.55 + b * 0.45;
        ctx.save(); ctx.translate(x, y); ctx.rotate(-0.25 + a * 0.4);
        ctx.drawImage(sprites[i % 13 === 0 ? 2 : i % 2], 0, 0, (4 + a * 20) * scale, (2 + b * 7) * scale);
        ctx.restore();
      }
    }
  };
  handle = requestAnimationFrame(draw);
  return () => { cancelAnimationFrame(handle); ctx.clearRect(0, 0, canvas.width, canvas.height); };
}
