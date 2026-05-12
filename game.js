import confetti from "https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.3/dist/confetti.module.mjs";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

/* ================= CONFIG ================= */
const MAX_GEN = 4;
const IS_MOBILE = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
const IS_IOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
const PRELOAD_COUNT = IS_MOBILE ? 3 : 8;

/* ================= STATE ================= */
const pokemonByGen = {};
const formsByGen = {};

let pokemonList = [];
let currentPokemon = "";

let streak = 0;
let guessed = false;

let awesompleteInstance = null;
let currentModel = null;

let silhouetteMode = true;

let bestStreak = localStorage.getItem("bestStreak")
  ? parseInt(localStorage.getItem("bestStreak"))
  : 0;

/* ================= PRELOAD CACHE ================= */
// preloadedModels[pokemon] = { scene, animations } once loaded
const preloadedModels = {};
// set of pokemon currently being fetched (avoid duplicate requests)
const preloadingNow = new Set();

/* ================= DOM ================= */
const badgeEl = document.getElementById("badge");
const guessInput = document.getElementById("guess");
const guessButton = document.getElementById("guessButton");
const nextButton = document.getElementById("nextButton");
const pokemonNameEl = document.getElementById("pokemonName");
const toggleSilhouetteBtn = document.getElementById("toggleSilhouetteBtn");
const eyeOpen = document.getElementById("eyeOpen");
const eyeClosed = document.getElementById("eyeClosed");
const copyBtn = document.getElementById("copyBtn");

/* ================= THREE ================= */
const canvas = document.getElementById("pokemonCanvas");

const renderer = new THREE.WebGLRenderer({
  canvas,
  alpha: true,
  antialias: true,
  preserveDrawingBuffer: true
});

renderer.setPixelRatio(window.devicePixelRatio);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 1000);
scene.add(camera);

const loader = new GLTFLoader();

/* ================= RESIZE ================= */
function resizeRenderer() {
  const container = document.querySelector(".pokemon-container");
  if (!container) return;

  const width = container.clientWidth;
  const height = container.clientHeight;

  renderer.setSize(width, height, false);

  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

window.addEventListener("resize", resizeRenderer);

/* ================= PERFECT ITERATIVE CAMERA FIT ================= */
const CHECK_RES = 64;

const edgeCheckTarget = new THREE.WebGLRenderTarget(
  CHECK_RES,
  CHECK_RES,
  {
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType
  }
);

function edgesContainPixels(pixels, width, height, margin = 1) {
  for (let y = 0; y < margin; y++) {
    for (let x = 0; x < width; x++) {
      const top    = ((y * width + x) * 4) + 3;
      const bottom = ((((height - 1 - y) * width) + x) * 4) + 3;
      if (pixels[top]    > 0) return true;
      if (pixels[bottom] > 0) return true;
    }
  }
  for (let x = 0; x < margin; x++) {
    for (let y = 0; y < height; y++) {
      const left  = ((y * width + x) * 4) + 3;
      const right = ((y * width + (width - 1 - x)) * 4) + 3;
      if (pixels[left]  > 0) return true;
      if (pixels[right] > 0) return true;
    }
  }
  return false;
}

function getScreenSilhouetteBounds(pixels, width, height) {
  let minX = width, maxX = 0;
  let minY = height, maxY = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = pixels[(y * width + x) * 4 + 3];
      if (alpha > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  return { minX, maxX, minY, maxY };
}

function fitCameraToObjectIterative(object, direction) {
  const box = new THREE.Box3().setFromObject(object);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());

  const dir = direction.clone().normalize();
  const up = new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3().crossVectors(dir, up).normalize();

  let distance = Math.max(size.x, size.y, size.z) * 1.5;
  let target = center.clone();

  const pixels = new Uint8Array(CHECK_RES * CHECK_RES * 4);

  function placeCamera() {
    camera.position.copy(target.clone().add(dir.clone().multiplyScalar(distance)));
    camera.lookAt(target);
    camera.near = distance / 100;
    camera.far = distance * 100;
    camera.updateProjectionMatrix();
  }

  function renderCheck() {
    renderer.setRenderTarget(edgeCheckTarget);
    renderer.render(scene, camera);
    renderer.readRenderTargetPixels(edgeCheckTarget, 0, 0, CHECK_RES, CHECK_RES, pixels);
    renderer.setRenderTarget(null);
    return edgesContainPixels(pixels, CHECK_RES, CHECK_RES, 1);
  }

  placeCamera();

  let clipped = renderCheck();
  let safety = 0;

  while (clipped && safety++ < 100) {
    distance *= 1.05;
    placeCamera();
    clipped = renderCheck();
  }

  safety = 0;
  while (!clipped && safety++ < 100) {
    const prev = distance;
    distance *= 0.98;
    placeCamera();
    clipped = renderCheck();
    if (clipped) {
      distance = prev;
      placeCamera();
      break;
    }
  }

  distance *= 1.005;
  placeCamera();

  renderer.setRenderTarget(edgeCheckTarget);
  renderer.render(scene, camera);
  renderer.readRenderTargetPixels(edgeCheckTarget, 0, 0, CHECK_RES, CHECK_RES, pixels);
  renderer.setRenderTarget(null);

  const bounds = getScreenSilhouetteBounds(pixels, CHECK_RES, CHECK_RES);

  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;

  const dx = (cx - CHECK_RES / 2) / CHECK_RES;
  const dy = (cy - CHECK_RES / 2) / CHECK_RES;

  const panScale = distance * 0.6;

  target.add(right.clone().multiplyScalar(-dx * panScale));
  target.add(up.clone().multiplyScalar(dy * panScale));

  placeCamera();

  clipped = renderCheck();
  safety = 0;

  while (!clipped && safety++ < 100) {
    const prev = distance;
    distance *= 0.99;
    placeCamera();
    clipped = renderCheck();
    if (clipped) {
      distance = prev;
      placeCamera();
      break;
    }
  }

  distance *= 1.002;
  placeCamera();
}

/* ================= CAMERA ================= */
function randomCameraDirection() {
  const theta = 2 * Math.PI * Math.random();
  const phi   = Math.acos(2 * Math.random() - 1);
  return new THREE.Vector3(
    Math.sin(phi) * Math.cos(theta),
    Math.cos(phi),
    Math.sin(phi) * Math.sin(theta)
  );
}

/* ================= MATERIALS ================= */
function makeFlatMaterial(original) {
  const mat = new THREE.MeshBasicMaterial({
    map: original.map || null,
    color: 0xffffff,

    transparent: original.transparent ?? false,
    opacity: original.opacity ?? 1,

    alphaMap: original.alphaMap || null,
    alphaTest: original.alphaTest ?? 0,

    side: THREE.DoubleSide,

    blending: original.blending ?? THREE.NormalBlending,

    depthWrite: original.depthWrite ?? true,
    depthTest: original.depthTest ?? true,

    premultipliedAlpha: original.premultipliedAlpha ?? false
  });

  mat.needsUpdate = true;
  return mat;
}

function applyFlatMaterials(model) {
  model.traverse(child => {
    if (!child.isMesh) return;
    if (!child.userData.originalMaterial) {
      child.userData.originalMaterial = child.material;
    }
    child.material = makeFlatMaterial(child.userData.originalMaterial);
  });
}

function applySilhouette(model) {
  model.traverse(child => {
    if (!child.isMesh) return;

    const original = child.userData.originalMaterial || child.material;

    child.material = new THREE.MeshBasicMaterial({
      color: 0x000000,

      // preserve transparency info
      map: original.map || null,
      alphaMap: original.alphaMap || null,

      transparent: original.transparent ?? true,
      opacity: original.opacity ?? 1,

      alphaTest: original.alphaTest ?? 0.01,

      side: THREE.DoubleSide,

      blending: original.blending ?? THREE.NormalBlending,

      depthWrite: original.depthWrite ?? true,
      depthTest: original.depthTest ?? true,

      premultipliedAlpha: original.premultipliedAlpha ?? false
    });

    child.material.needsUpdate = true;
  });

  silhouetteMode = true;
  renderOnce();
}

function restoreFlat(model) {
  applyFlatMaterials(model);
  silhouetteMode = false;
  renderOnce();
}

/* ================= MODEL PATH ================= */
function getModelPath(pokemon) {
  return `./public/models/${pokemon}.glb`;
}

/* ================= PRELOAD SYSTEM ================= */

/**
 * Fetch and parse a GLB for a given pokemon name.
 * Stores { scene, animations } in preloadedModels[pokemon] when done.
 * Safe to call multiple times — deduplicates in-flight requests.
 */
function preloadPokemon(pokemon) {
  if (preloadedModels[pokemon] || preloadingNow.has(pokemon)) return;
  preloadingNow.add(pokemon);

  loader.load(
    getModelPath(pokemon),
    (gltf) => {
      // Freeze animation on frame 0 the same way displayPokemon does
      if (gltf.animations && gltf.animations.length > 0) {
        const mixer = new THREE.AnimationMixer(gltf.scene);
        const action = mixer.clipAction(gltf.animations[0]);
        action.play();
        mixer.setTime(0);
        action.paused = true;
      }

      // Pre-traverse to tag frustum culling off (same as displayPokemon)
      gltf.scene.traverse(child => {
        if (child.isMesh) child.frustumCulled = false;
      });

      preloadedModels[pokemon] = { scene: gltf.scene, animations: gltf.animations };
      preloadingNow.delete(pokemon);
    },
    undefined,
    (err) => {
      console.warn("Preload failed:", pokemon, err);
      preloadingNow.delete(pokemon);
    }
  );
}

/**
 * Fill the preload cache up to PRELOAD_COUNT with random pokemon
 * that aren't already cached or in-flight.
 */
function refillPreloadQueue() {
  const cached = new Set([...Object.keys(preloadedModels), ...preloadingNow]);
  // Don't count the current pokemon toward the limit
  cached.delete(currentPokemon);

  let attempts = 0;
  while (cached.size < PRELOAD_COUNT && attempts++ < pokemonList.length * 2) {
    const candidate = pokemonList[Math.floor(Math.random() * pokemonList.length)];
    if (!cached.has(candidate)) {
      cached.add(candidate);
      preloadPokemon(candidate);
    }
  }
}

/** Clear all cached models and history (called when settings change). */
function clearPreloadCache() {
  for (const key of Object.keys(preloadedModels)) {
    delete preloadedModels[key];
  }
  preloadingNow.clear();
  recentlyShown.length = 0;
}

/* ================= DISPLAY POKEMON ================= */
function displayPokemon(pokemon) {
  guessed = false;
  currentPokemon = pokemon;

  guessInput.value = "";
  guessInput.disabled = false;
  guessButton.disabled = false;

  nextButton.textContent = "Skip";

  badgeEl.style.opacity = 0;
  pokemonNameEl.style.opacity = 0;

  toggleSilhouetteBtn.style.display = "none";
  eyeOpen.style.display = "block";
  eyeClosed.style.display = "none";

  if (currentModel) {
    scene.remove(currentModel);
    currentModel = null;
  }

  const cached = preloadedModels[pokemon];

  if (cached) {
    // ── Fast path: model already in cache ──
    instantiateModel(cached.scene, cached.animations);
  } else {
    // ── Slow path: load on demand ──
    loader.load(
      getModelPath(pokemon),
      (gltf) => {
        if (gltf.animations && gltf.animations.length > 0) {
          const mixer = new THREE.AnimationMixer(gltf.scene);
          const action = mixer.clipAction(gltf.animations[0]);
          action.play();
          mixer.setTime(0);
          action.paused = true;
        }

        gltf.scene.traverse(child => {
          if (child.isMesh) child.frustumCulled = false;
        });

        // Store in cache so toggling silhouette etc. still works
        preloadedModels[pokemon] = { scene: gltf.scene, animations: gltf.animations };

        // Only display if still the active pokemon (user may have skipped)
        if (pokemon === currentPokemon) {
          instantiateModel(gltf.scene, gltf.animations);
        }
      },
      undefined,
      (err) => {
        console.error("Failed loading model:", pokemon, err);
      }
    );
  }

  guessInput.focus();
}

/** Place a (possibly preloaded) gltf scene into the Three.js scene and render. */
function instantiateModel(gltfScene, animations) {
  // Animations were already frozen at frame 0 during preload; nothing extra needed.
  currentModel = gltfScene;
  scene.add(currentModel);
  currentModel.updateMatrixWorld(true);
  scene.updateMatrixWorld(true);

  resizeRenderer();

  applyFlatMaterials(currentModel);
  fitCameraToObjectIterative(currentModel, randomCameraDirection());
  camera.updateMatrixWorld(true);
  renderer.render(scene, camera);

  applySilhouette(currentModel);
  renderOnce();
}

/* ================= NEXT POKEMON ================= */
// Track recently seen pokemon to avoid short-cycle repeats
const recentlyShown = [];
const RECENT_LIMIT = Math.min(20, Math.floor((pokemonList.length || 100) * 0.1));

function pickNextPokemon() {
  // Candidates: preloaded and not recently shown, excluding current
  let candidates = pokemonList.filter(
    p => preloadedModels[p] && p !== currentPokemon && !recentlyShown.includes(p)
  );

  // Fall back to any preloaded (not current)
  if (!candidates.length) {
    candidates = pokemonList.filter(p => preloadedModels[p] && p !== currentPokemon);
  }

  // Fall back to full pool excluding recent
  if (!candidates.length) {
    candidates = pokemonList.filter(p => p !== currentPokemon && !recentlyShown.includes(p));
  }

  // Last resort: anything but current
  if (!candidates.length) {
    candidates = pokemonList.filter(p => p !== currentPokemon);
  }

  // Ultimate fallback
  if (!candidates.length) return pokemonList[Math.floor(Math.random() * pokemonList.length)];

  return candidates[Math.floor(Math.random() * candidates.length)];
}

function displayNextPokemon() {
  if (!pokemonList.length) return;

  const pick = pickNextPokemon();

  // Evict from cache after grabbing — the entry is still referenced by
  // displayPokemon via preloadedModels[pick], so evict right after that call.
  displayPokemon(pick);
  delete preloadedModels[pick];

  // Record as recently shown
  recentlyShown.push(pick);
  if (recentlyShown.length > RECENT_LIMIT) recentlyShown.shift();

  // Kick off background preloading after handing off to the browser
  const scheduleRefill = "requestIdleCallback" in window
    ? cb => requestIdleCallback(cb)
    : cb => setTimeout(cb, 100);

  scheduleRefill(refillPreloadQueue);
}

/* ================= RENDER LOOP ================= */
function renderOnce() {
  renderer.render(scene, camera);
}

/* ================= DATA LOADING ================= */
async function loadPokemonList() {
  try {
    const promises = [];

    for (let gen = 1; gen <= MAX_GEN; gen++) {
      promises.push(
        fetch(`./public/gen${gen}_pokemon.txt`)
          .then(r => r.text())
          .then(t => { pokemonByGen[gen] = t.split(/\r?\n/).filter(Boolean); })
      );
      promises.push(
        fetch(`./public/gen${gen}_forms.txt`)
          .then(r => r.text())
          .then(t => { formsByGen[gen] = t.split(/\r?\n/).filter(Boolean); })
      );
    }

    await Promise.all(promises);

    document.getElementById("bestStreak").textContent = bestStreak;

    updatePokemonPool();
    displayNextPokemon();

  } catch (err) {
    console.error(err);
  }
}

/* ================= POOL ================= */
function updatePokemonPool() {
  const includeForms = document.getElementById("includeForms").checked;
  let pool = [];

  for (let gen = 1; gen <= MAX_GEN; gen++) {
    const cb = document.getElementById(`gen${gen}`);
    if (cb?.checked) {
      pool.push(...pokemonByGen[gen]);
      if (includeForms) pool.push(...formsByGen[gen]);
    }
  }

  pokemonList = pool;
  setupAwesomplete();
}

/* ================= GUESS ================= */
function checkGuess() {
  if (guessed) return;

  const guess = guessInput.value.trim().toLowerCase();

  if (guess === currentPokemon.toLowerCase()) {
    restoreFlat(currentModel);
    renderOnce();

    toggleSilhouetteBtn.style.display = "inline-flex";

    streak++;
    document.getElementById("streak").textContent = streak;

    if (streak > bestStreak) {
      bestStreak = streak;
      localStorage.setItem("bestStreak", bestStreak);
      document.getElementById("bestStreak").textContent = bestStreak;
    }

    badgeEl.style.opacity = 1;
    confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 } });

    guessInput.disabled = true;
    guessButton.disabled = true;
    nextButton.textContent = "Next";

    guessed = true;

  } else {
    streak = 0;
    document.getElementById("streak").textContent = streak;
  }
}

/* ================= AUTOCOMPLETE ================= */
function setupAwesomplete() {
  const enabled = document.getElementById("enableAutocomplete").checked;

  if (!enabled) {
    if (awesompleteInstance) {
      awesompleteInstance.destroy();
      awesompleteInstance = null;
    }
    return;
  }

  const list = pokemonList.slice().sort();

  if (!awesompleteInstance) {
    awesompleteInstance = new Awesomplete(guessInput, {
      list,
      minChars: 1,
      maxItems: 8,
      autoFirst: true,
      filter: Awesomplete.FILTER_CONTAINS
    });
  } else {
    awesompleteInstance.list = list;
  }
}

/* ================= COPY ================= */
copyBtn.addEventListener("click", async () => {
  const offscreen = document.createElement("canvas");

  offscreen.width  = canvas.width;
  offscreen.height = canvas.height;

  const ctx = offscreen.getContext("2d");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, offscreen.width, offscreen.height);

  ctx.drawImage(canvas, 0, 0);

  if (guessed && !silhouetteMode) {
    const w = offscreen.width;
    const h = offscreen.height;

    const fontSize = Math.floor(h * 0.05);

    ctx.font = `bold ${fontSize}px Arial`;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";

    const x = w / 2;
    const y = h - h * 0.05;

    ctx.strokeStyle = "#333";
    ctx.lineWidth = Math.max(2, fontSize * 0.12);

    ctx.strokeText(currentPokemon, x, y);

    ctx.fillStyle = "#ffffff";
    ctx.fillText(currentPokemon, x, y);
  }

  let newTab = null;

  if (IS_IOS) {
    newTab = window.open("", "_blank");
  }

  offscreen.toBlob(async (blob) => {
    if (!blob) return;

    const url = URL.createObjectURL(blob);

    if (IS_IOS) {
      newTab.location.href = url;
      return;
    }

    if (!navigator.clipboard?.write) {
      window.open(url, "_blank");
      return;
    }

    try {
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": blob })
      ]);

      copyBtn.classList.add("copied");

      setTimeout(() => {
        copyBtn.classList.remove("copied");
      }, 500);

    } catch (err) {
      console.error("Clipboard failed:", err);
      window.open(url, "_blank");
    }

  }, "image/png");
});

/* ================= EVENTS ================= */
guessButton.addEventListener("click", checkGuess);

document.addEventListener("keydown", e => {
  if (e.key === "Enter") {
    guessed ? displayNextPokemon() : checkGuess();
  }
});

nextButton.addEventListener("click", () => {
  if (!guessed) {
    restoreFlat(currentModel);
    renderOnce();

    toggleSilhouetteBtn.style.display = "inline-flex";

    pokemonNameEl.textContent = currentPokemon;
    pokemonNameEl.style.opacity = 1;

    guessInput.disabled = true;
    guessButton.disabled = true;
    nextButton.textContent = "Next";

    guessed = true;
    streak = 0;
    document.getElementById("streak").textContent = streak;

  } else {
    displayNextPokemon();
  }
});

/* ================= TOGGLE SILHOUETTE ================= */
toggleSilhouetteBtn.addEventListener("click", () => {
  if (!currentModel) return;

  if (silhouetteMode) {
    restoreFlat(currentModel);

    pokemonNameEl.textContent = currentPokemon;
    pokemonNameEl.style.opacity = 1;

    eyeOpen.style.display = "none";
    eyeClosed.style.display = "block";
  } else {
    applySilhouette(currentModel);

    pokemonNameEl.style.opacity = 0;

    eyeOpen.style.display = "block";
    eyeClosed.style.display = "none";
  }
});

/* ================= SETTINGS ================= */
function saveSettings() {
  localStorage.setItem("includeForms",
    document.getElementById("includeForms").checked);

  localStorage.setItem("enableAutocomplete",
    document.getElementById("enableAutocomplete").checked);

  for (let gen = 1; gen <= MAX_GEN; gen++) {
    localStorage.setItem(`gen${gen}`,
      document.getElementById(`gen${gen}`).checked);
  }
}

function loadSettings() {
  document.getElementById("includeForms").checked =
    localStorage.getItem("includeForms") === "true";

  document.getElementById("enableAutocomplete").checked =
    localStorage.getItem("enableAutocomplete") === "true";

  for (let gen = 1; gen <= MAX_GEN; gen++) {
    const saved = localStorage.getItem(`gen${gen}`);
    if (saved !== null) {
      document.getElementById(`gen${gen}`).checked =
        saved === "true";
    }
  }
}

document.addEventListener("change", e => {
  saveSettings();
  if (e.target.id === "includeForms" || /^gen\d+$/.test(e.target.id)) {
    streak = 0;
    document.getElementById("streak").textContent = streak;

    // Pool changed — cached models from old pool may no longer be valid
    clearPreloadCache();
    updatePokemonPool();
    displayNextPokemon();
  } else if (e.target.id === "enableAutocomplete") {
    setupAwesomplete();
  }
});

/* ================= UI ================= */
function renderGenCheckboxes() {
  const container = document.getElementById("genChecklist");
  for (let gen = 1; gen <= MAX_GEN; gen++) {
    const label = document.createElement("label");
    label.innerHTML = `<input type="checkbox" id="gen${gen}" checked /> Gen ${gen}`;
    container.appendChild(label);
  }
}

function disableLastGenCheckbox() {
  const genCheckboxes =
    document.querySelectorAll("#genChecklist input[type=checkbox]");

  function updateDisabledState() {
    const checked = Array.from(genCheckboxes).filter(cb => cb.checked);
    genCheckboxes.forEach(cb => { cb.disabled = false; });
    if (checked.length === 1) checked[0].disabled = true;
  }

  genCheckboxes.forEach(cb => {
    cb.addEventListener("change", updateDisabledState);
  });

  updateDisabledState();
}

/* ================= INIT ================= */
document.addEventListener("DOMContentLoaded", () => {
  renderGenCheckboxes();
  loadSettings();
  disableLastGenCheckbox();
  resizeRenderer();
  loadPokemonList();

  document.getElementById("settingsBtn").addEventListener("click", () => {
    const panel = document.getElementById("settingsPanel");
    panel.style.display = panel.style.display === "block" ? "none" : "block";
  });
});