import * as THREE from "three";

/**
 * Every visible surface uses one of the custom toon materials below. They all render into a
 * two-attachment target: location 0 = lit colour (linear HDR), location 1 = view normal.xy,
 * outline-group id and outline mask. The post pass derives ink lines from that + depth.
 */

const lin = (hex: string) => new THREE.Color(hex);

export const G = {
  uTime: { value: 0 },
  uSunDir: { value: new THREE.Vector3(-0.72, 0.62, -0.3).normalize() },
  uSunColor: { value: lin("#fff3dc") },
  uShadowTint: { value: lin("#98a4d2") },
  uSkyZenith: { value: lin("#1379ad") },
  uSkyMid: { value: lin("#3e9fcc") },
  uSkyHorizon: { value: lin("#cfe8ee") },
  uFogColor: { value: lin("#b4d4df") },
  uFogDensity: { value: 0.0011 },
  uRimColor: { value: lin("#fff0c4") },
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
  vec3 col = mix(uSkyHorizon, uSkyMid, smoothstep(0.0, 0.22, h));
  col = mix(col, uSkyZenith, smoothstep(0.12, 0.75, h));
  float sd = max(dot(dir, uSunDir), 0.0);
  col += vec3(1.0, 0.82, 0.55) * (pow(sd, 5.0) * 0.18 + pow(sd, 48.0) * 0.35);
  col = mix(col, uFogColor * vec3(1.03, 1.0, 0.94), exp(-h * 22.0) * 0.55);
  return col;
}

vec3 applyFog(vec3 col, vec3 wpos){
  vec3 d = wpos - cameraPosition;
  float dist = length(d);
  float f = 1.0 - exp(-max(dist - 30.0, 0.0) * uFogDensity);
  vec3 dir = d / max(dist, 0.001);
  float sd = max(dot(dir, uSunDir), 0.0);
  vec3 fc = mix(uFogColor, uFogColor * vec3(1.1, 1.0, 0.86), sd * sd);
  fc = mix(fc, skyColor(normalize(vec3(dir.x, 0.02, dir.z))), 0.35);
  return mix(col, fc, f * 0.93);
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

// Three-step cel lighting (lit / shadow / dark shadow), painterly terminator, rim light.
vec3 toonT(vec3 base, vec3 N, vec3 wpos, float jitter, float paint, float rimAmt, float soft, vec3 shTint){
  float br = brush(wpos, N);
  float t = dot(N, uSunDir) + (br - 0.5) * 0.32 * paint + jitter;
  float lit = smoothstep(0.02 - soft, 0.06 + soft, t);
  float mid = smoothstep(-0.5 - soft, -0.44 + soft, t);
  vec3 cLit = base * uSunColor;
  vec3 cSh = base * shTint;
  vec3 cDk = cSh * vec3(0.66, 0.68, 0.8);
  vec3 col = mix(cDk, cSh, mid);
  col = mix(col, cLit, lit);
  col += base * uSkyMid * 0.07 * (N.y * 0.5 + 0.5);
  vec3 V = normalize(cameraPosition - wpos);
  float fr = 1.0 - max(dot(N, V), 0.0);
  float rim = smoothstep(0.58, 0.72, fr) * rimAmt;
  float sunSide = smoothstep(-0.3, 0.3, dot(N, uSunDir) + 0.2);
  col += uRimColor * base * rim * (0.25 + 0.75 * sunSide) * 0.9;
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
    float flap = sin(uTime * 17.0 + ph * 3.0) * 1.05;
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
  if (aWind > 0.0) {
    float wph = dot(wp.xz, vec2(0.37, 0.23));
    float gust = vnoise(wp.xz * 0.045 + vec2(uTime * 0.55, uTime * 0.21));
    float w = sin(uTime * 1.6 + wph) * 0.3 + sin(uTime * 2.7 + wph * 1.3) * 0.14 + (gust - 0.35) * 0.95;
    wp.xz += vec2(0.85, 0.35) * w * aWind * 0.32;
    wp.y -= aWind * w * w * 0.05;
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
}
`;

const UBER_FS = /* glsl */ `
${COMMON}
${OUT}
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
  if (!gl_FrontFacing) N = -N;
  vec3 base = vCol;
  float paint = 1.0, rim = 0.55, soft = 0.03, jit = 0.0, leafHi = 0.0;
  vec3 emis = vec3(0.0);
  float mask = uMask;
  int mt = vMat;

  if (mt == 1) {            // foliage: painted leaf clumps
    vec3 an = abs(N);
    vec2 p = (an.y > 0.55 ? vWPos.xz : (an.x > an.z ? vWPos.zy : vWPos.xy)) * 1.9;
    vec2 c = cellular(p);
    vec2 c2 = cellular(p * 2.6 + 5.0);
    jit = (c.y - 0.5) * 0.7 + (c2.y - 0.5) * 0.3 - smoothstep(0.5, 0.95, c.x) * 0.3;
    base *= 0.8 + c.y * 0.34;
    leafHi = smoothstep(0.55, 0.95, c2.y) * (1.0 - smoothstep(0.3, 0.8, c2.x));
    paint = 1.3; rim = 1.1;
  } else if (mt == 2) {     // horizontal clapboards
    float f = fract(vWPos.y / 0.19);
    base *= mix(0.55, 1.0, smoothstep(0.0, 0.14, f)) * (0.92 + 0.16 * vnoise(vec2(vWPos.x + vWPos.z, vWPos.y * 4.0) * 3.0));
    paint = 0.7;
  } else if (mt == 3) {     // kawara roof tiles (uv in metres)
    float cu = fract(vUv.x / 0.3);
    float rv = fract(vUv.y / 0.26);
    base *= (0.82 + 0.22 * sin(cu * 6.2831)) * mix(0.6, 1.0, smoothstep(0.0, 0.12, rv));
    paint = 0.6; rim = 0.9;
  } else if (mt == 4) {     // shoji: wooden lattice over lit paper
    vec2 g = vec2(fract(vUv.x * 5.0), fract(vUv.y * 4.0));
    float frame = max(step(g.x, 0.08), step(g.y, 0.07));
    frame = max(frame, max(step(0.97, vUv.x) + step(vUv.x, 0.03), step(0.97, vUv.y) + step(vUv.y, 0.03)));
    base = mix(vec3(0.92, 0.86, 0.72), vec3(0.24, 0.15, 0.08), frame);
    emis = vec3(1.0, 0.78, 0.5) * 0.28 * (1.0 - frame);
    paint = 0.4;
  } else if (mt == 5) {     // warm glowing window
    vec2 g = vec2(fract(vUv.x * 3.0), fract(vUv.y * 2.0));
    float frame = max(step(g.x, 0.06), step(g.y, 0.05));
    frame = max(frame, step(0.96, vUv.x) + step(vUv.x, 0.04));
    base = mix(vec3(0.08, 0.05, 0.03), vec3(0.12, 0.08, 0.05), frame);
    float fl = 0.9 + 0.1 * vnoise(vUv * 3.0 + uTime * 0.2);
    emis = vec3(1.0, 0.64, 0.3) * 1.25 * fl * (1.0 - frame) * (0.7 + 0.3 * vUv.y);
    paint = 0.2; rim = 0.0;
  } else if (mt == 6) {     // grass blades: soft up-facing normals
    N = normalize(mix(N, vec3(0.0, 1.0, 0.0), 0.7));
    paint = 0.8; rim = 0.9; soft = 0.06;
  } else if (mt == 7) {     // skin
    paint = 0.25; soft = 0.05; rim = 0.8;
  } else if (mt == 8) {     // cloth
    paint = 0.6; rim = 0.7;
  } else if (mt == 9) {     // bark / weathered wood
    base *= 0.85 + 0.25 * vnoise(vec2(atan(vObj.x, vObj.z) * 3.0, vWPos.y * 0.7) * 2.0);
    paint = 1.2;
  } else if (mt == 10) {    // painted metal / signs
    paint = 0.3; rim = 1.0;
  } else if (mt == 11) {    // ground: grass meadow paint
    float n = fbm2(vWPos.xz * 0.11);
    float fl = hash12(floor(vWPos.xz * 2.3));
    base *= 0.82 + 0.36 * n;
    base = mix(base, base * vec3(1.25, 1.2, 0.75), step(0.93, fl) * 0.6);
    paint = 1.6; rim = 0.0;
  } else if (mt == 12) {    // butterfly (bright, unshaded)
    gColor = vec4(applyFog(base * 0.92, vWPos), 1.0);
    gNormal = vec4(0.5, 0.5, uId / 32.0, 0.0);
    return;
  } else if (mt == 13) {    // stone
    base *= 0.8 + 0.35 * vnoise(vWPos.xz * 4.0 + vWPos.y * 3.0);
    paint = 1.4;
  } else if (mt == 14) {    // paper lantern
    emis = base * 0.55;
    paint = 0.3;
  } else if (mt == 15) {    // hair: strand highlights
    float s = vnoise(vec2(atan(vObj.x, vObj.z) * 9.0, vObj.y * 3.0));
    base *= 0.85 + 0.3 * s;
    paint = 0.3; rim = 1.4; soft = 0.02;
  } else if (mt == 16) {    // yellow/black pole guard
    float st = step(0.5, fract(vWPos.y * 2.2 + atan(vObj.x, vObj.z) * 0.16));
    base = mix(vec3(0.02, 0.02, 0.02), vec3(0.95, 0.72, 0.05), st);
    paint = 0.3;
  }

  // Skin shades warm (peach/rose) instead of the cool environment shadow.
  vec3 shT = mt == 7 ? vec3(0.78, 0.52, 0.5) : uShadowTint;
  if (mt == 7) jit += 0.22;
  vec3 col = toonT(base, N, vWPos, jit, paint, rim, soft, shT) + emis;
  if (mt == 1) {
    // Deep teal-green interiors, sunlit yellow-green leaf flecks on the lit side.
    float litSide = smoothstep(-0.05, 0.25, dot(N, uSunDir) + jit * 0.5);
    col = mix(col * vec3(0.72, 0.85, 0.92), col, litSide);
    col = mix(col, base * vec3(1.45, 1.5, 0.75) * uSunColor, leafHi * litSide * 0.55);
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
        // High painted wisps.
        float h = max(dir.y, 0.02);
        vec2 p = dir.xz / h * 0.6;
        float w = fbm2(p * vec2(0.6, 2.2) + vec2(uTime * 0.004, 0.0));
        float wisp = smoothstep(0.58, 0.8, w) * smoothstep(0.05, 0.25, dir.y) * (1.0 - smoothstep(0.5, 0.9, dir.y));
        col = mix(col, vec3(0.96, 0.97, 1.0), wisp * 0.45);
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
        float n = vnoise3(vWPos * 0.018) * 0.6 + vnoise3(vWPos * 0.05) * 0.4;
        float t = dot(N, uSunDir) * 0.5 + 0.5 + (n - 0.5) * 0.42;
        float lit = smoothstep(0.43, 0.48, t);
        float mid = smoothstep(0.24, 0.3, t);
        vec3 cTop = vec3(1.0, 0.99, 0.95);
        vec3 cMid = vec3(0.64, 0.71, 0.86);
        vec3 cLow = vec3(0.36, 0.45, 0.66);
        float hg = smoothstep(0.0, 0.5, vH + (n - 0.5) * 0.25);
        vec3 sh = mix(cLow, cMid, hg);
        vec3 col = mix(sh * 0.9, sh, mid);
        col = mix(col, cTop, lit * smoothstep(0.02, 0.3, vH + (n - 0.5) * 0.2));
        vec3 V = normalize(cameraPosition - vWPos);
        float fr = pow(1.0 - abs(dot(N, V)), 3.0);
        col += vec3(1.0, 0.96, 0.88) * fr * 0.3;
        vec3 dir = -V;
        col = mix(col, skyColor(dir), smoothstep(0.1, 0.0, dir.y) * 0.75 + 0.06);
        gColor = vec4(col, 1.0);
        gNormal = vec4(0.5, 0.5, 0.0, 0.0);
      }`,
  });
}

// ------------------------------------------------------------------ flooded paddies

export function waterMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: { ...G, uId: { value: 2 }, uMask: { value: 0.25 } },
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
      in vec3 vWPos; in vec2 vUv; in float vP;
      void main(){
        vec3 V = normalize(vWPos - cameraPosition);
        vec2 q = vWPos.xz;
        float r1 = vnoise(q * 1.1 + vec2(uTime * 0.3, uTime * 0.2));
        float r2 = vnoise(q * 2.7 - vec2(uTime * 0.25, -uTime * 0.33));
        vec3 Nw = normalize(vec3((r1 - 0.5) * 0.09 + (r2 - 0.5) * 0.05, 1.0, (r2 - 0.5) * 0.09));
        vec3 R = reflect(V, Nw);
        R.y = max(R.y, 0.015);
        vec3 refl = skyColor(normalize(R));
        float cl = fbm2(R.xz / (R.y + 0.15) * 0.5 + vec2(3.0, 1.0));
        // Bias toward the mid sky: grazing reflections otherwise wash out to horizon white.
        vec3 reflUp = skyColor(normalize(vec3(R.x, R.y + 0.4, R.z)));
        refl = mix(refl, reflUp, 0.75) * 0.85;
        refl = mix(refl, vec3(1.0, 0.99, 0.95), smoothstep(0.58, 0.7, cl) * 0.6);
        float fres = 0.2 + 0.5 * pow(1.0 - max(-V.y, 0.0), 4.0);
        vec3 mud = vec3(0.07, 0.09, 0.05);
        vec3 col = mix(mud, refl * 0.85, fres);

        // Rows of young rice: stripes parallel to the road that merge into a green sheen far away.
        float growth = vP;
        float row = abs(fract(vUv.x / 0.6) - 0.5) * 0.6;
        float pl = abs(fract(vUv.y / 0.45) - 0.5) * 0.45;
        float d = length(vec2(row, pl * 0.7));
        float rice = 1.0 - smoothstep(0.06 + 0.07 * growth, 0.09 + 0.09 * growth, d);
        float fw = length(fwidth(vUv / vec2(0.6, 0.45)));
        rice = mix(rice, 0.45 + 0.4 * growth, smoothstep(0.1, 0.6, fw));
        vec3 riceCol = mix(vec3(0.12, 0.33, 0.035), vec3(0.34, 0.6, 0.07), vnoise(vWPos.xz * 0.9)) * uSunColor;
        col = mix(col, riceCol, clamp(rice * (0.7 + 0.35 * growth), 0.0, 0.92));
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
      void main(){
        float u = vUv.x, v = vUv.y;
        float n = fbm2(vec2(u * 0.9, v * 0.3));
        float jag = (vnoise(vec2(v * 0.55, 3.0 + sign(u) * 9.0)) - 0.5) * 0.55 + (vnoise(vec2(v * 2.6, 7.0 + sign(u) * 5.0)) - 0.5) * 0.22;
        float au = abs(u) + jag;
        vec3 asph = mix(vec3(0.17, 0.165, 0.16), vec3(0.24, 0.225, 0.2), n);
        asph *= 1.0 + 0.1 * smoothstep(0.55, 0.0, abs(abs(u) - 1.15));
        vec2 pc = floor(vec2((u + 7.0) / 1.4, v / 3.3));
        float ph = hash12(pc);
        asph *= mix(1.0, 0.9, step(0.94, ph) * step(abs(u), 2.0));
        float cr = abs(vnoise(vec2(u * 2.4, v * 0.8) * 2.2) - 0.5);
        float cr2 = abs(vnoise(vec2(u * 4.1 + 11.0, v * 1.9) * 1.6) - 0.5);
        float crack = (1.0 - smoothstep(0.0, 0.01, cr)) * step(0.62, vnoise(vec2(u, v) * 0.35 + 4.0));
        crack = max(crack, (1.0 - smoothstep(0.0, 0.007, cr2)) * step(0.66, vnoise(vec2(u, v) * 0.3 + 9.0)));
        asph *= 1.0 - crack * 0.3;
        vec3 dirt = mix(vec3(0.3, 0.24, 0.14), vec3(0.4, 0.33, 0.2), vnoise(vec2(u, v) * 1.8));
        vec3 grass = mix(vec3(0.18, 0.36, 0.07), vec3(0.3, 0.48, 0.1), fbm2(vWPos.xz * 0.11));
        // Fine aggregate speckle so the asphalt isn't a flat grey sheet.
        float sp = vnoise(vec2(u, v) * 6.0) * 0.6 + vnoise(vec2(u, v) * 17.0) * 0.4;
        asph *= 0.92 + 0.14 * sp;
        asph *= vec3(1.06, 1.0, 0.94);
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
