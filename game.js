import confetti from "https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.3/dist/confetti.module.mjs";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

/* ================= CONFIG ================= */
const MAX_GEN = 4;

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

  // =========================
  // STEP 1: INITIAL FIT (ZOOM OUT / IN)
  // =========================
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

  // =========================
  // STEP 2: CENTERING PASS (NEW)
  // =========================
  renderer.setRenderTarget(edgeCheckTarget);
  renderer.render(scene, camera);
  renderer.readRenderTargetPixels(edgeCheckTarget, 0, 0, CHECK_RES, CHECK_RES, pixels);
  renderer.setRenderTarget(null);

  const bounds = getScreenSilhouetteBounds(pixels, CHECK_RES, CHECK_RES);

  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;

  const dx = (cx - CHECK_RES / 2) / CHECK_RES;
  const dy = (cy - CHECK_RES / 2) / CHECK_RES;

  // tune factor (scene dependent)
  const panScale = distance * 0.6;

  target.add(right.clone().multiplyScalar(-dx * panScale));
  target.add(up.clone().multiplyScalar(dy * panScale));

  placeCamera();

  // =========================
  // STEP 3: RE-FIT AFTER CENTERING (NEW)
  // =========================
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
  return new THREE.MeshBasicMaterial({
    map: original.map || null,
    transparent: true,
    alphaTest: 0.01,
    side: THREE.DoubleSide,
    color: 0xffffff
  });
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
    child.material = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      alphaTest: 0.01,
      side: THREE.DoubleSide
    });
  });
  silhouetteMode = true;
  renderOnce();
}

function restoreFlat(model) {
  applyFlatMaterials(model);
  silhouetteMode = false;
  renderOnce();
}

/* ================= MODEL ================= */
function getModelPath(pokemon) {
  return `./public/models/${pokemon.replace(/\./g, "")}.glb`;
}

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

  loader.load(
    getModelPath(pokemon),
    (gltf) => {
      currentModel = gltf.scene;

      currentModel.traverse(child => {
        if (child.isMesh) child.frustumCulled = false;
      });

      scene.add(currentModel);
      currentModel.updateMatrixWorld(true);
      scene.updateMatrixWorld(true);

      //
      // FREEZE ANIMATION ON FIRST FRAME
      //
      if (gltf.animations && gltf.animations.length > 0) {

        const mixer = new THREE.AnimationMixer(currentModel);

        const action = mixer.clipAction(gltf.animations[0]);

        action.play();

        // evaluate frame 0
        mixer.setTime(0);

        // stop future playback
        action.paused = true;
      }

      resizeRenderer();

      applyFlatMaterials(currentModel);
      fitCameraToObjectIterative(currentModel, randomCameraDirection());
      camera.updateMatrixWorld(true);
      renderer.render(scene, camera);

      applySilhouette(currentModel);

      renderOnce();
    },
    undefined,
    (err) => {
      console.error("Failed loading model:", pokemon, err);
    }
  );
}

/* ================= RENDER LOOP ================= */
function renderOnce() {
  renderer.render(scene, camera);
}

/* ================= DATA ================= */
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

/* ================= NEXT ================= */
function displayNextPokemon() {
  if (!pokemonList.length) return;
  const pokemon = pokemonList[Math.floor(Math.random() * pokemonList.length)];
  displayPokemon(pokemon);
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

  // white background
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, offscreen.width, offscreen.height);

  // draw 3D canvas
  ctx.drawImage(canvas, 0, 0);

  // optional name label
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

  const dataURL = offscreen.toDataURL("image/png");
  const blob = await (await fetch(dataURL)).blob();

  try {
    await navigator.clipboard.write([
      new ClipboardItem({ "image/png": blob })
    ]);

    copyBtn.classList.add("copied");
    setTimeout(() => copyBtn.classList.remove("copied"), 500);
  } catch {
    window.open(dataURL, "_blank");
  }
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

/* ================= TOGGLE ================= */
toggleSilhouetteBtn.addEventListener("click", () => {
  if (!currentModel) return;

  if (silhouetteMode) {
    restoreFlat(currentModel);
    eyeOpen.style.display = "none";
    eyeClosed.style.display = "block";
  } else {
    applySilhouette(currentModel);
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

/* ================= INIT ================= */
document.addEventListener("DOMContentLoaded", () => {
  renderGenCheckboxes();
  loadSettings();
  resizeRenderer();
  loadPokemonList();

  document.getElementById("settingsBtn").addEventListener("click", () => {
    const panel = document.getElementById("settingsPanel");
    panel.style.display = panel.style.display === "block" ? "none" : "block";
  });
});