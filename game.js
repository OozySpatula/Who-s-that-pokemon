import confetti from 'https://cdn.skypack.dev/canvas-confetti';

/* ================= CONFIG ================= */
const MAX_GEN = 3;
const PRELOAD_COUNT = 10;
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

/* Used indices tracker */
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
  } catch (e) { console.warn("Failed to load settings", e); }
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
    label.innerHTML = `
      <input type="checkbox" id="gen${gen}" checked />
      Gen ${gen}
    `;
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

  dequeue() {
    return this.items.shift()?.item;
  }

  size() {
    return this.items.length;
  }

  peek() {
    return this.items[0]?.item;
  }
}

const preloadQueue = new PriorityQueue();

/* ================= DATA LOADING ================= */
async function loadPokemonList() {
  try {
    const promises = [];
    for (let gen = 1; gen <= MAX_GEN; gen++) {
      promises.push(
        fetch(`./public/gen${gen}_pokemon.txt`)
          .then(r => r.text())
          .then(t => { pokemonByGen[gen] = t.split(/\r?\n/).map(l => l.trim()).filter(Boolean); })
      );
      promises.push(
        fetch(`./public/gen${gen}_forms.txt`)
          .then(r => r.text())
          .then(t => { formsByGen[gen] = t.split(/\r?\n/).map(l => l.trim()).filter(Boolean); })
      );
    }
    await Promise.all(promises);

    document.getElementById("bestStreak").textContent = bestStreak;
    updatePokemonPool();

    /* ======== CHANGED: load ONE first ======== */
    const firstPokemon = pokemonList[Math.floor(Math.random() * pokemonList.length)];
    const firstIndex = getNextIndexForPokemon(firstPokemon);

    currentPokemon = firstPokemon;
    silhouetteIndex = firstIndex;

    await preloadSinglePokemon(firstPokemon, firstIndex);
    displayPreloadedPokemon(firstPokemon, firstIndex);

    /* ======== CHANGED: preload AFTER render ======== */
    requestIdleCallback?.(() => refillQueueToCapacity()) 
      || setTimeout(refillQueueToCapacity, 0);

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
      pool = pool.concat(pokemonByGen[gen] || []);
      if (includeForms) pool = pool.concat(formsByGen[gen] || []);
    }
  }
  pokemonList = pool;

  Object.keys(preloadedImages).forEach(k => delete preloadedImages[k]);
  preloadQueue.items = [];
  setupAwesomplete();
}

/* ================= RANDOM ANGLE ================= */
function getNextIndexForPokemon(pokemon) {
  if (!usedImagesThisSession[pokemon]) usedImagesThisSession[pokemon] = new Set();
  const used = usedImagesThisSession[pokemon];

  if (used.size >= IMAGES_PER_POKEMON) used.clear();

  let index;
  do {
    index = Math.floor(Math.random() * IMAGES_PER_POKEMON);
  } while (used.has(index));

  used.add(index);
  return index;
}

/* ================= SILHOUETTE ================= */
function createSilhouetteFast(img) {
  return new Promise(resolve => {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;

    ctx.drawImage(img, 0, 0);
    ctx.globalCompositeOperation = "source-in";
    ctx.fillStyle = "black";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    canvas.toBlob(blob => {
      const silhouetteImg = new Image();
      silhouetteImg.onload = () => resolve(silhouetteImg);
      silhouetteImg.src = URL.createObjectURL(blob);
    }, "image/png");
  });
}

/* ================= PRELOAD SINGLE ================= */
function preloadSinglePokemon(pokemon, index) {
  if (!preloadedImages[pokemon]) preloadedImages[pokemon] = {};
  if (preloadedImages[pokemon][index]) return Promise.resolve();

  return new Promise(resolve => {
    const fullImg = new Image();
    fullImg.src = `./public/Pokemon_Renders/${pokemon}/${pokemon}_${index}.png`;
    fullImg.onload = async () => {
      const silhouetteImg = await createSilhouetteFast(fullImg);
      preloadedImages[pokemon][index] = { full: fullImg, silhouette: silhouetteImg };
      resolve();
    };
    fullImg.onerror = resolve;
  });
}

/* ================= PRELOAD QUEUE ================= */
function addToPreloadQueue(pokemon) {
  const index = getNextIndexForPokemon(pokemon);
  const unusedLeft = IMAGES_PER_POKEMON - usedImagesThisSession[pokemon].size + 1;
  preloadQueue.enqueue({ pokemon, index }, unusedLeft);
  preloadSinglePokemon(pokemon, index);
}

function refillQueueToCapacity() {
  while (preloadQueue.size() < PRELOAD_COUNT) {
    const pkm = pokemonList[Math.floor(Math.random() * pokemonList.length)];
    addToPreloadQueue(pkm);
  }
}

/* ================= DISPLAY ================= */
function displayPreloadedPokemon(pokemon, index) {
  const preloaded = preloadedImages[pokemon]?.[index];
  if (!preloaded) return;

  const clone = preloaded.silhouette.cloneNode();
  clone.dataset.realSrc = preloaded.full.src;
  clone.classList.add("silhouette");
  clone.style.opacity = 0;
  clone.style.transition = "opacity 0.075s ease-in";

  pokemonImg.replaceWith(clone);
  pokemonImg = clone;

  requestAnimationFrame(() => { pokemonImg.style.opacity = 1; });

  badgeEl.style.opacity = 0;
  pokemonImg.classList.remove("shake");
  guessInput.value = "";
  guessInput.disabled = false;
  guessButton.disabled = false;
  nextButton.textContent = "Skip";
  pokemonNameEl.style.opacity = 0;
  guessed = false;
  guessInput.focus();
}

/* ================= DISPLAY NEXT ================= */
function displayNextPokemon() {
  if (preloadQueue.size() === 0) return;

  const nextItem = preloadQueue.dequeue();
  currentPokemon = nextItem.pokemon;
  silhouetteIndex = nextItem.index;

  displayPreloadedPokemon(currentPokemon, silhouetteIndex);

  const newPokemon = pokemonList[Math.floor(Math.random() * pokemonList.length)];
  addToPreloadQueue(newPokemon);
}

/* ================= CHECK GUESS ================= */
function checkGuess() {
  if (guessed) return;
  if (guessInput.value.trim().toLowerCase() === currentPokemon.toLowerCase()) {
    pokemonImg.src = pokemonImg.dataset.realSrc;
    pokemonImg.classList.remove("silhouette");
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
    if (awesompleteInstance) {
      awesompleteInstance.destroy();
      awesompleteInstance = null;
      guessInput.removeAttribute("list");
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
      filter: Awesomplete.FILTER_STARTSWITH
    });
  } else {
    awesompleteInstance.list = list;
  }
}

/* ================= EVENTS ================= */
guessInput.addEventListener("keydown", e => {
  if (e.key !== "Tab" || !awesompleteInstance) return;
  const selected = awesompleteInstance.ul.querySelector("li[aria-selected='true']");
  if (!selected) return;
  e.preventDefault();
  awesompleteInstance.select(selected);
});

guessInput.addEventListener("input", () => {
  if (!guessInput.value && awesompleteInstance) awesompleteInstance.close();
});

nextButton.addEventListener("click", () => {
  if (!guessed && nextButton.textContent === "Skip") {
    pokemonImg.src = pokemonImg.dataset.realSrc;
    pokemonImg.classList.remove("silhouette");
    pokemonNameEl.textContent = currentPokemon;
    pokemonNameEl.style.opacity = 1;
    guessInput.disabled = true;
    guessButton.disabled = true;
    nextButton.textContent = "Next";
    guessed = true;
  } else {
    displayNextPokemon();
  }
});

guessButton.addEventListener("click", checkGuess);
document.addEventListener("keydown", e => {
  if (e.key === "Enter") guessed ? displayNextPokemon() : checkGuess();
});

document.addEventListener("change", e => {
  if (e.target.id === "includeForms" || /^gen\d+$/.test(e.target.id)) {
    saveSettings();
    updatePokemonPool();
    displayNextPokemon();
  } else if (e.target.id === "enableAutocomplete") {
    saveSettings();
    setupAwesomplete();
  }
});

document.addEventListener("DOMContentLoaded", () => {
  renderGenCheckboxes();
  loadSettings();
  loadPokemonList();
  document.getElementById("settingsBtn").addEventListener("click", () => {
    const panel = document.getElementById("settingsPanel");
    panel.style.display = panel.style.display === "block" ? "none" : "block";
  });
});
