import type * as THREE from "three";

/**
 * Opt-in (?prof=1) frame profiler: GPU time per pass via EXT_disjoint_timer_query_webgl2 (queries
 * are read back a few frames later, never stalling), CPU time per frame section, renderer.info
 * per pass. Results are running averages since the last reset().
 */
interface Acc {
  sum: number;
  n: number;
}

export class Profiler {
  readonly on: boolean;
  private gl: WebGL2RenderingContext | null = null;
  private ext: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null = null;
  private pending: { name: string; q: WebGLQuery }[] = [];
  private free: WebGLQuery[] = [];
  private open: { name: string; q: WebGLQuery } | null = null;
  private gpu = new Map<string, Acc>();
  private cpu = new Map<string, Acc>();
  private calls = new Map<string, Acc>();
  private tris = new Map<string, Acc>();
  private cpuT = 0;
  private cpuName = "";
  private info0 = { calls: 0, tris: 0 };

  constructor(renderer: THREE.WebGLRenderer, on: boolean) {
    this.on = on;
    if (!on) return;
    const gl = renderer.getContext() as WebGL2RenderingContext;
    this.ext = gl.getExtension("EXT_disjoint_timer_query_webgl2");
    this.gl = this.ext ? gl : null;
  }

  private add(m: Map<string, Acc>, k: string, v: number) {
    const a = m.get(k) ?? { sum: 0, n: 0 };
    a.sum += v;
    a.n++;
    m.set(k, a);
  }

  /** GPU + renderer.info around one pass. Passes must not nest. */
  begin(name: string, renderer?: THREE.WebGLRenderer): void {
    if (!this.on) return;
    if (renderer) this.info0 = { calls: renderer.info.render.calls, tris: renderer.info.render.triangles };
    if (!this.gl || !this.ext || this.open) return;
    const q = this.free.pop() ?? this.gl.createQuery()!;
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q);
    this.open = { name, q };
  }

  end(name: string, renderer?: THREE.WebGLRenderer): void {
    if (!this.on) return;
    if (renderer) {
      this.add(this.calls, name, renderer.info.render.calls - this.info0.calls);
      this.add(this.tris, name, renderer.info.render.triangles - this.info0.tris);
    }
    if (!this.gl || !this.ext || !this.open) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.pending.push(this.open);
    this.open = null;
  }

  cpuBegin(name: string): void {
    if (!this.on) return;
    this.cpuName = name;
    this.cpuT = performance.now();
  }

  cpuEnd(): void {
    if (!this.on) return;
    this.add(this.cpu, this.cpuName, performance.now() - this.cpuT);
  }

  cpuMark(name: string, ms: number): void {
    if (this.on) this.add(this.cpu, name, ms);
  }

  /** Read back finished queries (call once per frame). */
  poll(): void {
    if (!this.gl || !this.ext) return;
    const gl = this.gl;
    const disjoint = gl.getParameter(this.ext.GPU_DISJOINT_EXT);
    while (this.pending.length) {
      const p = this.pending[0];
      if (!gl.getQueryParameter(p.q, gl.QUERY_RESULT_AVAILABLE)) break;
      const ns = gl.getQueryParameter(p.q, gl.QUERY_RESULT) as number;
      if (!disjoint) this.add(this.gpu, p.name, ns / 1e6);
      this.free.push(p.q);
      this.pending.shift();
    }
  }

  reset(): void {
    this.gpu.clear();
    this.cpu.clear();
    this.calls.clear();
    this.tris.clear();
  }

  report(): Record<string, Record<string, number>> {
    const avg = (m: Map<string, Acc>) => Object.fromEntries([...m].map(([k, a]) => [k, +(a.sum / Math.max(1, a.n)).toFixed(3)]));
    return { gpuMs: avg(this.gpu), cpuMs: avg(this.cpu), calls: avg(this.calls), tris: avg(this.tris) };
  }
}
