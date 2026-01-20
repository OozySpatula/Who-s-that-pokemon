import confetti from 'https://cdn.skypack.dev/canvas-confetti';

/* ================= CONFIG ================= */
const MAX_GEN = 3;
const PRELOAD_COUNT = 10;

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

const preloadedImages = {};
const preloadQueue = [];

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

/* ================= PRELOADING ================= */
function preloadPokemon(pokemon) {
  if (preloadedImages[pokemon]) return;
  const index = Math.floor(Math.random() * 4);
  const img = new Image();
  img.src = `./public/Pokemon_Renders/${pokemon}/${pokemon}_${index}.png?ts=${Date.now()}`;
  img.onload = () => preloadedImages[pokemon] = img;
}

function updatePreloadQueue() {
  while (preloadQueue.length < PRELOAD_COUNT && pokemonList.length) {
    const next = pokemonList[Math.floor(Math.random() * pokemonList.length)];
    if (!preloadQueue.includes(next)) {
      preloadQueue.push(next);
      preloadPokemon(next);
    }
  }
}

/* ================= GAME FLOW ================= */
function displayNextPokemon() {
  if (!pokemonList.length) return;
  let next;
  do {
    next = preloadQueue.shift() || pokemonList[Math.floor(Math.random() * pokemonList.length)];
  } while (next === currentPokemon && pokemonList.length > 1);
  currentPokemon = next;
  updatePreloadQueue();
  silhouetteIndex = Math.floor(Math.random() * 4);
  pokemonImg.style.opacity = 0;
  pokemonImg.classList.remove("silhouette");
  const img = preloadedImages[currentPokemon] || new Image();
  if (!img.src) {
    img.src = `./public/Pokemon_Renders/${currentPokemon}/${currentPokemon}_${silhouetteIndex}.png?ts=${Date.now()}`;
  }
  const showImage = () => {
    pokemonImg.src = img.src;
    pokemonImg.classList.add("silhouette");
    pokemonImg.style.opacity = 1;
  };
  if (img.complete) showImage(); else img.onload = showImage;

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
      filter: Awesomplete.FILTER_STARTSWITH, // built-in starts-with filter
    });
  } else {
    awesompleteInstance.list = list;
  }

  // Force dropdown above input
  const dropdown = awesompleteInstance.ul;
  dropdown.style.bottom = `${guessInput.offsetHeight + 4}px`;
  dropdown.style.top = "auto";
}

/* ================= EVENTS ================= */
guessInput.addEventListener("keydown", e => {
  if (e.key !== "Tab") return;
  if (!awesompleteInstance) return;

  if (!guessInput.value.trim()) return;

  const ul = awesompleteInstance.ul;
  if (!ul || !ul.childNodes.length) return;

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
    pokemonImg.classList.remove("silhouette");
    pokemonNameEl.textContent = currentPokemon;
    pokemonNameEl.style.opacity = 1;
    guessInput.disabled = true;
    guessButton.disabled = true;
    nextButton.textContent = "Next";
    guessed = true;
  } else displayNextPokemon();
});

guessButton.addEventListener("click", checkGuess);
document.addEventListener("keydown", e => {
  if (e.key !== "Enter") return;

  // If already guessed, Enter acts like "Next"
  if (guessed) {
    displayNextPokemon();
  } else {
    checkGuess();
  }
});

document.addEventListener("change", e => {
  if (e.target.id === "includeForms" || /^gen\d+$/.test(e.target.id)) {
    // changing forms or generations still updates pool + preload
    updatePokemonPool();
    updatePreloadQueue();
    displayNextPokemon();
  } else if (e.target.id === "enableAutocomplete") {
    // ONLY toggle autocomplete; do not reset streak or load a new Pokémon
    setupAwesomplete();
  }
});

document.addEventListener("DOMContentLoaded", () => {
  renderGenCheckboxes();
  loadPokemonList();
  document.getElementById("settingsBtn").addEventListener("click", () => {
    const panel = document.getElementById("settingsPanel");
    panel.style.display = panel.style.display === "block" ? "none" : "block";
  });
});
