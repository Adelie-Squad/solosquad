// The meshopt decoder, loaded only when a GLB actually uses EXT_meshopt_compression. The decoder
// compiles WebAssembly the moment its module runs; under the engine's CSP (no 'wasm-unsafe-eval')
// that throws, so compiling it eagerly — what drei's `useGLTF(url, _, true)` does — would break the
// office even for uncompressed files. Here the wasm is compiled on the first compressed buffer.
type Decoder = (typeof import('three/examples/jsm/libs/meshopt_decoder.module.js'))['MeshoptDecoder'];

let loading: Promise<Decoder> | null = null;
let decoder: Decoder | null = null;

const load = () =>
  (loading ??= import('three/examples/jsm/libs/meshopt_decoder.module.js').then(async ({ MeshoptDecoder }) => {
    await MeshoptDecoder.ready;
    decoder = MeshoptDecoder;
    return MeshoptDecoder;
  }));

/** Quacks like `MeshoptDecoder` for GLTFLoader.setMeshoptDecoder. */
export const lazyMeshopt = {
  supported: true,
  get ready(): Promise<void> {
    return load().then(() => undefined);
  },
  decodeGltfBuffer(target: Uint8Array, count: number, size: number, source: Uint8Array, mode: string, filter?: string): void {
    if (!decoder) throw new Error('meshopt decoder used before it was ready');
    decoder.decodeGltfBuffer(target, count, size, source, mode, filter);
  },
};
