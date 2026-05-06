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

let bestStreak = localStorage.getItem("bestStreak")
  ? parseInt(localStorage.getItem("bestStreak"))
  : 0;

/* ================= DOM (OG STYLE) ================= */
const badgeEl = document.getElementById("badge");
const guessInput = document.getElementById("guess");
const guessButton = document.getElementById("guessButton");
const nextButton = document.getElementById("nextButton");
const pokemonNameEl = document.getElementById("pokemonName");

const toggleSilhouetteBtn = document.getElementById("toggleSilhouetteBtn");
const eyeOpen = document.getElementById("eyeOpen");
const eyeClosed = document.getElementById("eyeClosed");
const copyBtn = document.getElementById("copyBtn");

/* ================= THREE SETUP ================= */
const canvas = document.getElementById("pokemonCanvas");

const renderer = new THREE.WebGLRenderer({
  canvas,
  alpha: true,
  antialias: true
});

renderer.setSize(400, 400);

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
camera.position.set(2, 2, 2);
camera.lookAt(0, 0, 0);

const loader = new GLTFLoader();

let currentModel = null;

/* ================= LIGHTING ================= */
const light1 = new THREE.DirectionalLight(0xffffff, 1);
light1.position.set(2, 2, 2);
scene.add(light1);

const light2 = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(light2);

/* ================= CAMERA (TRUE UNIFORM SPHERE) ================= */
function randomCameraPosition(radius = 2.5) {
  const u = Math.random();
  const v = Math.random();

  const theta = 2 * Math.PI * u;
  const phi = Math.acos(2 * v - 1);

  camera.position.set(
    radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta)
  );

  camera.lookAt(0, 0, 0);
}

/* ================= MATERIALS ================= */
function applySilhouette(model) {
  model.traverse(child => {
    if (child.isMesh) {
      child.material = new THREE.MeshBasicMaterial({ color: 0x000000 });
    }
  });
}

function restoreMaterial(model) {
  model.traverse(child => {
    if (child.isMesh && child.userData.originalMaterial) {
      child.material = child.userData.originalMaterial;
    }
  });
}

/* ================= DISPLAY (OG STYLE FUNCTION NAME) ================= */
function displayPokemon(pokemon) {
  guessed = false;
  currentPokemon = pokemon;

  guessInput.value = "";
  guessInput.disabled = false;
  guessButton.disabled = false;
  nextButton.textContent = "Skip";

  badgeEl.style.opacity = 0;
  pokemonNameEl.style.opacity = 0;

  if (currentModel) {
    scene.remove(currentModel);
    currentModel = null;
  }

  const modelName = pokemon.replace(/\./g, "");

  loader.load(`./models/${modelName}.glb`, (gltf) => {
    currentModel = gltf.scene;

    currentModel.traverse(child => {
      if (child.isMesh) {
        child.userData.originalMaterial = child.material;
      }
    });

    scene.add(currentModel);

    randomCameraPosition();
    applySilhouette(currentModel);
  });
}

/* ================= RENDER LOOP ================= */
function animate() {
  requestAnimationFrame(animate);
  renderer.render(scene, camera);
}
animate();

/* ================= DATA LOADING (OG STRUCTURE KEPT) ================= */
async function loadPokemonList() {
  const promises = [];

  for (let gen = 1; gen <= MAX_GEN; gen++) {
    promises.push(
      fetch(`./public/gen${gen}_pokemon.txt`)
        .then(r => r.text())
        .then(t => pokemonByGen[gen] = t.split(/\r?\n/).filter(Boolean))
    );

    promises.push(
      fetch(`./public/gen${gen}_forms.txt`)
        .then(r => r.text())
        .then(t => formsByGen[gen] = t.split(/\r?\n/).filter(Boolean))
    );
  }

  await Promise.all(promises);

  document.getElementById("bestStreak").textContent = bestStreak;

  updatePokemonPool();
  displayNextPokemon();
}

/* ================= POOL (UNCHANGED LOGIC STYLE) ================= */
function updatePokemonPool() {
  const includeForms = document.getElementById("includeForms").checked;

  let pool = [];

  for (let gen = 1; gen <= MAX_GEN; gen++) {
    if (document.getElementById(`gen${gen}`).checked) {
      pool.push(...pokemonByGen[gen]);

      if (includeForms) {
        pool.push(...formsByGen[gen]);
      }
    }
  }

  pokemonList = pool;
  setupAwesomplete();
}

/* ================= NEXT ================= */
function displayNextPokemon() {
  if (!pokemonList.length) return;

  const p = pokemonList[Math.floor(Math.random() * pokemonList.length)];
  displayPokemon(p);
}

/* ================= GUESS ================= */
function checkGuess() {
  if (guessed) return;

  if (guessInput.value.trim().toLowerCase() === currentPokemon.toLowerCase()) {
    restoreMaterial(currentModel);

    streak++;
    document.getElementById("streak").textContent = streak;

    if (streak > bestStreak) {
      bestStreak = streak;
      localStorage.setItem("bestStreak", bestStreak);
      document.getElementById("bestStreak").textContent = bestStreak;
    }

    confetti({ particleCount: 150, spread: 70 });

    badgeEl.style.opacity = 1;

    guessInput.disabled = true;
    guessButton.disabled = true;
    nextButton.textContent = "Next";

    guessed = true;
  } else {
    streak = 0;
    document.getElementById("streak").textContent = streak;
  }
}

/* ================= EVENTS (OG STYLE) ================= */
guessButton.addEventListener("click", checkGuess);

document.addEventListener("keydown", e => {
  if (e.key === "Enter") {
    guessed ? displayNextPokemon() : checkGuess();
  }
});

nextButton.addEventListener("click", () => {
  if (!guessed) {
    restoreMaterial(currentModel);
    pokemonNameEl.textContent = currentPokemon;
    pokemonNameEl.style.opacity = 1;

    streak = 0;
    document.getElementById("streak").textContent = streak;

    guessed = true;
    nextButton.textContent = "Next";
  } else {
    displayNextPokemon();
  }
});

/* ================= TOGGLE SILHOUETTE ================= */
toggleSilhouetteBtn.addEventListener("click", () => {
  if (!currentModel) return;

  const isSil = currentModel.userData.isSilhouette;

  if (isSil) {
    restoreMaterial(currentModel);
  } else {
    applySilhouette(currentModel);
  }

  currentModel.userData.isSilhouette = !isSil;

  eyeOpen.style.display = isSil ? "block" : "none";
  eyeClosed.style.display = isSil ? "none" : "block";
});

/* ================= COPY (UNCHANGED IDEA) ================= */
copyBtn.addEventListener("click", async () => {
  const dataURL = renderer.domElement.toDataURL("image/png");
  const blob = await (await fetch(dataURL)).blob();

  try {
    await navigator.clipboard.write([
      new ClipboardItem({ "image/png": blob })
    ]);
  } catch {
    window.open(dataURL, "_blank");
  }
});

/* ================= AUTOCOMPLETE (UNCHANGED STYLE) ================= */
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
      autoFirst: true
    });
  } else {
    awesompleteInstance.list = list;
  }
}

/* ================= INIT (OG ORDER PRESERVED) ================= */
document.addEventListener("DOMContentLoaded", () => {
  renderGenCheckboxes();
  loadPokemonList();

  document.getElementById("settingsBtn").addEventListener("click", () => {
    const panel = document.getElementById("settingsPanel");
    panel.style.display =
      panel.style.display === "block" ? "none" : "block";
  });
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