/**
 * The accent scene's whole animation, indexed by frame.
 *
 * Nothing runs on wall-clock time: `renderFrame(t)` places every node for one
 * instant, so the same `t` always draws the same frame and a re-render is
 * reproducible. The springs mirror `content/juice.toml` and
 * `systems/gameplay/juice/second-order.ts`.
 */
const STAGE = document.getElementById("stage");
const TAU = Math.PI * 2;
const OUTLINE = "4px #2e222f";

/** Unit step response of a second-order system, as the game's second-order.ts draws one. */
function step(t, f, zeta) {
  if (t <= 0) return 0;
  const w = TAU * f;
  if (zeta < 1) {
    const wd = w * Math.sqrt(1 - zeta * zeta);
    return 1 - Math.exp(-zeta * w * t) * (Math.cos(wd * t) + ((zeta * w) / wd) * Math.sin(wd * t));
  }
  return 1 - Math.exp(-w * t) * (1 + w * t);
}

/** The word pop: the root is lifted to `popScale` and settles through the spring's overshoot. */
function pop(t, delay, popScale) {
  const scale = 1 + ((popScale ?? 1.4) - 1) * (1 - step(t - delay, 5, 0.45));
  return t < delay ? 0 : scale;
}

const lerp = (a, b, t) => a + (b - a) * Math.min(1, Math.max(0, t));
const seg = (t, from, to) => Math.min(1, Math.max(0, (t - from) / (to - from)));

const asset = (path) => new URL(path, window.FF.assetBase).href;

const RENDERERS = {};
const accents = new Map();

function mount(accent) {
  const node = document.createElement("div");
  node.dataset.accent = accent.id;
  STAGE.appendChild(node);
  accents.set(accent.id, { accent, node });
}

function renderFrame(t) {
  for (const { accent, node } of accents.values()) {
    if (t < accent.from || t > accent.to) {
      // Hidden inline, not by a class: `juicy` writes `display:flex` into the
      // node's own style, and an inline style beats any class rule, so a class
      // would leave every accent that ever drew visible for the rest of the cut.
      node.style.display = "none";
      continue;
    }
    node.style.display = "";
    RENDERERS[accent.kind](node, accent, t);
  }
  return accents.size;
}

/** The width the type must fit inside, leaving a margin at 1080 wide. */
const FITTED_WIDTH = 900;
const measurer = document.createElement("canvas").getContext("2d");

/** The largest size at or below `size` at which every line fits `maxWidth`. */
function fitSize(value, size, maxWidth) {
  if (measurer === null) return size;
  measurer.font = `italic 900 ${size}px Fraunces, Georgia, serif`;
  // The outline stroke widens every glyph, so it counts against the frame.
  const widest = Math.max(...value.split("\n").map((line) => measurer.measureText(line).width)) + 12;
  return widest <= maxWidth ? size : Math.floor((size * maxWidth) / widest);
}

/** Fraunces 900 slanted, a #2e222f outline, and a per-letter stagger of 22 ms. */
function juicy(node, value, size, delay, t) {
  node.innerHTML = "";
  const fitted = fitSize(String(value), size, FITTED_WIDTH);
  node.style.cssText =
    "position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;" +
    "font-family:'Fraunces',Georgia,serif;font-weight:900;font-style:italic;color:#fff;" +
    `font-size:${fitted}px;line-height:0.92;text-align:center;-webkit-text-stroke:${OUTLINE};` +
    `paint-order:stroke fill;text-shadow:0 8px 0 #2e222f, 0 14px 0 rgba(46,34,47,0.45);` +
    `transform:skewX(-12deg) scale(${pop(t, delay)})`;
  let index = 0;
  for (const line of String(value).split("\n")) {
    const row = document.createElement("div");
    row.style.cssText = "display:flex;justify-content:center";
    for (const character of [...line]) {
      const span = document.createElement("span");
      span.textContent = character === " " ? "\u00a0" : character;
      span.style.cssText = `display:inline-block;transform:scale(${pop(t, delay + index * 0.022)})`;
      row.appendChild(span);
      index += 1;
    }
    node.appendChild(row);
  }
}

RENDERERS.numeral = (node, accent, t) => juicy(node, accent.text, 420, accent.from, t);
RENDERERS.wordmark = (node, accent, t) => juicy(node, "FLOOR\nFIFTY", 210, accent.from, t);

RENDERERS.card = (node, accent, t) => {
  juicy(node, accent.text, 150, accent.from, t);
  const sub = document.createElement("div");
  sub.textContent = String(accent.sub ?? "").toUpperCase();
  sub.style.cssText =
    "position:absolute;left:0;right:0;top:62%;text-align:center;" +
    "font-family:'Manrope',system-ui,sans-serif;font-weight:600;font-size:46px;letter-spacing:0.16em;color:#fff;" +
    "text-shadow:0 3px 0 rgba(20,18,26,0.85), 0 0 14px rgba(20,18,26,0.6);" +
    `opacity:${seg(t, accent.from + 0.12, accent.to)}`;
  node.appendChild(sub);
};

RENDERERS.endcard = (node, accent, t) => {
  juicy(node, "FLOOR FIFTY", 130, accent.from, t);
  const date = document.createElement("div");
  date.textContent = "NOVEMBER 16";
  date.style.cssText =
    "position:absolute;left:0;right:0;top:58%;text-align:center;" +
    "font-family:'Manrope',system-ui,sans-serif;font-weight:600;font-size:64px;letter-spacing:0.2em;color:#fff;" +
    `opacity:${seg(t, accent.from + 0.15, accent.to)}`;
  node.appendChild(date);
};

/**
 * The five devices, in the order the hand passes through them. Every device is
 * centred, so consecutive cuts line the bezel up and the hand appears to
 * rotate rather than jump. Each screen plays a real extracted frame sequence.
 */
const DEVICES = [
  { id: "phone-p", w: 640, h: 1380, r: 90, hand: -14, frames: 48 },
  { id: "phone-l", w: 1010, h: 466, r: 50, hand: 64, frames: 48 },
  { id: "tablet", w: 900, h: 1200, r: 56, hand: -8, frames: 48 },
  { id: "laptop", w: 1040, h: 650, r: 36, hand: 2, frames: 48 },
  { id: "tv", w: 1040, h: 585, r: 28, hand: -6, frames: 48 },
];

const deviceFrame = (id, n) =>
  asset(`evidence/social-2026-10-05/devices/${id}/${String(n).padStart(4, "0")}.png`);

RENDERERS.devices = (node, accent, t) => {
  const per = (accent.to - accent.from) / DEVICES.length;
  const index = Math.min(DEVICES.length - 1, Math.floor((t - accent.from) / per));
  const local = t - accent.from - index * per;
  const device = DEVICES[index];
  const grow = seg(local, 0, 0.18);
  const settle = 1 + (1 - step(local, 5, 0.45)) * 0.12;
  node.innerHTML = "";
  const frame = document.createElement("div");
  frame.style.cssText =
    `position:absolute;left:${(1080 - device.w) / 2}px;top:${(1920 - device.h) / 2}px;` +
    `width:${device.w}px;height:${device.h}px;border-radius:${device.r}px;border:9px solid #2e222f;` +
    `background:#0d0a12;overflow:hidden;opacity:${grow};transform:scale(${lerp(1.18, 1, grow) * settle})`;
  const shot = document.createElement("img");
  shot.src = deviceFrame(device.id, (Math.floor(local * 30) % device.frames) + 1);
  shot.style.cssText = "width:100%;height:100%;object-fit:cover;display:block";
  frame.appendChild(shot);
  node.appendChild(frame);
  const hand = document.createElement("img");
  hand.src = asset("tools/social-edit/assets/hand.svg");
  hand.style.cssText =
    `position:absolute;left:${(1080 + device.w) / 2 - 260}px;top:${(1920 + device.h) / 2 - 380}px;` +
    `width:560px;height:690px;transform:rotate(${device.hand}deg);transform-origin:20% 80%;` +
    "filter:drop-shadow(0 8px 14px rgba(0,0,0,0.45))";
  node.appendChild(hand);
};

window.FF = {
  renderFrame,
  step,
  pop,
  lerp,
  seg,
  STAGE,
  boot: async (timeline, assetBase) => {
    window.FF.assetBase = assetBase;
    // Fitting measures the real face, so both faces must be loaded first.
    // `document.fonts.ready` alone is not enough: nothing has asked for Fraunces
    // yet, so it is not pending and ready resolves before it is fetched.
    if (document.fonts !== undefined) {
      await Promise.all([
        document.fonts.load("italic 900 150px Fraunces"),
        document.fonts.load("600 46px Manrope"),
      ]);
      await document.fonts.ready;
    }
    for (const accent of timeline.accents) mount(accent);
    return accents.size;
  },
};
