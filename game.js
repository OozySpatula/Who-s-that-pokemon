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

/**
 * preloadedImages[pokemon][index] = { full: Image, silhouette: Image }
 */
const preloadedImages = {};
const preloadQueue = [];

/**
 * usedImagesThisSession[pokemon] = Set(index)
 */
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

    if ("includeForms" in settings) {
      document.getElementById("includeForms").checked = settings.includeForms;
    }

    if ("enableAutocomplete" in settings) {
      document.getElementById("enableAutocomplete").checked =
        settings.enableAutocomplete;
    }

    if (settings.gens) {
      for (let gen = 1; gen <= MAX_GEN; gen++) {
        const cb = document.getElementById(`gen${gen}`);
        if (cb && gen in settings.gens) {
          cb.checked = settings.gens[gen];
        }
      }
    }
  } catch (e) {
    console.warn("Failed to load settings", e);
  }
}

/* ================= ELEMENTS ================= */
const badgeEl = document.getElementById("badge");
const pokemonImg = document.getElementById("pokemonImg");
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

/* ================= DATA LOADING ================= */
async function loadPokemonList() {
  try {
    const promises = [];
    for (let gen = 1; gen <= MAX_GEN; gen++) {
      promises.push(
        fetch(`./public/gen${gen}_pokemon.txt`)
          .then(r => r.text())
          .then(t => {
            pokemonByGen[gen] = t.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
          })
      );
      promises.push(
        fetch(`./public/gen${gen}_forms.txt`)
          .then(r => r.text())
          .then(t => {
            formsByGen[gen] = t.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
          })
      );
    }
    await Promise.all(promises);
    document.getElementById("bestStreak").textContent = bestStreak;
    updatePokemonPool();
    updatePreloadQueue();
    displayNextPokemon();
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
  preloadQueue.length = 0;

  setupAwesomplete();
}

/* ================= IMAGE INDEX LOGIC ================= */
function getUnusedImageIndex(pokemon) {
  if (!usedImagesThisSession[pokemon]) {
    usedImagesThisSession[pokemon] = new Set();
  }

  const used = usedImagesThisSession[pokemon];

  if (used.size >= IMAGES_PER_POKEMON) {
    used.clear();
  }

  let index;
  do {
    index = Math.floor(Math.random() * IMAGES_PER_POKEMON);
  } while (used.has(index));

  used.add(index);
  return index;
}

/* ================= SILHOUETTE HELPERS ================= */
function createSilhouetteDataURL(img) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;

  ctx.drawImage(img, 0, 0);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] > 0) {
      data[i] = 0;
      data[i + 1] = 0;
      data[i + 2] = 0;
    }
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL("image/png");
}

/* ================= PRELOADING ================= */
function preloadPokemon(pokemon, index) {
  if (!preloadedImages[pokemon]) preloadedImages[pokemon] = {};
  if (preloadedImages[pokemon][index]) return;

  const fullImg = new Image();
  fullImg.src = `./public/Pokemon_Renders/${pokemon}/${pokemon}_${index}.png?ts=${Date.now()}`;
  fullImg.onload = () => {
    const silhouetteDataUrl = createSilhouetteDataURL(fullImg);
    const silhouetteImg = new Image();
    silhouetteImg.src = silhouetteDataUrl;
    preloadedImages[pokemon][index] = { full: fullImg, silhouette: silhouetteImg };
  };
}

function updatePreloadQueue() {
  while (preloadQueue.length < PRELOAD_COUNT && pokemonList.length) {
    const pokemon = pokemonList[Math.floor(Math.random() * pokemonList.length)];
    if (!preloadQueue.includes(pokemon)) {
      preloadQueue.push(pokemon);
      for (let i = 0; i < IMAGES_PER_POKEMON; i++) {
        preloadPokemon(pokemon, i);
      }
    }
  }
}

/* ================= GAME FLOW ================= */
function displayNextPokemon() {
  if (!pokemonList.length) return;

  let next;
  do {
    next =
      preloadQueue.shift() ||
      pokemonList[Math.floor(Math.random() * pokemonList.length)];
  } while (next === currentPokemon && pokemonList.length > 1);

  currentPokemon = next;
  updatePreloadQueue();

  silhouetteIndex = getUnusedImageIndex(currentPokemon);
  pokemonImg.style.opacity = 0;
  pokemonImg.classList.remove("silhouette");

  const preloaded = preloadedImages[currentPokemon]?.[silhouetteIndex];

  if (preloaded?.silhouette?.complete) {
    pokemonImg.dataset.realSrc = preloaded.full.src;
    pokemonImg.src = preloaded.silhouette.src;
    pokemonImg.classList.add("silhouette");
    pokemonImg.style.opacity = 1;
  } else {
    const fullImg = preloaded?.full || new Image();
    fullImg.src = `./public/Pokemon_Renders/${currentPokemon}/${currentPokemon}_${silhouetteIndex}.png?ts=${Date.now()}`;
    const showSilhouette = () => {
      pokemonImg.dataset.realSrc = fullImg.src;
      const silhouetteDataUrl = createSilhouetteDataURL(fullImg);
      pokemonImg.src = silhouetteDataUrl;
      pokemonImg.classList.add("silhouette");
      pokemonImg.style.opacity = 1;
    };
    if (fullImg.complete) showSilhouette();
    else fullImg.onload = showSilhouette;
  }

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
    badgeEl.classList.remove("badge");
    void badgeEl.offsetWidth;
    badgeEl.classList.add("badge");
    launchConfetti();

    guessInput.disabled = true;
    guessButton.disabled = true;
    nextButton.textContent = "Next";
    guessed = true;
  } else {
    streak = 0;
    document.getElementById("streak").textContent = streak;
    pokemonImg.classList.remove("shake");
    void pokemonImg.offsetWidth;
    pokemonImg.classList.add("shake");
  }
}

/* ================= CONFETTI ================= */
function launchConfetti() {
  confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 } });
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

  const dropdown = awesompleteInstance.ul;
  dropdown.style.bottom = `${guessInput.offsetHeight + 4}px`;
  dropdown.style.top = "auto";
}

/* ================= EVENTS ================= */
guessInput.addEventListener("keydown", e => {
  if (e.key !== "Tab") return;
  if (!awesompleteInstance) return;

  const ul = awesompleteInstance.ul;
  if (!ul?.childNodes.length) return;

  const selected = ul.querySelector("li[aria-selected='true']");
  if (!selected) return;

  e.preventDefault();
  awesompleteInstance.select(selected);
});

guessInput.addEventListener("input", () => {
  if (!guessInput.value && awesompleteInstance) {
    awesompleteInstance.close();
  }
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
  if (e.key !== "Enter") return;
  guessed ? displayNextPokemon() : checkGuess();
});

document.addEventListener("change", e => {
  if (e.target.id === "includeForms" || /^gen\d+$/.test(e.target.id)) {
    saveSettings();
    updatePokemonPool();
    updatePreloadQueue();
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
    panel.style.display =
      panel.style.display === "block" ? "none" : "block";
  });
});
