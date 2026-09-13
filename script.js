/* ============================================================================
   NEON EEL: OVERDRIVE
   ----------------------------------------------------------------------------
   A neon snake-style arcade game. Pure HTML/CSS/JS, canvas-based, no libraries.

   HOW THE GAME LOOP WORKS (read this first):
   - The game advances in discrete "ticks". Each tick the eel moves one grid
     cell. The time between ticks is `currentSpeed` (in milliseconds).
   - Lower currentSpeed = faster eel. Speed is derived from the current level.
   - Timed systems (hazard cycles, bonus items, shield, toasts) are driven by
     `gameTime`, an accumulated millisecond clock that only advances while the
     eel is actually moving. This keeps everything paused before the first move
     and easy to reason about.

   SECTIONS:
     1. Tunable constants          <-- balance the game here
     2. Canvas + DOM references
     3. Game state variables
     4. Main loop
     5. Eel movement + eating
     6. Scoring / levels / speed
     7. Static bombs
     8. Level 2+ moving hazard + shield system
     9. Bonus (diamond) + penalty items
    10. Collision / game over
    11. Rendering (drawing every element)
    12. HUD + toast messages
    13. Input (keyboard, D-pad, swipe)
    14. Background music
    15. Sound effect
    16. Reset + boot
   ============================================================================ */


/* ============================================================================
   1. TUNABLE CONSTANTS  —  tweak these to rebalance the game
   ============================================================================ */

/* --- Board --- */
const GRID_SIZE = 20;                 // pixel size of one grid cell

/* --- Scoring & levels --- */
const FOOD_POINTS       = 20;         // points per white food
const DIAMOND_POINTS     = 100;       // points per cyan diamond (bonus)
const PENALTY_POINTS     = 100;       // points removed by an orange penalty item
const POINTS_PER_LEVEL   = 100;       // score needed to gain each level
                                      // Level 1 = 0-99, Level 2 = 100-199, ...

/* --- Coins (extra feature: earned on game over, spent in the shop) --- */
const POINTS_PER_COIN    = 10;        // conversion rate: 1 coin per 10 final score points

/* --- Evolution (extra feature): a long eel is hard to control, so instead of
   letting it grow forever, hitting the length threshold "evolves" it — the
   look changes a step further toward a real eel, it shrinks back by half, and
   growing gets slower. This repeats, so long sessions stay playable instead
   of guaranteeing a frustrating game over from an unmanageably long body. --- */
const EVOLUTION_LENGTH_THRESHOLD = 20;    // eel length that triggers the next evolution
const EVOLUTION_TARGET_LENGTH    = 10;    // length the eel shrinks to right after evolving
const EVOLUTION_MAX_VISUAL_STAGE = 3;     // look stops changing after this stage (mechanics keep going)

/* --- Speed (milliseconds per movement step; LOWER = FASTER) --- */
const START_SPEED          = 200;     // step time at level 1 (slowest / easiest)
                                      // higher number = calmer start (raised from 150
                                      // so level 1 is comfortable for new players)
const MIN_SPEED            = 60;      // fastest allowed step time  ==  SPEED CAP
const SPEED_STEP_PER_LEVEL = 10;      // ms shaved off for each level gained

/* --- Static bombs (touching one = instant game over) --- */
const BOMB_SPAWN_EVERY_FOOD = 3;      // drop a new bomb every N food eaten

/* --- Level 2+ moving hazard + shield pair --- */
const HAZARD_UNLOCK_LEVEL    = 2;     // level at which the pair starts appearing
const HAZARD_CYCLE_INTERVAL  = 20000; // ms of calm between repeat spawn cycles
const HAZARD_FIRST_DELAY     = 2000;  // ms of calm before the FIRST cycle, right after
                                      // unlocking. First spawn happens at
                                      // HAZARD_FIRST_DELAY + HAZARD_WARNING_TIME (= 5s).
const HAZARD_WARNING_TIME    = 3000;  // ms the warning banner is shown before they appear
const HAZARD_ACTIVE_DURATION = 10000; // ms the pair stays on the board
const HAZARD_MOVE_EVERY_TICKS = 2;    // hazard steps once per N eel steps
                                      // (2 => hazard moves at half the eel's speed,
                                      //  so it is always dodgeable)
const BODY_LOSS_PENALTY      = 20;    // BASE points lost per body cell the hazard bites off
                                      // (the eel is chopped from the contact point to the
                                      //  tail, so a deeper bite costs more points). Actually
                                      //  charged at BODY_LOSS_PENALTY * growthInterval, so a
                                      //  more-evolved eel (see EVOLUTION below) loses more per
                                      //  cell: 20 at stage 0, 40 at stage 1, 80 at stage 2, ...
const HAZARD_HIT_COOLDOWN    = 900;   // ms of immunity right after a bite
                                      // (stops the hazard eating the whole eel at once)
const SHIELD_DURATION        = 8000;  // ms the shield protects after pickup
const SHIELD_MOVE_LEVEL      = 5;     // the shield stays STILL below this level; it only
                                      // starts roaming once the game reaches this level.
// Once it roams, the shield gets FASTER (harder to catch) with each MOVING appearance
// — this depends on the number of moving appearances, NOT the level. It steps once
// every N eel steps: N starts large (slow) on the 1st moving appearance and shrinks by
// SHIELD_SPEEDUP_PER_APPEARANCE each time, down to the min.
//   1st moving appearance -> 4, 2nd -> 3, 3rd -> 2, 4th and later -> 1
const SHIELD_MOVE_EVERY_TICKS_START = 4; // 1st moving appearance: one step per 4 eel steps
const SHIELD_MOVE_EVERY_TICKS_MIN   = 1; // cap: one step per eel step (fast / hard)
const SHIELD_SPEEDUP_PER_APPEARANCE = 1; // eel-steps shaved off the cadence each moving appearance
const SHIELD_TURN_CHANCE     = 0.25;  // chance the roaming shield changes direction each step

/* --- Bonus (diamond) + penalty items: rare, occasional --- */
const DIAMOND_SPAWN_INTERVAL = 16000; // average ms between diamond appearances
const PENALTY_SPAWN_INTERVAL = 16000; // average ms between penalty appearances
const BONUS_SPAWN_JITTER     = 6000;  // +/- random ms added to the intervals above
const BONUS_ITEM_LIFETIME    = 8000;  // ms a diamond/penalty stays before vanishing

/* --- Toast / on-screen messages --- */
const TOAST_DEFAULT_TIME = 1600;      // ms a normal pop-up message stays visible

/* --- Swipe detection --- */
const SWIPE_THRESHOLD = 24;           // min pixels of finger travel to count as a swipe

/* --- Splash / intro screen --- */
const SPLASH_DURATION = 3000;         // ms the logo/title splash stays up before fading to the game


/* ============================================================================
   2. CANVAS + DOM REFERENCES
   ============================================================================ */
const canvas   = document.getElementById("gameCanvas");
const ctx      = canvas.getContext("2d");
const gameContainer = document.querySelector(".game-container");
const splashScreen  = document.getElementById("splashScreen");

const scoreEl        = document.getElementById("score");
const highScoreEl    = document.getElementById("highScore");
const levelEl        = document.getElementById("level");
const speedEl        = document.getElementById("speed");
const toastEl        = document.getElementById("toast");
const startScreen    = document.getElementById("startScreen");
const gameOverScreen = document.getElementById("gameOverScreen");
const deathReasonEl  = document.getElementById("deathReason");
const finalScoreEl   = document.getElementById("finalScore");
const finalLevelEl   = document.getElementById("finalLevel");
const finalBestEl    = document.getElementById("finalBest");
const newBestBadge   = document.getElementById("newBestBadge");
const restartBtn     = document.getElementById("restartBtn");
const boardWrapper   = document.getElementById("boardWrapper");
const touchControls  = document.getElementById("touchControls");
const pauseBtn       = document.getElementById("pauseBtn");
const pauseScreen    = document.getElementById("pauseScreen");
const resumeBtn      = document.getElementById("resumeBtn");
const countdownScreen= document.getElementById("countdownScreen");
const countdownNum   = document.getElementById("countdownNum");
const continueBtn    = document.getElementById("continueBtn");
const bombClearBtn   = document.getElementById("bombClearBtn");
const bombClearCountEl = document.getElementById("bombClearCount");
const secondChanceBadge   = document.getElementById("secondChanceBadge");
const secondChanceCountEl = document.getElementById("secondChanceCount");

/* --- Coins + shop DOM references --- */
const coinCountEl      = document.getElementById("coinCount");
const coinsEarnedEl    = document.getElementById("coinsEarned");
const totalCoinsFinalEl= document.getElementById("totalCoinsFinal");
const shopBtn          = document.getElementById("shopBtn");
const soundBtn         = document.getElementById("soundBtn");
const bgMusic          = document.getElementById("bgMusic");
const shopOverlay      = document.getElementById("shopOverlay");
const closeShopBtn     = document.getElementById("closeShopBtn");
const shopCoinCountEl  = document.getElementById("shopCoinCount");
const basicColorList   = document.getElementById("basicColorList");
const advancedColorList= document.getElementById("advancedColorList");
const customColorList  = document.getElementById("customColorList");
const gradientColorList= document.getElementById("gradientColorList");

/* --- Frame theme shop DOM references --- */
const frameBasicColorList    = document.getElementById("frameBasicColorList");
const frameAdvancedColorList = document.getElementById("frameAdvancedColorList");
const frameCustomColorList   = document.getElementById("frameCustomColorList");
const frameGradientColorList = document.getElementById("frameGradientColorList");

/* --- Shop tabs + items tab DOM references --- */
const colorsTabBtn   = document.getElementById("colorsTabBtn");
const itemsTabBtn    = document.getElementById("itemsTabBtn");
const colorsTabPanel = document.getElementById("colorsTabPanel");
const itemsTabPanel  = document.getElementById("itemsTabPanel");
const itemsList      = document.getElementById("itemsList");

/* --- Purchase confirmation + color-pick modal DOM references --- */
const confirmOverlay      = document.getElementById("confirmOverlay");
const confirmMessage      = document.getElementById("confirmMessage");
const confirmCancelBtn    = document.getElementById("confirmCancelBtn");
const confirmYesBtn       = document.getElementById("confirmYesBtn");
const colorPickOverlay    = document.getElementById("colorPickOverlay");
const colorPickTitle      = document.getElementById("colorPickTitle");
const colorPickInputs     = document.getElementById("colorPickInputs");
const colorPickPrice      = document.getElementById("colorPickPrice");
const colorPickCancelBtn  = document.getElementById("colorPickCancelBtn");
const colorPickConfirmBtn = document.getElementById("colorPickConfirmBtn");

// Number of cells across / down (board is square: 400 / 20 = 20).
const tileCount = canvas.width / GRID_SIZE;

/* --- High score, saved between sessions in the browser's localStorage --- */
const HIGH_SCORE_KEY = "neonEelHighScore"; // storage key; rename to reset everyone's best
const SOUND_MUTED_KEY = "neonEelSoundMuted"; // remembers the sound button's on/off state between visits

// localStorage can be unavailable (private mode, some file:// setups), so both
// read and write are wrapped in try/catch — a missing store just means no save.
function loadHighScore() {
    try { return Number(localStorage.getItem(HIGH_SCORE_KEY)) || 0; }
    catch (e) { return 0; }
}
function saveHighScore() {
    try { localStorage.setItem(HIGH_SCORE_KEY, String(highScore)); }
    catch (e) { /* not fatal if we can't persist */ }
}

let highScore = loadHighScore(); // persists across games; never reset by resetGame()
let beatBest;                    // true once THIS run beats the stored best (for the badge)


/* ============================================================================
   2b. COINS + SHOP  (extra feature)
   ----------------------------------------------------------------------------
   Coins are earned on every game over (score / POINTS_PER_COIN) and persist
   forever in localStorage, same pattern as the high score above. The shop
   spends coins to unlock eel color skins, grouped into four tiers:
     - "basic"    : 2 free starter colors + a few paid, still-basic colors
     - "advanced" : pricier, flashier colors
     - "custom"   : buy a NEW solid color pick each purchase
     - "gradient" : priciest tier — buy a NEW start/end color pick each purchase
   "basic"/"advanced" colors are owned forever once bought (free to re-equip
   any time). "custom"/"gradient" purchases work the same way once bought:
   each purchase adds its OWN permanent, freely re-equippable card next to the
   "buy a new one" card. Switching back to a previously purchased custom or
   gradient color is always free — only picking yet another NEW one costs
   coins again.
   Every purchase (of any tier) requires an explicit confirm-box click before
   coins are spent; for custom/gradient, the color-pick modal itself doubles
   as that confirmation.
   ============================================================================ */
const COIN_KEY            = "neonEelCoins";
const OWNED_COLORS_KEY    = "neonEelOwnedColors";
const SELECTED_COLOR_KEY  = "neonEelSelectedColor";
const CUSTOM_COLORS_KEY   = "neonEelCustomColors";       // array of {id, hex}
const GRADIENT_COLORS_KEY = "neonEelGradientColorsList"; // array of {id, start, end}

const DEFAULT_OWNED_COLORS   = ["classic", "toxic"]; // the 2 free basic colors
const DEFAULT_CUSTOM_HEX     = "#ff4fd8";
const DEFAULT_GRADIENT_START = "#66fcf1";
const DEFAULT_GRADIENT_END   = "#b967ff";
const DEFAULT_COLOR_ID       = "classic";

// id/head/body must stay unique; head/body are unused for the custom/gradient "buy" entries.
const COLOR_PALETTE = [
    { id: "classic",   name: "Classic Cyan",   tier: "basic",    price: 0,   head: "#66fcf1", body: "#45a29e" },
    { id: "toxic",     name: "Toxic Green",    tier: "basic",    price: 0,   head: "#7cff6b", body: "#3ea24a" },
    { id: "sunset",    name: "Sunset Orange",  tier: "basic",    price: 30,  head: "#ffb86b", body: "#e8722c" },
    { id: "bubblegum", name: "Bubblegum Pink", tier: "basic",    price: 30,  head: "#ff8fd8", body: "#d94fb0" },
    { id: "ice",       name: "Ice Blue",       tier: "basic",    price: 40,  head: "#9fe7ff", body: "#4fb8e0" },
    { id: "royal",     name: "Royal Purple",   tier: "advanced", price: 90,  head: "#d69bff", body: "#8a3fd1" },
    { id: "lava",      name: "Molten Lava",    tier: "advanced", price: 110, head: "#ffe066", body: "#ff4d4d" },
    { id: "galaxy",    name: "Galaxy",         tier: "advanced", price: 130, head: "#c9a7ff", body: "#4b2e83" },
    { id: "custom",    name: "Custom Color",   tier: "custom",   price: 200, head: null,      body: null      },
    { id: "gradient",  name: "Gradient Flow",  tier: "gradient", price: 350, head: null,      body: null      },
];

function loadCoins() {
    try { return Math.max(0, Number(localStorage.getItem(COIN_KEY)) || 10000); }
    catch (e) { return 0; }
}
function saveCoins() {
    try { localStorage.setItem(COIN_KEY, String(totalCoins)); }
    catch (e) { /* not fatal if we can't persist */ }
}
function loadOwnedColors() {
    try {
        const raw = JSON.parse(localStorage.getItem(OWNED_COLORS_KEY));
        if (Array.isArray(raw) && raw.length) return new Set(raw);
    } catch (e) { /* fall through to defaults */ }
    return new Set(DEFAULT_OWNED_COLORS);
}
function saveOwnedColors() {
    try { localStorage.setItem(OWNED_COLORS_KEY, JSON.stringify([...ownedColors])); }
    catch (e) { /* not fatal if we can't persist */ }
}
function loadSelectedColor() {
    try { return localStorage.getItem(SELECTED_COLOR_KEY) || DEFAULT_COLOR_ID; }
    catch (e) { return DEFAULT_COLOR_ID; }
}
function saveSelectedColor() {
    try { localStorage.setItem(SELECTED_COLOR_KEY, selectedColorId); }
    catch (e) { /* not fatal if we can't persist */ }
}
function loadCustomColors() {
    try {
        const raw = JSON.parse(localStorage.getItem(CUSTOM_COLORS_KEY));
        if (Array.isArray(raw)) return raw;
    } catch (e) { /* fall through to default */ }
    return [];
}
function saveCustomColors() {
    try { localStorage.setItem(CUSTOM_COLORS_KEY, JSON.stringify(customColors)); }
    catch (e) { /* not fatal if we can't persist */ }
}
function loadGradientColorsList() {
    try {
        const raw = JSON.parse(localStorage.getItem(GRADIENT_COLORS_KEY));
        if (Array.isArray(raw)) return raw;
    } catch (e) { /* fall through to default */ }
    return [];
}
function saveGradientColorsList() {
    try { localStorage.setItem(GRADIENT_COLORS_KEY, JSON.stringify(gradientColorsList)); }
    catch (e) { /* not fatal if we can't persist */ }
}

let totalCoins        = loadCoins();              // persists across games; only grows on game over
let ownedColors        = loadOwnedColors();        // Set of owned basic/advanced color ids
let selectedColorId    = loadSelectedColor();      // currently equipped color id
let customColors       = loadCustomColors();       // [{id, hex}, ...] one entry per custom purchase
let gradientColorsList = loadGradientColorsList(); // [{id, start, end}, ...] one entry per gradient purchase

// Darken a #rrggbb hex color by a 0..1 fraction — used to derive the eel's
// body tone from the head tone the player picked for a custom color.
function darkenHex(hex, fraction) {
    const num = parseInt(hex.slice(1), 16);
    const r = Math.max(0, Math.round(((num >> 16) & 0xff) * (1 - fraction)));
    const g = Math.max(0, Math.round(((num >> 8) & 0xff) * (1 - fraction)));
    const b = Math.max(0, Math.round((num & 0xff) * (1 - fraction)));
    return "#" + [r, g, b].map(v => v.toString(16).padStart(2, "0")).join("");
}

// Unique, stable id for a new custom/gradient purchase entry.
function generateColorEntryId(prefix) {
    return prefix + "_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7);
}

// Whichever skin is currently equipped, normalized to either a flat
// {mode:"flat", head, body} pair or a {mode:"gradient", start, end} pair.
function getEquippedEelColors() {
    const customEntry = customColors.find(c => c.id === selectedColorId);
    if (customEntry) return { mode: "flat", head: customEntry.hex, body: darkenHex(customEntry.hex, 0.35) };

    const gradientEntry = gradientColorsList.find(g => g.id === selectedColorId);
    if (gradientEntry) return { mode: "gradient", start: gradientEntry.start, end: gradientEntry.end };

    const swatch = COLOR_PALETTE.find(c => c.id === selectedColorId);
    if (swatch && ownedColors.has(swatch.id)) return { mode: "flat", head: swatch.head, body: swatch.body };

    return { mode: "flat", head: "#66fcf1", body: "#45a29e" }; // fallback: classic cyan
}

function updateCoinHUD() {
    coinCountEl.textContent = totalCoins;
    if (shopCoinCountEl) shopCoinCountEl.textContent = totalCoins;
}

// Basic/advanced tiers only: owned forever once bought, free to re-equip.
function finalizePurchase(item) {
    if (ownedColors.has(item.id) || totalCoins < item.price) return;
    totalCoins -= item.price;
    ownedColors.add(item.id);
    saveCoins();
    saveOwnedColors();
    equipColor(item.id); // auto-equip right after purchase
}

// Equips any owned color: basic/advanced, or a previously purchased
// custom/gradient entry. Always free — no coins spent re-equipping.
function equipColor(id) {
    const owned = ownedColors.has(id)
        || customColors.some(c => c.id === id)
        || gradientColorsList.some(g => g.id === id);
    if (!owned) return;
    selectedColorId = id;
    saveSelectedColor();
    renderShop();
    render(); // reflect the new eel color immediately
}

/* ---- Generic purchase confirmation (basic/advanced tiers) ---- */
function openPurchaseConfirm(item) {
    confirmMessage.textContent = "Buy " + item.name + " for " + item.price + " 🪙?";
    confirmYesBtn.onclick = () => {
        finalizePurchase(item);
        closeConfirm();
    };
    confirmOverlay.classList.remove("hidden");
}
function closeConfirm() {
    confirmOverlay.classList.add("hidden");
    confirmYesBtn.onclick = null;
}
confirmCancelBtn.addEventListener("click", closeConfirm);
confirmOverlay.addEventListener("click", (e) => {
    if (e.target === confirmOverlay) closeConfirm(); // click outside cancels, no charge
});

/* ---- Custom / gradient: color-pick modal doubles as the purchase confirm ---- */
function buildColorPickInput(labelText, value) {
    const wrapper = document.createElement("div");
    wrapper.className = "color-pick-input-group";
    const label = document.createElement("label");
    label.textContent = labelText;
    const input = document.createElement("input");
    input.type = "color";
    input.value = value;
    wrapper.appendChild(label);
    wrapper.appendChild(input);
    return { wrapper, input };
}

// A non-interactive swatch (no input) — used for the live gradient preview.
function buildColorPreviewSwatch(labelText) {
    const wrapper = document.createElement("div");
    wrapper.className = "color-pick-input-group";
    const label = document.createElement("label");
    label.textContent = labelText;
    const swatch = document.createElement("div");
    swatch.className = "color-pick-preview-swatch";
    wrapper.appendChild(label);
    wrapper.appendChild(swatch);
    return { wrapper, swatch };
}

function openColorPickConfirm(item) {
    if (totalCoins < item.price) return; // button is disabled in this case anyway

    colorPickTitle.textContent = item.tier === "gradient" ? "Choose Your Gradient Colors" : "Choose Your Custom Color";
    colorPickPrice.textContent = "Cost: " + item.price + " 🪙";
    colorPickConfirmBtn.textContent = "CONFIRM & BUY " + item.price + " 🪙";
    colorPickInputs.innerHTML = "";

    if (item.tier === "gradient") {
        // Prefill with the most recently purchased gradient, if any — makes tweaking a variant easy.
        const last = gradientColorsList[gradientColorsList.length - 1];
        const startPick = buildColorPickInput("Start", last ? last.start : DEFAULT_GRADIENT_START);
        const endPick   = buildColorPickInput("End", last ? last.end : DEFAULT_GRADIENT_END);
        const preview   = buildColorPreviewSwatch("Preview");

        // Live preview of the actual blend, so the player can judge the pairing before buying.
        const updatePreview = () => {
            preview.swatch.style.background = `linear-gradient(135deg, ${startPick.input.value}, ${endPick.input.value})`;
        };
        updatePreview();
        startPick.input.addEventListener("input", updatePreview);
        endPick.input.addEventListener("input", updatePreview);

        colorPickInputs.appendChild(startPick.wrapper);
        colorPickInputs.appendChild(endPick.wrapper);
        colorPickInputs.appendChild(preview.wrapper);
        colorPickConfirmBtn.onclick = () => finalizeGradientPurchase(startPick.input.value, endPick.input.value);
    } else {
        const last = customColors[customColors.length - 1];
        const colorPick = buildColorPickInput("Color", last ? last.hex : DEFAULT_CUSTOM_HEX);
        colorPickInputs.appendChild(colorPick.wrapper);
        colorPickConfirmBtn.onclick = () => finalizeCustomPurchase(colorPick.input.value);
    }

    colorPickOverlay.classList.remove("hidden");
}

function closeColorPick() {
    colorPickOverlay.classList.add("hidden");
    colorPickConfirmBtn.onclick = null;
}
colorPickCancelBtn.addEventListener("click", closeColorPick);
colorPickOverlay.addEventListener("click", (e) => {
    if (e.target === colorPickOverlay) closeColorPick(); // click outside cancels, no charge
});

// Buying custom/gradient always ADDS a new permanent, freely re-equippable
// entry — it never overwrites a previous purchase.
function finalizeCustomPurchase(hex) {
    const item = COLOR_PALETTE.find(c => c.id === "custom");
    if (totalCoins < item.price) return;
    totalCoins -= item.price;
    const entry = { id: generateColorEntryId("custom"), hex };
    customColors.push(entry);
    selectedColorId = entry.id;
    saveCoins();
    saveCustomColors();
    saveSelectedColor();
    closeColorPick();
    renderShop();
    render(); // reflect the new eel color immediately
}

function finalizeGradientPurchase(startHex, endHex) {
    const item = COLOR_PALETTE.find(c => c.id === "gradient");
    if (totalCoins < item.price) return;
    totalCoins -= item.price;
    const entry = { id: generateColorEntryId("gradient"), start: startHex, end: endHex };
    gradientColorsList.push(entry);
    selectedColorId = entry.id;
    saveCoins();
    saveGradientColorsList();
    saveSelectedColor();
    closeColorPick();
    renderShop();
    render(); // reflect the new eel color immediately
}

// The static "buy a new one" card for every tier, including custom/gradient.
function buildColorCard(item) {
    const isPremium = item.tier === "custom" || item.tier === "gradient"; // always a fresh purchase
    const owned     = !isPremium && ownedColors.has(item.id);
    const equipped  = !isPremium && selectedColorId === item.id;

    const card = document.createElement("div");
    card.className = "color-card" + (equipped ? " equipped" : "") + (owned ? " owned" : "");

    const swatch = document.createElement("div");
    swatch.className = "color-swatch";
    if (isPremium) {
        swatch.style.background = "linear-gradient(135deg, #777777, #4a4a4a)";
    } else {
        swatch.style.background = `linear-gradient(135deg, ${item.head}, ${item.body})`;
        swatch.style.boxShadow = `0 0 10px ${item.head}80`;
    }
    card.appendChild(swatch);

    const name = document.createElement("div");
    name.className = "color-name";
    name.textContent = item.name;
    card.appendChild(name);

    const action = document.createElement("button");
    action.className = "color-action-btn";
    if (isPremium) {
        action.textContent = "BUY " + item.price + " 🪙";
        const affordable = totalCoins >= item.price;
        action.disabled = !affordable;
        if (!affordable) card.classList.add("locked");
        action.addEventListener("click", () => openColorPickConfirm(item));
    } else if (equipped) {
        action.textContent = "EQUIPPED";
        action.disabled = true;
    } else if (owned) {
        action.textContent = "EQUIP";
        action.addEventListener("click", () => equipColor(item.id));
    } else {
        action.textContent = item.price === 0 ? "GET FREE" : ("BUY " + item.price + " 🪙");
        const affordable = totalCoins >= item.price;
        action.disabled = !affordable;
        if (!affordable) card.classList.add("locked");
        action.addEventListener("click", () => openPurchaseConfirm(item));
    }
    card.appendChild(action);

    return card;
}

// A purchased custom color's own card — freely re-equippable, no repurchase.
function buildCustomEntryCard(entry, index) {
    const equipped = selectedColorId === entry.id;
    const card = document.createElement("div");
    card.className = "color-card owned" + (equipped ? " equipped" : "");

    const swatch = document.createElement("div");
    swatch.className = "color-swatch";
    swatch.style.background = `linear-gradient(135deg, ${entry.hex}, ${darkenHex(entry.hex, 0.35)})`;
    card.appendChild(swatch);

    const name = document.createElement("div");
    name.className = "color-name";
    name.textContent = "Custom Color #" + (index + 1);
    card.appendChild(name);

    const action = document.createElement("button");
    action.className = "color-action-btn";
    if (equipped) {
        action.textContent = "EQUIPPED";
        action.disabled = true;
    } else {
        action.textContent = "EQUIP";
        action.addEventListener("click", () => equipColor(entry.id));
    }
    card.appendChild(action);

    return card;
}

// A purchased gradient's own card — freely re-equippable, no repurchase.
function buildGradientEntryCard(entry, index) {
    const equipped = selectedColorId === entry.id;
    const card = document.createElement("div");
    card.className = "color-card owned" + (equipped ? " equipped" : "");

    const swatch = document.createElement("div");
    swatch.className = "color-swatch";
    swatch.style.background = `linear-gradient(135deg, ${entry.start}, ${entry.end})`;
    card.appendChild(swatch);

    const name = document.createElement("div");
    name.className = "color-name";
    name.textContent = "Gradient Flow #" + (index + 1);
    card.appendChild(name);

    const action = document.createElement("button");
    action.className = "color-action-btn";
    if (equipped) {
        action.textContent = "EQUIPPED";
        action.disabled = true;
    } else {
        action.textContent = "EQUIP";
        action.addEventListener("click", () => equipColor(entry.id));
    }
    card.appendChild(action);

    return card;
}

function renderEelColorShop() {
    basicColorList.innerHTML = "";
    advancedColorList.innerHTML = "";
    customColorList.innerHTML = "";
    gradientColorList.innerHTML = "";

    COLOR_PALETTE.forEach(item => {
        if (item.tier === "basic") basicColorList.appendChild(buildColorCard(item));
        else if (item.tier === "advanced") advancedColorList.appendChild(buildColorCard(item));
        else if (item.tier === "custom") customColorList.appendChild(buildColorCard(item));
        else gradientColorList.appendChild(buildColorCard(item));
    });

    // Every purchased custom/gradient entry gets its own card, beside the buy card.
    customColors.forEach((entry, i) => customColorList.appendChild(buildCustomEntryCard(entry, i)));
    gradientColorsList.forEach((entry, i) => gradientColorList.appendChild(buildGradientEntryCard(entry, i)));
}

function renderShop() {
    renderEelColorShop();
    renderFrameColorShop();
    renderItemsShop();
    updateCoinHUD();
}

function openShop() {
    // Freeze gameplay behind the shop so the eel can't crash while browsing.
    if (countingDown) {
        clearInterval(countdownTimer);
        countingDown = false;
        countdownScreen.classList.add("hidden");
        pauseGame();
    } else if (hasStarted && !gameOver && !paused) {
        pauseGame();
    }
    renderShop();
    shopOverlay.classList.remove("hidden");
}

function closeShop() {
    shopOverlay.classList.add("hidden");
    closeConfirm();
    closeColorPick();
}

shopBtn.addEventListener("click", openShop);
closeShopBtn.addEventListener("click", closeShop);
shopOverlay.addEventListener("click", (e) => {
    if (e.target === shopOverlay) closeShop(); // click outside the card closes it
});


/* ============================================================================
   2c. FRAME THEME  (extra feature)
   ----------------------------------------------------------------------------
   Colors the phone panel (.game-container) itself, using the EXACT same shop
   flow as the eel colors above: 2 free basics, paid basics, advanced colors,
   and consumable custom/gradient purchases (each purchase becomes its own
   permanent, freely re-equippable card beside the buy card). The board's own
   background/grid tint is derived automatically from whichever frame is
   equipped — see applyFrameTheme() and boardTintStart/boardTintEnd.
   ============================================================================ */
const FRAME_OWNED_KEY           = "neonEelFrameOwnedColors";
const FRAME_SELECTED_KEY        = "neonEelFrameSelectedColor";
const FRAME_CUSTOM_COLORS_KEY   = "neonEelFrameCustomColors";
const FRAME_GRADIENT_COLORS_KEY = "neonEelFrameGradientColorsList";

const DEFAULT_FRAME_OWNED          = ["frame-classic", "frame-slate"];
const DEFAULT_FRAME_ID             = "frame-classic";
const DEFAULT_FRAME_CUSTOM_HEX     = "#66fcf1";
const DEFAULT_FRAME_GRADIENT_START = "#66fcf1";
const DEFAULT_FRAME_GRADIENT_END   = "#b967ff";

const FRAME_COLOR_PALETTE = [
    { id: "frame-classic",  name: "Classic Cyan",   tier: "basic",    price: 0,   accent: "#66fcf1" },
    { id: "frame-slate",    name: "Slate Grey",     tier: "basic",    price: 0,   accent: "#8c929a" },
    { id: "frame-sunset",   name: "Sunset Orange",  tier: "basic",    price: 30,  accent: "#ffb86b" },
    { id: "frame-rose",     name: "Rose Pink",      tier: "basic",    price: 30,  accent: "#ff6b9d" },
    { id: "frame-ice",      name: "Ice Blue",       tier: "basic",    price: 40,  accent: "#9fe7ff" },
    { id: "frame-royal",    name: "Royal Purple",   tier: "advanced", price: 90,  accent: "#d69bff" },
    { id: "frame-inferno",  name: "Inferno Red",    tier: "advanced", price: 110, accent: "#ff4d4d" },
    { id: "frame-toxic",    name: "Toxic Green",    tier: "advanced", price: 130, accent: "#7cff6b" },
    { id: "frame-custom",   name: "Custom Frame",   tier: "custom",   price: 200, accent: null },
    { id: "frame-gradient", name: "Gradient Frame", tier: "gradient", price: 350, accent: null },
];

function loadFrameOwnedColors() {
    try {
        const raw = JSON.parse(localStorage.getItem(FRAME_OWNED_KEY));
        if (Array.isArray(raw) && raw.length) return new Set(raw);
    } catch (e) { /* fall through to defaults */ }
    return new Set(DEFAULT_FRAME_OWNED);
}
function saveFrameOwnedColors() {
    try { localStorage.setItem(FRAME_OWNED_KEY, JSON.stringify([...frameOwnedColors])); }
    catch (e) { /* not fatal if we can't persist */ }
}
function loadFrameSelectedColor() {
    try { return localStorage.getItem(FRAME_SELECTED_KEY) || DEFAULT_FRAME_ID; }
    catch (e) { return DEFAULT_FRAME_ID; }
}
function saveFrameSelectedColor() {
    try { localStorage.setItem(FRAME_SELECTED_KEY, frameSelectedColorId); }
    catch (e) { /* not fatal if we can't persist */ }
}
function loadFrameCustomColors() {
    try {
        const raw = JSON.parse(localStorage.getItem(FRAME_CUSTOM_COLORS_KEY));
        if (Array.isArray(raw)) return raw;
    } catch (e) { /* fall through to default */ }
    return [];
}
function saveFrameCustomColors() {
    try { localStorage.setItem(FRAME_CUSTOM_COLORS_KEY, JSON.stringify(frameCustomColors)); }
    catch (e) { /* not fatal if we can't persist */ }
}
function loadFrameGradientColorsList() {
    try {
        const raw = JSON.parse(localStorage.getItem(FRAME_GRADIENT_COLORS_KEY));
        if (Array.isArray(raw)) return raw;
    } catch (e) { /* fall through to default */ }
    return [];
}
function saveFrameGradientColorsList() {
    try { localStorage.setItem(FRAME_GRADIENT_COLORS_KEY, JSON.stringify(frameGradientColorsList)); }
    catch (e) { /* not fatal if we can't persist */ }
}

let frameOwnedColors        = loadFrameOwnedColors();
let frameSelectedColorId    = loadFrameSelectedColor();
let frameCustomColors       = loadFrameCustomColors();
let frameGradientColorsList = loadFrameGradientColorsList();
// Both set for real by applyFrameTheme(); read by clearCanvas()/drawGrid().
// Equal values (the default/flat-frame case) paint as a plain flat tint.
let boardTintStart = "#66fcf1";
let boardTintEnd   = "#66fcf1";

// Blend two #rrggbb hex colors; weightB=0 -> hexA, weightB=1 -> hexB.
function mixHex(hexA, hexB, weightB) {
    const a = parseInt(hexA.slice(1), 16), b = parseInt(hexB.slice(1), 16);
    const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
    const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
    const r = Math.round(ar + (br - ar) * weightB);
    const g = Math.round(ag + (bg - ag) * weightB);
    const bl = Math.round(ab + (bb - ab) * weightB);
    return "#" + [r, g, bl].map(v => v.toString(16).padStart(2, "0")).join("");
}

// #rrggbb -> "rgba(r, g, b, alpha)", for CSS custom properties that need transparency.
function hexToRgba(hex, alpha) {
    const num = parseInt(hex.slice(1), 16);
    const r = (num >> 16) & 0xff, g = (num >> 8) & 0xff, b = num & 0xff;
    return "rgba(" + r + ", " + g + ", " + b + ", " + alpha + ")";
}

// Whichever frame theme is equipped, normalized like getEquippedEelColors().
function getEquippedFrameColors() {
    const customEntry = frameCustomColors.find(c => c.id === frameSelectedColorId);
    if (customEntry) return { mode: "flat", accent: customEntry.hex };

    const gradientEntry = frameGradientColorsList.find(g => g.id === frameSelectedColorId);
    if (gradientEntry) return { mode: "gradient", start: gradientEntry.start, end: gradientEntry.end };

    const swatch = FRAME_COLOR_PALETTE.find(c => c.id === frameSelectedColorId);
    if (swatch && frameOwnedColors.has(swatch.id)) return { mode: "flat", accent: swatch.accent };

    return { mode: "flat", accent: "#66fcf1" }; // fallback: classic cyan
}

// Applies the equipped frame theme to the ENTIRE phone panel — border/glow,
// the HUD text (.stats), and the D-pad (.dpad-btn), all via CSS custom
// properties set on .game-container (they cascade to its descendants) — and
// derives the board's own background/grid tint from the same theme. For a
// gradient frame, the board tint is a matching diagonal gradient using BOTH
// colors (not just the start) — otherwise, if the start happens to be the
// default cyan (the picker's own prefill), the board can look completely
// unchanged even though the border clearly shows a gradient.
function applyFrameTheme() {
    const frame = getEquippedFrameColors();
    const primaryAccent = frame.mode === "gradient" ? frame.start : frame.accent;

    if (frame.mode === "gradient") {
        gameContainer.style.borderImage = `linear-gradient(135deg, ${frame.start}, ${frame.end}) 1`;
        gameContainer.style.setProperty("--frame-border", "transparent");
        boardTintStart = frame.start;
        boardTintEnd = frame.end;
    } else {
        gameContainer.style.borderImage = "none";
        gameContainer.style.setProperty("--frame-border", hexToRgba(primaryAccent, 0.5));
        boardTintStart = frame.accent;
        boardTintEnd = frame.accent; // same color at both ends -> clearCanvas()/drawGrid() paint it flat
    }
    gameContainer.style.setProperty("--frame-accent", primaryAccent);
    gameContainer.style.setProperty("--frame-glow", hexToRgba(primaryAccent, 0.2));
    gameContainer.style.setProperty("--frame-glow-soft", hexToRgba(primaryAccent, 0.25));
    gameContainer.style.setProperty("--frame-text-glow", hexToRgba(primaryAccent, 0.5));

    render(); // repaint immediately so the board's tint updates without waiting for a tick
}

function equipFrameColor(id) {
    const owned = frameOwnedColors.has(id)
        || frameCustomColors.some(c => c.id === id)
        || frameGradientColorsList.some(g => g.id === id);
    if (!owned) return;
    frameSelectedColorId = id;
    saveFrameSelectedColor();
    renderFrameColorShop();
    applyFrameTheme();
}

function finalizeFramePurchase(item) {
    if (frameOwnedColors.has(item.id) || totalCoins < item.price) return;
    totalCoins -= item.price;
    frameOwnedColors.add(item.id);
    saveCoins();
    saveFrameOwnedColors();
    equipFrameColor(item.id);
}

function openFramePurchaseConfirm(item) {
    confirmMessage.textContent = "Buy " + item.name + " for " + item.price + " 🪙?";
    confirmYesBtn.onclick = () => {
        finalizeFramePurchase(item);
        closeConfirm();
    };
    confirmOverlay.classList.remove("hidden");
}

function openFrameColorPickConfirm(item) {
    if (totalCoins < item.price) return;

    colorPickTitle.textContent = item.tier === "gradient" ? "Choose Your Frame Gradient" : "Choose Your Frame Color";
    colorPickPrice.textContent = "Cost: " + item.price + " 🪙";
    colorPickConfirmBtn.textContent = "CONFIRM & BUY " + item.price + " 🪙";
    colorPickInputs.innerHTML = "";

    if (item.tier === "gradient") {
        const last = frameGradientColorsList[frameGradientColorsList.length - 1];
        const startPick = buildColorPickInput("Start", last ? last.start : DEFAULT_FRAME_GRADIENT_START);
        const endPick   = buildColorPickInput("End", last ? last.end : DEFAULT_FRAME_GRADIENT_END);
        const preview   = buildColorPreviewSwatch("Preview");

        const updatePreview = () => {
            preview.swatch.style.background = `linear-gradient(135deg, ${startPick.input.value}, ${endPick.input.value})`;
        };
        updatePreview();
        startPick.input.addEventListener("input", updatePreview);
        endPick.input.addEventListener("input", updatePreview);

        colorPickInputs.appendChild(startPick.wrapper);
        colorPickInputs.appendChild(endPick.wrapper);
        colorPickInputs.appendChild(preview.wrapper);
        colorPickConfirmBtn.onclick = () => finalizeFrameGradientPurchase(startPick.input.value, endPick.input.value);
    } else {
        const last = frameCustomColors[frameCustomColors.length - 1];
        const colorPick = buildColorPickInput("Color", last ? last.hex : DEFAULT_FRAME_CUSTOM_HEX);
        colorPickInputs.appendChild(colorPick.wrapper);
        colorPickConfirmBtn.onclick = () => finalizeFrameCustomPurchase(colorPick.input.value);
    }

    colorPickOverlay.classList.remove("hidden");
}

function finalizeFrameCustomPurchase(hex) {
    const item = FRAME_COLOR_PALETTE.find(c => c.id === "frame-custom");
    if (totalCoins < item.price) return;
    totalCoins -= item.price;
    const entry = { id: generateColorEntryId("frame-custom"), hex };
    frameCustomColors.push(entry);
    frameSelectedColorId = entry.id;
    saveCoins();
    saveFrameCustomColors();
    saveFrameSelectedColor();
    closeColorPick();
    renderFrameColorShop();
    applyFrameTheme();
}

function finalizeFrameGradientPurchase(startHex, endHex) {
    const item = FRAME_COLOR_PALETTE.find(c => c.id === "frame-gradient");
    if (totalCoins < item.price) return;
    totalCoins -= item.price;
    const entry = { id: generateColorEntryId("frame-gradient"), start: startHex, end: endHex };
    frameGradientColorsList.push(entry);
    frameSelectedColorId = entry.id;
    saveCoins();
    saveFrameGradientColorsList();
    saveFrameSelectedColor();
    closeColorPick();
    renderFrameColorShop();
    applyFrameTheme();
}

function buildFrameColorCard(item) {
    const isPremium = item.tier === "custom" || item.tier === "gradient";
    const owned     = !isPremium && frameOwnedColors.has(item.id);
    const equipped  = !isPremium && frameSelectedColorId === item.id;

    const card = document.createElement("div");
    card.className = "color-card" + (equipped ? " equipped" : "") + (owned ? " owned" : "");

    const swatch = document.createElement("div");
    swatch.className = "color-swatch";
    if (isPremium) {
        swatch.style.background = "linear-gradient(135deg, #777777, #4a4a4a)";
    } else {
        swatch.style.background = item.accent;
        swatch.style.boxShadow = `0 0 10px ${item.accent}80`;
    }
    card.appendChild(swatch);

    const name = document.createElement("div");
    name.className = "color-name";
    name.textContent = item.name;
    card.appendChild(name);

    const action = document.createElement("button");
    action.className = "color-action-btn";
    if (isPremium) {
        action.textContent = "BUY " + item.price + " 🪙";
        const affordable = totalCoins >= item.price;
        action.disabled = !affordable;
        if (!affordable) card.classList.add("locked");
        action.addEventListener("click", () => openFrameColorPickConfirm(item));
    } else if (equipped) {
        action.textContent = "EQUIPPED";
        action.disabled = true;
    } else if (owned) {
        action.textContent = "EQUIP";
        action.addEventListener("click", () => equipFrameColor(item.id));
    } else {
        action.textContent = item.price === 0 ? "GET FREE" : ("BUY " + item.price + " 🪙");
        const affordable = totalCoins >= item.price;
        action.disabled = !affordable;
        if (!affordable) card.classList.add("locked");
        action.addEventListener("click", () => openFramePurchaseConfirm(item));
    }
    card.appendChild(action);

    return card;
}

function buildFrameCustomEntryCard(entry, index) {
    const equipped = frameSelectedColorId === entry.id;
    const card = document.createElement("div");
    card.className = "color-card owned" + (equipped ? " equipped" : "");

    const swatch = document.createElement("div");
    swatch.className = "color-swatch";
    swatch.style.background = entry.hex;
    card.appendChild(swatch);

    const name = document.createElement("div");
    name.className = "color-name";
    name.textContent = "Custom Frame #" + (index + 1);
    card.appendChild(name);

    const action = document.createElement("button");
    action.className = "color-action-btn";
    if (equipped) {
        action.textContent = "EQUIPPED";
        action.disabled = true;
    } else {
        action.textContent = "EQUIP";
        action.addEventListener("click", () => equipFrameColor(entry.id));
    }
    card.appendChild(action);

    return card;
}

function buildFrameGradientEntryCard(entry, index) {
    const equipped = frameSelectedColorId === entry.id;
    const card = document.createElement("div");
    card.className = "color-card owned" + (equipped ? " equipped" : "");

    const swatch = document.createElement("div");
    swatch.className = "color-swatch";
    swatch.style.background = `linear-gradient(135deg, ${entry.start}, ${entry.end})`;
    card.appendChild(swatch);

    const name = document.createElement("div");
    name.className = "color-name";
    name.textContent = "Gradient Frame #" + (index + 1);
    card.appendChild(name);

    const action = document.createElement("button");
    action.className = "color-action-btn";
    if (equipped) {
        action.textContent = "EQUIPPED";
        action.disabled = true;
    } else {
        action.textContent = "EQUIP";
        action.addEventListener("click", () => equipFrameColor(entry.id));
    }
    card.appendChild(action);

    return card;
}

function renderFrameColorShop() {
    frameBasicColorList.innerHTML = "";
    frameAdvancedColorList.innerHTML = "";
    frameCustomColorList.innerHTML = "";
    frameGradientColorList.innerHTML = "";

    FRAME_COLOR_PALETTE.forEach(item => {
        if (item.tier === "basic") frameBasicColorList.appendChild(buildFrameColorCard(item));
        else if (item.tier === "advanced") frameAdvancedColorList.appendChild(buildFrameColorCard(item));
        else if (item.tier === "custom") frameCustomColorList.appendChild(buildFrameColorCard(item));
        else frameGradientColorList.appendChild(buildFrameColorCard(item));
    });

    frameCustomColors.forEach((entry, i) => frameCustomColorList.appendChild(buildFrameCustomEntryCard(entry, i)));
    frameGradientColorsList.forEach((entry, i) => frameGradientColorList.appendChild(buildFrameGradientEntryCard(entry, i)));
}


/* ============================================================================
   2d. SHOP TABS (Colors / Items)
   ============================================================================ */
function switchShopTab(tab) {
    const showColors = tab === "colors";
    colorsTabPanel.classList.toggle("hidden", !showColors);
    itemsTabPanel.classList.toggle("hidden", showColors);
    colorsTabBtn.classList.toggle("active", showColors);
    itemsTabBtn.classList.toggle("active", !showColors);
}
colorsTabBtn.addEventListener("click", () => switchShopTab("colors"));
itemsTabBtn.addEventListener("click", () => switchShopTab("items"));


/* ============================================================================
   2e. ITEMS (POWER-UPS)  (extra feature)
   ----------------------------------------------------------------------------
   Two consumable purchases. Each is bought like any other shop entry (a
   confirm box, coins spent) but adds a CHARGE to an inventory instead of
   being equipped — the charge is then spent later, when it's actually useful:
     - "bombclear" : removes up to BOMB_CLEAR_COUNT bombs from the current
                     board. Usable any time during a run via the HUD button
                     next to the pause button.
     - "continue"  : offered on the game-over screen; spending a charge
                     revives the eel safely instead of restarting the run.
   Charge counts persist across sessions, same as coins.
   ============================================================================ */
const BOMB_CLEAR_KEY  = "neonEelBombClearCharges";
const CONTINUE_KEY    = "neonEelContinueCharges";
const BOMB_CLEAR_COUNT = 5; // bombs removed per use

const ITEM_PALETTE = [
    { id: "bombclear", name: "Bomb Defuser", icon: "💣", price: 30,
      description: "Instantly clears " + BOMB_CLEAR_COUNT + " bombs from the board. Usable any time during a run." },
    { id: "continue",  name: "Second Chance", icon: "💗", price: 100,
      description: "Continue right where you crashed instead of restarting — once per game over." },
];

function loadBombClearCharges() {
    try { return Math.max(0, Number(localStorage.getItem(BOMB_CLEAR_KEY)) || 0); }
    catch (e) { return 0; }
}
function saveBombClearCharges() {
    try { localStorage.setItem(BOMB_CLEAR_KEY, String(bombClearCharges)); }
    catch (e) { /* not fatal if we can't persist */ }
}
function loadContinueCharges() {
    try { return Math.max(0, Number(localStorage.getItem(CONTINUE_KEY)) || 0); }
    catch (e) { return 0; }
}
function saveContinueCharges() {
    try { localStorage.setItem(CONTINUE_KEY, String(continueCharges)); }
    catch (e) { /* not fatal if we can't persist */ }
}

let bombClearCharges = loadBombClearCharges(); // persists across games; spent via the in-game HUD button
let continueCharges  = loadContinueCharges();  // persists across games; spent on the game-over screen

function buyItem(item) {
    if (totalCoins < item.price) return;
    totalCoins -= item.price;
    saveCoins();
    if (item.id === "bombclear") { bombClearCharges++; saveBombClearCharges(); }
    else if (item.id === "continue") { continueCharges++; saveContinueCharges(); }
    updateCoinHUD();
    renderItemsShop();
    updateBombClearHUD();
}

function openItemPurchaseConfirm(item) {
    confirmMessage.textContent = "Buy " + item.name + " for " + item.price + " 🪙?";
    confirmYesBtn.onclick = () => {
        buyItem(item);
        closeConfirm();
    };
    confirmOverlay.classList.remove("hidden");
}

function ownedCountFor(itemId) {
    return itemId === "bombclear" ? bombClearCharges : continueCharges;
}

function buildItemCard(item) {
    const card = document.createElement("div");
    card.className = "item-card";

    const icon = document.createElement("div");
    icon.className = "item-icon";
    icon.textContent = item.icon;
    card.appendChild(icon);

    const name = document.createElement("div");
    name.className = "item-name";
    name.textContent = item.name;
    card.appendChild(name);

    const desc = document.createElement("div");
    desc.className = "item-desc";
    desc.textContent = item.description;
    card.appendChild(desc);

    const owned = ownedCountFor(item.id);
    if (owned > 0) {
        const ownedNote = document.createElement("div");
        ownedNote.className = "item-owned-count";
        ownedNote.textContent = "OWNED: " + owned;
        card.appendChild(ownedNote);
    }

    const action = document.createElement("button");
    action.className = "color-action-btn";
    action.textContent = "BUY " + item.price + " 🪙";
    const affordable = totalCoins >= item.price;
    action.disabled = !affordable;
    if (!affordable) card.classList.add("locked");
    action.addEventListener("click", () => openItemPurchaseConfirm(item));
    card.appendChild(action);

    return card;
}

function renderItemsShop() {
    itemsList.innerHTML = "";
    ITEM_PALETTE.forEach(item => itemsList.appendChild(buildItemCard(item)));
}

/* ---- Bomb Defuser: in-game HUD button, next to the pause button ---- */
function updateBombClearHUD() {
    bombClearCountEl.textContent = bombClearCharges;
    const owns = bombClearCharges > 0;
    bombClearBtn.classList.toggle("hidden", !owns || !hasStarted);
    bombClearBtn.disabled = !(owns && hasStarted && !gameOver && !paused && !countingDown && bombs.length > 0);

    secondChanceCountEl.textContent = continueCharges;
    secondChanceBadge.classList.toggle("hidden", continueCharges <= 0 || !hasStarted);
}

function useBombClear() {
    if (bombClearBtn.disabled) return;

    const removedCount = Math.min(BOMB_CLEAR_COUNT, bombs.length);
    bombs.splice(0, removedCount);
    bombClearCharges--;
    saveBombClearCharges();

    updateBombClearHUD();
    showToast("-" + removedCount + " BOMBS CLEARED", "shield");
    render();
}

bombClearBtn.addEventListener("click", useBombClear);


/* ============================================================================
   3. GAME STATE VARIABLES  (all reset in resetGame())
   ============================================================================ */
let eel;            // array of {x,y}; eel[0] is the head, last entry is the tail
let food;             // {x,y} of the white food
let bombs;            // array of {x,y} static bombs

let dx, dy;           // current movement direction (grid cells per tick)
let score;
let level;
let currentSpeed;     // ms per tick (derived from level)

let gameTime;         // accumulated ms of *active* play (drives all timed systems)
let tickCount;        // how many ticks have run (drives hazard move cadence)

let gameOver;
let hasStarted;       // becomes true on the first direction the player chooses
let changingDirection;// lock so the player can't reverse into themselves in one tick
let deathCause;       // 'wall' | 'self' | 'bomb' | 'eaten' -> shown on game over
let coinsAwardedThisRun; // guards awardRunCoins() against double-paying after a declined continue

/* --- Evolution (extra feature) --- */
let evolutionStage;   // 0 = original look; +1 each time the eel evolves (mechanics keep scaling past EVOLUTION_MAX_VISUAL_STAGE)
let growthInterval;   // food needed to grow the eel by 1 segment; doubles with each evolution
let foodSinceGrowth;  // food eaten since the eel last grew a segment

let gameLoopTimeout;  // handle for the setTimeout driving the loop

/* --- Pause / resume --- */
let paused;           // true while the game is paused (loop stopped, overlay shown)
let countingDown;     // true during the 3-2-1 resume countdown (loop not running yet)
let countdownTimer;   // handle for the countdown setInterval

/* --- Moving hazard + shield (feature 2) --- */
let hazardUnlocked;      // latches true once the player first reaches HAZARD_UNLOCK_LEVEL
let hazardFirstCycle;    // true until the first cycle fires (uses the short HAZARD_FIRST_DELAY)
let hazardPhase;         // 'waiting' | 'warning' | 'active'
let hazardPhaseStart;    // gameTime when the current phase began
let movingHazard;        // {x,y} of the chasing hazard, or null
let shieldItem;          // {x,y} of the shield pickup, or null
let shieldDir;           // {x,y} wander direction for the roaming shield
let shieldMoveCount;     // how many times the shield has appeared as a MOVING shield (drives roam speed)
let shieldCounted;       // whether the current shield appearance has been counted as a moving one
let shieldActiveUntil;   // gameTime until which the eel is protected (0 = unprotected)
let hazardHitCooldownUntil; // gameTime until which the eel can't be bitten again
let destroyed;           // true if the hazard bit the eel's HEAD (ends the game)

/* --- Bonus (diamond) + penalty items (feature 3) --- */
let diamond;             // {x,y} or null
let diamondExpire;       // gameTime when the current diamond vanishes
let diamondNextSpawn;    // gameTime when the next diamond may appear
let penalty;             // {x,y} or null
let penaltyExpire;
let penaltyNextSpawn;

/* --- Toast --- */
let toastExpire;         // gameTime when the current toast should hide


/* ============================================================================
   4. MAIN LOOP
   ============================================================================ */

// One tick = one eel step. Update everything, then draw, then schedule the next.
function gameTick() {
    // Allow exactly one new direction to be accepted before the next move.
    changingDirection = false;
    tickCount++;

    // The game clock only advances while the eel is moving. This keeps every
    // timed system frozen on the start screen and makes the ~20s durations feel
    // like real seconds of play.
    if (dx !== 0 || dy !== 0) {
        gameTime += currentSpeed;
    }

    // --- UPDATE ---
    advanceEel();        // move the eel + handle anything it eats
    checkEvolution();      // shrink + re-skin the eel once it's grown long enough
    updateTimedSystems();  // hazard cycle, bonus spawns, expirations, toast
    updateMovingHazard();  // move the hazard toward the eel + resolve contact
    updateShieldMovement();// roam the shield around (level 5+; speed by moving-appearance count)

    // --- CHECK FOR DEATH ---
    if (checkGameOver()) {
        endGame();
        return;            // stop the loop; resetGame() will restart it
    }

    // --- DRAW ---
    render();

    // Schedule the next tick. currentSpeed may have changed this tick (level up),
    // and it takes effect here on the next scheduled step.
    gameLoopTimeout = setTimeout(gameTick, currentSpeed);
}

// (Re)start the loop cleanly, cancelling any previous pending tick.
function startLoop() {
    clearTimeout(gameLoopTimeout);
    gameTick();
}


/* ============================================================================
   5. EEL MOVEMENT + EATING
   ============================================================================ */
function advanceEel() {
    // Do nothing until the player has chosen a direction.
    if (dx === 0 && dy === 0) return;

    // New head cell in the current direction.
    const head = { x: eel[0].x + dx, y: eel[0].y + dy };
    eel.unshift(head);

    let grew = false; // when the eel eats food it keeps its tail (grows by 1)

    // --- WHITE FOOD (+FOOD_POINTS) ---
    if (food && head.x === food.x && head.y === food.y) {
        score += FOOD_POINTS;
        onScoreChanged();
        generateFood();
        playFoodSound();

        // Every N food eaten, drop a new static bomb.
        foodEaten++;
        if (foodEaten % BOMB_SPAWN_EVERY_FOOD === 0) {
            spawnBomb();
        }

        // Growth is throttled by growthInterval (see checkEvolution() below):
        // it starts at 1 (grow every food, the original behavior) and doubles
        // with each evolution, so a longer-lived eel grows more slowly.
        foodSinceGrowth++;
        if (foodSinceGrowth >= growthInterval) {
            grew = true;
            foodSinceGrowth = 0;
        }
    }

    // If we didn't grow this step, drop the tail so the eel stays the same length.
    if (!grew) eel.pop();

    // --- DIAMOND (+DIAMOND_POINTS) ---
    if (diamond && head.x === diamond.x && head.y === diamond.y) {
        score += DIAMOND_POINTS;
        diamond = null;
        scheduleDiamond();
        showToast("+" + DIAMOND_POINTS + "!", "diamond");
        onScoreChanged();
        playDiamondSound();
    }

    // --- PENALTY (-PENALTY_POINTS) ---
    if (penalty && head.x === penalty.x && head.y === penalty.y) {
        score = Math.max(0, score - PENALTY_POINTS); // never drop below zero
        penalty = null;
        schedulePenalty();
        showToast("-" + PENALTY_POINTS, "penalty");
        onScoreChanged();
        playPenaltySound();
    }

    // --- SHIELD PICKUP (temporary protection) ---
    if (shieldItem && head.x === shieldItem.x && head.y === shieldItem.y) {
        shieldActiveUntil = gameTime + SHIELD_DURATION;
        shieldItem = null;
        showToast("SHIELD ON", "shield");
        playShieldSound();
    }
}

// Track how many food have been eaten (used for bomb spawn cadence).
let foodEaten = 0;

// Place the food on a random free cell.
function generateFood() {
    food = getRandomFreeCell();
}

/* ----------------------------------------------------------------------------
   EVOLUTION (extra feature)
   ----------------------------------------------------------------------------
   A body that only ever grows eventually gets unmanageable and ends every run
   the same frustrating way. Instead, once the eel reaches
   EVOLUTION_LENGTH_THRESHOLD cells, it "evolves": the look steps one stage
   closer to a real eel, the body is cut back to EVOLUTION_TARGET_LENGTH, and
   growth slows down (growthInterval doubles, so it also costs more per cell
   to lose a body part to a hazard bite — see biteEelFrom). The visual stage
   caps at EVOLUTION_MAX_VISUAL_STAGE, but the shrink + slowdown keep
   happening every time the threshold is hit again, so a long session stays
   playable instead of spiraling into an uncontrollable tangle.

   growthInterval is always derived from evolutionStage as 2^evolutionStage,
   so evolving up and de-evolving down (applyDeEvolution, called from a
   hazard bite) can never drift out of sync with each other.
   ---------------------------------------------------------------------------- */
function checkEvolution() {
    if (eel.length < EVOLUTION_LENGTH_THRESHOLD) return;

    evolutionStage++;
    eel.splice(EVOLUTION_TARGET_LENGTH); // keep head..9th segment, drop the rest
    growthInterval = Math.pow(2, evolutionStage);
    foodSinceGrowth = 0;

    showToast("EEL EVOLVED! STAGE " + evolutionStage, "evolution", 2200);
}

// Called after a hazard bite shortens the eel. If the eel is now too short
// for its current evolution stage (< EVOLUTION_TARGET_LENGTH), it steps back
// down — repeating for as many stages as needed. Each step down DOUBLES the
// segment count (the exact inverse of the halving that evolving up applies),
// so e.g. 4 segments at stage 3 becomes 8 at stage 2, then 16 at stage 1
// (stage 1's normal 10-19 range), rather than being stranded far below the
// minimum length for its stage. The extra segments pile onto the tail's
// current cell and unstack naturally as the eel moves in later ticks.
// Returns the new stage number if a de-evolution happened, else null.
function applyDeEvolution() {
    const startStage = evolutionStage;

    while (evolutionStage > 0 && eel.length < EVOLUTION_TARGET_LENGTH) {
        const targetLength = eel.length * 2;
        const tail = eel[eel.length - 1];
        while (eel.length < targetLength) {
            eel.push({ x: tail.x, y: tail.y });
        }
        evolutionStage--;
    }

    if (evolutionStage === startStage) return null; // already fit its stage; nothing changed

    growthInterval = Math.pow(2, evolutionStage);
    foodSinceGrowth = 0;
    return evolutionStage;
}


/* ============================================================================
   6. SCORING / LEVELS / SPEED
   ============================================================================ */

// Call after ANY score change. Recomputes level + speed and updates the HUD.
function onScoreChanged() {
    // Level 1 = 0-99, Level 2 = 100-199, ...
    const newLevel = Math.floor(score / POINTS_PER_LEVEL) + 1;

    if (newLevel > level) {
        showToast("LEVEL " + newLevel + "!", "level");
    }
    level = newLevel;

    // Latch the hazard system on the first time we reach the unlock level.
    // (A penalty can drop the level back down, but once unlocked it stays on.)
    if (!hazardUnlocked && level >= HAZARD_UNLOCK_LEVEL) {
        hazardUnlocked = true;
        hazardPhase = "waiting";
        hazardPhaseStart = gameTime; // first cycle waits a full interval
    }

    // Speed is a direct function of level, capped at MIN_SPEED so the eel never
    // gets uncontrollably fast. If a penalty lowers the level, the eel slows too.
    currentSpeed = Math.max(MIN_SPEED, START_SPEED - (level - 1) * SPEED_STEP_PER_LEVEL);

    // Track the all-time best and persist it the moment it is beaten.
    if (score > highScore) {
        highScore = score;
        beatBest = true;
        saveHighScore();
    }

    updateHUD();
}


/* ============================================================================
   7. STATIC BOMBS  (unchanged behaviour: touching one ends the game)
   ============================================================================ */
function spawnBomb() {
    // Keep at least 4 cells away from the head so a bomb never appears right in
    // front of the moving eel.
    bombs.push(getRandomFreeCell(4));
}


/* ============================================================================
   8. MOVING HAZARD + SHIELD SYSTEM  (feature 2; unlocks at HAZARD_UNLOCK_LEVEL)
   ----------------------------------------------------------------------------
   A simple state machine cycles through three phases once unlocked:

     waiting  --(HAZARD_CYCLE_INTERVAL)-->  warning
     warning  --(HAZARD_WARNING_TIME)---->  active   (spawn hazard + shield)
     active   --(HAZARD_ACTIVE_DURATION)->  waiting  (despawn both)

   During 'active', the hazard chases the eel (unless the eel is shielded):
     - a hit on the BODY chops the eel from the contact point back to the tail
       and costs points per cell lost — the eel survives, just shorter;
     - a hit on the HEAD ends the game.
   Grabbing the shield item grants protection.
   ============================================================================ */
function updateHazardCycle() {
    if (!hazardUnlocked) return;

    const elapsed = gameTime - hazardPhaseStart;

    if (hazardPhase === "waiting") {
        // The very first cycle after unlocking uses a short delay so the hazard
        // appears soon; every cycle after that uses the longer calm interval.
        const wait = hazardFirstCycle ? HAZARD_FIRST_DELAY : HAZARD_CYCLE_INTERVAL;
        if (elapsed >= wait) {
            // Enter WARNING: tell the player something is coming.
            hazardFirstCycle = false;
            hazardPhase = "warning";
            hazardPhaseStart = gameTime;
            showToast("⚠ HAZARD INCOMING — GRAB THE SHIELD", "warning", HAZARD_WARNING_TIME);
        }
    } else if (hazardPhase === "warning") {
        if (elapsed >= HAZARD_WARNING_TIME) {
            // Enter ACTIVE: spawn the paired hazard + shield.
            spawnHazardPair();
            hazardPhase = "active";
            hazardPhaseStart = gameTime;
        }
    } else if (hazardPhase === "active") {
        if (elapsed >= HAZARD_ACTIVE_DURATION) {
            // Duration over: both disappear until the next cycle.
            movingHazard = null;
            shieldItem = null;
            hazardPhase = "waiting";
            hazardPhaseStart = gameTime;
        }
    }
}

function spawnHazardPair() {
    // Hazard spawns a safe distance from the head; shield can be anywhere free.
    movingHazard = getRandomFreeCell(6);
    shieldItem   = getRandomFreeCell();
    shieldCounted = false; // this appearance hasn't been counted as a moving one yet
    pickNewShieldDir();    // starting wander direction (used only once it actually roams)
}

/* --- Roaming shield ---------------------------------------------------------
   Below SHIELD_MOVE_LEVEL the shield sits STILL. Once the game reaches that level
   it wanders: drifting in a straight line, randomly turning, and bouncing off the
   walls. How fast it steps depends on how many times it has appeared as a MOVING
   shield (see shieldMoveEveryTicks) — the more moving appearances, the faster. */
function updateShieldMovement() {
    if (!shieldItem) return;                        // no shield on the board right now
    if (level < SHIELD_MOVE_LEVEL) return;          // stays still until level 5

    // Count this appearance the first moment it is eligible to move (level 5+).
    if (!shieldCounted) {
        shieldMoveCount++;
        shieldCounted = true;
    }

    if (tickCount % shieldMoveEveryTicks() !== 0) return; // move on the moving-appearance cadence

    // Occasionally change direction (or if it doesn't have one yet).
    if (!shieldDir || (shieldDir.x === 0 && shieldDir.y === 0)) pickNewShieldDir();
    if (Math.random() < SHIELD_TURN_CHANCE) pickNewShieldDir();

    let nx = shieldItem.x + shieldDir.x;
    let ny = shieldItem.y + shieldDir.y;

    // Bounce off a wall: if the next step would leave the board, pick a new heading.
    if (nx < 0 || nx >= tileCount || ny < 0 || ny >= tileCount) {
        pickNewShieldDir();
        nx = shieldItem.x + shieldDir.x;
        ny = shieldItem.y + shieldDir.y;
    }

    // Safety clamp so it can never end up outside the board.
    shieldItem.x = Math.max(0, Math.min(tileCount - 1, nx));
    shieldItem.y = Math.max(0, Math.min(tileCount - 1, ny));
}

// How often the roaming shield steps, in eel-ticks (bigger = slower/easier).
// Based on how many times it has appeared as a MOVING shield, NOT the level:
//   1st moving appearance -> START (4), then shrinks by SHIELD_SPEEDUP_PER_APPEARANCE
//   each moving appearance, down to SHIELD_MOVE_EVERY_TICKS_MIN (1).
function shieldMoveEveryTicks() {
    const stepsFaster = (shieldMoveCount - 1) * SHIELD_SPEEDUP_PER_APPEARANCE;
    return Math.max(SHIELD_MOVE_EVERY_TICKS_MIN, SHIELD_MOVE_EVERY_TICKS_START - stepsFaster);
}

// Pick one of the four grid directions at random for the roaming shield.
function pickNewShieldDir() {
    const dirs = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }];
    shieldDir = dirs[Math.floor(Math.random() * dirs.length)];
}

// Move the hazard + resolve any contact with the eel. Called every tick.
function updateMovingHazard() {
    if (!movingHazard) return;

    // The hazard only steps every HAZARD_MOVE_EVERY_TICKS ticks, so it moves
    // slower than the eel and can be outrun.
    if (tickCount % HAZARD_MOVE_EVERY_TICKS === 0) {
        stepHazardTowardEel();
    }

    resolveHazardContact();
}

// Greedy chase: step one cell along whichever axis is further from the head.
function stepHazardTowardEel() {
    const head = eel[0];
    const diffX = head.x - movingHazard.x;
    const diffY = head.y - movingHazard.y;

    if (Math.abs(diffX) > Math.abs(diffY)) {
        movingHazard.x += Math.sign(diffX);
    } else if (diffY !== 0) {
        movingHazard.y += Math.sign(diffY);
    } else if (diffX !== 0) {
        movingHazard.x += Math.sign(diffX);
    }

    // Safety clamp so the hazard can never leave the board.
    movingHazard.x = Math.max(0, Math.min(tileCount - 1, movingHazard.x));
    movingHazard.y = Math.max(0, Math.min(tileCount - 1, movingHazard.y));
}

function resolveHazardContact() {
    if (!movingHazard) return;

    // Find WHICH eel segment the hazard is sitting on, searching from the head
    // outward. hitIndex 0 = head, larger = further down the body toward the tail.
    let hitIndex = -1;
    for (let i = 0; i < eel.length; i++) {
        if (eel[i].x === movingHazard.x && eel[i].y === movingHazard.y) {
            hitIndex = i;
            break;
        }
    }
    if (hitIndex === -1) return;                   // hazard isn't touching the eel

    // Shielded? Blocked completely, no body loss.
    if (gameTime < shieldActiveUntil) return;

    // Recently bitten? Brief immunity so we don't lose the whole eel in a flash.
    if (gameTime < hazardHitCooldownUntil) return;

    biteEelFrom(hitIndex);
    hazardHitCooldownUntil = gameTime + HAZARD_HIT_COOLDOWN;
}

// The hazard's contact at `index` (0 = head, larger = further toward the tail):
//   - HEAD hit (index 0)  -> the eel is destroyed and the game ends.
//   - BODY hit (index >=1) -> chop that segment AND everything behind it (toward
//                             the tail); the eel survives, shorter. Each lost cell
//                             costs points (more at higher evolution stages — see
//                             BODY_LOSS_PENALTY), and the level then follows the
//                             score. If the bite leaves the eel too short for its
//                             current evolution stage, it de-evolves (see
//                             applyDeEvolution()).
function biteEelFrom(index) {
    // A direct hit on the head ends the game.
    if (index === 0) {
        destroyed = true;                          // checkGameOver() will end the run
        return;
    }

    // A body hit chops from the contact point back to the tail.
    const removed = eel.length - index;            // cells from the cut back to the tail
    playHazardBiteSound();

    // Lose points for the body we lost (score can't go below zero), then recompute
    // the level + speed from the new score. A more-evolved eel costs more per cell,
    // since its segments grew much more slowly (see BODY_LOSS_PENALTY).
    const penaltyPerCell = BODY_LOSS_PENALTY * growthInterval;
    score = Math.max(0, score - removed * penaltyPerCell);
    onScoreChanged();

    eel.splice(index);                             // remove from the contact cell to the tail

    const deEvolvedTo = applyDeEvolution(); // null if the eel didn't need to step back down

    let message = "-" + removed + " BODY (-" + (removed * penaltyPerCell) + ")";
    if (deEvolvedTo !== null) message += " · DE-EVOLVED TO STAGE " + deEvolvedTo;
    showToast(message, "hazard");
}


/* ============================================================================
   9. BONUS (DIAMOND) + PENALTY ITEMS  (feature 3)
   ----------------------------------------------------------------------------
   Each item type runs on its own timer: it appears occasionally, lingers for
   BONUS_ITEM_LIFETIME, then (if not eaten) vanishes and schedules the next one.
   ============================================================================ */
function updateBonusItems() {
    // --- Diamond ---
    if (diamond) {
        if (gameTime >= diamondExpire) {          // not eaten in time -> vanish
            diamond = null;
            scheduleDiamond();
        }
    } else if (gameTime >= diamondNextSpawn) {    // time to appear
        diamond = getRandomFreeCell(2);
        diamondExpire = gameTime + BONUS_ITEM_LIFETIME;
    }

    // --- Penalty ---
    if (penalty) {
        if (gameTime >= penaltyExpire) {
            penalty = null;
            schedulePenalty();
        }
    } else if (gameTime >= penaltyNextSpawn) {
        penalty = getRandomFreeCell(2);
        penaltyExpire = gameTime + BONUS_ITEM_LIFETIME;
    }
}

// Pick a randomized delay so items don't appear on a predictable beat.
function jitteredInterval(base) {
    return base + (Math.random() * 2 - 1) * BONUS_SPAWN_JITTER;
}
function scheduleDiamond() { diamondNextSpawn = gameTime + jitteredInterval(DIAMOND_SPAWN_INTERVAL); }
function schedulePenalty() { penaltyNextSpawn = gameTime + jitteredInterval(PENALTY_SPAWN_INTERVAL); }


/* ============================================================================
   RUN ALL TIME-BASED SYSTEMS FOR THIS TICK
   ============================================================================ */
function updateTimedSystems() {
    updateHazardCycle();
    updateBonusItems();

    // Hide the toast once its time is up.
    if (toastEl.classList.contains("show") && gameTime >= toastExpire) {
        toastEl.classList.remove("show");
    }
}


/* ============================================================================
   10. COLLISION / GAME OVER
   ----------------------------------------------------------------------------
   Note: a hazard hit on the BODY only shortens the eel; a hazard hit on the HEAD
   ends the game (via the `destroyed` flag). Walls, self-collision, and static
   bombs also end the game.
   ============================================================================ */
function checkGameOver() {
    // The hazard bit the eel's head.
    if (destroyed) { deathCause = "eaten"; return true; }

    const head = eel[0];

    // Wall collision.
    if (head.x < 0 || head.x >= tileCount || head.y < 0 || head.y >= tileCount) {
        deathCause = "wall";
        return true;
    }

    // Self collision (start at 4: the head can't reach cells closer than that).
    for (let i = 4; i < eel.length; i++) {
        if (eel[i].x === head.x && eel[i].y === head.y) {
            deathCause = "self";
            return true;
        }
    }

    // Static bomb collision.
    for (let i = 0; i < bombs.length; i++) {
        if (bombs[i].x === head.x && bombs[i].y === head.y) {
            deathCause = "bomb";
            return true;
        }
    }

    return false;
}

function endGame() {
    gameOver = true;
    clearTimeout(gameLoopTimeout);
    (DEATH_SOUNDS[deathCause] || playWallHitSound)();

    // Friendly explanation of what killed the player.
    const reasons = {
        wall:  "You slammed into the wall.",
        self:  "You bit your own tail.",
        bomb:  "A bomb got you.",
        eaten: "The hazard bit your head."
    };
    deathReasonEl.textContent = reasons[deathCause] || "You crashed.";
    finalScoreEl.textContent  = score;
    finalLevelEl.textContent  = level;
    finalBestEl.textContent   = highScore;

    // Show the "NEW BEST!" badge only if this run set a new record.
    newBestBadge.classList.toggle("hidden", !beatBest);

    // Offer CONTINUE only if the player owns a Second Chance charge. If they
    // do, the coin payout is deferred until the game over is actually
    // accepted (see awardRunCoins()) — continuing shouldn't let the player
    // farm partial coins for a run that isn't really finished yet.
    const canOfferContinue = continueCharges > 0;
    continueBtn.classList.toggle("hidden", !canOfferContinue);
    if (canOfferContinue) {
        coinsEarnedEl.textContent = Math.floor(score / POINTS_PER_COIN);
        totalCoinsFinalEl.textContent = totalCoins;
    } else {
        awardRunCoins();
    }

    pauseBtn.classList.add("hidden");     // no pausing on the game-over screen
    bombClearBtn.classList.add("hidden"); // ...and no using items here either
    gameOverScreen.classList.remove("hidden");
}

// Converts this run's score into coins and adds them to the persistent
// total. Idempotent per run (see coinsAwardedThisRun), so it's safe to call
// either immediately from endGame() (no continue available) or lazily from
// restartGame() (a continue was offered but declined).
function awardRunCoins() {
    if (coinsAwardedThisRun) return;
    coinsAwardedThisRun = true;

    const coinsEarned = Math.floor(score / POINTS_PER_COIN);
    totalCoins += coinsEarned;
    saveCoins();
    coinsEarnedEl.textContent = coinsEarned;
    totalCoinsFinalEl.textContent = totalCoins;
    updateCoinHUD();
}

/* ---- Continue (Second Chance item) ---- */

// Undoes the fatal move so the eel is back in a safe, valid state, then
// grants a brief shield so it isn't instantly re-killed by whatever was
// already threatening it (especially a still-chasing hazard).
function reviveEelToSafety() {
    if (deathCause !== "eaten") {
        // wall/self/bomb: the fatal head is still at eel[0] — remove it,
        // restoring the eel to its last valid shape before the crash.
        if (eel.length > 1) {
            eel.shift();
        } else {
            // No previous shape to restore (a 1-segment eel) — teleport the
            // lone segment to a cell that's actually free instead.
            const safeCell = getRandomFreeCell(6);
            eel[0].x = safeCell.x;
            eel[0].y = safeCell.y;
        }
    }
    shieldActiveUntil = gameTime + SHIELD_DURATION;
    hazardHitCooldownUntil = gameTime + SHIELD_DURATION;
}

function continueRun() {
    if (continueCharges <= 0) return;
    continueCharges--;
    saveContinueCharges();

    reviveEelToSafety();

    gameOver = false;
    destroyed = false;
    deathCause = null;
    dx = 0; dy = 0;              // require a fresh direction, same as the very start of a run
    changingDirection = false;

    gameOverScreen.classList.add("hidden");
    continueBtn.classList.add("hidden");
    pauseBtn.classList.remove("hidden");
    updateBombClearHUD();

    updateHUD();
    render();
    startLoop();
}
continueBtn.addEventListener("click", continueRun);

// Shared restart path for the RESTART button and the SPACE shortcut: if a
// continue was offered but declined, the deferred coin payout happens here.
function restartGame() {
    awardRunCoins();
    resetGame();
}


/* ============================================================================
   11. RENDERING
   ============================================================================ */
function render() {
    clearCanvas();
    drawGrid();
    // Draw items first, then the eel on top of everything.
    drawBombs();
    drawFood();
    drawDiamond();
    drawPenalty();
    drawShieldItem();
    drawMovingHazard();
    drawEel();
    updateBombClearHUD(); // reactive: keeps the button's enabled state in sync with bombs.length etc.
}

// A diagonal (top-left -> bottom-right) gradient tinting `baseHex` with
// boardTintStart/boardTintEnd, matching the frame border's own 135deg CSS
// gradient direction. When the two are equal (a flat, non-gradient frame),
// this degenerates into a plain flat color automatically.
//
// The theme accent is pre-darkened before blending, regardless of how
// bright/light the player's chosen color is (a stark white or neon custom
// color would otherwise wash the whole board out) — the board should always
// read as "dark with a hint of the theme," comfortable to stare at for a
// whole run, not a colored panel.
function boardTintGradient(baseHex, weight) {
    const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    const start = darkenHex(boardTintStart, 0.55);
    const end = darkenHex(boardTintEnd, 0.55);
    gradient.addColorStop(0, mixHex(baseHex, start, weight));
    gradient.addColorStop(1, mixHex(baseHex, end, weight));
    return gradient;
}

// The board's background/grid pick up a subtle tint of the equipped frame
// theme, so the board still reads as "based on" the phone frame without
// ever getting bright enough to strain the eyes during a long run.
function clearCanvas() {
    ctx.fillStyle = boardTintGradient("#111418", 0.08);
    ctx.fillRect(0, 0, canvas.width, canvas.height);
}

// Subtle background grid lines for that sleek arcade look.
function drawGrid() {
    ctx.strokeStyle = boardTintGradient("#1a222c", 0.16);
    ctx.lineWidth = 1;
    for (let i = 0; i < canvas.width; i += GRID_SIZE) {
        ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, canvas.height); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(canvas.width, i); ctx.stroke();
    }
}

// Helper: pixel center of a grid cell.
function cellCenter(c) { return c * GRID_SIZE + GRID_SIZE / 2; }

// A 45°-diagonal gradient scoped to the EEL's own bounding box (not the
// board) — start color at the eel's top-left corner, end color at its
// bottom-right corner, so the gradient travels and resizes WITH the eel as
// it moves and grows, always at a true 45° angle regardless of the
// bounding box's aspect ratio.
function buildDiagonalGradient(startHex, endHex) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    eel.forEach(part => {
        if (part.x < minX) minX = part.x;
        if (part.y < minY) minY = part.y;
        if (part.x > maxX) maxX = part.x;
        if (part.y > maxY) maxY = part.y;
    });
    const minPx = minX * GRID_SIZE, minPy = minY * GRID_SIZE;
    const maxPx = (maxX + 1) * GRID_SIZE, maxPy = (maxY + 1) * GRID_SIZE;

    // A line with equal x/y steps is exactly 45°, regardless of whether the
    // bounding box is wide, tall, or square. Its length is chosen so t=0
    // lands on the box's top-left corner and t=1 lands on its bottom-right
    // corner (projecting both onto the 45° axis).
    const span = ((maxPx - minPx) + (maxPy - minPy)) / 2;
    const gradient = ctx.createLinearGradient(minPx, minPy, minPx + span, minPy + span);
    gradient.addColorStop(0, startHex);
    gradient.addColorStop(1, endHex);
    return gradient;
}

function drawEel() {
    // While shielded the eel turns gold and pulses; the instant the shield ends
    // it reverts to its normal appearance.
    const shielded = gameTime < shieldActiveUntil;
    const pulse = shielded ? (0.5 + 0.5 * Math.sin(gameTime / 110)) : 0; // 0..1
    const skin = getEquippedEelColors(); // shop-selected skin (flat head/body or a gradient)
    const diagonalGradient = skin.mode === "gradient" ? buildDiagonalGradient(skin.start, skin.end) : null;
    const stage = Math.min(evolutionStage, EVOLUTION_MAX_VISUAL_STAGE); // visual look caps here
    const total = eel.length;

    eel.forEach((part, index) => {
        let fillStyle, glowColor, glowBlur;
        if (shielded) {
            // Head slightly brighter than the body so the head is still readable.
            fillStyle = index === 0 ? "#fff3b0" : "#ffd166";
            glowColor = "#ffd166";
            glowBlur  = 12 + pulse * 16;              // pulsing golden glow
        } else if (skin.mode === "gradient") {
            fillStyle = diagonalGradient;
            glowColor = skin.start;
            glowBlur  = index === 0 ? 8 : 0;          // subtle glow on the head only
        } else {
            fillStyle = index === 0 ? skin.head : skin.body; // shop-equipped skin
            glowColor = skin.head;
            glowBlur  = index === 0 ? 8 : 0;          // subtle glow on the head only
        }
        drawEelSegment(stage, part, index, total, fillStyle, glowColor, glowBlur);
    });
    ctx.shadowBlur = 0;
}

// The body's local "forward" direction at a segment, used to orient the head
// snout, fins, and swimming undulation. Falls back to the current movement
// direction (or rightward) when neighbors coincide, e.g. a length-1 eel.
function getSegmentDirection(index) {
    const prev = eel[Math.max(0, index - 1)];       // neighbor toward the head
    const next = eel[Math.min(eel.length - 1, index + 1)]; // neighbor toward the tail
    let vx = prev.x - next.x, vy = prev.y - next.y;
    if (vx === 0 && vy === 0) { vx = dx || 1; vy = dy || 0; }
    const len = Math.hypot(vx, vy) || 1;
    return { x: vx / len, y: vy / len };
}

// Draws one eel segment. `stage` (0..EVOLUTION_MAX_VISUAL_STAGE) picks how
// eel-like it looks:
//   0 = original blocky rounded-rect segments.
//   1 = rounded, tapered body with simple eyes on the head.
//   2 = stage 1's body, but the head becomes a pointed snout.
//   3 = stage 2's body/head, plus a gentle swimming wiggle, more frequent
//       dorsal fins, and a fanned tail-fin at the very tip (new at this stage).
function drawEelSegment(stage, part, index, total, fillStyle, glowColor, glowBlur) {
    ctx.fillStyle = fillStyle;
    ctx.shadowColor = glowColor;
    ctx.shadowBlur = glowBlur;
    ctx.strokeStyle = "#0b0c10";
    ctx.lineWidth = 2;

    if (stage === 0) {
        ctx.beginPath();
        ctx.roundRect(part.x * GRID_SIZE, part.y * GRID_SIZE, GRID_SIZE, GRID_SIZE, 4);
        ctx.fill();
        ctx.stroke();
        return;
    }

    const taper = total > 1 ? 1 - 0.45 * (index / (total - 1)) : 1; // 1.0 at head -> 0.55 at tail
    const r = (GRID_SIZE / 2) * 1.05 * taper;
    const isHead = index === 0;
    const isTail = index === total - 1;

    let cx = cellCenter(part.x), cy = cellCenter(part.y);
    if (stage >= 3) {
        // Gentle swimming undulation: a perpendicular wiggle that travels along the body over time.
        const dir = getSegmentDirection(index);
        const perp = { x: -dir.y, y: dir.x };
        const wiggle = Math.sin(gameTime / 220 - index * 0.7) * (GRID_SIZE * 0.18);
        cx += perp.x * wiggle;
        cy += perp.y * wiggle;
    }

    if (stage >= 2 && isHead) {
        // Pointed snout: a simple triangle facing the direction of travel.
        const dir = getSegmentDirection(0);
        const perp = { x: -dir.y, y: dir.x };
        const tipX = cx + dir.x * r * 1.6, tipY = cy + dir.y * r * 1.6;
        const backX = cx - dir.x * r * 0.6, backY = cy - dir.y * r * 0.6;
        ctx.beginPath();
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(backX + perp.x * r, backY + perp.y * r);
        ctx.lineTo(backX - perp.x * r, backY - perp.y * r);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
    } else if (stage >= 3 && isTail && total > 1) {
        // NEW at stage 3: a fanned tail-fin instead of a plain circle at the very tip.
        const dir = getSegmentDirection(index);
        const perp = { x: -dir.y, y: dir.x };
        const tipBackX = cx - dir.x * r * 1.4, tipBackY = cy - dir.y * r * 1.4;
        ctx.beginPath();
        ctx.moveTo(cx + dir.x * r * 0.6, cy + dir.y * r * 0.6);       // where the fin meets the body
        ctx.lineTo(tipBackX + perp.x * r * 0.9, tipBackY + perp.y * r * 0.9);
        ctx.lineTo(cx - dir.x * r * 0.5, cy - dir.y * r * 0.5);       // notch at the center of the fan
        ctx.lineTo(tipBackX - perp.x * r * 0.9, tipBackY - perp.y * r * 0.9);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
    } else {
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
    }

    // Dorsal fins (stage 3+, more frequent than earlier drafts): every other
    // body segment, alternating sides, skipping the head and tail.
    if (stage >= 3 && !isHead && !isTail && index % 2 === 0) {
        const dir = getSegmentDirection(index);
        const perp = { x: -dir.y, y: dir.x };
        const side = (index % 4 === 0) ? 1 : -1;
        ctx.beginPath();
        ctx.moveTo(cx + perp.x * r * side * 0.3, cy + perp.y * r * side * 0.3);
        ctx.lineTo(cx + perp.x * r * side * 1.6, cy + perp.y * r * side * 1.6);
        ctx.lineTo(cx - dir.x * r * 0.8, cy - dir.y * r * 0.8);
        ctx.closePath();
        ctx.fill();
    }

    // Simple eyes on the head — the earliest "more eel-like" upgrade, stage 1+.
    if (stage >= 1 && isHead) {
        const dir = getSegmentDirection(0);
        const perp = { x: -dir.y, y: dir.x };
        ctx.shadowBlur = 0;
        ctx.fillStyle = "#0b0c10";
        [-1, 1].forEach(side => {
            const ex = cx + dir.x * r * 0.3 + perp.x * r * 0.5 * side;
            const ey = cy + dir.y * r * 0.3 + perp.y * r * 0.5 * side;
            ctx.beginPath();
            ctx.arc(ex, ey, r * 0.16, 0, Math.PI * 2);
            ctx.fill();
        });
    }
}

function drawFood() {
    if (!food) return;
    ctx.fillStyle = "#e5e6e8";
    ctx.shadowBlur = 10;
    ctx.shadowColor = "#66fcf1";
    ctx.beginPath();
    ctx.arc(cellCenter(food.x), cellCenter(food.y), GRID_SIZE / 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
}

function drawBombs() {
    bombs.forEach(bomb => {
        ctx.fillStyle = "#ff3366";
        ctx.shadowBlur = 15;
        ctx.shadowColor = "#ff3366";
        ctx.beginPath();
        ctx.arc(cellCenter(bomb.x), cellCenter(bomb.y), GRID_SIZE / 2.2, 0, Math.PI * 2);
        ctx.fill();
        // Small white warning core.
        ctx.fillStyle = "#ffffff";
        ctx.shadowBlur = 0;
        ctx.fillRect(cellCenter(bomb.x) - 2, cellCenter(bomb.y) - 2, 4, 4);
    });
    ctx.shadowBlur = 0;
}

// Diamond bonus: a spinning cyan gem.
function drawDiamond() {
    if (!diamond) return;
    const cx = cellCenter(diamond.x), cy = cellCenter(diamond.y);
    const r = GRID_SIZE / 2.2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(gameTime / 400);       // slow spin
    ctx.fillStyle = "#5bc8ff";
    ctx.shadowColor = "#5bc8ff";
    ctx.shadowBlur = 14;
    ctx.beginPath();                  // a diamond = square rotated 45°
    ctx.moveTo(0, -r); ctx.lineTo(r, 0); ctx.lineTo(0, r); ctx.lineTo(-r, 0);
    ctx.closePath();
    ctx.fill();
    // Bright inner highlight.
    ctx.fillStyle = "#dff5ff";
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.moveTo(0, -r / 2); ctx.lineTo(r / 2, 0); ctx.lineTo(0, r / 2); ctx.lineTo(-r / 2, 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.shadowBlur = 0;
}

// Penalty: an orange downward triangle with a minus bar (clearly "bad, go down").
function drawPenalty() {
    if (!penalty) return;
    const cx = cellCenter(penalty.x), cy = cellCenter(penalty.y);
    const r = GRID_SIZE / 2;
    ctx.fillStyle = "#ff6b35";
    ctx.shadowColor = "#ff6b35";
    ctx.shadowBlur = 14;
    ctx.beginPath();                  // downward-pointing triangle
    ctx.moveTo(cx - r, cy - r * 0.7);
    ctx.lineTo(cx + r, cy - r * 0.7);
    ctx.lineTo(cx, cy + r);
    ctx.closePath();
    ctx.fill();
    // White minus sign.
    ctx.fillStyle = "#ffffff";
    ctx.shadowBlur = 0;
    ctx.fillRect(cx - 5, cy - 4, 10, 3);
    ctx.shadowBlur = 0;
}

// Shield pickup: a pulsing golden ring with a "+" — thematically matches the
// golden shielded eel.
function drawShieldItem() {
    if (!shieldItem) return;
    const cx = cellCenter(shieldItem.x), cy = cellCenter(shieldItem.y);
    const pulse = 0.5 + 0.5 * Math.sin(gameTime / 130);
    ctx.strokeStyle = "#ffd166";
    ctx.shadowColor = "#ffd166";
    ctx.shadowBlur = 10 + pulse * 10;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, GRID_SIZE / 2.6, 0, Math.PI * 2);
    ctx.stroke();
    // "+" cross in the middle.
    ctx.beginPath();
    ctx.moveTo(cx - 4, cy); ctx.lineTo(cx + 4, cy);
    ctx.moveTo(cx, cy - 4); ctx.lineTo(cx, cy + 4);
    ctx.stroke();
    ctx.shadowBlur = 0;
}

// Moving hazard: a spiky, pulsing purple star.
function drawMovingHazard() {
    if (!movingHazard) return;
    const cx = cellCenter(movingHazard.x), cy = cellCenter(movingHazard.y);
    const pulse = 0.5 + 0.5 * Math.sin(gameTime / 90);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(gameTime / 250);
    ctx.fillStyle = "#b967ff";
    ctx.shadowColor = "#b967ff";
    ctx.shadowBlur = 14 + pulse * 10;
    drawStar(0, 0, 6, GRID_SIZE / 2, GRID_SIZE / 4.5);
    ctx.fill();
    // Dark core.
    ctx.fillStyle = "#2a0a3d";
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.arc(0, 0, GRID_SIZE / 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.shadowBlur = 0;
}

// Trace a star path (used by the moving hazard). Caller sets fill/stroke.
function drawStar(cx, cy, spikes, outerR, innerR) {
    let rot = -Math.PI / 2;
    const step = Math.PI / spikes;
    ctx.beginPath();
    ctx.moveTo(cx, cy - outerR);
    for (let i = 0; i < spikes; i++) {
        ctx.lineTo(cx + Math.cos(rot) * outerR, cy + Math.sin(rot) * outerR); rot += step;
        ctx.lineTo(cx + Math.cos(rot) * innerR, cy + Math.sin(rot) * innerR); rot += step;
    }
    ctx.closePath();
}


/* ============================================================================
   12. HUD + TOAST MESSAGES
   ============================================================================ */
function updateHUD() {
    scoreEl.textContent = score;
    highScoreEl.textContent = highScore;
    levelEl.textContent = level;
    // Speed % relative to the level-1 speed (100% = starting speed, higher = faster).
    speedEl.textContent = Math.round((START_SPEED / currentSpeed) * 100);
}

// Show a short pop-up message. `type` selects a color (see .toast.* in CSS).
function showToast(message, type, duration) {
    toastEl.textContent = message;
    toastEl.className = "toast show " + (type || "");
    toastExpire = gameTime + (duration || TOAST_DEFAULT_TIME);
}


/* ============================================================================
   13. INPUT  (keyboard + on-screen D-pad + swipe)
   ----------------------------------------------------------------------------
   All three input methods funnel into setDirection(), which enforces the
   "no reversing into yourself" rule and the one-turn-per-tick lock.
   ============================================================================ */
function setDirection(dir) {
    if (gameOver) return;
    if (splashActive) return; // ignore steering while the intro splash is still covering the board
    if (paused || countingDown) return; // ignore steering while paused / counting down
    if (changingDirection) return; // already turned this tick

    const goingUp    = dy === -1;
    const goingDown  = dy === 1;
    const goingLeft  = dx === -1;
    const goingRight = dx === 1;

    let turned = false;
    if (dir === "left"  && !goingRight) { dx = -1; dy = 0; turned = true; }
    if (dir === "right" && !goingLeft)  { dx = 1;  dy = 0; turned = true; }
    if (dir === "up"    && !goingDown)  { dx = 0;  dy = -1; turned = true; }
    if (dir === "down"  && !goingUp)    { dx = 0;  dy = 1;  turned = true; }

    if (turned) {
        changingDirection = true;
        markStarted();
    }
}

// Hide the start hint on the very first move.
function markStarted() {
    if (!hasStarted) {
        hasStarted = true;
        startScreen.classList.add("hidden");
        pauseBtn.classList.remove("hidden"); // pause is available once we're playing
        updateBombClearHUD();                // ...and so is the Bomb Defuser, if owned
    }
}

/* ---- Keyboard ---- */
document.addEventListener("keydown", (event) => {
    const key = event.key;

    // SPACE restarts after a crash.
    if (key === " ") {
        event.preventDefault();
        if (gameOver) {
            restartGame();
        } else {
            useBombClear();
        }
        return;
    }

    // P toggles pause / resume.
    if (key === "p" || key === "P") {
        togglePause();
        return;
    }

    // Stop arrow keys / space from scrolling the page.
    if ([" ", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(key)) {
        event.preventDefault();
    }

    switch (key) {
        case "ArrowLeft":  case "a": case "A": setDirection("left");  break;
        case "ArrowRight": case "d": case "D": setDirection("right"); break;
        case "ArrowUp":    case "w": case "W": setDirection("up");    break;
        case "ArrowDown":  case "s": case "S": setDirection("down");  break;
    }
});

/* ---- On-screen D-pad ---- */
// pointerdown fires for both mouse and touch and has no tap delay.
touchControls.querySelectorAll(".dpad-btn").forEach(btn => {
    btn.addEventListener("pointerdown", (e) => {
        e.preventDefault();               // avoid double-firing / focus scroll
        setDirection(btn.dataset.dir);
    });
});

/* ---- Swipe gestures on the board ---- */
let touchStartX = 0, touchStartY = 0;

boardWrapper.addEventListener("touchstart", (e) => {
    const t = e.changedTouches[0];
    touchStartX = t.clientX;
    touchStartY = t.clientY;
}, { passive: true });

// Block page scrolling while swiping over the board.
boardWrapper.addEventListener("touchmove", (e) => {
    e.preventDefault();
}, { passive: false });

boardWrapper.addEventListener("touchend", (e) => {
    // Tapping the board while crashed also restarts (handy on mobile).
    if (gameOver) return;

    const t = e.changedTouches[0];
    const dX = t.clientX - touchStartX;
    const dY = t.clientY - touchStartY;

    // Ignore tiny movements (a tap, not a swipe).
    if (Math.abs(dX) < SWIPE_THRESHOLD && Math.abs(dY) < SWIPE_THRESHOLD) return;

    // Longer axis wins.
    if (Math.abs(dX) > Math.abs(dY)) {
        setDirection(dX > 0 ? "right" : "left");
    } else {
        setDirection(dY > 0 ? "down" : "up");
    }
}, { passive: true });

/* ---- Restart button (mouse + touch) ---- */
restartBtn.addEventListener("click", restartGame);


/* ============================================================================
   PAUSE / RESUME  (with a 3-2-1 countdown when resuming)
   ============================================================================ */
function togglePause() {
    // Only pausable while actually playing: not on the start/game-over screens,
    // and not in the middle of a resume countdown.
    if (!hasStarted || gameOver || countingDown) return;
    if (paused) resumeWithCountdown();
    else        pauseGame();
}

function pauseGame() {
    paused = true;
    clearTimeout(gameLoopTimeout);           // stop the loop -> the whole board freezes
    pauseScreen.classList.remove("hidden");
    pauseBtn.innerHTML = "&#9654;";          // show a "play" triangle
    pauseBtn.setAttribute("aria-label", "Resume");
}

function resumeWithCountdown() {
    paused = false;
    countingDown = true;
    pauseScreen.classList.add("hidden");
    pauseBtn.innerHTML = "&#10073;&#10073;"; // back to the "pause" bars
    pauseBtn.setAttribute("aria-label", "Pause");

    // Count 3 -> 2 -> 1 (one second each), then start playing again. This uses a
    // real-time interval, so the frozen board stays put behind the big number.
    let n = 3;
    showCountdownNumber(n);
    clearInterval(countdownTimer);
    countdownTimer = setInterval(() => {
        n--;
        if (n > 0) {
            showCountdownNumber(n);
        } else {
            clearInterval(countdownTimer);
            countdownScreen.classList.add("hidden");
            countingDown = false;
            startLoop();                     // resume ticking
        }
    }, 1000);
}

// Show one countdown number and restart its CSS pop animation.
function showCountdownNumber(n) {
    countdownNum.textContent = n;
    countdownScreen.classList.remove("hidden");
    // Force the animation to replay by removing then re-adding it (needs a reflow).
    countdownNum.style.animation = "none";
    void countdownNum.offsetWidth;
    countdownNum.style.animation = "";
}

/* ---- Pause controls: corner button, overlay RESUME button, and the P key ---- */
pauseBtn.addEventListener("click", togglePause);
resumeBtn.addEventListener("click", togglePause);


/* ============================================================================
   14. BACKGROUND MUSIC  (plays a real audio file — see /audio/bgm.mp3)
   ============================================================================ */

let musicMuted    = false; // whether the PLAYER has chosen to mute, via the sound button
let audioUnlocked = false; // becomes true once the browser has actually let sound through

// Browsers always allow a MUTED <audio> element to autoplay with no
// interaction at all. So we start the loop muted the moment the script
// runs — while the splash screen is still showing — so it's already
// running (silently) underneath the logo.
function beginSilentPlayback() {
    bgMusic.muted = true;
    bgMusic.play().catch(() => {}); // muted autoplay basically never fails, but just in case
}

// Makes the already-running track audible. Called automatically the
// instant the splash screen finishes (see hideSplash()) — this works
// without a tap in browsers that allow it (e.g. once a player has used the
// game before, or it's been added to the home screen as an app). Some
// browsers still block ANY audible sound before a genuine tap/click/key no
// matter what — that's a platform rule with no code-level workaround — so
// the fallback listener further down catches that case and unmutes on the
// player's first real touch of the page instead.
function unmuteMusic() {
    if (musicMuted) return; // player has explicitly muted via the sound button — respect that
    bgMusic.muted = false;
    bgMusic.play().catch(() => {});
    audioUnlocked = true;
}

// The ONLY thing that mutes background music is the sound button — game
// state (pause, game over, restart) never calls this. It controls ONLY
// bgMusic; sound effects (food, diamond, etc.) are handled by a completely
// separate audio context further down and always play regardless of this
// button's state.
function setMusicMuted(muted) {
    musicMuted = muted;
    bgMusic.muted = muted;
    if (!muted) {
        bgMusic.play().catch(() => {}); // clicking the button IS a real gesture too
    }
    // Resume the SFX context here too, regardless of mute/unmute — clicking
    // this button is a real gesture on every browser, and it might be the
    // player's very first interaction with the page at all. Resuming it
    // later, from inside the game loop when food gets eaten, is too late on
    // stricter browsers and leaves it stuck suspended forever.
    const ctx = getSfxContext();
    if (ctx.state === "suspended") ctx.resume();
    soundBtn.textContent = muted ? "🔇" : "🔊";
    soundBtn.classList.toggle("muted", muted);
    soundBtn.setAttribute("aria-label", muted ? "Unmute music" : "Mute music");
    try { localStorage.setItem(SOUND_MUTED_KEY, muted ? "1" : "0"); } catch (e) {}
}

// Restore whatever the player last chose, so a returning player doesn't
// have to re-mute every visit.
try {
    musicMuted = localStorage.getItem(SOUND_MUTED_KEY) === "1";
} catch (e) {}
soundBtn.textContent = musicMuted ? "🔇" : "🔊"; // sync the icon only — playback hasn't started yet
soundBtn.classList.toggle("muted", musicMuted);
soundBtn.setAttribute("aria-label", musicMuted ? "Unmute music" : "Mute music");

beginSilentPlayback(); // start the (silent, for now) loop right away — while the splash screen is still up

soundBtn.addEventListener("click", () => setMusicMuted(!musicMuted));

// Fallback: if the automatic unmute attempt in hideSplash() gets blocked
// by the browser (no interaction yet), catch the player's very FIRST
// tap/click/key anywhere on the page (home screen, D-pad, keyboard, shop —
// anything) and unmute right then instead. Since the track is already
// running by this point, this just turns the volume on — no restart. Also
// warms up the sound-effects context here, so the very first pickup sound
// in an actual run doesn't have to create it from scratch.
function unmuteOnFirstInteraction() {
    unmuteMusic();
    const ctx = getSfxContext();
    if (ctx.state === "suspended") ctx.resume(); // do this HERE, inside the real gesture — see setMusicMuted() for why
    document.removeEventListener("pointerdown", unmuteOnFirstInteraction);
    document.removeEventListener("keydown", unmuteOnFirstInteraction);
}
document.addEventListener("pointerdown", unmuteOnFirstInteraction);
document.addEventListener("keydown", unmuteOnFirstInteraction);


/* ============================================================================
   15. SOUND EFFECTS  (Web Audio API — short synthesized blips, no audio files)
   ----------------------------------------------------------------------------
   This is a SEPARATE, second AudioContext from the background music (which
   plays through the <audio id="bgMusic"> element) — one-shot game sounds
   work completely differently under the hood (they're generated on the fly,
   not decoded from a file), so they get their own tiny "sound card". This
   one is intentionally NOT wired to the sound button — the button only
   controls bgMusic, so these always play regardless of its state.
   ============================================================================ */

let sfxCtx  = null;
let sfxGain = null;

function getSfxContext() {
    if (!sfxCtx) {
        sfxCtx = new (window.AudioContext || window.webkitAudioContext)();
        sfxGain = sfxCtx.createGain();
        sfxGain.gain.value = 1; // always on — not tied to musicMuted/the sound button
        sfxGain.connect(sfxCtx.destination);
    }
    return sfxCtx;
}

// Plays one short pitched tone. `endFreq` is optional — if set, the pitch
// slides from `freq` to `endFreq` over the note (that's what makes a sound
// feel like it's rising/falling, e.g. a power-up sweep or a falling "hurt"
// tone, instead of sitting on one flat pitch).
function playBlip({ freq, endFreq = null, duration = 0.12, type = "square", volume = 0.22, delay = 0 }) {
    const ctx = getSfxContext();
    if (ctx.state === "suspended") ctx.resume();
    const when = ctx.currentTime + delay;

    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, when);
    if (endFreq !== null) osc.frequency.exponentialRampToValueAtTime(endFreq, when + duration);

    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(0, when);
    envelope.gain.linearRampToValueAtTime(volume, when + 0.01);        // near-instant attack — SFX should feel snappy
    envelope.gain.exponentialRampToValueAtTime(0.0001, when + duration); // then decay away

    osc.connect(envelope);
    envelope.connect(sfxGain);
    osc.start(when);
    osc.stop(when + duration + 0.05);
}

// Plays a short burst of filtered white noise — good for anything that
// isn't really a "pitch" (a crunch, a thud, an explosion). Built from a
// buffer of random sample values instead of an oscillator's clean wave.
function playNoiseBurst({ duration = 0.15, volume = 0.28, filterFreq = 1200, delay = 0 }) {
    const ctx = getSfxContext();
    if (ctx.state === "suspended") ctx.resume();
    const when = ctx.currentTime + delay;

    const bufferSize = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1; // raw white noise

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter(); // softens raw noise into a "crunch"/"boom" instead of a harsh hiss
    filter.type = "lowpass";
    filter.frequency.value = filterFreq;

    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(volume, when);
    envelope.gain.exponentialRampToValueAtTime(0.0001, when + duration);

    noise.connect(filter);
    filter.connect(envelope);
    envelope.connect(sfxGain);
    noise.start(when);
    noise.stop(when + duration + 0.05);
}

// --- One function per game event -------------------------------------------

function playFoodSound() {
    // Quick upward "pop" — the classic pickup blip.
    playBlip({ freq: 523.25, endFreq: 1046.50, duration: 0.09, type: "square", volume: 0.5 });
}

function playDiamondSound() {
    // Two-note ascending sparkle — reads as the "bigger" reward vs. plain food.
    playBlip({ freq: 784.00,  endFreq: 1568.00, duration: 0.10, type: "triangle", volume: 0.5 });
    playBlip({ freq: 1046.50, duration: 0.16, type: "triangle", volume: 0.48, delay: 0.08 });
}

function playPenaltySound() {
    // Downward buzzy blip — reads as "negative" without being harsh.
    playBlip({ freq: 300, endFreq: 120, duration: 0.18, type: "sawtooth", volume: 0.5 });
}

function playShieldSound() {
    // A quick, cheerful three-note "ta-da!" (ascending major arpeggio)
    // instead of a plain sweep — reads as excited/happy rather than just "on".
    playBlip({ freq: 523.25, duration: 0.09, type: "square", volume: 0.5 });               // C5
    playBlip({ freq: 659.25, duration: 0.09, type: "square", volume: 0.5,  delay: 0.08 });  // E5
    playBlip({ freq: 783.99, duration: 0.18, type: "square", volume: 0.52, delay: 0.16 });  // G5 — held a beat longer
}

function playHazardBiteSound() {
    // Same fix as the wall hit: the low `sine` tone barely reproduces on
    // small speakers. Added a sharp higher-pitched "snap" transient so the
    // bite is actually audible, kept the noise crunch, switched the low
    // tone to `square` and raised its volume for more presence underneath.
    playNoiseBurst({ duration: 0.04, volume: 0.48, filterFreq: 3500 }); // sharp "snap" — cuts through
    playNoiseBurst({ duration: 0.12, volume: 0.44, filterFreq: 800 });  // crunch body
    playBlip({ freq: 220, endFreq: 70, duration: 0.14, type: "square", volume: 0.5 });
}

function playWallHitSound() {
    // Very low sine tones barely reproduce on small phone speakers, which is
    // likely why this one was hard to hear — switched to square wave (more
    // harmonic content = more audible at low pitch) and added a sharp
    // high-passed "crack" transient on top of the low rumble for punch.
    playNoiseBurst({ duration: 0.05, volume: 0.32, filterFreq: 4000 }); // sharp crack — cuts through small speakers
    playNoiseBurst({ duration: 0.18, volume: 0.26, filterFreq: 500 });  // low rumble underneath, for weight
    playBlip({ freq: 220, endFreq: 80, duration: 0.2, type: "square", volume: 0.5 });
}

function playSelfBiteSound() {
    // Two falling notes — a quick "gulp" shape, distinct from the wall's
    // single thud. Switched triangle -> square and raised volume/pitch a
    // bit, both of which make a real audible difference on phone speakers.
    playBlip({ freq: 320, endFreq: 160, duration: 0.13, type: "square", volume: 0.5 });
    playBlip({ freq: 240, endFreq: 110, duration: 0.16, type: "square", volume: 0.5, delay: 0.1 });
}

function playBombSound() {
    // Explosion: a wide noise burst plus a falling low tone underneath.
    playNoiseBurst({ duration: 0.3, volume: 0.3, filterFreq: 2000 });
    playBlip({ freq: 200, endFreq: 40, duration: 0.3, type: "sawtooth", volume: 0.5 });
}

// Looked up by deathCause in endGame() — see section 10.
const DEATH_SOUNDS = {
    wall:  playWallHitSound,
    self:  playSelfBiteSound,
    bomb:  playBombSound,
    eaten: playHazardBiteSound, // a head hit is really just a stronger version of the same bite
};


/* ============================================================================
   16. RESET + BOOT
   ============================================================================ */
function resetGame() {
    // --- Core state ---
    eel = [{ x: 10, y: 10 }];
    bombs = [];
    dx = 0; dy = 0;
    score = 0;
    level = 1;
    foodEaten = 0;
    currentSpeed = START_SPEED;

    gameTime = 0;
    tickCount = 0;

    gameOver = false;
    hasStarted = false;
    changingDirection = false;
    deathCause = null;
    coinsAwardedThisRun = false;
    beatBest = false;   // high score itself persists; only the "new best" flag resets

    // --- Evolution ---
    evolutionStage = 0;
    growthInterval = 1;   // grow every food eaten, same as the original behavior
    foodSinceGrowth = 0;

    // --- Hazard + shield ---
    hazardUnlocked = false;
    hazardFirstCycle = true;
    hazardPhase = "waiting";
    hazardPhaseStart = 0;
    movingHazard = null;
    shieldItem = null;
    shieldDir = { x: 0, y: 0 };
    shieldMoveCount = 0;
    shieldCounted = false;
    shieldActiveUntil = 0;
    hazardHitCooldownUntil = 0;
    destroyed = false;

    // --- Bonus / penalty items ---
    diamond = null;
    penalty = null;
    scheduleDiamond();
    // Offset the penalty timer so the two rarely appear at the same moment.
    schedulePenalty();
    penaltyNextSpawn += PENALTY_SPAWN_INTERVAL / 2;

    // --- Toast ---
    toastEl.className = "toast";
    toastExpire = 0;

    // --- Pause / countdown ---
    paused = false;
    countingDown = false;
    clearInterval(countdownTimer);
    pauseScreen.classList.add("hidden");
    countdownScreen.classList.add("hidden");
    pauseBtn.classList.add("hidden");            // shown again on the first move
    pauseBtn.innerHTML = "&#10073;&#10073;";
    pauseBtn.setAttribute("aria-label", "Pause");
    bombClearBtn.classList.add("hidden");        // shown again on the first move, if owned
    continueBtn.classList.add("hidden");         // only shown by the next endGame(), if owned

    // Food needs the reset state above (getRandomFreeCell reads eel/bombs/etc.).
    generateFood();

    // --- Screens ---
    gameOverScreen.classList.add("hidden");
    startScreen.classList.remove("hidden");

    updateHUD();
    startLoop();
}


/* ----------------------------------------------------------------------------
   SHARED SPAWN HELPERS
   ---------------------------------------------------------------------------- */

// Is a grid cell empty of the eel and every item?
function isCellFree(x, y) {
    if (eel.some(s => s.x === x && s.y === y)) return false;
    if (food && food.x === x && food.y === y) return false;
    if (bombs.some(b => b.x === x && b.y === y)) return false;
    if (diamond && diamond.x === x && diamond.y === y) return false;
    if (penalty && penalty.x === x && penalty.y === y) return false;
    if (movingHazard && movingHazard.x === x && movingHazard.y === y) return false;
    if (shieldItem && shieldItem.x === x && shieldItem.y === y) return false;
    return true;
}

// Return a random free cell. `minHeadDist` optionally keeps it that many cells
// (Manhattan distance) away from the eel's head.
function getRandomFreeCell(minHeadDist = 0) {
    let x, y, tries = 0;
    do {
        x = Math.floor(Math.random() * tileCount);
        y = Math.floor(Math.random() * tileCount);
        tries++;
        if (tries > 500) break; // safety valve on a nearly-full board
    } while (
        !isCellFree(x, y) ||
        (minHeadDist > 0 &&
            Math.abs(x - eel[0].x) + Math.abs(y - eel[0].y) < minHeadDist)
    );
    return { x, y };
}


/* ----------------------------------------------------------------------------
   PWA: SERVICE WORKER REGISTRATION + INSTALL PROMPT
   ----------------------------------------------------------------------------
   Registering the service worker is what makes the game installable and
   playable offline. It only works over HTTPS or http://localhost — browsers
   block service workers on plain file:// pages, so this fails silently
   there (the game itself is completely unaffected either way).
   ---------------------------------------------------------------------------- */
if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
        navigator.serviceWorker.register("sw.js").catch(() => {
            /* Expected on file:// or unsupported browsers — the game still works fine without it. */
        });
    });
}


/* ----------------------------------------------------------------------------
   SPLASH / INTRO SCREEN
   ---------------------------------------------------------------------------- */
let splashActive = true; // blocks steering input until the splash finishes (see setDirection())

function hideSplash() {
    splashActive = false;
    splashScreen.classList.add("hidden");
    unmuteMusic(); // try to make the already-running loop audible right as the home screen appears
}


/* ----------------------------------------------------------------------------
   BOOT THE GAME
   ---------------------------------------------------------------------------- */
updateCoinHUD();
resetGame();
applyFrameTheme(); // paints the persisted frame + board tint (also does the first real render)
setTimeout(hideSplash, SPLASH_DURATION);
