import confetti from "https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.3/dist/confetti.module.mjs";

/* ================= CONFIG ================= */
const MAX_GEN = 4;
const IS_MOBILE = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
const IS_IOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
const PRELOAD_COUNT = IS_MOBILE ? 4 : 10;
const IMAGES_PER_POKEMON = 4;

/* ================= STATE ================= */
const pokemonByGen = {};
const formsByGen = {};
let pokemonList = [];
let currentPokemon = "";
let silhouetteIndex = 0;
let streak = 0;
let guessed = false;
let awesompleteInstance = null;

let bestStreak = localStorage.getItem("bestStreak")
  ? parseInt(localStorage.getItem("bestStreak"))
  : 0;

/* Preloaded images */
const preloadedImages = {};
const usedImagesThisSession = {};

/* ================= SETTINGS ================= */
const SETTINGS_KEY = "pokemonGuessSettings";

function saveSettings() {
  const settings = {
    includeForms: document.getElementById("includeForms").checked,
    enableAutocomplete: document.getElementById("enableAutocomplete").checked,
    gens: {}
  };
  for (let gen = 1; gen <= MAX_GEN; gen++) {
    const cb = document.getElementById(`gen${gen}`);
    if (cb) settings.gens[gen] = cb.checked;
  }
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function loadSettings() {
  const raw = localStorage.getItem(SETTINGS_KEY);
  if (!raw) return;
  try {
    const settings = JSON.parse(raw);
    document.getElementById("includeForms").checked = settings.includeForms ?? true;
    document.getElementById("enableAutocomplete").checked = settings.enableAutocomplete ?? true;
    if (settings.gens) {
      for (let gen = 1; gen <= MAX_GEN; gen++) {
        const cb = document.getElementById(`gen${gen}`);
        if (cb && gen in settings.gens) cb.checked = settings.gens[gen];
      }
    }
  } catch {}
}

/* ================= ELEMENTS ================= */
const badgeEl = document.getElementById("badge");
let pokemonImg = document.getElementById("pokemonImg");
const pokemonNameEl = document.getElementById("pokemonName");
const guessInput = document.getElementById("guess");
const guessButton = document.getElementById("guessButton");
const nextButton = document.getElementById("nextButton");

/* ================= UI ================= */
function renderGenCheckboxes() {
  const container = document.getElementById("genChecklist");
  for (let gen = 1; gen <= MAX_GEN; gen++) {
    const label = document.createElement("label");
    label.innerHTML = `<input type="checkbox" id="gen${gen}" checked /> Gen ${gen}`;
    container.appendChild(label);
  }
}

/* ================= PRIORITY QUEUE ================= */
class PriorityQueue {
  constructor() { this.items = []; }
  enqueue(item, priority) {
    this.items.push({ item, priority });
    this.items.sort((a, b) => b.priority - a.priority);
  }
  dequeue() { return this.items.shift()?.item; }
  size() { return this.items.length; }
}

const preloadQueue = new PriorityQueue();

/* ================= DATA LOADING ================= */
async function loadPokemonList() {
  try {
    const promises = [];
    for (let gen = 1; gen <= MAX_GEN; gen++) {
      promises.push(fetch(`./public/gen${gen}_pokemon.txt`).then(r => r.text())
        .then(t => pokemonByGen[gen] = t.split(/\r?\n/).filter(Boolean)));
      promises.push(fetch(`./public/gen${gen}_forms.txt`).then(r => r.text())
        .then(t => formsByGen[gen] = t.split(/\r?\n/).filter(Boolean)));
    }
    await Promise.all(promises);

    document.getElementById("bestStreak").textContent = bestStreak;
    updatePokemonPool();

    const firstPokemon = pokemonList[Math.floor(Math.random() * pokemonList.length)];
    const firstIndex = getNextIndexForPokemon(firstPokemon);
    currentPokemon = firstPokemon;
    silhouetteIndex = firstIndex;

    await preloadSinglePokemon(firstPokemon, firstIndex);
    displayPreloadedPokemon(firstPokemon, firstIndex);

    if ("requestIdleCallback" in window) {
      requestIdleCallback(refillQueueToCapacity);
    } else {
      setTimeout(refillQueueToCapacity, 50);
    }
  } catch (err) {
    console.error("Failed to load Pokémon lists", err);
  }
}

/* ================= POOL ================= */
function updatePokemonPool() {
  const includeForms = document.getElementById("includeForms").checked;
  let pool = [];
  for (let gen = 1; gen <= MAX_GEN; gen++) {
    if (document.getElementById(`gen${gen}`).checked) {
      pool.push(...pokemonByGen[gen]);
      if (includeForms) pool.push(...formsByGen[gen]);
    }
  }
  pokemonList = pool;
  Object.keys(preloadedImages).forEach(k => delete preloadedImages[k]);
  preloadQueue.items = [];
  setupAwesomplete();
}

/* ================= RANDOM IMAGE ================= */
function getNextIndexForPokemon(pokemon) {
  if (!usedImagesThisSession[pokemon]) usedImagesThisSession[pokemon] = new Set();
  const used = usedImagesThisSession[pokemon];
  if (used.size >= IMAGES_PER_POKEMON) used.clear();
  let index;
  do index = Math.floor(Math.random() * IMAGES_PER_POKEMON);
  while (used.has(index));
  used.add(index);
  return index;
}

/* ================= SILHOUETTE ================= */
function createSilhouetteFast(img) {
  return new Promise(resolve => {
    if (!img.naturalWidth || !img.naturalHeight) { resolve(img); return; }
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    ctx.drawImage(img, 0, 0);
    ctx.globalCompositeOperation = "source-in";
    ctx.fillStyle = "black";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    canvas.toBlob(blob => {
      if (!blob) { resolve(img); return; }
      const s = new Image();
      s.onload = () => resolve(s);
      s.src = URL.createObjectURL(blob);
    }, "image/png");
  });
}

function getRenderFolderName(pokemon) {
  // Special-case Mime Jr. because folders can't contain dots
  if (pokemon === "Mime Jr.") {
    return "Mime Jr";
  }
  return pokemon;
}

/* ================= PRELOAD ================= */
function preloadSinglePokemon(pokemon, index) {
  if (!preloadedImages[pokemon]) preloadedImages[pokemon] = {};
  if (preloadedImages[pokemon][index]) return Promise.resolve();
  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    const folderName = getRenderFolderName(pokemon);
    img.src = `./public/Pokemon_Renders/${folderName}/${folderName}_${index}.png`;
    img.onload = async () => {
      const sil = await createSilhouetteFast(img);
      preloadedImages[pokemon][index] = { full: img, silhouette: sil };
      resolve();
    };
    img.onerror = resolve;
  });
}

function addToPreloadQueue(pokemon) {
  const index = getNextIndexForPokemon(pokemon);
  preloadQueue.enqueue({ pokemon, index }, 1);
  preloadSinglePokemon(pokemon, index);
}

function refillQueueToCapacity() {
  while (preloadQueue.size() < PRELOAD_COUNT) {
    const p = pokemonList[Math.floor(Math.random() * pokemonList.length)];
    addToPreloadQueue(p);
  }
}

/* ================= DISPLAY ================= */
function displayPreloadedPokemon(pokemon, index) {
  const preloaded = preloadedImages[pokemon]?.[index];
  if (!preloaded) { displayNextPokemon(); return; }
  const clone = preloaded.silhouette.cloneNode();
  clone.dataset.realSrc = preloaded.full.src;
  clone.classList.add("silhouette");
  clone.style.opacity = 0;
  clone.style.transition = "opacity 0.075s ease-in";
  pokemonImg.replaceWith(clone);
  pokemonImg = clone;
  badgeEl.style.opacity = 0;
  pokemonImg.classList.remove("shake");
  toggleSilhouetteBtn.style.display = "none";
  guessInput.value = "";
  guessInput.disabled = false;
  guessButton.disabled = false;
  nextButton.textContent = "Skip";
  pokemonNameEl.style.opacity = 0;
  guessed = false;
  guessInput.focus();

  // reset eye icons
  document.getElementById("eyeOpen").style.display = "block";
  document.getElementById("eyeClosed").style.display = "none";
  requestAnimationFrame(() => { pokemonImg.style.opacity = 1; });
}

function displayNextPokemon() {
  if (!preloadQueue.size()) return;
  const { pokemon, index } = preloadQueue.dequeue();
  currentPokemon = pokemon;
  silhouetteIndex = index;
  displayPreloadedPokemon(pokemon, index);
  const newPokemon = pokemonList[Math.floor(Math.random() * pokemonList.length)];
  addToPreloadQueue(newPokemon);
}

/* ================= CHECK GUESS ================= */
function checkGuess() {
  if (guessed) return;
  if (guessInput.value.trim().toLowerCase() === currentPokemon.toLowerCase()) {
    pokemonImg.src = pokemonImg.dataset.realSrc;
    pokemonImg.classList.remove("silhouette");
    toggleSilhouetteBtn.style.display = "inline-flex";
    streak++;
    document.getElementById("streak").textContent = streak;
    if (streak > bestStreak) {
      bestStreak = streak;
      localStorage.setItem("bestStreak", bestStreak);
      document.getElementById("bestStreak").textContent = bestStreak;
    }
    badgeEl.style.opacity = 1;
    badgeEl.classList.remove("badge"); void badgeEl.offsetWidth; badgeEl.classList.add("badge");
    confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 } });
    guessInput.disabled = true;
    guessButton.disabled = true;
    nextButton.textContent = "Next";
    guessed = true;
  } else {
    streak = 0;
    document.getElementById("streak").textContent = streak;
    pokemonImg.classList.remove("shake"); void pokemonImg.offsetWidth; pokemonImg.classList.add("shake");
  }
}

/* ================= AUTOCOMPLETE ================= */
function setupAwesomplete() {
  const enabled = document.getElementById("enableAutocomplete").checked;
  if (!enabled) {
    if (awesompleteInstance) { awesompleteInstance.destroy(); awesompleteInstance = null; guessInput.removeAttribute("list"); }
    return;
  }
  const list = pokemonList.slice().sort();
  if (!awesompleteInstance) {
    awesompleteInstance = new Awesomplete(guessInput, {
      list, minChars: 1, maxItems: 8, autoFirst: true,
      filter: Awesomplete.FILTER_CONTAINS
    });
  } else awesompleteInstance.list = list;
}

/* ================= EVENTS ================= */
guessInput.addEventListener("keydown", e => {
  if (e.key !== "Tab" || !awesompleteInstance) return;
  const selected = awesompleteInstance.ul.querySelector("li[aria-selected='true']");
  if (!selected) return;
  e.preventDefault(); awesompleteInstance.select(selected);
});

guessInput.addEventListener("input", () => {
  if (!guessInput.value && awesompleteInstance) awesompleteInstance.close();
});

nextButton.addEventListener("click", () => {
  if (!guessed && nextButton.textContent === "Skip") {
    pokemonImg.src = pokemonImg.dataset.realSrc;
    pokemonImg.classList.remove("silhouette");
    toggleSilhouetteBtn.style.display = "inline-flex";
    pokemonNameEl.textContent = currentPokemon;
    pokemonNameEl.style.opacity = 1;
    guessInput.disabled = true;
    guessButton.disabled = true;
    nextButton.textContent = "Next";
    guessed = true;
    streak = 0;
    document.getElementById("streak").textContent = streak;
  } else displayNextPokemon();
});

guessButton.addEventListener("click", checkGuess);
document.addEventListener("keydown", e => { if (e.key === "Enter") guessed ? displayNextPokemon() : checkGuess(); });

document.addEventListener("change", async e => {
  if (e.target.id === "includeForms" || /^gen\d+$/.test(e.target.id)) {
    saveSettings();

    // Reset streak
    streak = 0;
    document.getElementById("streak").textContent = streak;

    updatePokemonPool();

    // pick a fresh Pokémon from the updated pool
    if (pokemonList.length === 0) return; // safety
    const firstPokemon = pokemonList[Math.floor(Math.random() * pokemonList.length)];
    const firstIndex = getNextIndexForPokemon(firstPokemon);
    currentPokemon = firstPokemon;
    silhouetteIndex = firstIndex;

    await preloadSinglePokemon(firstPokemon, firstIndex);
    displayPreloadedPokemon(firstPokemon, firstIndex);

    // refill the preload queue
    if ("requestIdleCallback" in window) {
      requestIdleCallback(refillQueueToCapacity);
    } else {
      setTimeout(refillQueueToCapacity, 50);
    }
  } else if (e.target.id === "enableAutocomplete") {
    saveSettings();
    setupAwesomplete();
  }
});

function disableLastGenCheckbox() {
  const genCheckboxes = document.querySelectorAll("#genChecklist input[type=checkbox]");

  function updateDisabledState() {
    const checked = Array.from(genCheckboxes).filter(c => c.checked);
    genCheckboxes.forEach(cb => cb.disabled = false); // enable all first
    if (checked.length === 1) {
      checked[0].disabled = true; // disable the last remaining
    }
  }

  genCheckboxes.forEach(cb => cb.addEventListener("change", updateDisabledState));
  updateDisabledState(); // initial check
}

document.addEventListener("DOMContentLoaded", () => {
  renderGenCheckboxes();
  loadSettings();
  disableLastGenCheckbox();
  loadPokemonList();
  document.getElementById("settingsBtn").addEventListener("click", () => {
    const panel = document.getElementById("settingsPanel");
    panel.style.display = panel.style.display === "block" ? "none" : "block";
  });
});

const copyBtn = document.getElementById("copyBtn");

copyBtn.addEventListener("click", async () => {
  if (!pokemonImg || !pokemonImg.complete) return;

  const img = pokemonImg;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  const w = img.naturalWidth;
  const h = img.naturalHeight;

  canvas.width = w;
  canvas.height = h;

  /* Flatten transparency */
  const bg = getComputedStyle(document.body).backgroundColor || "#ffffff";
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  /* Draw visible image */
  ctx.drawImage(img, 0, 0, w, h);

  /* Draw name if revealed AND not silhouette */
  if (!pokemonImg.classList.contains("silhouette")) {
    const fontSize = Math.floor(h * 0.075);
    ctx.font = `bold ${fontSize}px Arial`;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";

    const x = w / 2;
    const y = h - h * 0.05;

    ctx.strokeStyle = "#333";
    ctx.lineWidth = Math.max(2, fontSize * 0.12);
    ctx.strokeText(currentPokemon, x, y);

    ctx.fillStyle = "#fff";
    ctx.fillText(currentPokemon, x, y);
  }

  canvas.toBlob(async blob => {
    if (!blob) return;

    /* 📱 iOS Safari fallback */
    if (IS_IOS || !navigator.clipboard?.write) {
      const url = URL.createObjectURL(blob);
      const win = window.open(url, "_blank");

      // iOS sometimes blocks immediate opens
      if (!win) {
        alert("Tap and hold the image to copy or save.");
      }
      return;
    }

    /* 🖥 Desktop browsers */
    try {
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": blob })
      ]);

      copyBtn.classList.add("copied");
      setTimeout(() => copyBtn.classList.remove("copied"), 500);
    } catch (err) {
      console.error("Clipboard failed, falling back:", err);

      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
    }
  }, "image/png");
});

const toggleSilhouetteBtn = document.getElementById("toggleSilhouetteBtn");
const eyeOpen = document.getElementById("eyeOpen");
const eyeClosed = document.getElementById("eyeClosed");

toggleSilhouetteBtn.addEventListener("click", async () => {
  const preloaded = preloadedImages[currentPokemon]?.[silhouetteIndex];
  if (!preloaded) return;

  const isSilhouette = pokemonImg.classList.contains("silhouette");
  const targetImg = isSilhouette ? preloaded.full : preloaded.silhouette;

  try {
    await targetImg.decode();

    // swap image
    pokemonImg.src = targetImg.src;
    pokemonImg.classList.toggle("silhouette", !isSilhouette);

    // icons reflect CURRENT visible state
    eyeOpen.style.display = isSilhouette ? "block" : "none";
    eyeClosed.style.display = isSilhouette ? "none" : "block";
  } catch (err) {
    console.error("Failed to toggle silhouette image:", err);
  }
});