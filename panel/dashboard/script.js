/* ==========================================
   GROW ASSIST v1.5
   AGENT STATUS + LIVE CAPTURE + VISUAL BLOCK SCAN + WORLD MAPPING
   Dashboard-only monitoring and simulation.
   No automated gameplay input is sent.
========================================== */

/* 1. CONFIGURATION */

const CONFIG = {
  agentURL: "http://127.0.0.1:8765/status",
  captureURL: "http://127.0.0.1:8765/capture",
  refreshInterval: 3000,
  captureInterval: 500,
  requestTimeout: 8000
};

/* 2. GLOBAL STATE */

let agentOnline = false;
let gameFound = false;
let monitoring = false;
let lastGameState = null;
let lastAgentError = null;
let lastCaptureError = null;

let captureTimer = null;
let captureRunning = false;
let currentCaptureURL = null;
let captureGeneration = 0;
let statusTimer = null;
let detectionEnabled = true;
let detectionCanvas = null;
let detectionContext = null;
let lastDetectionSummary = "";

const $ = (id) => document.getElementById(id);

function setText(id, value) {
  const element = $(id);
  if (element) element.textContent = String(value);
}

function setFirstExistingText(ids, value) {
  for (const id of ids) {
    const element = $(id);
    if (element) {
      element.textContent = String(value);
      return true;
    }
  }
  return false;
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    CONFIG.requestTimeout
  );

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

/* 3. ACTIVITY LOG */

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
  const list = $("activityList");
  if (list) {
    list.innerHTML =
      '<div class="empty">No activity recorded yet.</div>';
  }
});

/* 4. DETECTION PREVIEW ELEMENTS */

function ensureCaptureElements() {
  let preview = $("capturePreview");

  if (!preview) {
    preview = document.querySelector("#detection .preview");
  }

  if (!preview) {
    console.warn(
      "GROW ASSIST: Detection Preview container not found. " +
      "Add #capturePreview or .preview inside #detection."
    );
    return null;
  }

  preview.style.position = "relative";
  preview.style.overflow = "hidden";

  let image = $("gameCaptureImage");
  if (!image) {
    image = document.createElement("img");
    image.id = "gameCaptureImage";
    image.alt = "Growtopia screen capture";
    preview.appendChild(image);
  }

  Object.assign(image.style, {
    display: "none",
    width: "100%",
    height: "100%",
    maxWidth: "100%",
    objectFit: "contain",
    background: "#080c11"
  });

  let message = $("captureMessage");
  if (!message) {
    message = document.createElement("div");
    message.id = "captureMessage";
    message.textContent = "Waiting for Local Agent...";
    preview.appendChild(message);
  }

  let indicator = $("captureIndicator");
  if (!indicator) {
    indicator = document.createElement("div");
    indicator.id = "captureIndicator";
    indicator.textContent = "● LIVE CAPTURE";
    preview.appendChild(indicator);
  }

  Object.assign(message.style, {
    display: "block",
    textAlign: "center",
    padding: "20px",
    color: "#85919e"
  });

  Object.assign(indicator.style, {
    display: "none",
    position: "absolute",
    top: "10px",
    left: "10px",
    zIndex: "5",
    padding: "7px 10px",
    borderRadius: "5px",
    background: "#183126",
    color: "#36d399",
    fontSize: "10px"
  });

  return { preview, image, message, indicator };
}

function showCaptureMessage(message) {
  const elements = ensureCaptureElements();
  if (!elements) return;

  elements.image.style.display = "none";
  elements.message.style.display = "block";
  elements.message.textContent = message;
  elements.indicator.style.display = "none";
}

function stopCapture(message = "Capture stopped.") {
  captureGeneration++;

  if (captureTimer !== null) {
    clearInterval(captureTimer);
    captureTimer = null;
  }

  if (currentCaptureURL) {
    URL.revokeObjectURL(currentCaptureURL);
    currentCaptureURL = null;
  }

  const elements = ensureCaptureElements();
  if (elements) {
    if (detectionContext && detectionCanvas) {
      detectionContext.clearRect(0, 0, detectionCanvas.width, detectionCanvas.height);
    }
    elements.image.removeAttribute("src");
    elements.image.style.display = "none";
    elements.message.style.display = "block";
    elements.message.textContent = message;
    elements.indicator.style.display = "none";
  }
}

/* 4B. INITIAL VISUAL BLOCK DETECTION
   Browser-side image analysis only. This first pass identifies likely
   Rock pixels and the dark Cave Background opening, plus the soil region.
   Results are approximate and must be calibrated against more screenshots.
*/

function ensureDetectionOverlay(preview) {
  if (!detectionCanvas) {
    detectionCanvas = document.createElement("canvas");
    detectionCanvas.id = "detectionOverlay";
    Object.assign(detectionCanvas.style, {
      position: "absolute",
      inset: "0",
      width: "100%",
      height: "100%",
      pointerEvents: "none",
      zIndex: "4"
    });
    preview.appendChild(detectionCanvas);
    detectionContext = detectionCanvas.getContext("2d");
  }
  return detectionCanvas;
}

function connectedComponents(mask, width, height, minPixels, maxPixels) {
  const seen = new Uint8Array(mask.length);
  const components = [];
  const neighbors = [-1, 1, -width, width, -width-1, -width+1, width-1, width+1];

  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    const stack = [start];
    seen[start] = 1;
    let minX = width, minY = height, maxX = 0, maxY = 0, count = 0;

    while (stack.length) {
      const index = stack.pop();
      const x = index % width;
      const y = Math.floor(index / width);
      count++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      for (const delta of neighbors) {
        const next = index + delta;
        if (next < 0 || next >= mask.length || seen[next] || !mask[next]) continue;
        const nx = next % width;
        const ny = Math.floor(next / width);
        if (Math.abs(nx - x) > 1 || Math.abs(ny - y) > 1) continue;
        seen[next] = 1;
        stack.push(next);
      }
    }

    const boxWidth = maxX - minX + 1;
    const boxHeight = maxY - minY + 1;
    if (count >= minPixels && count <= maxPixels && boxWidth >= 14 && boxHeight >= 14) {
      components.push({ x:minX, y:minY, width:boxWidth, height:boxHeight, pixels:count });
    }
  }
  return components;
}

function analyzeCaptureImage(image, preview) {
  if (!detectionEnabled || !image.naturalWidth || !image.naturalHeight) return;
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  const work = document.createElement("canvas");
  work.width = width;
  work.height = height;
  const ctx = work.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(image, 0, 0, width, height);

  let pixels;
  try {
    pixels = ctx.getImageData(0, 0, width, height).data;
  } catch (error) {
    addLog("Detection unavailable: browser blocked image pixel access.");
    return;
  }

  // Ignore the Windows title bar and the black strip at the bottom.
  // The calibrated playfield begins around y=30 in the current Agent capture.
  const playTop = Math.round(height * 0.05);
  const groundY = Math.round(height * 0.51);
  const rockMask = new Uint8Array(width * height);
  const caveMask = new Uint8Array(width * height);
  let dirtSamples = 0;
  let totalSoilSamples = 0;

  for (let y = groundY; y < Math.min(height - 65, Math.round(height * 0.82)); y++) {
    for (let x = 8; x < width - 8; x++) {
      const i = (y * width + x) * 4;
      const r = pixels[i], g = pixels[i+1], b = pixels[i+2];
      const max = Math.max(r,g,b), min = Math.min(r,g,b);
      const saturation = max - min;
      const idx = y * width + x;

      // Neutral light-gray pixels are candidate Rock material.
      if (r > 125 && g > 125 && b > 115 && saturation < 48) rockMask[idx] = 1;

      // Very dark warm pixels near the ground opening are candidate cave pixels.
      if (y < groundY + 105 && r < 75 && g < 66 && b < 48 && r >= g) caveMask[idx] = 1;

      // Brown pixels are counted as a rough Dirt-terrain signal.
      if ((x & 1) === 0 && (y & 1) === 0) {
        if (r > 45 && r < 145 && g > 18 && g < 95 && b < 65 && r > g * 1.35) dirtSamples++;
        totalSoilSamples++;
      }
    }
  }

  const rocks = connectedComponents(rockMask, width, height, 35, 9000)
    .filter(box => box.width >= 22 && box.width <= 115 && box.height >= 22 && box.height <= 115)
    .filter(box => box.y < height * 0.82);

  // Restrict cave candidates to the surface-opening band to avoid diagonal Dirt texture.
  const caveCandidates = connectedComponents(caveMask, width, height, 100, 14000)
    .filter(box => box.y >= groundY - 8 && box.y < groundY + 115)
    .filter(box => box.width >= 30 && box.width <= 180 && box.height >= 25 && box.height <= 140);

  const overlay = ensureDetectionOverlay(preview);
  const viewW = preview.clientWidth;
  const viewH = preview.clientHeight;
  overlay.width = Math.max(1, viewW * (window.devicePixelRatio || 1));
  overlay.height = Math.max(1, viewH * (window.devicePixelRatio || 1));
  const out = detectionContext;
  out.setTransform(window.devicePixelRatio || 1, 0, 0, window.devicePixelRatio || 1, 0, 0);
  out.clearRect(0, 0, viewW, viewH);

  const scale = Math.min(viewW / width, viewH / height);
  const drawW = width * scale;
  const drawH = height * scale;
  const offsetX = (viewW - drawW) / 2;
  const offsetY = (viewH - drawH) / 2;
  const mapBox = box => ({
    x: offsetX + box.x * scale,
    y: offsetY + box.y * scale,
    width: box.width * scale,
    height: box.height * scale
  });

  // Mark the broad soil zone as a terrain estimate, not individual Dirt tiles.
  if (dirtSamples > 100) {
    out.save();
    out.strokeStyle = "#d97706";
    out.lineWidth = 2;
    out.setLineDash([6, 4]);
    const soil = mapBox({ x: 8, y: groundY + 8, width: width - 16, height: Math.max(20, height * 0.30) });
    out.strokeRect(soil.x, soil.y, soil.width, soil.height);
    out.fillStyle = "#d97706";
    out.font = "bold 12px Arial";
    out.fillText("DIRT TERRAIN (estimate)", soil.x + 8, soil.y + 17);
    out.restore();
  }

  for (const rock of rocks) {
    const b = mapBox(rock);
    out.strokeStyle = "#38bdf8";
    out.lineWidth = 2;
    out.setLineDash([]);
    out.strokeRect(b.x, b.y, b.width, b.height);
    out.fillStyle = "#38bdf8";
    out.font = "bold 12px Arial";
    out.fillText("ROCK?", b.x + 2, Math.max(12, b.y - 4));
  }

  for (const cave of caveCandidates) {
    const b = mapBox(cave);
    out.strokeStyle = "#a78bfa";
    out.lineWidth = 2;
    out.setLineDash([4, 3]);
    out.strokeRect(b.x, b.y, b.width, b.height);
    out.fillStyle = "#a78bfa";
    out.font = "bold 12px Arial";
    out.fillText("CAVE?", b.x + 2, Math.max(12, b.y - 4));
  }

  const summary = `Visual scan: ${rocks.length} possible Rock, ${caveCandidates.length} possible Cave opening, Dirt terrain ${dirtSamples > 100 ? "visible" : "uncertain"}.`;
  if (summary !== lastDetectionSummary) {
    addLog(summary);
    lastDetectionSummary = summary;
  }
}

/* 5. LIVE SCREEN CAPTURE */

async function updateGameCapture() {
  if (captureRunning || !agentOnline || !gameFound) return;

  const elements = ensureCaptureElements();
  if (!elements) return;

  captureRunning = true;
  const thisGeneration = captureGeneration;

  try {
    const response = await fetchWithTimeout(
      CONFIG.captureURL + "?t=" + Date.now(),
      {
        method: "GET",
        cache: "no-store",
        mode: "cors"
      }
    );

    if (!response.ok) {
      throw new Error("Capture endpoint returned HTTP " + response.status);
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.toLowerCase().startsWith("image/")) {
      throw new Error("Agent response was not an image (" + contentType + ").");
    }

    const blob = await response.blob();
    if (!blob.size) {
      throw new Error("Agent returned an empty image.");
    }

    if (thisGeneration !== captureGeneration) return;

    const newURL = URL.createObjectURL(blob);
    const oldURL = currentCaptureURL;

    elements.image.onload = () => {
      if (oldURL && oldURL !== newURL) {
        URL.revokeObjectURL(oldURL);
      }
      analyzeCaptureImage(elements.image, elements.preview);
    };

    elements.image.onerror = () => {
      URL.revokeObjectURL(newURL);
      if (currentCaptureURL === newURL) {
        currentCaptureURL = null;
      }
      showCaptureMessage("The captured image could not be displayed.");
    };

    currentCaptureURL = newURL;
    elements.image.src = newURL;
    elements.image.style.display = "block";
    elements.message.style.display = "none";
    elements.indicator.style.display = "block";

    if (lastCaptureError !== null) {
      addLog("Live capture restored.");
      lastCaptureError = null;
    }
  } catch (error) {
    if (thisGeneration !== captureGeneration) return;

    const message = error.name === "AbortError"
      ? "Capture request timed out."
      : error.message;

    showCaptureMessage("Capture unavailable: " + message);

    if (lastCaptureError !== message) {
      addLog("Screen capture error: " + message);
      lastCaptureError = message;
    }
  } finally {
    captureRunning = false;
  }
}

function startCapture() {
  if (captureTimer !== null) return;

  addLog("Live capture started.");
  updateGameCapture();

  captureTimer = setInterval(
    updateGameCapture,
    CONFIG.captureInterval
  );
}

/* 6. AGENT STATUS AND GAME DETECTION */

function updateStatusCards(data) {
  const games = Array.isArray(data.games) ? data.games : [];
  const firstGame = games[0];

  setFirstExistingText(
    ["monitorStatus", "agentStatus"],
    agentOnline ? "Online" : "Offline"
  );

  setFirstExistingText(
    ["agentDescription", "monitorDescription"],
    agentOnline ? "Local Agent connected" : "Cannot connect to local Agent"
  );

  setFirstExistingText(
    ["selectedItem", "gameStatus"],
    gameFound ? "Detected" : "Not Found"
  );

  setFirstExistingText(
    ["gameDescription", "gameStatusDescription"],
    gameFound
      ? (firstGame?.title || firstGame?.process || "Growtopia")
      : "Waiting for Growtopia"
  );

  setFirstExistingText(
    ["detectedCount", "processCount"],
    games.length
  );

  setFirstExistingText(
    ["systemStatus"],
    agentOnline ? "Ready" : "Disconnected"
  );

  setFirstExistingText(
    ["agentConnection"],
    agentOnline ? "Connected" : "Disconnected"
  );
}

async function updateAgentStatus() {
  try {
    const response = await fetchWithTimeout(
      CONFIG.agentURL + "?t=" + Date.now(),
      {
        method: "GET",
        cache: "no-store",
        mode: "cors"
      }
    );

    if (!response.ok) {
      throw new Error("Status endpoint returned HTTP " + response.status);
    }

    const data = await response.json();

    agentOnline = data.status === "online";
    gameFound = data.gameFound === true;

    const games = Array.isArray(data.games) ? data.games : [];

    updateStatusCards(data);

    if (agentOnline && lastAgentError !== "connected") {
      addLog("GrowAssist Agent connected.");
    }

    if (gameFound !== lastGameState) {
      if (gameFound) {
        addLog(
          "Growtopia detected." +
          (games[0]?.pid ? " PID: " + games[0].pid : "")
        );
      } else {
        addLog("Growtopia not detected.");
      }
      lastGameState = gameFound;
    }

    lastAgentError = null;

    if (agentOnline && gameFound) {
      startCapture();
    } else {
      stopCapture(
        !agentOnline
          ? "Waiting for Local Agent..."
          : "Waiting for Growtopia..."
      );
    }
  } catch (error) {
    agentOnline = false;
    gameFound = false;

    setFirstExistingText(["monitorStatus", "agentStatus"], "Offline");
    setFirstExistingText(
      ["agentDescription", "monitorDescription"],
      "Cannot connect to local Agent"
    );
    setFirstExistingText(["selectedItem", "gameStatus"], "Unknown");
    setFirstExistingText(
      ["gameDescription", "gameStatusDescription"],
      "Agent connection unavailable"
    );
    setFirstExistingText(["detectedCount", "processCount"], "0");
    setFirstExistingText(["systemStatus"], "Disconnected");
    setFirstExistingText(["agentConnection"], "Offline");

    stopCapture("Agent connection unavailable.");

    const message = error.name === "AbortError"
      ? "Agent status request timed out."
      : error.message;

    if (lastAgentError !== message) {
      addLog("Agent connection failed: " + message);
      lastAgentError = message;
    }

    lastGameState = null;
  }
}

function startStatusPolling() {
  if (statusTimer !== null) return;

  updateAgentStatus();
  statusTimer = setInterval(
    updateAgentStatus,
    CONFIG.refreshInterval
  );
}

/* 7. ITEM MONITOR CONFIGURATION
   This section only stores the dashboard configuration.
   It does not send gameplay input to Growtopia.
*/

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

  const targetInput = $("targetCount");
  const targetValue = Number(targetInput?.value);

  if (!Number.isInteger(targetValue) || targetValue < 1) {
    addLog("Invalid monitoring target.");
    return;
  }

  monitoring = true;

  const selected = $("itemSelect")?.value || "Dirt";
  const startButton = $("startBtn");

  if (startButton) {
    startButton.textContent = "MONITORING";
    startButton.disabled = true;
  }

  addLog(
    "Monitoring configuration started: " +
    selected + " | Target: " + targetValue
  );
});

$("stopBtn")?.addEventListener("click", () => {
  if (!monitoring) return;

  monitoring = false;

  const startButton = $("startBtn");
  if (startButton) {
    startButton.textContent = "START MONITOR";
    startButton.disabled = false;
  }

  addLog("Monitoring configuration stopped.");
});

/* 8. WORLD MAPPING SIMULATOR */

const MAP_WIDTH = 12;
const MAP_HEIGHT = 8;

const world = Array(MAP_WIDTH * MAP_HEIGHT).fill("empty");

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

      const isPlayer = player.x === x && player.y === y;
      const isTarget = target.x === x && target.y === y;
      const isPath = simulatedPath.some(
        point => point.x === x && point.y === y
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

/* 9. PATH ANALYSIS
   Abstract grid simulation only.
   Does not model verified Growtopia physics.
*/

function findPath(start, end) {
  if (start.x === end.x && start.y === end.y) {
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
    const position = current.pos;

    if (position.x === end.x && position.y === end.y) {
      return current.path;
    }

    for (const move of moves) {
      const nx = position.x + move.x;
      const ny = position.y + move.y;

      if (
        nx < 0 || nx >= MAP_WIDTH ||
        ny < 0 || ny >= MAP_HEIGHT
      ) continue;

      const index = cellIndex(nx, ny);
      if (visited.has(index)) continue;

      if (
        ["dirt", "rock"].includes(world[index]) &&
        !(nx === end.x && ny === end.y)
      ) continue;

      visited.add(index);

      queue.push({
        pos: { x: nx, y: ny },
        path: [
          ...current.path,
          { x: nx, y: ny, move: move.type }
        ]
      });
    }
  }

  return null;
}

/* 10. ANALYZE PATH BUTTON */

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
      .map(point => point.move)
      .join(" → ");

    if (pathResult) {
      pathResult.textContent =
        `Path found! ${distance} simulated steps. ` +
        `Start: (${player.x}, ${player.y}). ` +
        `Target: (${target.x}, ${target.y}). ` +
        `Route: ${moves || "Same position"}. ` +
        "Abstract simulation only.";
    }

    addLog("Path analysis completed. Steps: " + distance);
  }

  renderWorld();
});

/* 11. RESET MAP */

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

/* 12. INITIALIZE */

ensureCaptureElements();
renderWorld();
addLog("GROW ASSIST dashboard initialized.");
startStatusPolling();

/* Clean up timers and temporary image URL when leaving page. */
window.addEventListener("beforeunload", () => {
  if (statusTimer !== null) clearInterval(statusTimer);
  if (captureTimer !== null) clearInterval(captureTimer);
  if (currentCaptureURL) URL.revokeObjectURL(currentCaptureURL);
});
