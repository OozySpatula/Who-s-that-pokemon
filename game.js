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

  const size = Math.min(
    container.clientWidth,
    window.innerHeight * 0.65,
    500
  );

  renderer.setSize(size, size, false);
  camera.aspect = 1;
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

function fitCameraToObjectIterative(object, direction) {
  const box    = new THREE.Box3().setFromObject(object);
  const center = box.getCenter(new THREE.Vector3());
  const size   = box.getSize(new THREE.Vector3());

  let distance = Math.max(size.x, size.y, size.z) * 1.5;
  const dir = direction.clone().normalize();
  let target = center.clone();

  function placeCamera() {
    camera.position.copy(target.clone().add(dir.clone().multiplyScalar(distance)));
    camera.lookAt(target);
    camera.near = distance / 100;
    camera.far  = distance * 100;
    camera.updateProjectionMatrix();
  }

  const pixels = new Uint8Array(CHECK_RES * CHECK_RES * 4);

  function renderCheck() {
    renderer.setRenderTarget(edgeCheckTarget);
    renderer.render(scene, camera);
    renderer.readRenderTargetPixels(edgeCheckTarget, 0, 0, CHECK_RES, CHECK_RES, pixels);
    renderer.setRenderTarget(null);
    return edgesContainPixels(pixels, CHECK_RES, CHECK_RES, 1);
  }

  // STEP 1: Zoom out far enough to see the whole model
  placeCamera();
  let clipped = renderCheck();
  let safety = 0;
  while (clipped && safety < 100) {
    distance *= 1.05;
    placeCamera();
    clipped = renderCheck();
    safety++;
  }

  // STEP 2: Find visual centroid and correct the lookAt target
  {
    let sumX = 0, sumY = 0, count = 0;
    for (let y = 0; y < CHECK_RES; y++) {
      for (let x = 0; x < CHECK_RES; x++) {
        if (pixels[(y * CHECK_RES + x) * 4 + 3] > 0) {
          sumX += x;
          sumY += y;
          count++;
        }
      }
    }

    if (count > 0) {
      const ndcX =  (sumX / count / CHECK_RES) * 2 - 1;
      const ndcY = -((sumY / count / CHECK_RES) * 2 - 1);

      const halfH = Math.tan((camera.fov * Math.PI / 180) / 2) * distance;
      const halfW = halfH * camera.aspect;

      const forward = dir.clone().negate();
      const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
      const up    = new THREE.Vector3().crossVectors(right, forward).normalize();

      target.addScaledVector(right, ndcX * halfW);
      target.addScaledVector(up,    ndcY * halfH);

      placeCamera();
    }
  }

  // STEP 3: Zoom out again if recentering caused clipping
  clipped = renderCheck();
  safety = 0;
  while (clipped && safety < 100) {
    distance *= 1.05;
    placeCamera();
    clipped = renderCheck();
    safety++;
  }

  // STEP 4: Zoom in as tight as possible
  safety = 0;
  while (!clipped && safety < 100) {
    const prev = distance;
    distance *= 0.98;
    placeCamera();
    clipped = renderCheck();
    if (clipped) {
      distance = prev;
      placeCamera();
      break;
    }
    safety++;
  }

  // Tiny margin
  distance *= 1.005;
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
}

function restoreFlat(model) {
  applyFlatMaterials(model);
  silhouetteMode = false;
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
      resizeRenderer();

      applyFlatMaterials(currentModel);
      fitCameraToObjectIterative(currentModel, randomCameraDirection());
      applySilhouette(currentModel);
    },
    undefined,
    (err) => {
      console.error("Failed loading model:", pokemon, err);
    }
  );
}

/* ================= RENDER LOOP ================= */
function animate() {
  requestAnimationFrame(animate);
  renderer.render(scene, camera);
}

animate();

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

/* ================= CROP TRANSPARENT ================= */
function cropTransparent(srcCanvas) {
  const ctx = srcCanvas.getContext("2d");
  const { width, height } = srcCanvas;
  const pixels = ctx.getImageData(0, 0, width, height).data;

  const alpha = (x, y) => pixels[(y * width + x) * 4 + 3];

  let minY = 0;
  outer: for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) if (alpha(x, y)) { minY = y; break outer; }
  }

  let maxY = height - 1;
  outer: for (let y = height - 1; y >= 0; y--) {
    for (let x = 0; x < width; x++) if (alpha(x, y)) { maxY = y; break outer; }
  }

  let minX = 0;
  outer: for (let x = 0; x < width; x++) {
    for (let y = minY; y <= maxY; y++) if (alpha(x, y)) { minX = x; break outer; }
  }

  let maxX = width - 1;
  outer: for (let x = width - 1; x >= 0; x--) {
    for (let y = minY; y <= maxY; y++) if (alpha(x, y)) { maxX = x; break outer; }
  }

  const cropWidth  = maxX - minX + 1;
  const cropHeight = maxY - minY + 1;

  const cropped = document.createElement("canvas");
  cropped.width  = cropWidth;
  cropped.height = cropHeight;
  cropped.getContext("2d").drawImage(
    srcCanvas,
    minX, minY, cropWidth, cropHeight,
    0,    0,    cropWidth, cropHeight
  );

  return cropped;
}

/* ================= COPY ================= */
copyBtn.addEventListener("click", async () => {
  // Composite render onto white background
  const offscreen = document.createElement("canvas");
  offscreen.width  = canvas.width;
  offscreen.height = canvas.height;

  const ctx = offscreen.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, offscreen.width, offscreen.height);
  ctx.drawImage(canvas, 0, 0);

  // Crop transparent padding
  const cropped = cropTransparent(offscreen);
  const croppedCtx = cropped.getContext("2d");

  // Add name text only when revealed and not re-silhouetted
  if (guessed && !silhouetteMode) {
    const w = cropped.width;
    const h = cropped.height;
    const fontSize = Math.floor(h * 0.075);

    croppedCtx.font         = `bold ${fontSize}px Arial`;
    croppedCtx.textAlign    = "center";
    croppedCtx.textBaseline = "bottom";

    const x = w / 2;
    const y = h - h * 0.05;

    croppedCtx.strokeStyle = "#333";
    croppedCtx.lineWidth   = Math.max(2, fontSize * 0.12);
    croppedCtx.strokeText(currentPokemon, x, y);

    croppedCtx.fillStyle = "#ffffff";
    croppedCtx.fillText(currentPokemon, x, y);
  }

  const dataURL = cropped.toDataURL("image/png");
  const blob    = await (await fetch(dataURL)).blob();

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
document.addEventListener("change", e => {
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
  resizeRenderer();
  loadPokemonList();

  document.getElementById("settingsBtn").addEventListener("click", () => {
    const panel = document.getElementById("settingsPanel");
    panel.style.display = panel.style.display === "block" ? "none" : "block";
  });
});