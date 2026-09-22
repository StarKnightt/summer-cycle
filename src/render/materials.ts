import * as THREE from "three";

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
  uSunColor: { value: lin("#ffe0ad") },
  uShadowTint: { value: lin("#7f8fc4") },
  uSkyZenith: { value: lin("#127f9e") },
  uSkyMid: { value: lin("#2fa3c0") },
  uSkyHorizon: { value: lin("#bfe3e6") },
  uFogColor: { value: lin("#c6ddd8") },
  uFogDensity: { value: 0.0012 },
  uRimColor: { value: lin("#fff1d0") },
  uWindDir: { value: new THREE.Vector2(0.8, -0.6).normalize() },
  uShadowMap: { value: null as THREE.Texture | null },
  uShadowMat: { value: new THREE.Matrix4() },
  uShadowOn: { value: 0 },
  uShadowTexel: { value: new THREE.Vector2(1 / 2048, 1 / 2048) },
  uShadowRange: { value: 300 },
  uShadowCenter: { value: new THREE.Vector3() },
  uShadowHalf: { value: 55 },
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
uniform sampler2D uShadowMap;
uniform mat4 uShadowMat;
uniform float uShadowOn;
uniform vec2 uShadowTexel;
uniform float uShadowRange;
uniform vec3 uShadowCenter;
uniform float uShadowHalf;

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
  float sd = max(dot(dir, uSunDir), 0.0);
  col += vec3(1.0, 0.8, 0.5) * (pow(sd, 5.0) * 0.16 + pow(sd, 48.0) * 0.3);
  // Warm aerial haze hugging the horizon.
  col = mix(col, vec3(0.86, 0.84, 0.72), exp(-h * 26.0) * 0.45);
  return col;
}

vec3 applyFog(vec3 col, vec3 wpos){
  vec3 d = wpos - cameraPosition;
  float dist = length(d);
  float f = 1.0 - exp(-max(dist - 30.0, 0.0) * uFogDensity);
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
  return vnoise(q * vec2(1.1, 6.0)) * 0.6 + vnoise(q * vec2(2.3, 13.0)) * 0.4;
}

// Toon-thresholded shadow map: 1 = sunlit, 0 = in shadow. Canopy shadows get sun flecks.
float shadowVis(vec3 wpos, vec3 N){
  if (uShadowOn < 0.5) return 1.0;
  vec2 rel = abs(wpos.xz - uShadowCenter.xz);
  float edge = smoothstep(uShadowHalf * 0.82, uShadowHalf * 0.98, max(rel.x, rel.y));
  if (edge >= 1.0) return 1.0;
  vec3 p = wpos + N * 0.05 + uSunDir * 0.04;
  vec4 sc = uShadowMat * vec4(p, 1.0);
  vec3 s = sc.xyz / sc.w;
  if (s.x <= 0.0 || s.x >= 1.0 || s.y <= 0.0 || s.y >= 1.0 || s.z >= 1.0) return 1.0;
  // 3x3 bilinear PCF from a 4x4 texel footprint: smooth, stair-free edges.
  vec2 tc = s.xy / uShadowTexel - 0.5;
  vec2 f = fract(tc);
  vec2 b0 = (floor(tc) + 0.5) * uShadowTexel;
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
vec3 toonT(vec3 base, vec3 N, vec3 wpos, float jitter, float paint, float rimAmt, float soft, vec3 shTint){
  float br = brush(wpos, N);
  float t = dot(N, uSunDir) + (br - 0.5) * 0.32 * paint + jitter;
  float sv = shadowVis(wpos, N);
  float lit = smoothstep(0.02 - soft, 0.06 + soft, t) * sv;
  float mid = smoothstep(-0.5 - soft, -0.44 + soft, t);
  vec3 cLit = base * uSunColor;
  vec3 cSh = base * shTint;
  vec3 cDk = cSh * vec3(0.7, 0.72, 0.84);
  vec3 col = mix(cDk, cSh, max(mid, 1.0 - sv));
  col = mix(col, cLit, lit);
  col += base * uSkyMid * 0.1 * (N.y * 0.5 + 0.5);
  vec3 V = normalize(cameraPosition - wpos);
  float fr = 1.0 - max(dot(N, V), 0.0);
  float rim = smoothstep(0.58, 0.72, fr) * rimAmt;
  float sunSide = smoothstep(-0.3, 0.3, dot(N, uSunDir) + 0.2) * (0.3 + 0.7 * sv);
  col += uRimColor * base * rim * (0.2 + 0.8 * sunSide) * 0.8;
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
void writeOut(vec3 col, vec3 wN, float mask){
  vec3 vn = normalize((viewMatrix * vec4(wN, 0.0)).xyz);
  gColor = vec4(col, 1.0);
  gNormal = vec4(vn.xy * 0.5 + 0.5, uId / 32.0, mask);
}
`;

/** Leaf-cluster alpha shape on a 0..1 card: three overlapping pointed leaves (scalloped edge). */
export const LEAF_SHAPE = /* glsl */ `
float leafShape(vec2 uv){
  float a = 0.0;
  for (int i = 0; i < 3; i++) {
    float ang = float(i) * 2.1 + 0.4;
    vec2 c = vec2(0.5) + vec2(cos(ang), sin(ang)) * 0.17;
    vec2 d = uv - c;
    float ca = cos(ang), sa = sin(ang);
    d = mat2(ca, sa, -sa, ca) * d;
    // pointed ellipse
    float e = length(vec2(d.x * 2.2, d.y * 3.6)) + abs(d.x) * 1.4;
    a = max(a, 1.0 - smoothstep(0.62, 0.66, e));
  }
  return a;
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
    float near = smoothstep(4.0, 8.0, length(rel));
    vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    wp = vec4(c + (right * position.x + up * position.y) * near, 1.0);
  }
  if (aWind > 0.0) wp.xyz += windOffset(wp.xyz, aWind);
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
}
`;

const UBER_FS = /* glsl */ `
${COMMON}
${OUT}
${LEAF_SHAPE}
in vec3 vWPos;
in vec3 vN;
in vec3 vCol;
in vec2 vUv;
in vec3 vObj;
flat in int vMat;

vec2 cellular(vec2 p){
  vec2 i = floor(p), f = fract(p); float d = 8.0; float h = 0.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y));
    vec2 o = vec2(hash12(i + g), hash12(i + g + 17.3));
    vec2 r = g + o - f; float dd = dot(r, r);
    if (dd < d) { d = dd; h = hash12(i + g + 41.7); }
  }
  return vec2(sqrt(d), h);
}

void main(){
  vec3 N = normalize(vN);
  if (!gl_FrontFacing && vMat != 17) N = -N;
  vec3 base = vCol;
  float paint = 1.0, rim = 0.55, soft = 0.03, jit = 0.0, leafHi = 0.0;
  vec3 emis = vec3(0.0);
  float mask = uMask;
  int mt = vMat;

  if (mt == 20) {           // flower card: five rounded petals + a golden eye, alpha-cut
    vec2 d = vUv - 0.5;
    float r = length(d), th = atan(d.y, d.x);
    float petal = 0.3 + 0.16 * cos(th * 5.0);
    if (r > petal) discard;
    base = mix(vec3(0.95, 0.62, 0.08), base, smoothstep(0.08, 0.11, r)) * (0.85 + 0.3 * r / petal);
    N = normalize(mix(N, vec3(0.0, 1.0, 0.0), 0.5));
    mask = -1.0; paint = 0.3; rim = 0.3;
  }
  if (mt == 17) {           // leaf card: scalloped alpha-cut leaf cluster on the canopy edge
    float a = leafShape(vUv);
    if (a < 0.5) discard;
    mt = 1;
    mask = -1.0;
  }
  if (mt == 1) {            // foliage: painted leaf clumps
    vec3 an = abs(N);
    vec2 p = (an.y > 0.55 ? vWPos.xz : (an.x > an.z ? vWPos.zy : vWPos.xy)) * 1.9;
    vec2 c = cellular(p);
    vec2 c2 = cellular(p * 2.6 + 5.0);
    jit = (c.y - 0.5) * 0.7 + (c2.y - 0.5) * 0.3 - smoothstep(0.5, 0.95, c.x) * 0.3;
    base *= 0.8 + c.y * 0.34;
    leafHi = smoothstep(0.55, 0.95, c2.y) * (1.0 - smoothstep(0.3, 0.8, c2.x));
    paint = 1.3; rim = 1.1;
  } else if (mt == 2) {     // dark stained vertical wall boards
    vec2 tg = normalize(vec2(-N.z, N.x) + 1e-4);
    float s = dot(vWPos.xz, tg);
    float f = fract(s / 0.21);
    base *= mix(0.6, 1.0, smoothstep(0.0, 0.07, f) * smoothstep(1.0, 0.93, f)) * (0.9 + 0.2 * vnoise(vec2(s * 5.0, vWPos.y * 0.8)));
    paint = 0.7;
  } else if (mt == 3) {     // kawara roof tiles (uv in metres): ribs down the slope, course lines
    float cu = fract(vUv.x / 0.25);
    float rv = fract(vUv.y / 0.28);
    float rib = 0.5 + 0.5 * sin(cu * 6.2831);
    base = mix(vec3(0.0144, 0.0185, 0.0203), vec3(0.0409, 0.0529, 0.0612), rib) * (vCol.r > 0.5 ? 1.0 : 0.9);
    base *= mix(0.55, 1.0, smoothstep(0.0, 0.14, rv));
    paint = 0.5; rim = 1.2;
  } else if (mt == 4) {     // shoji: matte cream paper in a wooden lattice (daylight, no glow)
    vec2 g = vec2(fract(vUv.x * 5.0), fract(vUv.y * 4.0));
    float frame = max(step(g.x, 0.08), step(g.y, 0.07));
    frame = max(frame, max(step(0.97, vUv.x) + step(vUv.x, 0.03), step(0.97, vUv.y) + step(vUv.y, 0.03)));
    base = mix(vec3(0.8, 0.72, 0.53), vec3(0.08, 0.05, 0.03), frame);
    paint = 0.4;
  } else if (mt == 5) {     // glass: dark interior, sky sheen streak, faint warm depth
    vec2 g = vec2(fract(vUv.x * 3.0), fract(vUv.y * 2.0));
    float frame = max(step(g.x, 0.05), step(g.y, 0.045));
    frame = max(frame, step(0.96, vUv.x) + step(vUv.x, 0.04));
    float streak = smoothstep(0.05, 0.0, abs(fract(vUv.x * 1.3 + vUv.y * 0.9) - 0.5) - 0.12);
    vec3 glass = vec3(0.03, 0.045, 0.05) + uSkyMid * 0.18 * streak + vec3(0.12, 0.07, 0.03) * (1.0 - vUv.y) * 0.5;
    base = mix(glass, vec3(0.06, 0.04, 0.025), frame);
    paint = 0.2; rim = 0.0;
  } else if (mt == 6) {     // grass blades: soft up-facing normals, no ink
    N = normalize(mix(N, vec3(0.0, 1.0, 0.0), 0.7));
    paint = 0.8; rim = 0.9; soft = 0.06;
    mask = -1.0;
  } else if (mt == 7) {     // skin
    paint = 0.25; soft = 0.05; rim = 0.8;
  } else if (mt == 8) {     // cloth
    paint = 0.6; rim = 0.7;
  } else if (mt == 9) {     // bark / weathered wood
    base *= 0.85 + 0.25 * vnoise(vec2(atan(vObj.x, vObj.z) * 3.0, vWPos.y * 0.7) * 2.0);
    paint = 1.2;
  } else if (mt == 10) {    // painted metal / signs
    paint = 0.3; rim = 0.5;
  } else if (mt == 11) {    // ground: grass meadow paint
    float n = fbm2(vWPos.xz * 0.11);
    float fl = hash12(floor(vWPos.xz * 2.3));
    base *= 0.82 + 0.36 * n;
    base = mix(base, base * vec3(1.2, 1.2, 0.8), step(0.93, fl) * 0.5);
    paint = 1.6; rim = 0.0;
  } else if (mt == 12) {    // butterfly (bright, unshaded)
    gColor = vec4(applyFog(base * 0.92, vWPos), 1.0);
    gNormal = vec4(0.5, 0.5, uId / 32.0, -1.0);
    return;
  } else if (mt == 13) {    // stone
    base *= 0.8 + 0.35 * vnoise(vWPos.xz * 4.0 + vWPos.y * 3.0);
    paint = 1.4;
  } else if (mt == 14) {    // paper lantern (soft, never a lamp in daylight)
    emis = base * 0.18;
    paint = 0.3;
  } else if (mt == 15) {    // hair: strand highlights
    float s = vnoise(vec2(atan(vObj.x, vObj.z) * 9.0, vObj.y * 3.0));
    base *= 0.85 + 0.3 * s;
    paint = 0.3; rim = 1.4; soft = 0.02;
  } else if (mt == 16) {    // yellow/black pole guard
    float st = step(0.5, fract(vWPos.y * 2.2 + atan(vObj.x, vObj.z) * 0.16));
    base = mix(vec3(0.02, 0.02, 0.02), vec3(0.9, 0.62, 0.04), st);
    paint = 0.3;
  } else if (mt == 18) {    // light mote
    vec2 d = vUv - 0.5;
    float a = 1.0 - smoothstep(0.2, 0.5, length(d));
    if (a < 0.5) discard;
    gColor = vec4(vec3(1.08, 1.02, 0.84), 1.0);
    gNormal = vec4(0.5, 0.5, uId / 32.0, -1.0);
    return;
  } else if (mt == 19) {    // painted distant mountains: authored colour, soft top-lit gradient
    float h = clamp(vObj.y / 160.0, 0.0, 1.0);
    vec3 c = base * (0.9 + 0.18 * h) * (0.94 + 0.12 * brush(vWPos * 0.05, N));
    vec3 V = normalize(vWPos - cameraPosition);
    c = mix(c, skyColor(normalize(vec3(V.x, 0.02, V.z))), 0.25 * (1.0 - h));
    gColor = vec4(c, 1.0);
    gNormal = vec4(0.5, 0.5, uId / 32.0, uMask);
    return;
  }

  // Skin shades warm (peach/rose) instead of the cool environment shadow.
  vec3 shT = mt == 7 ? vec3(0.78, 0.52, 0.5) : uShadowTint;
  if (mt == 7) jit += 0.22;
  vec3 col = toonT(base, N, vWPos, jit, paint, rim, soft, shT) + emis;
  if (mt == 1) {
    // Deep teal-green interiors, sunlit yellow-green leaf flecks on the lit side.
    float litSide = smoothstep(-0.05, 0.25, dot(N, uSunDir) + jit * 0.5);
    col = mix(col * vec3(0.66, 0.8, 0.88), col, litSide);
    col = mix(col, base * vec3(1.45, 1.5, 0.75) * uSunColor, leafHi * litSide * 0.5);
  }
  col = applyFog(col, vWPos);
  writeOut(col, N, mask);
}
`;

const uberCache = new Map<string, THREE.ShaderMaterial>();

/** Shared toon material. `id` = outline group (edges drawn between groups), `mask` = line weight. */
export function uber(id: number, mask = 1, side: THREE.Side = THREE.FrontSide): THREE.ShaderMaterial {
  const key = `${id}|${mask}|${side}`;
  let m = uberCache.get(key);
  if (!m) {
    m = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: { ...G, uId: { value: id }, uMask: { value: mask } },
      vertexShader: UBER_VS,
      fragmentShader: UBER_FS,
      vertexColors: true,
      side,
    });
    uberCache.set(key, m);
  }
  return m;
}

/** Depth-only material for the sun shadow pass (instancing-aware, leaf cards alpha-cut). */
export function shadowDepthMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    side: THREE.DoubleSide,
    uniforms: {},
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
      }`,
    fragmentShader: /* glsl */ `
      ${LEAF_SHAPE}
      in vec2 vUv; flat in int vMat;
      layout(location = 0) out vec4 o;
      void main(){
        if (vMat == 17 && leafShape(vUv) < 0.5) discard;
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
        col = mix(col, vec3(0.95, 0.96, 0.98), wisp * 0.5);
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
      out vec3 vWPos; out vec3 vN; out float vH;
      void main(){
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWPos = wp.xyz; vN = normalize(mat3(modelMatrix) * normal); vH = aH;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      ${COMMON}
      ${OUT}
      in vec3 vWPos; in vec3 vN; in float vH;
      void main(){
        vec3 N = normalize(vN);
        float n = vnoise3(vWPos * 0.02) * 0.6 + vnoise3(vWPos * 0.06) * 0.4;
        float t = dot(N, uSunDir) * 0.5 + 0.5 + (n - 0.5) * 0.4;
        float lit = smoothstep(0.44, 0.48, t);
        float mid = smoothstep(0.26, 0.3, t);
        vec3 cTop = vec3(1.0, 0.975, 0.93);
        vec3 cMid = vec3(0.47, 0.51, 0.67);   // #b7bfd6
        vec3 cLow = vec3(0.33, 0.38, 0.58);   // #9aa6c8
        float hg = smoothstep(0.0, 0.45, vH + (n - 0.5) * 0.2);
        vec3 sh = mix(cLow, cMid, hg);
        vec3 col = mix(sh * 0.92, sh, mid);
        col = mix(col, cTop, lit * smoothstep(0.03, 0.25, vH + (n - 0.5) * 0.2));
        vec3 V = normalize(cameraPosition - vWPos);
        float fr = pow(1.0 - abs(dot(N, V)), 3.0);
        float sunSide = smoothstep(-0.2, 0.4, dot(N, uSunDir));
        col = mix(col, vec3(1.0, 0.96, 0.86), fr * 0.5 * sunSide);   // #fff6e0 rim
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

        // Sparse rows of young rice: tufts on 0.6 m rows with open water between.
        float growth = vP;
        float row = abs(fract(vUv.x / 0.6) - 0.5) * 0.6;
        float pl = abs(fract(vUv.y / 0.45) - 0.5) * 0.45;
        float d = length(vec2(row, pl * 0.8));
        float rice = 1.0 - smoothstep(0.04 + 0.04 * growth, 0.06 + 0.06 * growth, d);
        float fw = length(fwidth(vUv / vec2(0.6, 0.45)));
        rice = mix(rice, 0.18 + 0.25 * growth, smoothstep(0.1, 0.6, fw));
        float sv = shadowVis(vWPos, vec3(0.0, 1.0, 0.0));
        vec3 riceCol = mix(vec3(0.1, 0.3, 0.035), vec3(0.3, 0.55, 0.07), vnoise(vWPos.xz * 0.9)) * mix(uShadowTint, uSunColor, sv);
        col = mix(col * mix(0.75, 1.0, sv), riceCol, clamp(rice * (0.75 + 0.3 * growth), 0.0, 0.9));
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
        vec3 asph = mix(vec3(0.15, 0.13, 0.115), vec3(0.21, 0.185, 0.16), n);
        float sp = vnoise(vec2(u, v) * 6.0) * 0.6 + vnoise(vec2(u, v) * 17.0) * 0.4;
        asph *= 0.92 + 0.14 * sp;
        asph *= 1.0 + 0.1 * smoothstep(0.55, 0.0, abs(abs(u) - 1.1));   // polished tyre tracks
        // Patch polygons (repairs of different age).
        vec2 pc = cell(vec2(u * 0.55, v * 0.16));
        float patchy = step(0.72, pc.y) * step(abs(u), 2.3);
        asph *= mix(1.0, pc.y > 0.86 ? 0.82 : 1.12, patchy);
        float seam = (1.0 - smoothstep(0.0, 0.04, pc.x)) * patchy;
        asph *= 1.0 - seam * 0.35;
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
        vec3 grass = mix(vec3(0.05, 0.17, 0.04), vec3(0.09, 0.25, 0.05), fbm2(vWPos.xz * 0.11));
        vec3 base = asph;
        base = mix(base, dirt, smoothstep(2.3, 2.45, au));
        base = mix(base, grass, smoothstep(2.6, 2.95, au + (n - 0.5) * 0.4));
        vec3 N = vec3(0.0, 1.0, 0.0);
        vec3 col = toon(base, N, vWPos, 0.0, 1.0, 0.0, 0.03);
        col = applyFog(col, vWPos);
        writeOut(col, N, uMask * smoothstep(2.6, 3.2, au));
      }`,
  });
}
