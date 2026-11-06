// The two looks of the guide as shaders: face-direction three tones (§4) and the penguin body
// with its heart face painted in (§8.3). Uniform objects are shared, so a theme switch only
// rewrites colours — nothing is rebuilt.
import * as THREE from 'three';
import type { Tone3 } from './palette';

const TONE_VS = /* glsl */ `
  varying vec3 vN;
  void main() {
    vN = normalize(transpose(inverse(mat3(modelMatrix))) * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const TONE_FS = /* glsl */ `
  uniform vec3 uTop, uLit, uShade;
  varying vec3 vN;
  void main() {
    vec3 n = normalize(vN);
    float right = smoothstep(-0.08, 0.08, n.x - n.z);
    float top = smoothstep(0.55, 0.65, n.y);
    gl_FragColor = vec4(mix(mix(uLit, uShade, right), uTop, top), 1.0);
  }`;

export class ToneMaterials {
  private mats = new Map<string, THREE.ShaderMaterial>();

  get(key: string, tone: Tone3): THREE.ShaderMaterial {
    let m = this.mats.get(key);
    if (!m) {
      m = new THREE.ShaderMaterial({
        uniforms: { uTop: { value: new THREE.Color() }, uLit: { value: new THREE.Color() }, uShade: { value: new THREE.Color() } },
        vertexShader: TONE_VS,
        fragmentShader: TONE_FS,
      });
      this.mats.set(key, m);
    }
    setTone(m, tone);
    return m;
  }

  /** Re-colour every material from a new palette (theme switch). */
  recolor(lookup: (key: string) => Tone3 | null): void {
    for (const [key, m] of this.mats) {
      const tone = lookup(key);
      if (tone) setTone(m, tone);
    }
  }

  dispose(): void {
    for (const m of this.mats.values()) m.dispose();
    this.mats.clear();
  }
}

function setTone(m: THREE.ShaderMaterial, [top, lit, shade]: Tone3): void {
  (m.uniforms.uTop.value as THREE.Color).set(top);
  (m.uniforms.uLit.value as THREE.Color).set(lit);
  (m.uniforms.uShade.value as THREE.Color).set(shade);
}

/** A sticker / prop tone set from one team colour: lighter top, the colour, darker side. */
export function toneFrom(hex: string): Tone3 {
  const c = new THREE.Color(hex);
  const top = c.clone().lerp(new THREE.Color(1, 1, 1), 0.22);
  const shade = c.clone().multiplyScalar(0.62);
  return [`#${top.getHexString()}`, hex, `#${shade.getHexString()}`];
}

const BODY_VS = /* glsl */ `
  varying vec3 vN;
  varying vec3 vP;
  void main() {
    vP = position;
    vN = normalize(transpose(inverse(mat3(modelMatrix))) * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

// uGlow: the laptop screen lighting the front (evening, working). uDim: dozing in the dark.
const BODY_FS = /* glsl */ `
  uniform vec3 bTop, bLit, bShade, wTop, wLit, wShade, uInk, uStitch, uGlowColor;
  uniform float uGlow, uDim;
  varying vec3 vN;
  varying vec3 vP;
  float sdE(vec2 p, vec2 c, vec2 r) { vec2 q = (p - c) / r; return (length(q) - 1.0) * min(r.x, r.y); }
  float sdC(vec2 p, vec2 c, float r) { return length(p - c) - r; }
  void main() {
    vec3 n = normalize(vN);
    float right = smoothstep(-0.08, 0.08, n.x - n.z);
    float top = smoothstep(0.55, 0.65, n.y);
    vec2 p = vP.xy;
    float d = min(sdE(p, vec2(0.0, 0.43), vec2(0.405, 0.39)),
              min(sdC(p, vec2(-0.155, 0.85), 0.175), sdC(p, vec2(0.155, 0.85), 0.175)));
    float front = step(0.04, vP.z);
    float inside = front * (1.0 - smoothstep(-0.003, 0.003, d));
    vec3 lit = mix(bLit, wLit, inside);
    vec3 sh = mix(bShade, wShade, inside);
    vec3 tp = mix(bTop, wTop, inside);
    lit = mix(lit, uGlowColor, uGlow * front);
    vec3 c = mix(mix(lit, sh, right), tp, top);
    c *= (1.0 - uDim * (1.0 - inside * 0.5));
    float dash = step(0.0, sin(atan(p.y - 0.5, p.x) * 72.0));
    float st = inside * (1.0 - smoothstep(0.004, 0.007, abs(d + 0.036))) * dash;
    c = mix(c, uStitch, st * 0.9);
    float border = front * (1.0 - smoothstep(0.009, 0.013, abs(d)));
    c = mix(c, uInk, border);
    gl_FragColor = vec4(c, 1.0);
  }`;

export interface BodyColors {
  body: Tone3;
  face: Tone3;
  ink: string;
  stitch: string;
  glowColor: string;
}

/** One per penguin — the glow and the dimming differ by agent; the body geometry is shared. */
export function bodyMaterial(c: BodyColors): THREE.ShaderMaterial {
  const col = (h: string) => ({ value: new THREE.Color(h) });
  const m = new THREE.ShaderMaterial({
    uniforms: {
      bTop: col(c.body[0]),
      bLit: col(c.body[1]),
      bShade: col(c.body[2]),
      wTop: col(c.face[0]),
      wLit: col(c.face[1]),
      wShade: col(c.face[2]),
      uInk: col(c.ink),
      uStitch: col(c.stitch),
      uGlowColor: col(c.glowColor),
      uGlow: { value: 0 },
      uDim: { value: 0 },
    },
    vertexShader: BODY_VS,
    fragmentShader: BODY_FS,
  });
  return m;
}

export function recolorBody(m: THREE.ShaderMaterial, c: BodyColors): void {
  const u = m.uniforms;
  (u.bTop.value as THREE.Color).set(c.body[0]);
  (u.bLit.value as THREE.Color).set(c.body[1]);
  (u.bShade.value as THREE.Color).set(c.body[2]);
  (u.wTop.value as THREE.Color).set(c.face[0]);
  (u.wLit.value as THREE.Color).set(c.face[1]);
  (u.wShade.value as THREE.Color).set(c.face[2]);
  (u.uInk.value as THREE.Color).set(c.ink);
  (u.uStitch.value as THREE.Color).set(c.stitch);
  (u.uGlowColor.value as THREE.Color).set(c.glowColor);
}

/** The ink-line composite (guide §6): silhouettes from depth, creases at half the radius. */
export function inkComposite(tColor: THREE.Texture, tNormal: THREE.Texture, tDepth: THREE.Texture, near: number, far: number, ink: string) {
  const uniforms = {
    tColor: { value: tColor },
    tNormal: { value: tNormal },
    tDepth: { value: tDepth },
    uTexel: { value: new THREE.Vector2() },
    uThick: { value: 2.9 },
    uNear: { value: near },
    uFar: { value: far },
    uInk: { value: new THREE.Color(ink) },
    /** World-unit depth jump that counts as an outline. The guide's 0.14 holds at its zoom;
     * zoomed out, a sloped floor changes more than that across the sample radius, so the
     * stage raises it with the world size of a pixel. */
    uDepthEdge: { value: 0.14 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    depthTest: false,
    depthWrite: false,
    vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D tColor, tNormal, tDepth;
      uniform vec2 uTexel;
      uniform float uThick, uNear, uFar, uDepthEdge;
      uniform vec3 uInk;
      varying vec2 vUv;
      float dep(vec2 uv) { return uNear + texture2D(tDepth, uv).x * (uFar - uNear); }
      vec3 nor(vec2 uv) { return normalize(texture2D(tNormal, uv).xyz * 2.0 - 1.0); }
      void main() {
        vec3 col = texture2D(tColor, vUv).rgb;
        float dc = dep(vUv);
        vec3 nc = nor(vUv);
        float sil = 0.0, crease = 0.0;
        for (int i = 0; i < 12; i++) {
          float a = float(i) * 0.5235988;
          vec2 d = vec2(cos(a), sin(a)) * uTexel;
          sil = max(sil, step(uDepthEdge, abs(dep(vUv + d * uThick) - dc)));
          crease = max(crease, step(0.25, 1.0 - dot(nor(vUv + d * uThick * 0.5), nc)));
        }
        gl_FragColor = vec4(mix(col, uInk, max(sil, crease)), 1.0);
      }`,
  });
  return { material, uniforms };
}
