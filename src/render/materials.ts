import * as THREE from "three";
import { TOD, TOD_GLSL } from "./todUniforms";

/**
 * Every visible surface uses one of the custom toon materials below. They all render into a
 * two-attachment target: location 0 = lit colour (linear HDR), location 1 = view normal.xy,
 * outline-group id and outline mask. The post pass derives ink lines from that + depth.
 *
 * Outline mask: > 0 line weight, 0 = passive (draws no line itself, neighbours may),
 * < 0 = excluded (never inked and ignored by neighbours: grass, rice, leaf cards, motes).
 */

const lin = (hex: string) => new THREE.Color(hex);

export const G = {
  uTime: { value: 0 },
  // Low golden sun from behind-left of the rider (~25° elevation): long shadows rake forward-right.
  uSunDir: { value: new THREE.Vector3(-0.55, 0.42, 0.72).normalize() },
  // Near-white sun so whites stay white; the golden warmth comes from ambient, rim and grade.
  uSunColor: { value: lin("#fff1dc") },
  uShadowTint: { value: lin("#8a90b0") },
  uSkyZenith: { value: lin("#0f6f7d") },
  uSkyMid: { value: lin("#2fa3c0") },
  uSkyHorizon: { value: lin("#bfe3e6") },
  uFogColor: { value: lin("#c6ddd8") },
  uFogDensity: { value: 0.00095 },
  uRimColor: { value: lin("#fff1d0") },
  uWindDir: { value: new THREE.Vector2(0.8, -0.6).normalize() },
  uShadowMap: { value: null as THREE.Texture | null },
  uShadowMat: { value: new THREE.Matrix4() },
  uShadowOn: { value: 0 },
  uShadowTexel: { value: new THREE.Vector2(1 / 2048, 1 / 2048) },
  uShadowRange: { value: 300 },
  uShadowCenter: { value: new THREE.Vector3() },
  uShadowHalf: { value: 55 },
  /** Set while rendering the paddy mirror: canopy fringe cards are skipped there. */
  uNoFringe: { value: 0 },
  /** Painted leaf atlas (see leafAtlas.ts); assigned once the renderer exists. */
  uLeafTex: { value: null as THREE.Texture | null },
  /** Street signage atlas (see signAtlas.ts). */
  uSignTex: { value: null as THREE.Texture | null },
  /** 1 while the scene pass has no MSAA: coverage-alpha surfaces dither instead (see writeOut). */
  uDither: { value: 0 },
  /** Grass parting around her feet when she walks: (x, z, radius, strength). */
  uPush: { value: new THREE.Vector4(0, 0, 0.8, 0) },
  ...TOD,
};

export const COMMON = /* glsl */ `
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uShadowTint;
uniform vec3 uSkyZenith;
uniform vec3 uSkyMid;
uniform vec3 uSkyHorizon;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform vec3 uRimColor;
uniform vec2 uWindDir;
uniform float uNoFringe;
uniform sampler2D uLeafTex;
uniform sampler2D uSignTex;
uniform float uDither;
uniform vec4 uPush;
uniform sampler2D uShadowMap;
uniform mat4 uShadowMat;
uniform float uShadowOn;
uniform vec2 uShadowTexel;
uniform float uShadowRange;
uniform vec3 uShadowCenter;
uniform float uShadowHalf;
${TOD_GLSL}

float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hash13(vec3 p3){ p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
float vnoise3(vec3 p){
  vec3 i = floor(p), f = fract(p); vec3 u = f * f * (3.0 - 2.0 * f);
  float a = mix(mix(hash13(i), hash13(i + vec3(1,0,0)), u.x), mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), u.x), u.y);
  float b = mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), u.x), mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), u.x), u.y);
  return mix(a, b, u.z);
}
float fbm2(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++){ s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }

vec3 skyColor(vec3 dir){
  float h = clamp(dir.y, 0.0, 1.0);
  vec3 col = mix(uSkyHorizon, uSkyMid, smoothstep(0.0, 0.2, h));
  col = mix(col, uSkyZenith, smoothstep(0.14, 0.7, h));
  float sd = max(dot(dir, uSkySun), 0.0);
  col += uSunGlow * (pow(sd, 5.0) * uSunGlowAmt.x + pow(sd, 48.0) * uSunGlowAmt.y);
  if (uHorizGlowK.x > 0.0) {
    // Low sun: the horizon glows warm toward it (sunset band), fading around the sky.
    float az = dot(normalize(dir.xz + 1e-5), normalize(uSkySun.xz + 1e-5)) * 0.5 + 0.5;
    col = mix(col, uHorizGlow, clamp(exp(-h * uHorizGlowK.y) * az * az * uHorizGlowK.x, 0.0, 1.0));
  }
  // Warm aerial haze hugging the horizon.
  col = mix(col, uHaze, exp(-h * 26.0) * uHazeAmt);
  return col;
}

vec3 applyFog(vec3 col, vec3 wpos){
  col = col * uWorldTint + gEmit;
  vec3 d = wpos - cameraPosition;
  float dist = length(d);
  float f = 1.0 - exp(-max(dist - 70.0, 0.0) * uFogDensity);
  vec3 dir = d / max(dist, 0.001);
  vec3 fc = mix(uFogColor, skyColor(normalize(vec3(dir.x, 0.03, dir.z))), 0.45);
  fc *= vec3(1.03, 1.0, 0.95);
  return mix(col, fc, f * 0.9);
}

// Directional brush strokes that stick to the surface (world space, planar by dominant normal).
float brush(vec3 wp, vec3 n){
  vec3 an = abs(n);
  vec2 p = an.y > max(an.x, an.z) ? wp.xz : (an.x > an.z ? wp.zy : wp.xy);
  float ang = vnoise(p * 0.12) * 3.14159;
  float c = cos(ang), s = sin(ang);
  vec2 q = mat2(c, -s, s, c) * p;
  // Band-limited by pixel footprint: stroke octaves fade to their mean before they can alias.
  float fp = length(wp - cameraPosition) * 0.0011;
  float k1 = 1.0 - smoothstep(0.25, 0.6, fp * 6.0), k2 = 1.0 - smoothstep(0.25, 0.6, fp * 13.0);
  return 0.5 + (vnoise(q * vec2(1.1, 6.0)) - 0.5) * 0.6 * k1 + (vnoise(q * vec2(2.3, 13.0)) - 0.5) * 0.4 * k2;
}

// Toon-thresholded shadow map: 1 = sunlit, 0 = in shadow. Canopy shadows get sun flecks.
bool gFastShadow = false;
float shadowVis(vec3 wpos, vec3 N){
  if (uShadowOn < 0.5) return 1.0;
  vec2 rel = abs(wpos.xz - uShadowCenter.xz);
  float edge = smoothstep(uShadowHalf * 0.82, uShadowHalf * 0.98, max(rel.x, rel.y));
  if (edge >= 1.0) return 1.0;
  vec3 p = wpos + N * 0.05 + uSunDir * 0.04;
  vec4 sc = uShadowMat * vec4(p, 1.0);
  vec3 s = sc.xyz / sc.w;
  if (s.x <= 0.0 || s.x >= 1.0 || s.y <= 0.0 || s.y >= 1.0 || s.z >= 1.0) return 1.0;
  vec2 tc = s.xy / uShadowTexel - 0.5;
  vec2 f = fract(tc);
  vec2 b0 = (floor(tc) + 0.5) * uShadowTexel;
  if (gFastShadow) {
    // Foliage: one bilinear 2x2 tap is plenty under the leaf texture (and far cheaper on canopies).
    float l00 = step(s.z - 0.0008, texture(uShadowMap, b0).r);
    float l10 = step(s.z - 0.0008, texture(uShadowMap, b0 + vec2(uShadowTexel.x, 0.0)).r);
    float l01 = step(s.z - 0.0008, texture(uShadowMap, b0 + vec2(0.0, uShadowTexel.y)).r);
    float l11 = step(s.z - 0.0008, texture(uShadowMap, b0 + uShadowTexel).r);
    return mix(mix(mix(l00, l10, f.x), mix(l01, l11, f.x), f.y), 1.0, edge);
  }
  // 3x3 bilinear PCF from a 4x4 texel footprint: smooth, stair-free edges.
  float L[16];
  float gap = 0.0, n = 0.0;
  for (int j = 0; j < 4; j++) for (int i = 0; i < 4; i++) {
    float d = texture(uShadowMap, b0 + vec2(float(i - 1), float(j - 1)) * uShadowTexel).r;
    float lit = step(s.z - 0.0008, d);
    L[j * 4 + i] = lit;
    gap += (1.0 - lit) * (s.z - d);
    n += 1.0 - lit;
  }
  float vis = 0.0;
  for (int j = 0; j < 3; j++) for (int i = 0; i < 3; i++) {
    float a = mix(L[j * 4 + i], L[j * 4 + i + 1], f.x);
    float c = mix(L[(j + 1) * 4 + i], L[(j + 1) * 4 + i + 1], f.x);
    vis += mix(a, c, f.y);
  }
  vis /= 9.0;
  float g = n > 0.0 ? gap / n * uShadowRange : 0.0;
  // Dappled sunlight through leaves: only when the occluder is high above (canopy).
  float fl = vnoise(wpos.xz * 1.1 + vec2(uTime * 0.12, 0.0)) * 0.65 + vnoise(wpos.xz * 2.7) * 0.35;
  float fleck = smoothstep(0.62, 0.7, fl) * smoothstep(3.0, 5.0, g);
  vis = max(smoothstep(0.35, 0.65, vis), fleck);
  return mix(vis, 1.0, edge);
}

// Three-step cel lighting (lit / shadow / dark shadow), painterly terminator, rim light.
// Set by the skin branch: one crisp cel step on the form, but cast shadows (hair) stay soft.
float gSoftCast = 0.0;
vec3 toonT(vec3 base, vec3 N, vec3 wpos, float jitter, float paint, float rimAmt, float soft, vec3 shTint){
  float br = brush(wpos, N);
  float t = dot(N, uSunDir) + (br - 0.5) * 0.32 * paint + jitter;
  float sv = shadowVis(wpos, N);
  // Skin (the only very soft material): cast shadows from hair/cap fall softly, no hard seams.
  if (soft > 0.12 || gSoftCast > 0.5) sv = mix(sv, 1.0, 0.45);
  float lit = smoothstep(0.02 - soft, 0.06 + soft, t) * sv;
  float mid = smoothstep(-0.5 - soft, -0.44 + soft, t);
  vec3 cLit = base * uSunColor;
  // High-albedo surfaces (blouse, plaster, socks) shade to a light, less saturated blue-grey so
  // they read as white-in-shade, never as holes or sky.
  float al = dot(base, vec3(0.2126, 0.7152, 0.0722));
  float chroma = max(base.r, max(base.g, base.b)) - min(base.r, min(base.g, base.b));
  float whiteK = smoothstep(0.35, 0.75, al) * (1.0 - smoothstep(0.12, 0.3, chroma));
  vec3 cSh = base * mix(shTint, vec3(0.37, 0.4, 0.52), whiteK);
  vec3 cDk = cSh * vec3(0.7, 0.72, 0.84);
  vec3 col = mix(cDk, cSh, max(mid, 1.0 - sv));
  col = mix(col, cLit, lit);
  col += base * uSkyMid * 0.1 * (N.y * 0.5 + 0.5);
  // Warm bounce light from the sunlit ground (the golden-hour warmth, without yellowing whites).
  col += base * vec3(0.07, 0.045, 0.02) * (0.5 - N.y * 0.5) * (1.0 - lit);
  vec3 V = normalize(cameraPosition - wpos);
  float fr = 1.0 - max(dot(N, V), 0.0);
  float rim = smoothstep(0.58, 0.72, fr) * rimAmt;
  float sunSide = smoothstep(-0.3, 0.3, dot(N, uSunDir) + 0.2) * (0.3 + 0.7 * sv);
  col += uRimColor * base * rim * (0.2 + 0.8 * sunSide) * 0.8;
  // Skin turning away from the camera takes one soft cel shade (far cheek in 3/4, jaw edges).
  if (gSoftCast > 0.5) col = mix(col, cSh, smoothstep(0.5, 0.58, fr) * 0.7);
  col *= 1.0 + (br - 0.5) * 0.14 * paint;
  return min(col, vec3(0.97));
}
vec3 toon(vec3 base, vec3 N, vec3 wpos, float jitter, float paint, float rimAmt, float soft){
  return toonT(base, N, wpos, jitter, paint, rimAmt, soft, uShadowTint);
}
`;

const OUT = /* glsl */ `
layout(location = 0) out vec4 gColor;
layout(location = 1) out vec4 gNormal;
uniform float uId;
uniform float uMask;
// Coverage for alpha-cut cards: with MSAA + alphaToCoverage this becomes a per-sample mask, so
// blade and leaf edges resolve smoothly instead of crawling as the camera moves.
float gAlpha = 1.0;
// Without MSAA, alpha-to-coverage has a single sample and turns partial alpha fully opaque
// (spoke blur disc, near leaf cards). Then a screen-fixed 4x4 ordered dither stands in for it.
const float BAYER4[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
void writeOut(vec3 col, vec3 wN, float mask){
  if (uDither > 0.5 && gAlpha < 0.999) {
    ivec2 q = ivec2(gl_FragCoord.xy) & 3;
    if (gAlpha * 16.0 <= BAYER4[q.y * 4 + q.x] + 0.5) discard;
    gAlpha = 1.0;
  }
  vec3 vn = normalize((viewMatrix * vec4(wN, 0.0)).xyz);
  gColor = vec4(col, gAlpha);
  gNormal = vec4(vn.xy * 0.5 + 0.5, uId / 32.0, mask);
}
`;

/** Leaf-cluster alpha shape on a 0..1 card: three overlapping pointed leaves (scalloped edge). */
export const LEAF_SHAPE = /* glsl */ `
float leafShape(vec2 uv){
  vec2 q = uv - 0.5;
  if (dot(q, q) < 0.15 * 0.15) return 1.0;
  // Seven pointed leaves (vesica outlines) of uneven length radiating from a small core: the
  // card edge reads as a serrated leaf cluster even when a near canopy fills the screen.
  for (int i = 0; i < 7; i++) {
    float fi = float(i);
    float ang = fi * 0.8976 + 0.3 + 0.25 * sin(fi * 2.7);
    vec2 dv = vec2(cos(ang), sin(ang));
    float L = 0.12 + 0.075 * fract(sin(fi * 12.9898) * 43758.5453);
    vec2 d = q - dv * (0.08 + L);
    float along = dot(d, dv), across = dot(d, vec2(-dv.y, dv.x));
    float k = 1.0 - along * along / (L * L);
    if (k > 0.0 && abs(across) < 0.062 * k) return 1.0;
  }
  return 0.0;
}
`;

// ------------------------------------------------------------------ uber toon

const UBER_VS = /* glsl */ `
${COMMON}
in float aMat;
in float aWind;
out vec3 vWPos;
out vec3 vN;
out vec3 vCol;
out vec2 vUv;
out vec3 vObj;
flat out int vMat;

vec3 windOffset(vec3 wp, float w){
  // Coherent wind: every blade leans the same way, and gust bands travel downwind.
  vec2 d = uWindDir;
  float along = dot(wp.xz, d);
  float wave = sin(along * 0.22 - uTime * 2.1) * 0.5 + 0.5;
  wave = wave * wave;
  float flutter = sin(uTime * 3.3 + dot(wp.xz, vec2(1.7, 2.3))) * 0.12;
  float gust = vnoise(wp.xz * 0.03 - d * uTime * 0.35);
  float k = 0.22 + wave * 0.55 + gust * 0.35 + flutter;
  vec3 o = vec3(d.x, 0.0, d.y) * k * w * 0.34;
  o.y = -w * k * k * 0.08;
  return o;
}

void main(){
  vec3 pos = position;
  mat4 m = modelMatrix;
#ifdef USE_INSTANCING
  m = modelMatrix * instanceMatrix;
#endif
  int mt = int(aMat + 0.5);
  vec3 ipos = m[3].xyz;
  float ph = hash12(floor(ipos.xz * 3.0)) * 6.2831;
  if (mt == 12) {
    float flap = sin(uTime * 16.0 + ph * 3.0) * 1.1;
    float ax = abs(pos.x);
    pos = vec3(sign(pos.x) * ax * cos(flap), pos.y + ax * sin(flap), pos.z);
  }
  vec4 wp = m * vec4(pos, 1.0);
  if (mt == 12) {
    float t = uTime * 0.8;
    wp.xyz += vec3(sin(t * 0.7 + ph) * 1.4 + sin(t * 1.9 + ph * 2.0) * 0.35,
                   sin(t * 1.3 + ph) * 0.3 + sin(t * 3.7 + ph) * 0.08,
                   cos(t * 0.5 + ph) * 1.4);
  }
  if (mt == 18) {
    // Drifting light motes / seed fluff in a box that wraps around the camera.
    vec3 base = ipos;
    base.xz += uWindDir * uTime * 0.6;
    base.y += sin(uTime * 0.4 + ph) * 0.6;
    vec3 rel = base - cameraPosition;
    rel.xz = mod(rel.xz + 18.0, 36.0) - 18.0;
    rel.y = mod(rel.y + 1.0, 7.0) - 1.0;
    vec3 c = cameraPosition + rel + vec3(0.0, 0.2, 0.0);
    // Camera-facing billboard; motes closer than ~5 m collapse (never big blobs on the lens).
    float near = smoothstep(4.0, 8.0, length(rel)) * (0.55 + 0.9 * hash12(ipos.xz * 7.1));
    vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    wp = vec4(c + (right * position.x + up * position.y) * near, 1.0);
  }
  if (aWind > 0.0) wp.xyz += windOffset(wp.xyz, aWind);
  if (aWind > 0.0 && uPush.w > 0.0) {
    vec2 pd = wp.xz - uPush.xy;
    float pl = length(pd);
    float pf = (1.0 - smoothstep(uPush.z * 0.35, uPush.z, pl)) * uPush.w;
    wp.xz += pd / max(pl, 1e-3) * pf * min(aWind, 1.0) * 0.45;
    wp.y -= pf * min(aWind, 1.0) * 0.12;
  }
  vWPos = wp.xyz;
  vN = normalize(mat3(m) * normal);
  vCol = color;
#ifdef USE_INSTANCING_COLOR
  vCol *= instanceColor;
#endif
  vUv = uv;
  vObj = position;
  vMat = mt;
  gl_Position = projectionMatrix * viewMatrix * wp;
  if (mt == 21 && uNoFringe > 0.5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
`;

const UBER_FS = /* glsl */ `
// Compile-time material set: branches for ids the mesh never carries fold away (smaller program,
// fewer registers, better occupancy). Default: every branch.
#ifndef MT_MASK_V
#define MT_MASK_V 0xFFFFFFFFu
#endif
const uint MT_MASK = MT_MASK_V;
#define HAS(x) ((MT_MASK & (1u << uint(x))) != 0u)
${COMMON}
${OUT}
${LEAF_SHAPE}
in vec3 vWPos;
in vec3 vN;
in vec3 vCol;
in vec2 vUv;
in vec3 vObj;
flat in int vMat;
// Per-material extras (see uberWith): bike lamp glow, spoke motion blur.
uniform float uLamp;
uniform float uBlur;

vec2 cellular(vec2 p){
  vec2 i = floor(p), f = fract(p); float d = 8.0; vec2 best = vec2(0.0);
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y));
    vec2 o = vec2(hash12(i + g), hash12(i + g + 17.3));
    vec2 r = g + o - f; float dd = dot(r, r);
    if (dd < d) { d = dd; best = g; }
  }
  return vec2(sqrt(d), hash12(i + best + 41.7));
}

// Anti-aliased periodic line of half-width hw (cell units) on every integer of x. Once cells shrink
// below a few pixels it fades to its average coverage instead of crawling (moiré / shimmer).
float aaLine(float x, float hw){
  float w = fwidth(x);
  float d = abs(fract(x + 0.5) - 0.5);
  float l = 1.0 - smoothstep(hw - w, hw + w, d);
  return mix(l, 2.0 * hw, smoothstep(0.2, 0.5, w));
}
float aaStep(float e, float x){ float w = fwidth(x) * 0.7 + 1e-5; return smoothstep(e - w, e + w, x); }
// Fine-detail fade: 1 while the pattern of frequency x is resolvable, 0 when it would alias.
float aaKeep(float x){ return 1.0 - smoothstep(0.15, 0.45, fwidth(x)); }

void main(){
  vec3 N = normalize(vN);
  if (!gl_FrontFacing && vMat != 17 && vMat != 21) N = -N;
  vec3 base = vCol;
  float paint = 1.0, rim = 0.55, soft = 0.03, jit = 0.0, leafHi = 0.0;
  bool card = false;
  vec3 emis = vec3(0.0);
  float mask = uMask;
  int mt = vMat;

  if ((HAS(20) && mt == 20)) {           // flower card: five rounded petals + a golden eye, alpha-cut
    vec2 d = vUv - 0.5;
    float r = length(d), th = atan(d.y, d.x);
    float petal = 0.3 + 0.16 * cos(th * 5.0);
    float edge = petal - r;
    float fa = clamp(edge / max(fwidth(edge), 1e-4) + 0.5, 0.0, 1.0);
    if (fa < 0.02) discard;
    gAlpha = fa;
    base = mix(vec3(0.95, 0.62, 0.08), base, smoothstep(0.08, 0.11, r)) * (0.85 + 0.3 * r / petal);
    N = normalize(mix(N, vec3(0.0, 1.0, 0.0), 0.5));
    mask = -1.0; paint = 0.3; rim = 0.3;
  }
  float leafTone = -1.0, leafVar = 0.5;
  if ((HAS(17) && mt == 17) || (HAS(21) && mt == 21)) { // leaf card: painted leaf cluster from the atlas (uv already in the atlas)
    vec4 lt = texture(uLeafTex, vUv);
    // Sharpen the mipmapped coverage to ~1 px, then hand it to alpha-to-coverage.
    float a = clamp((lt.a - 0.5) / max(fwidth(lt.a), 1e-3) + 0.5, 0.0, 1.0);
    if (a < 0.02) discard;
    gAlpha = a;
    leafTone = lt.r; leafVar = lt.g;
    mt = 1;
    mask = -1.0;
    card = true;
  }
  if ((HAS(1) && mt == 1)) {            // foliage: painted leaf clumps
    gFastShadow = true;
    vec3 an = abs(N);
    // Close to the camera the leaf cells get smaller and softer so they read as foliage, not facets.
    float nearK = 1.0 - smoothstep(5.0, 16.0, distance(vWPos, cameraPosition));
    vec2 p = (an.y > 0.55 ? vWPos.xz : (an.x > an.z ? vWPos.zy : vWPos.xy)) * mix(1.9, 4.2, nearK);
    // Second octave from cheap value noise (a second cellular lookup cost ~10% fps under canopies).
    float n2 = vnoise(p * 2.6 + 5.0);
    if (card) {
      // Cards already carry a leaf silhouette: value noise alone is enough (and cheap: they overlap).
      float n1 = vnoise(p * 1.1);
      jit = ((n1 - 0.5) * 0.8 + (n2 - 0.5) * 0.3) * mix(1.0, 0.6, nearK);
      leafHi = smoothstep(0.62, 0.9, n2) * 0.6;
    } else {
      vec2 c = cellular(p);
      jit = ((c.y - 0.5) * 0.7 + (n2 - 0.5) * 0.3 - smoothstep(0.5, 0.95, c.x) * 0.3) * mix(1.0, 0.6, nearK);
      leafHi = smoothstep(0.62, 0.9, n2) * (1.0 - smoothstep(0.3, 0.8, c.x));
      // Canopy surface painted with atlas leaves in two overlapping world-space layers (textureGrad
      // keeps the mip choice continuous across the fract() wrap: no seam lines).
      vec2 wp = (an.y > 0.55 ? vWPos.xz : (an.x > an.z ? vWPos.zy : vWPos.xy)) * 1.35;
      vec2 wq = mat2(0.8, -0.6, 0.6, 0.8) * wp * 1.6 + 3.7;
      vec2 cA = vec2(0.0, 0.5), cB = vec2(0.5, 0.0); // ovate + small-leaf cells
      vec4 la = textureGrad(uLeafTex, cA + fract(wp) * 0.5, dFdx(wp) * 0.5, dFdy(wp) * 0.5);
      vec4 lb = textureGrad(uLeafTex, cB + fract(wq) * 0.5, dFdx(wq) * 0.5, dFdy(wq) * 0.5);
      float ka = smoothstep(0.35, 0.65, la.a), kb = smoothstep(0.35, 0.65, lb.a);
      leafTone = mix(mix(0.1, lb.r * 0.85, kb), la.r, ka);
      leafVar = mix(lb.g, la.g, ka);
    }
    // Grey light probe: the canopy palette is applied to the toon light response below.
    base = vec3(0.25);
    // Low paint/jitter: thresholding smooth noise draws its isolines, which read as concentric
    // contour rings on a near bush. The painted leaves carry the texture instead.
    if (!card) jit *= 0.55;
    paint = card ? 0.25 : 0.4; rim = 0.5;
    // Cards brushing past the lens fade out through coverage instead of popping at the near plane.
    if (card) gAlpha *= smoothstep(0.25, 0.9, distance(vWPos, cameraPosition));
  } else if ((HAS(2) && mt == 2)) {     // dark stained vertical wall boards
    vec2 tg = normalize(vec2(-N.z, N.x) + 1e-4);
    float s = dot(vWPos.xz, tg);
    float bx = s / 0.21;
    float board = floor(bx);
    // Per-board tone, seams, fine vertical grain and the odd knot (all fade before they alias).
    float tone = 0.88 + 0.2 * hash12(vec2(board, 3.7));
    float grain = (vnoise(vec2(s * 55.0, vWPos.y * 1.6 + board * 7.0)) - 0.5) * 0.22 * aaKeep(s * 55.0);
    vec2 kp = vec2(fract(bx) - 0.5, fract(vWPos.y * 0.6 + hash12(vec2(board, 9.1))) - 0.5) * vec2(0.21, 1.66);
    float knot = (1.0 - smoothstep(0.012, 0.03, length(kp))) * step(0.7, hash12(vec2(board, floor(vWPos.y * 0.6))));
    base *= tone * (1.0 + grain) * (1.0 - 0.45 * aaLine(bx, 0.045)) * (1.0 - knot * 0.35 * aaKeep(bx * 8.0));
    // Weathering: darker and mossier toward the stone footing.
    base = mix(base, base * vec3(0.8, 0.9, 0.7), (1.0 - smoothstep(0.3, 1.0, vWPos.y)) * 0.6);
    paint = 0.5;
  } else if ((HAS(3) && mt == 3)) {     // kawara roof tiles (uv in metres): ribs down the slope, course lines
    vec2 t = vec2(vUv.x / 0.25, vUv.y / 0.28);
    vec2 id = floor(t);
    float cu = fract(t.x);
    float rib = 0.5 + 0.5 * sin(cu * 6.2831);
    float var = 0.85 + 0.3 * hash12(id);
    base = mix(vec3(0.0144, 0.0185, 0.0203), vec3(0.0409, 0.0529, 0.0612), rib) * (vCol.r > 0.5 ? 1.0 : 0.9) * var;
    // Each course's lower lip: dark gap then a lit rounded edge, anti-aliased.
    float lip = aaLine(t.y, 0.06);
    float edge = aaLine(t.y - 0.1, 0.05);
    base *= (1.0 - 0.55 * lip) * (1.0 + 0.7 * edge * rib);
    // Lichen / weathering blooms, stronger toward the eaves (low uv.y is the gutter edge).
    float lich = smoothstep(0.62, 0.8, vnoise(vUv * 3.1 + 11.0)) * (1.0 - smoothstep(0.0, 2.2, vUv.y) * 0.6);
    base = mix(base, vec3(0.12, 0.13, 0.07), lich * 0.5);
    paint = 0.4; rim = 1.2;
  } else if ((HAS(4) && mt == 4)) {     // shoji: matte cream paper in a wooden lattice (daylight, no glow)
    float frame = max(aaLine(vUv.x * 5.0, 0.045), aaLine(vUv.y * 4.0, 0.04));
    frame = max(frame, 1.0 - aaStep(0.03, vUv.x) * aaStep(0.03, vUv.y) * (1.0 - aaStep(0.97, vUv.x)) * (1.0 - aaStep(0.97, vUv.y)));
    float fib = (vnoise(vUv * vec2(40.0, 90.0)) - 0.5) * 0.08 * aaKeep(vUv.y * 90.0);
    base = mix(vec3(0.8, 0.72, 0.53) * (1.0 + fib), vec3(0.08, 0.05, 0.03), frame);
    paint = 0.3;
    gEmit = vec3(1.0, 0.64, 0.32) * (1.0 - frame) * uNight * step(0.3, hash12(floor(vWPos.xz / 6.0))) * 0.9;
  } else if ((HAS(5) && mt == 5)) {     // glass: dark interior, sky sheen streak, faint warm depth
    float frame = max(aaLine(vUv.x * 3.0, 0.03), aaLine(vUv.y * 2.0, 0.025));
    frame = max(frame, 1.0 - aaStep(0.04, vUv.x) * (1.0 - aaStep(0.96, vUv.x)));
    // One broad soft sheen (a sharp repeating stripe shimmered as the camera moved).
    float streak = 1.0 - smoothstep(0.0, 0.35, abs(vUv.x * 0.8 + vUv.y * 0.6 - 0.75));
    vec3 glass = vec3(0.03, 0.045, 0.05) + uSkyMid * 0.16 * streak + vec3(0.12, 0.07, 0.03) * (1.0 - vUv.y) * 0.5;
    base = mix(glass, vec3(0.06, 0.04, 0.025), frame);
    paint = 0.2; rim = 0.0;
    gEmit = vec3(1.0, 0.6, 0.3) * (1.0 - frame) * uNight * step(0.45, hash12(floor(vWPos.xz / 6.0) + 3.1)) * 0.7;
  } else if ((HAS(6) && mt == 6)) {     // grass blades: soft up-facing normals, no ink
    N = normalize(mix(N, vec3(0.0, 1.0, 0.0), 0.7));
    // Cool dense grass: offset the warm sun so lit tips land near the authored #6f9a3e.
    base *= vec3(1.0, 1.22, 1.75);
    // Wind-sway bands: tips brighten where the travelling gust wave (same as windOffset) leans them.
    float wv = sin(dot(vWPos.xz, uWindDir) * 0.22 - uTime * 2.1) * 0.5 + 0.5;
    base *= 1.0 + smoothstep(0.5, 1.0, wv) * clamp(vObj.y * 1.3 - 0.25, 0.0, 1.0) * 0.28;
    paint = 0.8; rim = 0.7; soft = 0.06;
    mask = -1.0;
  } else if ((HAS(7) && mt == 7)) {     // skin: a single clean cel step, soft cast shadows
    paint = 0.0; soft = 0.065; rim = 0.5; gSoftCast = 1.0;
  } else if ((HAS(22) && mt == 22)) {    // glasses acetate: flat, clean, no brush strokes
    paint = 0.0; soft = 0.02; rim = 0.0;
  } else if ((HAS(8) && mt == 8)) {     // cloth
    paint = 0.6; rim = 0.7;
  } else if ((HAS(9) && mt == 9)) {     // bark / weathered wood
    base *= 0.85 + 0.25 * vnoise(vec2(atan(vObj.x, vObj.z) * 3.0, vWPos.y * 0.7) * 2.0);
    paint = 1.2;
  } else if ((HAS(10) && mt == 10)) {    // painted metal / signs
    paint = 0.3; rim = 0.5;
  } else if ((HAS(26) && mt == 26) || (HAS(29) && mt == 29)) { // chrome / glossy enamel: finished after the toon pass
    paint = (HAS(26) && mt == 26) ? 0.0 : 0.2; rim = 0.3; soft = 0.02;
  } else if ((HAS(27) && mt == 27)) {    // lamp lens: glassy by day, glows with uLamp
    float fr = 1.0 - max(dot(N, normalize(cameraPosition - vWPos)), 0.0);
    base = mix(base, vec3(0.92, 0.93, 0.9), 0.25 + 0.5 * fr * fr);
    emis = vec3(1.0, 0.84, 0.55) * uLamp * 2.6;
    paint = 0.0; rim = 0.0;
  } else if ((HAS(28) && mt == 28)) {    // spokes (uv.y 0) giving way to a soft motion-blur disc (uv.y 1) with speed
    if (vUv.y > 0.5) {
      float r = length(vObj.yz);
      gAlpha = uBlur * (0.24 + 0.05 * smoothstep(0.08, 0.26, r));
      N = normalize(mix(N, vec3(0.0, 1.0, 0.0), 0.5));
      mask = -1.0;
    } else gAlpha = 1.0 - uBlur;
    if (gAlpha < 0.03) discard;
    paint = 0.0; rim = 0.4; soft = 0.02;
  } else if ((HAS(11) && mt == 11)) {    // ground: grass meadow paint
    float n = fbm2(vWPos.xz * 0.11);
    float fl = hash12(floor(vWPos.xz * 2.3));
    base *= 0.82 + 0.36 * n;
    base = mix(base, base * vec3(1.2, 1.2, 0.8), step(0.93, fl) * 0.5);
    paint = 1.6; rim = 0.0;
  } else if ((HAS(12) && mt == 12)) {    // butterfly (bright, unshaded)
    gColor = vec4(applyFog(base * 0.92, vWPos), 1.0);
    gNormal = vec4(0.5, 0.5, uId / 32.0, -1.0);
    return;
  } else if ((HAS(13) && mt == 13)) {    // stone
    base *= 0.8 + 0.35 * vnoise(vWPos.xz * 4.0 + vWPos.y * 3.0);
    paint = 1.4;
  } else if ((HAS(23) && mt == 23) || (HAS(24) && mt == 24)) { // painted signage from the atlas; 24 = lit (vending, phone)
    vec4 sg = texture(uSignTex, vUv);
    if (sg.a < 0.5) discard;
    base = sg.rgb * vCol;
    paint = 0.12; rim = 0.3; soft = 0.05;
    if ((HAS(24) && mt == 24)) emis = base * 0.28;
    // Dusk: lit panels (vending, phone) glow; painted shop signs catch a little lamplight.
    gEmit = base * uNight * ((HAS(24) && mt == 24) ? 0.7 : 0.18);
  } else if ((HAS(25) && mt == 25)) {    // plaster: rain streaks under the eaves, grime toward the ground
    vec2 tg = normalize(vec2(-N.z, N.x) + 1e-4);
    float sx = dot(vWPos.xz, tg);
    float st = vnoise(vec2(sx * 7.0, vWPos.y * 0.35)) * vnoise(vec2(sx * 2.3 + 4.0, 1.0));
    base *= 1.0 - 0.16 * smoothstep(0.3, 0.6, st) * aaKeep(sx * 7.0);
    base *= mix(0.84, 1.0, smoothstep(0.2, 1.4, vObj.y));
    paint = 0.7;
  } else if ((HAS(14) && mt == 14)) {    // paper lantern (soft, never a lamp in daylight)
    emis = base * 0.18;
    // Albedo-driven: paper lanterns bloom, dark shop interiors stay a warm dim glow.
    gEmit = (base * 2.2 + vec3(0.26, 0.14, 0.05)) * uNight;
    paint = 0.3;
  } else if ((HAS(15) && mt == 15)) {    // hair: strand highlights
    float s = vnoise(vec2(atan(vObj.x, vObj.z) * 9.0, vObj.y * 3.0));
    base *= 0.85 + 0.3 * s;
    paint = 0.3; rim = 1.4; soft = 0.02;
  } else if ((HAS(16) && mt == 16)) {    // yellow/black pole guard
    float st = aaStep(0.5, fract(vWPos.y * 2.2 + atan(vObj.x, vObj.z) * 0.16));
    base = mix(vec3(0.02, 0.02, 0.02), vec3(0.9, 0.62, 0.04), st);
    paint = 0.3;
  } else if ((HAS(18) && mt == 18)) {    // light mote
    vec2 d = vUv - 0.5;
    float a = 1.0 - smoothstep(0.2, 0.5, length(d));
    if (a < 0.5) discard;
    // Only float in the shade under canopies and eaves, low down: sunbeam dust, never sky specks.
    float shade = 1.0 - shadowVis(vec3(vWPos.x, 0.0, vWPos.z), vec3(0.0, 1.0, 0.0));
    if (shade < 0.5 || vWPos.y > 5.0) discard;
    // ~60% coverage (the Kuwahara pass melts the dither into a soft glow).
    if (hash12(floor(gl_FragCoord.xy)) > 0.6) discard;
    gColor = vec4(vec3(1.0, 0.9, 0.62) * 1.02 * uWorldTint, 1.0);
    gNormal = vec4(0.5, 0.5, uId / 32.0, -1.0);
    return;
  } else if ((HAS(31) && mt == 31)) {    // stone-lantern fire box: dark by day, a warm flame at dusk
    gEmit = vec3(1.0, 0.58, 0.24) * uNight * 2.2;
  } else if ((HAS(30) && mt == 30)) {    // lamp / vending / sign panel: plain paint by day, lit at night
    paint = 0.3; rim = 0.5;
    gEmit = mix(base, vec3(1.0, 0.93, 0.8), 0.35) * uNight * 1.3;
  } else if ((HAS(19) && mt == 19)) {    // painted distant mountains: authored colour, soft top-lit gradient
    float h = clamp(vObj.y / 160.0, 0.0, 1.0);
    vec3 c = base * (0.9 + 0.18 * h) * (0.94 + 0.12 * brush(vWPos * 0.05, N));
    vec3 V = normalize(vWPos - cameraPosition);
    c = mix(c * uFarTint, skyColor(normalize(vec3(V.x, 0.02, V.z))), 0.25 * (1.0 - h) + uFarHaze * (1.0 - 0.5 * h));
    gColor = vec4(c, 1.0);
    gNormal = vec4(0.5, 0.5, uId / 32.0, uMask);
    return;
  }

  // Skin shades warm (peach/rose) instead of the cool environment shadow.
  // Skin shades to a soft pink-lavender instead of the cool environment shadow.
  vec3 shT = (HAS(7) && mt == 7) ? vec3(0.9, 0.75, 0.7) : (HAS(15) && mt == 15) ? vec3(0.42, 0.4, 0.38) : uShadowTint;
  if ((HAS(7) && mt == 7)) jit += 0.34;
  vec3 col = toonT(base, N, vWPos, jit, paint, rim, soft, shT) + emis;
  if ((HAS(26) && mt == 26) || (HAS(29) && mt == 29)) {
    // Faked reflections: no env map, just the sky gradient over a dark ground with a crisp horizon
    // (chrome), or a sun-and-sky highlight streak (enamel). Bands thinner than a pixel fade out
    // instead of sparkling along thin tubes.
    vec3 V = normalize(cameraPosition - vWPos);
    vec3 R = reflect(-V, N);
    float lumB = dot(base * uSunColor, vec3(0.2126, 0.7152, 0.0722));
    float L = clamp(dot(col, vec3(0.2126, 0.7152, 0.0722)) / max(lumB, 1e-4), 0.0, 1.0);
    float fw = max(fwidth(R.y), 1e-4);
    float keep = clamp(0.05 / fw, 0.0, 1.0);
    if ((HAS(26) && mt == 26)) {
      vec3 sky = mix(uSkyHorizon, uSkyMid, smoothstep(0.08, 0.6, R.y));
      sky = mix(sky, uSkyZenith, smoothstep(0.6, 1.0, R.y));
      // Silver, not teal: the sky only tints the reflection.
      sky = mix(vec3(dot(sky, vec3(0.2126, 0.7152, 0.0722))), sky, 0.45) * 1.08;
      vec3 env = mix(vec3(0.2, 0.175, 0.15) * (0.75 + 0.25 * smoothstep(-0.8, 0.0, R.y)), sky, smoothstep(-fw, fw, R.y + 0.02));
      float band = 1.0 - smoothstep(0.045, 0.045 + fw * 1.5, abs(R.y - 0.09));
      env += vec3(1.0, 0.97, 0.9) * band * keep * 0.7;
      col = env * base * mix(0.5, 1.0, L);
      float sd = dot(R, uSunDir);
      float sfw = max(fwidth(sd), 1e-4);
      col += vec3(1.0, 0.95, 0.85) * smoothstep(0.975 - sfw, 0.975 + sfw, sd) * L * keep * 0.8;
    } else {
      vec3 S = normalize(uSunDir + vec3(0.0, 0.7, 0.0));
      float sd = dot(R, S);
      float sfw = max(fwidth(sd), 1e-4);
      float hi = smoothstep(0.93 - sfw, 0.93 + sfw, sd) * clamp(0.04 / sfw, 0.0, 1.0);
      col += base * uSkyMid * 0.35 * smoothstep(0.1, 0.9, R.y);
      col = mix(col, vec3(0.97, 0.93, 0.88), hi * mix(0.35, 0.8, L));
    }
  }
  if ((HAS(1) && mt == 1)) {
    // Canopy palette over the probe's light response: deep blue-green core (#1b3a2a), near-black
    // band on the far side (#10211d), sunlit clusters (#4f7d3a) only on the sun-facing upper shell.
    vec3 Lr = col * 4.0;
    float sunLit = smoothstep(0.35, 0.8, (Lr.r - uShadowTint.r) / max(uSunColor.r - uShadowTint.r, 0.05));
    float ndl = dot(N, uSunDir);
    vec3 cCore = vec3(0.0103, 0.0423, 0.0232);
    vec3 tintK = mix(vec3(1.0), clamp(vCol / cCore, 0.5, 1.8), 0.6);
    float v = 0.86 + jit * 0.3;
    vec3 core = cCore * tintK * v;
    vec3 band = vec3(0.0056, 0.0152, 0.0122) * tintK;
    vec3 sunC = vec3(0.078, 0.205, 0.042) * tintK * (1.02 + jit * 0.25);
    float farSide = max(smoothstep(-0.2, -0.55, ndl + jit * 0.35), smoothstep(-0.3, -0.8, N.y + jit * 0.25) * 0.2);
    float upper = smoothstep(0.05, 0.5, N.y + ndl * 0.3 + jit * 0.35);
    float clump = smoothstep(0.42, 0.62, vnoise(vWPos.xz * 0.55 + vWPos.y * 0.45) * 0.7 + (jit + 0.5) * 0.3);
    float litC = sunLit * upper * clump;
    vec3 c = mix(core, band, farSide);
    c += core * uSkyMid * 0.5 * max(N.y, 0.0) * (1.0 - litC);
    // Undersides seen from the road: clumpy variation + faint warm ground bounce, never a flat void.
    float under = smoothstep(-0.1, -0.7, N.y);
    c *= 1.0 + under * (clump * 0.6 - 0.1);
    c += vec3(0.012, 0.02, 0.008) * under * (0.5 + jit);
    c = mix(c, sunC, litC);
    c = mix(c, vec3(0.12, 0.25, 0.055), leafHi * litC * 0.45);
    if (leafTone >= 0.0) {
      // Painted leaves: 3-4 tones per leaf (dark core, shaded half, lit half, sunlit edge), with a
      // little hue drift per leaf. Shade + sun response stays from the canopy model above.
      c *= mix(0.5, 1.45, leafTone) * (0.9 + 0.22 * leafVar);
      c = mix(c, sunC * vec3(1.18, 1.12, 0.9), litC * smoothstep(0.62, 0.92, leafTone) * 0.55);
      c = mix(c, c * vec3(1.05, 1.1, 0.72), (leafVar - 0.5) * 0.35);
    }
    col = c;
  }
  col = applyFog(col, vWPos);
  writeOut(col, N, mask);
}
`;

const uberCache = new Map<string, THREE.ShaderMaterial>();

/**
 * Uncached uber material with its own extra uniforms (e.g. uLamp, uBlur) for a single object;
 * the shared G uniforms stay shared, so it compiles to the same program as `uber`.
 */
export function uberWith(id: number, mask: number, extra: Record<string, THREE.IUniform>): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: { ...G, uId: { value: id }, uMask: { value: mask }, ...extra },
    vertexShader: UBER_VS,
    fragmentShader: UBER_FS,
    vertexColors: true,
    alphaToCoverage: true,
  });
}

/**
 * Shared toon material. `id` = outline group (edges drawn between groups), `mask` = line weight,
 * `mts` = bit set of surface ids (M.*) the geometry uses (0 = all; see specializeUber).
 */
export function uber(id: number, mask = 1, side: THREE.Side = THREE.FrontSide, mts = 0): THREE.ShaderMaterial {
  const key = `${id}|${mask}|${side}|${mts >>> 0}`;
  let m = uberCache.get(key);
  if (!m) {
    m = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: { ...G, uId: { value: id }, uMask: { value: mask } },
      vertexShader: UBER_VS,
      fragmentShader: UBER_FS,
      defines: mts ? { MT_MASK_V: `0x${(mts >>> 0).toString(16)}u` } : {},
      vertexColors: true,
      side,
      alphaToCoverage: true,
    });
    m.userData.uber = { id, mask, side };
    uberCache.set(key, m);
  }
  return m;
}

/** Bit set of the surface ids (aMat) a geometry carries. */
export function surfaceBits(g: THREE.BufferGeometry): number {
  const a = g.attributes.aMat as THREE.BufferAttribute | undefined;
  if (!a) return 0xffffffff;
  let bits = 0;
  for (let i = 0; i < a.count; i++) bits |= 1 << Math.round(a.getX(i));
  return bits >>> 0;
}

/**
 * Swap every generic uber material under `root` for a variant compiled with only the surface
 * branches its meshes use. One variant per material (union over all meshes sharing it), so the
 * program count stays small. `extra(o)` can add geometries a mesh may switch to (LODs).
 */
export function specializeUber(root: THREE.Object3D, extra?: (o: THREE.Mesh) => THREE.BufferGeometry[]): number {
  const users = new Map<THREE.ShaderMaterial, { bits: number; meshes: THREE.Mesh[] }>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mat = m.material as THREE.ShaderMaterial;
    if (!mat?.userData?.uber || mat.defines?.MT_MASK_V) return;
    const e = users.get(mat) ?? { bits: 0, meshes: [] };
    e.bits |= surfaceBits(m.geometry);
    for (const g of extra?.(m) ?? []) e.bits |= surfaceBits(g);
    e.meshes.push(m);
    users.set(mat, e);
  });
  for (const [mat, e] of users) {
    const { id, mask, side } = mat.userData.uber;
    // Leaf cards (17, 21) continue down the foliage (1) branch.
    if (e.bits & ((1 << 17) | (1 << 21))) e.bits |= 1 << 1;
    const v = uber(id, mask, side, e.bits | 1);
    for (const m of e.meshes) m.material = v;
  }
  return users.size;
}

/** Depth-only material for the sun shadow pass (instancing-aware, leaf cards alpha-cut). */
export function shadowDepthMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    side: THREE.DoubleSide,
    uniforms: { uLeafTex: G.uLeafTex },
    vertexShader: /* glsl */ `
      in float aMat;
      out vec2 vUv; flat out int vMat;
      void main(){
        mat4 m = modelMatrix;
      #ifdef USE_INSTANCING
        m = modelMatrix * instanceMatrix;
      #endif
        vUv = uv; vMat = int(aMat + 0.5);
        gl_Position = projectionMatrix * viewMatrix * m * vec4(position, 1.0);
        if (vMat == 21) gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // fringe cards: no shadow, clipped
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uLeafTex;
      in vec2 vUv; flat in int vMat;
      layout(location = 0) out vec4 o;
      void main(){
        if (vMat == 17 && texture(uLeafTex, vUv).a < 0.5) discard;
        if (vMat == 28 && vUv.y > 0.5) discard; // spoke motion-blur disc casts no shadow
        o = vec4(1.0);
      }`,
  });
}

// ------------------------------------------------------------------ sky dome

export function skyMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: { ...G, uId: { value: 0 }, uMask: { value: 0 } },
    side: THREE.BackSide,
    depthWrite: false,
    vertexShader: /* glsl */ `
      out vec3 vWPos;
      void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vWPos = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: /* glsl */ `
      ${COMMON}
      ${OUT}
      in vec3 vWPos;
      void main(){
        vec3 dir = normalize(vWPos - cameraPosition);
        vec3 col = skyColor(dir);
        // Thin cirrus wisps high up.
        float h = max(dir.y, 0.02);
        vec2 p = dir.xz / h * 0.6;
        float w = fbm2(p * vec2(0.5, 2.6) + vec2(uTime * 0.004, 0.0));
        float wisp = smoothstep(0.6, 0.8, w) * smoothstep(0.12, 0.3, dir.y) * (1.0 - smoothstep(0.55, 0.95, dir.y));
        col = mix(col, uWisp, wisp * 0.5);
        float cd = dot(dir, uSkySun);
        if (cd > 0.9) {
          // Sun disk with a soft halo (HDR: the bloom pass turns it into a glow).
          float disk = smoothstep(0.99972, 0.99982, cd);
          col += uSunDisk * (disk + pow(cd, 1400.0) * 0.45 + pow(cd, 160.0) * 0.1);
        }
        if (uStars > 0.0 && dir.y > 0.04) {
          // Soft painted stars (big enough to survive the paint filter), twinkling slowly.
          vec2 sp = dir.xz / (1.0 + dir.y) * 70.0;
          vec2 ci = floor(sp);
          float hs = hash12(ci);
          vec2 off = vec2(hash12(ci + 3.1), hash12(ci + 7.7)) * 0.6 + 0.2;
          float d = length(fract(sp) - off);
          float tw = 0.65 + 0.35 * sin(uTime * (0.8 + hs * 2.5) + hs * 40.0);
          float star = step(0.94, hs) * (1.0 - smoothstep(0.03, 0.11 + 0.08 * fract(hs * 17.0), d)) * tw;
          col += vec3(0.95, 0.95, 1.0) * star * uStars * smoothstep(0.04, 0.3, dir.y) * (1.0 - wisp * 0.8);
        }
        gColor = vec4(col, 1.0);
        gNormal = vec4(0.5, 0.5, 0.0, 0.0);
      }`,
  });
}

// ------------------------------------------------------------------ cumulus clouds

export function cloudMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: { ...G, uId: { value: 0 }, uMask: { value: 0 } },
    vertexShader: /* glsl */ `
      in float aH;
      in vec3 aLobe;
      out vec3 vWPos; out vec3 vN; out vec3 vL; out float vH;
      void main(){
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWPos = wp.xyz; vN = normalize(mat3(modelMatrix) * normal); vH = aH;
        vL = mat3(modelMatrix) * (position - aLobe);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      ${COMMON}
      ${OUT}
      in vec3 vWPos; in vec3 vN; in vec3 vL; in float vH;
      void main(){
        // Per-lobe shading: each puff is lit like its own ball, blended with the merged normal.
        vec3 N = normalize(mix(normalize(vN), normalize(vL), 0.55));
        float n = vnoise3(vWPos * 0.02) * 0.6 + vnoise3(vWPos * 0.06) * 0.4;
        float t = dot(N, uSkySun) * 0.5 + 0.5 + (n - 0.5) * 0.3 + (vH - 0.4) * 0.25;
        float lit = smoothstep(0.5, 0.54, t);
        float mid = smoothstep(0.3, 0.34, t);
        vec3 cTop = uCloudTop, cMid = uCloudMid, cLow = uCloudLow;
        // Underside (facing down or low in the cloud) always sits in the cool tone.
        float under = smoothstep(0.15, -0.35, N.y) * (1.0 - smoothstep(0.1, 0.35, vH));
        vec3 col = mix(cLow, cMid, mid);
        col = mix(col, cTop, lit);
        col = mix(col, cLow, under * 0.85);
        vec3 V = normalize(cameraPosition - vWPos);
        if (uCloudK.z > 0.0) {
          // Low sun: undersides and low flanks catch warm light, strongest on the sunward side.
          float sAz = dot(normalize(-V.xz + 1e-5), normalize(uSkySun.xz + 1e-5)) * 0.5 + 0.5;
          float low = clamp(under + (1.0 - smoothstep(0.0, 0.55, vH)) * 0.6, 0.0, 1.0);
          col = mix(col, uCloudUnder, uCloudK.z * low * (0.3 + 0.7 * sAz));
        }
        float fr = pow(1.0 - abs(dot(N, V)), 3.0);
        float sunSide = smoothstep(-0.2, 0.4, dot(N, uSkySun));
        col = mix(col, uCloudRim, fr * uCloudK.x * sunSide);   // #fff6e0 rim
        // Backlit silver lining toward a low sun.
        col += uCloudRim * fr * uCloudK.y * pow(max(dot(-V, uSkySun), 0.0), 3.0);
        vec3 dir = -V;
        col = mix(col, skyColor(dir), smoothstep(0.1, 0.0, dir.y) * 0.7 + 0.05);
        gColor = vec4(col, 1.0);
        gNormal = vec4(0.5, 0.5, 0.0, 0.0);
      }`,
  });
}

// ------------------------------------------------------------------ flooded paddies

export const REFL = {
  uRefl: { value: null as THREE.Texture | null },
  uReflMat: { value: new THREE.Matrix4() },
  uReflOn: { value: 0 },
  uReflY: { value: -0.25 },
};

export function waterMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: { ...G, ...REFL, uId: { value: 2 }, uMask: { value: 0 } },
    vertexShader: /* glsl */ `
      in float aP;
      out vec3 vWPos; out vec2 vUv; out float vP;
      void main(){
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWPos = wp.xyz; vUv = uv; vP = aP;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      ${COMMON}
      ${OUT}
      uniform sampler2D uRefl; uniform mat4 uReflMat; uniform float uReflOn; uniform float uReflY;
      in vec3 vWPos; in vec2 vUv; in float vP;
      // Young rice tuft in its vertical sheet: three tapering blades from one root, the centre
      // upright and two leaning out (V). x = lateral metres from the root, y = height above water.
      float riceBlades(float x, float y, float H, vec2 rnd, float aa){
        float cov = 0.0;
        for (int k = 0; k < 3; k++){
          float fk = float(k) - 1.0;
          float bh = H * (k == 1 ? 1.0 : 0.72 + 0.2 * rnd.x);
          float t = y / bh;
          if (t > 1.0) continue;
          float lean = fk * (0.36 + 0.24 * rnd.y) + (rnd.x - 0.5) * 0.14;
          float xc = lean * bh * t * (0.5 + 0.5 * t);
          float w = 0.013 * (1.0 - t * 0.88) + 0.0012;
          float we = max(w, aa);
          cov = max(cov, clamp((we - abs(x - xc)) / aa + 0.5, 0.0, 1.0) * (w / we));
        }
        return cov;
      }
      // Walk one family of vertical tuft sheets (planes a = (k+.5)*pa, tufts every pb along b) from
      // the camera side of the view ray down to the water. Returns (coverage, mean height fraction).
      vec2 riceSheet(float a0, float b0, float Da, float Db, float vy, float tmax, float H, float pa, float pb, bool swap, float aa){
        if (abs(Da) < 1e-4) return vec2(0.0);
        float s = sign(Da);
        float a1 = a0 + Da * tmax;
        float k = s > 0.0 ? floor(a1 / pa - 0.5) : ceil(a1 / pa - 0.5);
        float acc = 0.0, yf = 0.0;
        for (int n = 0; n < 8; n++){
          float t = ((k + 0.5) * pa - a0) / Da;
          if (t < 0.0) break;
          float y = t * vy;
          float b = b0 + Db * t;
          float i = floor(b / pb);
          vec2 cell = swap ? vec2(k, i) : vec2(i, k);
          vec2 rnd = vec2(hash12(cell + 7.3), hash12(cell + 19.1));
          float h = H * (0.85 + 0.3 * rnd.y);
          float cov = hash12(cell + 3.7) < 0.1 ? 0.0 : riceBlades(b - (i + 0.5) * pb, y, h, rnd, aa);
          float w = (1.0 - acc) * cov;
          yf += w * min(y / h, 1.0);
          acc += w;
          if (acc > 0.97) break;
          k -= s;
        }
        return vec2(acc, acc > 0.0 ? yf / acc : 0.0);
      }
      void main(){
        vec3 V = normalize(vWPos - cameraPosition);
        vec2 q = vWPos.xz;
        float r1 = vnoise(q * 1.1 + vec2(uTime * 0.3, uTime * 0.2));
        float r2 = vnoise(q * 2.7 - vec2(uTime * 0.25, -uTime * 0.33));
        vec2 rip = vec2(r1 - 0.5, r2 - 0.5);
        vec3 Nw = normalize(vec3(rip.x * 0.07, 1.0, rip.y * 0.07));
        vec3 R = reflect(V, Nw);
        R.y = max(R.y, 0.015);
        vec3 refl = skyColor(normalize(R));
        if (uReflOn > 0.5) {
          // Planar mirror of the real scene (sky, clouds, trees, poles, fences), ripple-distorted.
          vec4 pc = uReflMat * vec4(vWPos.x, uReflY, vWPos.z, 1.0);
          vec2 uv = pc.xy / pc.w + rip * 0.012;
          refl = texture(uRefl, clamp(uv, 0.001, 0.999)).rgb;
        }
        float cosT = max(-V.y, 0.0);
        float fres = 0.3 + 0.7 * pow(1.0 - cosT, 5.0);
        vec3 mud = vec3(0.05, 0.065, 0.04);
        vec3 col = mix(mud, refl * 0.9, fres);
        // Sparkle on ripple crests.
        float sp = smoothstep(0.86, 0.95, vnoise(q * 6.0 + uTime * 0.8)) * fres;
        col += vec3(1.0, 0.95, 0.8) * sp * 0.25;
        if (uGlint > 0.0) {
          // Low sun on the water: a bright streak toward the sun, broken up by the ripples.
          float g = max(dot(R, uSkySun), 0.0);
          float br = 0.3 + 1.7 * smoothstep(0.5, 0.85, vnoise(q * vec2(2.2, 7.0) + vec2(uTime * 0.7, 0.0)));
          col += uSunDisk * (pow(g, 90.0) * br + pow(g, 12.0) * 0.04) * uGlint;
        }

        // Young rice on a 0.6 x 0.45 m grid: V-shaped three-blade tufts drawn as crossed vertical
        // sheets intersected along the view ray (real parallax, no geometry). The rows nearest the
        // road (u > -10.8) are 3D instanced rice; far away the tufts resolve into an average carpet.
        float growth = vP;
        float dist = length(vWPos - cameraPosition);
        float sv = shadowVis(vWPos, vec3(0.0, 1.0, 0.0));
        float H = 0.2 + 0.24 * growth;
        float farK = smoothstep(32.0, 70.0, dist);
        float drawn = step(vUv.x, -10.8);
        // uv.x = u = x - roadX(z): slope of that shear, so world ray offsets map into paddy uv.
        float e = vUv.x - vWPos.x;
        vec2 dzs = vec2(dFdx(vWPos.z), dFdy(vWPos.z));
        float sl = dot(vec2(dFdx(e), dFdy(e)), dzs) / max(dot(dzs, dzs), 1e-6);
        vec2 riceR = vec2(0.0);
        if (drawn > 0.5 && farK < 1.0) {
          vec2 D = vec2(-V.x - sl * V.z, -V.z);
          vec2 Dn = normalize(D + 1e-5);
          float vy = max(-V.y, 0.02);
          float tmax = H * 1.15 / vy;
          float aa = max(dist * 0.0011, 0.002);
          vec2 ra = riceSheet(vUv.y, vUv.x, D.y, D.x, vy, tmax, H, 0.45, 0.6, false, aa);
          vec2 rb = riceSheet(vUv.x, vUv.y, D.x, D.y, vy, tmax, H, 0.6, 0.45, true, aa);
          float cA = ra.x * smoothstep(0.2, 0.5, abs(Dn.y));
          float cB = rb.x * smoothstep(0.2, 0.5, abs(Dn.x));
          riceR = vec2(1.0 - (1.0 - cA) * (1.0 - cB), (cA * ra.y + cB * rb.y) / max(cA + cB, 1e-4));
        }
        float cov = mix(riceR.x, (0.32 + 0.3 * growth) * drawn, farK);
        float yf = mix(riceR.y, 0.55, farK);
        vec3 riceCol = mix(vec3(0.028, 0.072, 0.016), vec3(0.05, 0.147, 0.023), smoothstep(0.0, 0.4, yf));
        riceCol = mix(riceCol, vec3(0.2, 0.34, 0.075), smoothstep(0.55, 1.0, yf));
        riceCol *= (0.9 + 0.2 * vnoise(vWPos.xz * 0.9)) * mix(uShadowTint * 1.1, vec3(1.0, 0.97, 0.9), sv);
        col = mix(col * mix(0.75, 1.0, sv), riceCol, clamp(cov, 0.0, 0.95));
        col = applyFog(col, vWPos);
        writeOut(col, vec3(0.0, 1.0, 0.0), 0.0);
      }`,
  });
}

// ------------------------------------------------------------------ country road

export function roadMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: { ...G, uId: { value: 1 }, uMask: { value: 0.3 } },
    vertexShader: /* glsl */ `
      out vec3 vWPos; out vec2 vUv;
      void main(){
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWPos = wp.xyz; vUv = uv;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      ${COMMON}
      ${OUT}
      in vec3 vWPos; in vec2 vUv;
      vec2 cell(vec2 p){
        vec2 i = floor(p), f = fract(p); float d = 8.0, d2 = 8.0; float h = 0.0;
        for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
          vec2 g = vec2(float(x), float(y));
          vec2 o = vec2(hash12(i + g), hash12(i + g + 17.3));
          float dd = length(g + o - f);
          if (dd < d) { d2 = d; d = dd; h = hash12(i + g + 41.7); } else if (dd < d2) d2 = dd;
        }
        return vec2(d2 - d, h);
      }
      void main(){
        float u = vUv.x, v = vUv.y;
        float n = fbm2(vec2(u * 0.9, v * 0.3));
        float jag = (vnoise(vec2(v * 0.55, 3.0 + sign(u) * 9.0)) - 0.5) * 0.55 + (vnoise(vec2(v * 2.6, 7.0 + sign(u) * 5.0)) - 0.5) * 0.22;
        float au = abs(u) + jag;
        // Warm weathered asphalt.
        // Low-frequency warm/cool drift (#6c5e51 <-> #7a6a55) so the slab never reads as flat grey.
        float lf = fbm2(vec2(u * 0.18, v * 0.045) + 3.7);
        vec3 asph = mix(vec3(0.15, 0.114, 0.092), vec3(0.19, 0.145, 0.1), smoothstep(0.3, 0.7, lf));
        asph *= 0.9 + 0.2 * n;
        float sp = vnoise(vec2(u, v) * 6.0) * 0.6 + vnoise(vec2(u, v) * 17.0) * 0.4;
        asph *= 0.94 + 0.1 * sp;
        // Faint polished tyre tracks (slightly lighter, wavering).
        float tw = (vnoise(vec2(v * 0.08, 1.0)) - 0.5) * 0.3;
        float track = smoothstep(0.22, 0.0, abs(abs(u + tw) - 0.95)) * (0.6 + 0.4 * vnoise(vec2(u * 3.0, v * 0.5)));
        asph *= 1.0 + 0.09 * track;
        // Repair patches: soft-edged, subtle, irregular (no hard polygon facets).
        vec2 pc = cell(vec2(u * 0.7, v * 0.2) + vec2(vnoise(vec2(v * 0.3, u)) * 0.6, 0.0));
        float patchy = step(0.8, pc.y) * step(abs(u), 2.2) * smoothstep(0.02, 0.12, pc.x);
        asph *= mix(1.0, pc.y > 0.9 ? 0.9 : 1.06, patchy);
        float seam = (1.0 - smoothstep(0.0, 0.025, pc.x)) * step(0.8, pc.y) * step(abs(u), 2.2);
        asph *= 1.0 - seam * 0.18;
        // Darker worn/oily edges before the crumbling margin.
        asph *= 1.0 - 0.18 * smoothstep(1.5, 2.25, abs(u) + jag * 0.5);
        // Cracks: thin network, denser toward the crumbling edges.
        float cr = abs(vnoise(vec2(u * 2.4, v * 0.8) * 2.2) - 0.5);
        float edgeK = smoothstep(1.2, 2.3, abs(u));
        float crack = (1.0 - smoothstep(0.0, 0.01 + 0.01 * edgeK, cr)) * step(0.62 - 0.3 * edgeK, vnoise(vec2(u, v) * 0.35 + 4.0));
        asph *= 1.0 - crack * 0.35;
        // Faded, broken edge line remnant.
        float line = (1.0 - smoothstep(0.05, 0.08, abs(abs(u) - 2.05))) * step(0.45, vnoise(vec2(v * 0.25, sign(u) * 3.0)));
        line *= 0.16 * (0.4 + 0.6 * vnoise(vec2(u * 20.0, v * 3.0))) * step(0.5, vnoise(vec2(v * 1.7, u)));
        asph = mix(asph, vec3(0.62, 0.6, 0.55), line);
        vec3 dirt = mix(vec3(0.24, 0.19, 0.11), vec3(0.33, 0.27, 0.17), vnoise(vec2(u, v) * 1.8));
        vec3 grass = mix(vec3(0.04, 0.12, 0.035), vec3(0.07, 0.18, 0.045), fbm2(vWPos.xz * 0.11));
        vec3 base = asph;
        base = mix(base, dirt, smoothstep(2.3, 2.45, au));
        base = mix(base, grass, smoothstep(2.6, 2.95, au + (n - 0.5) * 0.4));
        vec3 N = vec3(0.0, 1.0, 0.0);
        vec3 col = toon(base, N, vWPos, 0.0, 1.0, 0.0, 0.03);
        if (uNight > 0.0) {
          // Warm pools under the pole lamps (every 40 m, hanging over the right lane).
          float dz = mod(vWPos.z + 32.0, 40.0) - 20.0, du = u - 2.8;
          gEmit = base * vec3(1.0, 0.72, 0.42) * exp(-(du * du * 0.35 + dz * dz * 0.12)) * uNight * 3.0;
        }
        col = applyFog(col, vWPos);
        writeOut(col, N, uMask * smoothstep(2.6, 3.2, au));
      }`,
  });
}
