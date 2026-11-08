// Post stack (pmndrs `postprocessing`), loaded lazily so it is a separate chunk and never fetched when reduced
// motion is preferred. HDR scene -> bloom (half resolution, thresholded on emissive pixels) -> tone mapping +
// vignette + film grain in one combined pass.
import * as THREE from 'three';
import * as L from './look';

export interface Post {
  render(dt: number): void;
  setSize(width: number, height: number): void;
  dispose(): void;
}

export async function createPost(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): Promise<Post> {
  const pp = await import('postprocessing');
  const composer = new pp.EffectComposer(renderer, {
    frameBufferType: THREE.HalfFloatType,
    multisampling: renderer.capabilities.isWebGL2 ? L.POST_MSAA : 0,
  });
  composer.addPass(new pp.RenderPass(scene, camera));

  const bloom = new pp.BloomEffect({
    mipmapBlur: true,
    luminanceThreshold: L.BLOOM_THRESHOLD,
    luminanceSmoothing: L.BLOOM_SMOOTHING,
    intensity: L.BLOOM_INTENSITY,
    radius: L.BLOOM_RADIUS,
    levels: L.BLOOM_LEVELS,
    resolutionScale: L.BLOOM_RESOLUTION_SCALE,
  });
  composer.addPass(new pp.EffectPass(camera, bloom));

  // The renderer's own tone mapping only applies when drawing to the screen, so the composer does it here.
  const tone = new pp.ToneMappingEffect({ mode: pp.ToneMappingMode.ACES_FILMIC });
  const vignette = new pp.VignetteEffect({ offset: L.VIGNETTE_OFFSET, darkness: L.VIGNETTE_DARKNESS });
  const grain = new pp.NoiseEffect({ premultiply: true });
  grain.blendMode.opacity.value = L.GRAIN_OPACITY;
  composer.addPass(new pp.EffectPass(camera, tone, vignette, grain));

  return {
    render: (dt) => composer.render(dt),
    setSize: (w, h) => composer.setSize(w, h, false),
    dispose: () => composer.dispose(),
  };
}
