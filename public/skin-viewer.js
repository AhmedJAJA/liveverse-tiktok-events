/* SPONGE LIVE — 3D skin viewer (three.js r170, self-hosted under /vendor/three).
   One viewer = one WebGL canvas and one model at a time. three.js itself is only downloaded the first time a
   viewer is mounted, and nothing renders while the viewer is off-screen or the tab is hidden, so phones stay
   cool. Drag to turn the character all the way round, pinch / wheel / buttons to zoom.
   Characters: KayKit Adventurers by Kay Lousberg (CC0). */

let libs = null;
const loadLibs = () => (libs ||= Promise.all([
  import('/vendor/three/three.module.min.js'),
  import('/vendor/three/GLTFLoader.js'),
  import('/vendor/three/OrbitControls.js'),
]).then(([THREE, { GLTFLoader }, { OrbitControls }]) => ({ THREE, GLTFLoader, OrbitControls })));

export function webglAvailable() {
  try { const c = document.createElement('canvas'); return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl'))); } catch { return false; }
}

/** Shared model cache: switching back to a skin you already saw costs nothing. Small (≤ 4 entries). */
const gltfCache = new Map();
async function loadGltf(url, GLTFLoader) {
  if (gltfCache.has(url)) return gltfCache.get(url);
  const p = new GLTFLoader().loadAsync(url);
  gltfCache.set(url, p);
  p.catch(() => gltfCache.delete(url));
  while (gltfCache.size > 4) gltfCache.delete(gltfCache.keys().next().value);
  return p;
}

/**
 * @param {HTMLElement} host  element the canvas goes into (sized by CSS)
 * @param {{ model: string, animations?: Record<string,string>, autoRotate?: boolean, onState?: (s: string, info?: any) => void }} opts
 */
export async function mountViewer(host, opts) {
  const { THREE, GLTFLoader, OrbitControls } = await loadLibs();
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const phone = matchMedia('(max-width: 760px), (pointer: coarse)').matches;
  const say = (s, info) => { host.dataset.state = s; opts.onState?.(s, info); };

  const renderer = new THREE.WebGLRenderer({ antialias: !phone, alpha: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, phone ? 1.5 : 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  const canvas = renderer.domElement; canvas.className = 'sv-canvas';
  canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', opts.label || 'شخصيتك ثلاثية الأبعاد');
  host.append(canvas);

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xdff3ff, 0x1b2a55, 1.6));
  const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(2.5, 4, 3.5); scene.add(key);
  const rim = new THREE.DirectionalLight(0x6fd8ff, 1.3); rim.position.set(-3, 2.5, -3); scene.add(rim);
  // soft round shadow under the feet (a canvas gradient, no image download)
  const g = document.createElement('canvas'); g.width = g.height = 128;
  const gx = g.getContext('2d'), grad = gx.createRadialGradient(64, 64, 4, 64, 64, 62);
  grad.addColorStop(0, 'rgba(0,0,0,.55)'); grad.addColorStop(1, 'rgba(0,0,0,0)'); gx.fillStyle = grad; gx.fillRect(0, 0, 128, 128);
  const shadowTex = new THREE.CanvasTexture(g);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.002; scene.add(shadow);

  const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 50);
  const controls = new OrbitControls(camera, canvas);
  Object.assign(controls, { enableDamping: true, dampingFactor: 0.08, enablePan: false, rotateSpeed: 0.8, zoomSpeed: 0.9,
    minPolarAngle: Math.PI * 0.18, maxPolarAngle: Math.PI * 0.56, autoRotate: !reduced && opts.autoRotate !== false, autoRotateSpeed: 1.2 });
  controls.addEventListener('start', () => { controls.autoRotate = false; wake(); });
  controls.addEventListener('change', () => wake());

  let model = null, mixer = null, actions = {}, current = null, backTimer = 0, home = null;
  const clock = new THREE.Clock();

  function fit(object) {
    const box = new THREE.Box3().setFromObject(object), size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
    object.position.sub(new THREE.Vector3(center.x, box.min.y, center.z)); // feet on the floor, centered
    const h = size.y, target = new THREE.Vector3(0, h * 0.52, 0);
    const dist = (h * 0.62) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    camera.position.set(dist * 0.35, h * 0.72, dist); camera.near = dist / 50; camera.far = dist * 20; camera.updateProjectionMatrix();
    controls.target.copy(target); controls.minDistance = dist * 0.45; controls.maxDistance = dist * 1.7; controls.update();
    shadow.scale.setScalar(Math.max(size.x, size.z) * 0.55 + 0.15);
    home = { pos: camera.position.clone(), target: target.clone() };
  }
  // eases the camera back to the starting view (instantly when the visitor prefers less motion)
  let homeAnim = 0;
  function goHome() {
    if (!home) return;
    cancelAnimationFrame(homeAnim);
    const p0 = camera.position.clone(), t0 = controls.target.clone(), start = performance.now(), ms = reduced ? 0 : 450;
    const step = (now) => {
      const k = ms ? Math.min(1, (now - start) / ms) : 1, e = 1 - Math.pow(1 - k, 3);
      camera.position.lerpVectors(p0, home.pos, e); controls.target.lerpVectors(t0, home.target, e); controls.update(); wake();
      if (k < 1) homeAnim = requestAnimationFrame(step);
    };
    homeAnim = requestAnimationFrame(step);
  }
  function disposeModel() {
    clearTimeout(backTimer);
    if (!model) return;
    mixer?.stopAllAction(); mixer?.uncacheRoot(model);
    scene.remove(model); model = null; mixer = null; actions = {}; current = null;
  }

  async function setModel(url, animations = opts.animations || {}) {
    say('loading');
    let gltf;
    try { gltf = await loadGltf(url, GLTFLoader); } catch (e) { say('error', e); return false; }
    if (disposed) return false;
    disposeModel();
    // skinned meshes must not be shared between viewers: clone the scene graph (geometry / textures stay shared)
    const { clone } = await import('/vendor/three/SkeletonUtils.js');
    model = clone ? clone(gltf.scene) : gltf.scene;
    model.traverse((o) => { if (o.isMesh) { o.frustumCulled = false; if (o.material) o.material.envMapIntensity = 0.6; } });
    scene.add(model); fit(model);
    mixer = new THREE.AnimationMixer(model);
    for (const [key2] of Object.entries(animations)) {
      const clip = gltf.animations.find((c) => c.name === key2) || gltf.animations.find((c) => c.name === animations[key2]);
      if (clip) actions[key2] = mixer.clipAction(clip);
    }
    mixer.addEventListener('finished', (e) => { if (e.action === actions.win) backTimer = setTimeout(() => play('idle'), 300); if (e.action === actions.lose) backTimer = setTimeout(() => play('idle'), 1600); });
    play('idle', 0);
    say('ready', { animations: Object.keys(actions) });
    wake();
    return true;
  }

  function play(name, fade = 0.25) {
    const next = actions[name]; if (!next) return false;
    clearTimeout(backTimer);
    const once = name === 'win' || name === 'lose';
    next.reset(); next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity); next.clampWhenFinished = once;
    if (current && current !== next) next.crossFadeFrom(current, fade, false); else next.fadeIn(fade);
    next.play(); current = next; host.dataset.anim = name;
    if (name === 'lose') goHome(); // the character falls to the floor: make sure it stays in frame
    wake();
    return true;
  }

  /* render only when it can be seen */
  let visible = true, running = false, idleFrames = 0, disposed = false;
  const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) wake(); }, { threshold: 0.05 });
  io.observe(host);
  const onVis = () => { if (!document.hidden) wake(); };
  document.addEventListener('visibilitychange', onVis);
  function resize() {
    const w = Math.max(1, host.clientWidth), h = Math.max(1, host.clientHeight);
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); wake();
  }
  const ro = new ResizeObserver(resize); ro.observe(host); resize();
  function wake() { idleFrames = 0; if (!running && !disposed) { running = true; clock.getDelta(); requestAnimationFrame(frame); } }
  // phones draw at most 30 frames a second
  const minGap = phone ? 1000 / 31 : 0; let last = 0;
  function frame(now = performance.now()) {
    if (disposed || !visible || document.hidden) { running = false; return; }
    if (minGap && now - last < minGap) { requestAnimationFrame(frame); return; }
    last = now;
    const dt = Math.min(clock.getDelta(), 0.1);
    mixer?.update(dt);
    const moved = controls.update();
    renderer.render(scene, camera);
    // with an animation playing we keep going; a still model stops rendering after a short while
    if (!mixer && !moved && ++idleFrames > 30) { running = false; return; }
    requestAnimationFrame(frame);
  }
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); say('error', new Error('context lost')); });

  const api = {
    setModel, play,
    zoom(f) { const d = camera.position.clone().sub(controls.target); const len = THREE.MathUtils.clamp(d.length() * f, controls.minDistance, controls.maxDistance); camera.position.copy(controls.target).add(d.setLength(len)); controls.update(); wake(); },
    rotate(rad) { controls.autoRotate = false; const d = camera.position.clone().sub(controls.target); d.applyAxisAngle(new THREE.Vector3(0, 1, 0), rad); camera.position.copy(controls.target).add(d); controls.update(); wake(); },
    reset() { goHome(); },
    setAutoRotate(on) { controls.autoRotate = !!on && !reduced; wake(); },
    dispose() {
      disposed = true; io.disconnect(); ro.disconnect(); document.removeEventListener('visibilitychange', onVis);
      disposeModel(); controls.dispose(); shadow.geometry.dispose(); shadow.material.dispose(); shadowTex.dispose();
      renderer.dispose(); renderer.forceContextLoss(); canvas.remove();
    },
  };
  // keyboard: arrows turn, + / - zoom, 0 resets (the stage is focusable)
  host.addEventListener('keydown', (e) => {
    const k = e.key;
    if (k === 'ArrowLeft') api.rotate(-0.35); else if (k === 'ArrowRight') api.rotate(0.35);
    else if (k === '+' || k === '=') api.zoom(0.85); else if (k === '-' || k === '_') api.zoom(1.18); else if (k === '0') api.reset(); else return;
    e.preventDefault();
  });
  if (opts.model) await setModel(opts.model, opts.animations);
  return api;
}
