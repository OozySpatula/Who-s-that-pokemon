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

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);

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

  function placeCamera() {
    camera.position.copy(
      center.clone().add(dir.clone().multiplyScalar(distance))
    );
    camera.lookAt(center);
    camera.updateProjectionMatrix();
  }

  placeCamera();

  const pixels = new Uint8Array(CHECK_RES * CHECK_RES * 4);

  function renderCheck() {
    renderer.setRenderTarget(edgeCheckTarget);
    renderer.render(scene, camera);
    renderer.readRenderTargetPixels(
      edgeCheckTarget, 0, 0, CHECK_RES, CHECK_RES, pixels
    );
    renderer.setRenderTarget(null);
    return edgesContainPixels(pixels, CHECK_RES, CHECK_RES, 1);
  }

  // Zoom OUT until not clipped
  let clipped = renderCheck();
  let safety = 0;

  while (clipped && safety < 100) {
    distance *= 1.05;
    placeCamera();
    clipped = renderCheck();
    safety++;
  }

  // Zoom IN until just before clipping
  safety = 0;

  while (!clipped && safety < 100) {
    const previousDistance = distance;
    distance *= 0.98;
    placeCamera();
    clipped = renderCheck();

    if (clipped) {
      distance = previousDistance;
      placeCamera();
      break;
    }

    safety++;
  }

  // Small margin
  distance *= 1.02;
  placeCamera();

  camera.near = distance / 100;
  camera.far  = distance * 100;
  camera.updateProjectionMatrix();
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

      // Apply flat materials first so iterative fit
      // sees real alpha pixels, not silhouette black
      applyFlatMaterials(currentModel);

      fitCameraToObjectIterative(currentModel, randomCameraDirection());

      // Now switch to silhouette for the guess
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

/* ================= COPY ================= */
copyBtn.addEventListener("click", async () => {
  const dataURL = renderer.domElement.toDataURL("image/png");
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