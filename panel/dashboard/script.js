
/* ==========================================
   GROW ASSIST v1.2
   AGENT + LIVE CAPTURE + WORLD MAPPING
========================================== */

/* CONFIGURATION */

const CONFIG = {
  agentURL: "http://127.0.0.1:8765/status",
  captureURL: "http://127.0.0.1:8765/capture",
  refreshInterval: 3000,
  captureInterval: 1500
};

/* GLOBAL STATE */

let agentOnline = false;
let gameFound = false;
let monitoring = false;
let monitorTimer = null;
let lastGameState = null;
let lastAgentError = null;

let captureTimer = null;
let captureRunning = false;
let currentCaptureURL = null;

const $ = (id) => document.getElementById(id);

/* ==========================================
   1. ACTIVITY LOG
========================================== */

function addLog(message) {
  const list = $("activityList");
  if (!list) return;

  const empty = list.querySelector(".empty");
  if (empty) empty.remove();

  const entry = document.createElement("div");
  entry.className = "activity-entry";

  const label = document.createElement("span");
  label.textContent = message;

  const time = document.createElement("small");
  time.textContent = new Date().toLocaleTimeString();

  entry.append(label, time);
  list.prepend(entry);

  while (list.children.length > 50) {
    list.lastElementChild.remove();
  }
}

$("clearLog")?.addEventListener("click", () => {
  $("activityList").innerHTML =
    '<div class="empty">No activity recorded yet.</div>';

  lastGameState = null;
  lastAgentError = null;
});

/* ==========================================
   2. LIVE CAPTURE ELEMENTS
========================================== */

const captureImage = $("gameCaptureImage");
const captureMessage = $("captureMessage");
const captureIndicator = $("captureIndicator");

function showCaptureMessage(message) {
  if (captureImage) {
    captureImage.style.display = "none";
  }

  if (captureMessage) {
    captureMessage.style.display = "block";
    captureMessage.textContent = message;
  }

  if (captureIndicator) {
    captureIndicator.style.display = "none";
  }
}

function stopCapture(message = "Capture stopped.") {
  if (captureTimer) {
    clearInterval(captureTimer);
    captureTimer = null;
  }

  if (currentCaptureURL) {
    URL.revokeObjectURL(currentCaptureURL);
    currentCaptureURL = null;
  }

  if (captureImage) {
    captureImage.removeAttribute("src");
    captureImage.style.display = "none";
  }

  if (captureIndicator) {
    captureIndicator.style.display = "none";
  }

  if (captureMessage) {
    captureMessage.style.display = "block";
    captureMessage.textContent = message;
  }
}

/* ==========================================
   3. CAPTURE IMAGE FROM LOCAL AGENT
========================================== */

async function updateGameCapture() {

  if (!captureImage || captureRunning) return;

  if (!agentOnline) {
    stopCapture("Waiting for Local Agent...");
    return;
  }

  if (!gameFound) {
    stopCapture("Waiting for Growtopia...");
    return;
  }

  captureRunning = true;

  try {
    const response = await fetch(
      CONFIG.captureURL + "?t=" + Date.now(),
      {
        method: "GET",
        cache: "no-store"
      }
    );

    if (!response.ok) {
      throw new Error(
        "Capture endpoint returned HTTP " + response.status
      );
    }

    const blob = await response.blob();

    if (!blob.type.startsWith("image/")) {
      throw new Error("Agent did not return an image.");
    }

    const newURL = URL.createObjectURL(blob);
    const oldURL = currentCaptureURL;

    captureImage.onload = () => {
      if (oldURL) {
        URL.revokeObjectURL(oldURL);
      }
    };

    captureImage.onerror = () => {
      URL.revokeObjectURL(newURL);

      if (currentCaptureURL === newURL) {
        currentCaptureURL = null;
      }

      showCaptureMessage("Unable to display captured image.");
    };

    currentCaptureURL = newURL;
    captureImage.src = newURL;
    captureImage.style.display = "block";

    if (captureMessage) {
      captureMessage.style.display = "none";
    }

    if (captureIndicator) {
      captureIndicator.style.display = "block";
    }

  } catch (error) {

    showCaptureMessage(
      "Capture unavailable: " + error.message
    );

    if (
      lastCaptureError !== error.message
    ) {
      addLog("Screen capture error: " + error.message);
      lastCaptureError = error.message;
    }

  } finally {
    captureRunning = false;
  }
}

let lastCaptureError = null;

function startCapture() {
  if (captureTimer) return;

  addLog("Live capture started.");

  updateGameCapture();

  captureTimer = setInterval(
    updateGameCapture,
    CONFIG.captureInterval
  );
}

/* ==========================================
   4. AGENT CONNECTION
========================================== */

async function updateAgentStatus() {

  try {

    const response = await fetch(CONFIG.agentURL, {
      method: "GET",
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error("HTTP " + response.status);
    }

    const data = await response.json();

    agentOnline = data.status === "online";

    const games = Array.isArray(data.games)
      ? data.games
      : [];

    gameFound = data.gameFound === true;

    $("monitorStatus").textContent =
      agentOnline ? "Online" : "Offline";

    $("agentDescription").textContent =
      agentOnline
        ? "Local Agent connected"
        : "Agent unavailable";

    $("selectedItem").textContent =
      gameFound ? "Detected" : "Not Found";

    $("gameDescription").textContent =
      gameFound
        ? games.map(g => g.title || g.process).join(", ")
        : "Waiting for Growtopia";

    $("detectedCount").textContent = games.length;

    $("systemStatus").textContent =
      agentOnline ? "Ready" : "Disconnected";

    $("agentConnection").textContent =
      agentOnline ? "Connected" : "Disconnected";

    if (agentOnline && lastAgentError !== "connected") {
      addLog("GrowAssist Agent connected.");
      lastAgentError = "connected";
    }

    if (gameFound !== lastGameState) {

      addLog(
        gameFound
          ? "Growtopia detected. PID: " + games[0].pid
          : "Growtopia not detected."
      );

      lastGameState = gameFound;
    }

    if (agentOnline && gameFound) {
      startCapture();
    } else {
      stopCapture(
        !agentOnline
          ? "Waiting for Local Agent..."
          : "Waiting for Growtopia..."
      );
    }

    lastAgentError = null;

  } catch (error) {

    agentOnline = false;
    gameFound = false;

    $("monitorStatus").textContent = "Offline";

    $("agentDescription").textContent =
      "Cannot connect to local Agent";

    $("selectedItem").textContent = "Unknown";

    $("gameDescription").textContent =
      "Agent connection unavailable";

    $("systemStatus").textContent = "Disconnected";

    $("agentConnection").textContent = "Offline";

    $("detectedCount").textContent = "0";

    stopCapture("Agent disconnected.");

    if (lastAgentError !== error.message) {
      addLog(
        "Agent connection failed: " + error.message
      );

      lastAgentError = error.message;
    }

    lastGameState = null;
  }
}

/* Initial connection */

updateAgentStatus();

setInterval(
  updateAgentStatus,
  CONFIG.refreshInterval
);

/* ==========================================
   5. ITEM MONITOR CONFIGURATION
========================================== */

$("itemSelect")?.addEventListener("change", () => {

  const selected = $("itemSelect").value;

  addLog("Selected monitoring item: " + selected);
});

$("startBtn")?.addEventListener("click", () => {

  if (monitoring) return;

  if (!agentOnline) {
    addLog("Cannot start: Agent is disconnected.");
    return;
  }

  if (
    !Number.isInteger(Number($("targetCount").value)) ||
    Number($("targetCount").value) < 1
  ) {
    addLog("Invalid monitoring target.");
    return;
  }

  monitoring = true;

  const selected = $("itemSelect").value;
  const target = $("targetCount").value;

  $("startBtn").textContent = "MONITORING";
  $("startBtn").disabled = true;

  addLog(
    "Monitoring configuration started: " +
    selected + " | Target: " + target
  );

  // Configuration monitoring only.
  // Does not perform gameplay actions.
});

$("stopBtn")?.addEventListener("click", () => {

  if (!monitoring) return;

  monitoring = false;

  $("startBtn").textContent = "START MONITOR";
  $("startBtn").disabled = false;

  addLog("Monitoring configuration stopped.");
});

/* ==========================================
   6. WORLD MAPPING SIMULATOR
========================================== */

const MAP_WIDTH = 12;
const MAP_HEIGHT = 8;

const world = Array(
  MAP_WIDTH * MAP_HEIGHT
).fill("empty");

let player = { x: 2, y: 5 };
let target = { x: 8, y: 3 };
let simulatedPath = [];

const grid = $("worldGrid");
const mapMode = $("mapMode");
const pathResult = $("pathResult");

function cellIndex(x, y) {
  return y * MAP_WIDTH + x;
}

function renderWorld() {

  if (!grid) return;

  grid.innerHTML = "";

  for (let y = 0; y < MAP_HEIGHT; y++) {

    for (let x = 0; x < MAP_WIDTH; x++) {

      const cell = document.createElement("button");
      const type = world[cellIndex(x, y)];

      cell.type = "button";
      cell.className = "world-cell " + type;

      const isPlayer =
        player.x === x && player.y === y;

      const isTarget =
        target.x === x && target.y === y;

      const isPath = simulatedPath.some(
        p => p.x === x && p.y === y
      );

      if (isPlayer) {

        cell.classList.add("player");
        cell.textContent = "P";

      } else if (isTarget) {

        cell.classList.add("target");
        cell.textContent = "T";

      } else if (isPath) {

        cell.classList.add("path");
        cell.textContent = "•";

      } else {

        cell.textContent =
          type === "dirt" ? "D" :
          type === "rock" ? "R" :
          type === "cave" ? "C" : "";
      }

      cell.title = `X:${x} Y:${y} - ${type}`;

      cell.addEventListener("click", () => {

        const mode = mapMode?.value;

        if (!mode) return;

        if (mode === "player") {

          player = { x, y };

        } else if (mode === "target") {

          target = { x, y };

        } else {

          world[cellIndex(x, y)] = mode;
        }

        simulatedPath = [];

        if (pathResult) {
          pathResult.textContent =
            "Map updated. Analyze the path again.";
        }

        renderWorld();
      });

      grid.appendChild(cell);
    }
  }
}

/* ==========================================
   7. PATH ANALYSIS
========================================== */

// Abstract grid simulation only.
// Does not control Growtopia.

function findPath(start, end) {

  if (
    start.x === end.x &&
    start.y === end.y
  ) {
    return [start];
  }

  const queue = [{
    pos: start,
    path: [start]
  }];

  const visited = new Set([
    cellIndex(start.x, start.y)
  ]);

  const moves = [
    { x: 1, y: 0, type: "walk" },
    { x: -1, y: 0, type: "walk" },
    { x: 0, y: -1, type: "jump-up" },
    { x: 0, y: 1, type: "drop" },
    { x: 1, y: -1, type: "jump-forward" },
    { x: -1, y: -1, type: "jump-forward" }
  ];

  while (queue.length > 0) {

    const current = queue.shift();
    const p = current.pos;

    if (p.x === end.x && p.y === end.y) {
      return current.path;
    }

    for (const move of moves) {

      const nx = p.x + move.x;
      const ny = p.y + move.y;

      if (
        nx < 0 || nx >= MAP_WIDTH ||
        ny < 0 || ny >= MAP_HEIGHT
      ) {
        continue;
      }

      const index = cellIndex(nx, ny);

      if (visited.has(index)) continue;

      if (
        ["dirt", "rock"].includes(world[index]) &&
        !(nx === end.x && ny === end.y)
      ) {
        continue;
      }

      visited.add(index);

      queue.push({
        pos: { x: nx, y: ny },
        path: [
          ...current.path,
          {
            x: nx,
            y: ny,
            move: move.type
          }
        ]
      });
    }
  }

  return null;
}

/* ==========================================
   8. ANALYZE PATH BUTTON
========================================== */

$("analyzePath")?.addEventListener("click", () => {

  const result = findPath(player, target);

  if (!result) {

    simulatedPath = [];

    if (pathResult) {
      pathResult.textContent =
        "No available path in the current simulation.";
    }

    addLog("Path analysis: No route found.");

  } else {

    simulatedPath = result;

    const distance = result.length - 1;

    const moves = result
      .slice(1)
      .map(p => p.move)
      .join(" → ");

    if (pathResult) {
      pathResult.textContent =
        `Path found! ${distance} simulated steps. ` +
        `Start: (${player.x}, ${player.y}). ` +
        `Target: (${target.x}, ${target.y}). ` +
        `Route: ${moves || "Same position"}. ` +
        `Abstract simulation only.`;
    }

    addLog(
      "Path analysis completed. Steps: " + distance
    );
  }

  renderWorld();
});

/* ==========================================
   9. RESET MAP
========================================== */

$("resetMap")?.addEventListener("click", () => {

  world.fill("empty");

  player = { x: 2, y: 5 };
  target = { x: 8, y: 3 };

  simulatedPath = [];

  if (pathResult) {
    pathResult.textContent =
      "Map reset. Place your blocks and analyze again.";
  }

  renderWorld();

  addLog("World mapping reset.");
});

/* ==========================================
   10. INITIALIZE
========================================== */

renderWorld();

addLog("GROW ASSIST dashboard initialized.");
