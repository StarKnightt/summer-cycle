import * as THREE from "three";

/**
 * Street signage painted on a canvas at load (system Japanese fonts, no downloads): shop boards,
 * noren, road signs, vending-machine fronts, shutters. Sampled by the uber shader for M.sign /
 * M.signGlow via the uv rect of each entry. Colours are sRGB paint; the texture decodes to linear.
 */
const W = 2048, H = 1024;

type Painter = (g: CanvasRenderingContext2D, w: number, h: number) => void;

const GOTHIC = `"Yu Gothic UI", "Yu Gothic", "Meiryo", "Hiragino Sans", "Noto Sans CJK JP", "Noto Sans JP", sans-serif`;
const MINCHO = `"Yu Mincho", "Hiragino Mincho ProN", "MS Mincho", "Noto Serif CJK JP", serif`;

function text(g: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, color: string, font = GOTHIC, weight = 700) {
  g.font = `${weight} ${size}px ${font}`;
  g.fillStyle = color;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(s, x, y);
}

function vtext(g: CanvasRenderingContext2D, s: string, x: number, y0: number, step: number, size: number, color: string, font = GOTHIC) {
  [...s].forEach((c, i) => text(g, c, x, y0 + i * step, size, color, font));
}

/** Weathering: soft grime near the edges, a few drip streaks from the top. */
function grime(g: CanvasRenderingContext2D, w: number, h: number, k = 1) {
  const e = g.createLinearGradient(0, 0, 0, h);
  e.addColorStop(0, `rgba(60,45,30,${0.1 * k})`);
  e.addColorStop(0.2, "rgba(60,45,30,0)");
  e.addColorStop(0.85, "rgba(60,45,30,0)");
  e.addColorStop(1, `rgba(60,45,30,${0.18 * k})`);
  g.fillStyle = e;
  g.fillRect(0, 0, w, h);
  let s = 7;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 6 * k; i++) {
    const x = rnd() * w, len = h * (0.2 + rnd() * 0.5);
    const d = g.createLinearGradient(0, 0, 0, len);
    d.addColorStop(0, `rgba(70,55,40,${0.18 * k})`);
    d.addColorStop(1, "rgba(70,55,40,0)");
    g.fillStyle = d;
    g.fillRect(x, 0, 2 + rnd() * 5, len);
  }
}

const PAINT: Record<string, [number, number, number, number, Painter]> = {
  // name: [x, y, w, h, painter]
  dagashi: [0, 0, 512, 160, (g, w, h) => {
    g.fillStyle = "#f4ede0"; g.fillRect(0, 0, w, h);
    g.strokeStyle = "#b8302c"; g.lineWidth = 10; g.strokeRect(8, 8, w - 16, h - 16);
    text(g, "だがし", w * 0.42, h * 0.52, 96, "#c0302a");
    text(g, "やまだ屋", w * 0.84, h * 0.52, 34, "#3a3230", MINCHO);
    grime(g, w, h);
  }],
  ramen: [512, 0, 512, 160, (g, w, h) => {
    g.fillStyle = "#b82a26"; g.fillRect(0, 0, w, h);
    text(g, "ラーメン", w * 0.5, h * 0.5, 100, "#fff6e6");
    grime(g, w, h, 0.7);
  }],
  closed: [1024, 0, 512, 160, (g, w, h) => {
    g.fillStyle = "#8fa3ad"; g.fillRect(0, 0, w, h);
    text(g, "たなか商店", w * 0.5, h * 0.5, 88, "rgba(240,236,226,0.8)", MINCHO);
    g.fillStyle = "rgba(150,110,70,0.35)"; g.fillRect(0, 0, w, h);
    grime(g, w, h, 2);
  }],
  tabako: [1536, 0, 256, 160, (g, w, h) => {
    g.fillStyle = "#c83a32"; g.fillRect(0, 0, w, h);
    text(g, "たばこ", w * 0.5, h * 0.5, 64, "#ffffff");
  }],
  kori: [1792, 0, 256, 256, (g, w, h) => {
    g.fillStyle = "#fbfaf4"; g.fillRect(0, 0, w, h);
    g.fillStyle = "#3a6fc0";
    g.beginPath(); g.moveTo(0, h * 0.78);
    for (let x = 0; x <= w; x += 8) g.lineTo(x, h * 0.78 + Math.sin(x / 18) * 10);
    g.lineTo(w, h); g.lineTo(0, h); g.fill();
    text(g, "氷", w * 0.5, h * 0.42, 150, "#d4302c", MINCHO, 900);
  }],
  noren: [0, 160, 512, 256, (g, w, h) => {
    g.fillStyle = "#2a3558"; g.fillRect(0, 0, w, h);
    g.fillStyle = "#1f2846"; for (let i = 1; i < 4; i++) g.fillRect((w * i) / 4 - 3, h * 0.25, 6, h);
    text(g, "そば", w * 0.5, h * 0.55, 150, "#f4efe4", MINCHO, 900);
  }],
  tomare: [512, 160, 256, 256, (g, w, h) => {
    g.fillStyle = "rgba(0,0,0,0)"; g.clearRect(0, 0, w, h);
    g.fillStyle = "#f4f2ee";
    g.beginPath(); g.moveTo(8, 10); g.lineTo(w - 8, 10); g.lineTo(w / 2, h - 10); g.closePath(); g.fill();
    g.fillStyle = "#c8262a";
    g.beginPath(); g.moveTo(26, 22); g.lineTo(w - 26, 22); g.lineTo(w / 2, h - 36); g.closePath(); g.fill();
    text(g, "止まれ", w / 2, h * 0.3, 50, "#ffffff");
  }],
  bus: [768, 160, 256, 256, (g, w, h) => {
    g.fillStyle = "#e8e6e0"; g.fillRect(0, 0, w, h);
    g.fillStyle = "#ffffff"; g.beginPath(); g.arc(w / 2, h / 2, w * 0.47, 0, 7); g.fill();
    g.strokeStyle = "#2a5aa8"; g.lineWidth = 16; g.beginPath(); g.arc(w / 2, h / 2, w * 0.42, 0, 7); g.stroke();
    text(g, "バス停", w / 2, h * 0.4, 50, "#2a5aa8");
    text(g, "田中口", w / 2, h * 0.63, 40, "#303030");
  }],
  phone: [1024, 160, 512, 96, (g, w, h) => {
    g.fillStyle = "#3c8a52"; g.fillRect(0, 0, w, h);
    text(g, "公衆電話", w * 0.5, h * 0.52, 64, "#ffffff");
  }],
  yasai: [1024, 256, 512, 160, (g, w, h) => {
    g.fillStyle = "#c9a776"; g.fillRect(0, 0, w, h);
    text(g, "やさい", w * 0.36, h * 0.5, 84, "#2d5a2a", GOTHIC, 800);
    text(g, "100円", w * 0.78, h * 0.5, 58, "#b3302a", GOTHIC, 800);
    grime(g, w, h, 1.2);
  }],
  sake: [1536, 160, 128, 512, (g, w, h) => {
    g.fillStyle = "#f2ece0"; g.fillRect(0, 0, w, h);
    vtext(g, "酒たばこ", w / 2, 70, 118, 96, "#2a2624", MINCHO);
    grime(g, w, h);
  }],
  shrine: [1664, 256, 128, 384, (g, w, h) => {
    g.fillStyle = "#2c2a26"; g.fillRect(0, 0, w, h);
    g.strokeStyle = "#c8a64a"; g.lineWidth = 6; g.strokeRect(8, 8, w - 16, h - 16);
    vtext(g, "稲荷社", w / 2, 80, 110, 88, "#e9d59a", MINCHO);
  }],
  shutter: [0, 416, 512, 384, (g, w, h) => {
    g.fillStyle = "#a9adae"; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 16) {
      g.fillStyle = "#8d9294"; g.fillRect(0, y, w, 3);
      g.fillStyle = "#c4c7c6"; g.fillRect(0, y + 4, w, 2);
    }
    g.fillStyle = "rgba(140,80,40,0.25)"; g.fillRect(0, h * 0.8, w, h * 0.2);
    text(g, "準備中", w * 0.5, h * 0.4, 64, "rgba(60,60,64,0.55)");
    grime(g, w, h, 2);
  }],
  vendDrink: [512, 416, 256, 512, (g, w, h) => {
    g.fillStyle = "#f2f4f6"; g.fillRect(0, 0, w, h);
    const cols = ["#d8342c", "#2a64c0", "#f0b02a", "#2c9a5a", "#8a3aa8", "#e8e2d0", "#e05a2a", "#20a0c0"];
    for (let r = 0; r < 3; r++) {
      g.fillStyle = "#e0e8ef"; g.fillRect(12, 20 + r * 100, w - 24, 88);
      for (let c = 0; c < 6; c++) {
        g.fillStyle = cols[(r * 3 + c) % cols.length];
        g.fillRect(22 + c * 37, 30 + r * 100, 26, 56);
        g.fillStyle = "rgba(255,255,255,0.6)"; g.fillRect(24 + c * 37, 34 + r * 100, 5, 46);
        g.fillStyle = r === 2 ? "#d8342c" : "#2a64c0"; g.fillRect(22 + c * 37, 92 + r * 100, 26, 8);
      }
    }
    text(g, "つめたい", w * 0.5, 332, 30, "#2a64c0");
    g.fillStyle = "#2a2e34"; g.fillRect(40, 380, w - 80, 70);
    g.fillStyle = "#c8ccd0"; g.fillRect(w - 70, 350, 30, 20);
  }],
  vendIce: [768, 416, 256, 512, (g, w, h) => {
    g.fillStyle = "#f7f0f4"; g.fillRect(0, 0, w, h);
    g.fillStyle = "#e8508a"; g.fillRect(0, 0, w, 90);
    text(g, "アイス", w * 0.5, 46, 60, "#ffffff");
    const cols = ["#f7d2e0", "#c8e6f6", "#fbe7a8", "#d6f0c8", "#f4c0a8"];
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 4; c++) {
        g.fillStyle = cols[(r + c) % cols.length];
        g.fillRect(20 + c * 56, 110 + r * 88, 44, 70);
        g.fillStyle = "#b03a6a"; g.fillRect(20 + c * 56, 170 + r * 88, 44, 8);
      }
    g.fillStyle = "#2a2e34"; g.fillRect(40, 400, w - 80, 60);
  }],
  jizoBib: [1024, 416, 128, 128, (g, w, h) => {
    g.fillStyle = "#d2322c"; g.fillRect(0, 0, w, h);
    g.fillStyle = "rgba(255,255,255,0.12)"; for (let y = 0; y < h; y += 10) g.fillRect(0, y, w, 3);
  }],
  awning: [1152, 416, 256, 128, (g, w, h) => {
    for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? "#f4ede2" : "#c8302a"; g.fillRect((i * w) / 8, 0, w / 8, h); }
    g.fillStyle = "rgba(60,40,30,0.18)"; g.fillRect(0, h * 0.8, w, h * 0.2);
  }],
  plate: [1408, 416, 128, 128, (g, w, h) => {
    g.fillStyle = "#f2f0e8"; g.fillRect(0, 0, w, h);
    g.strokeStyle = "#306a3a"; g.lineWidth = 6; g.strokeRect(6, 6, w - 12, h - 12);
    text(g, "軽", w / 2, h / 2, 70, "#306a3a");
  }],
};

let tex: THREE.CanvasTexture | null = null;

export function signAtlas(renderer: THREE.WebGLRenderer): THREE.CanvasTexture {
  if (tex) return tex;
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const g = cv.getContext("2d")!;
  g.fillStyle = "#808080";
  g.fillRect(0, 0, W, H);
  for (const [x, y, w, h, paint] of Object.values(PAINT)) {
    g.save();
    g.translate(x, y);
    g.beginPath();
    g.rect(0, 0, w, h);
    g.clip();
    paint(g, w, h);
    g.restore();
  }
  tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  tex.needsUpdate = true;
  return tex;
}

export type SignName = keyof typeof PAINT;

/** Map a 0..1 plane uv into the atlas rect of `name` (half-texel inset, texture flipY). */
export function signUv(name: string, u: number, v: number): [number, number] {
  const [x, y, w, h] = PAINT[name];
  const x0 = (x + 1.5) / W, x1 = (x + w - 1.5) / W;
  const y0 = 1 - (y + h - 1.5) / H, y1 = 1 - (y + 1.5) / H;
  return [x0 + (x1 - x0) * u, y0 + (y1 - y0) * v];
}
