
/* GROW ASSIST - WORLD MAPPING SIMULATOR */

const MAP_WIDTH = 12;
const MAP_HEIGHT = 8;

const world = Array(MAP_WIDTH * MAP_HEIGHT).fill("empty");

let player = { x: 2, y: 5 };
let target = { x: 8, y: 3 };
let simulatedPath = [];

const grid = document.getElementById("worldGrid");
const mapMode = document.getElementById("mapMode");
const pathResult = document.getElementById("pathResult");

function cellIndex(x, y) {
  return y * MAP_WIDTH + x;
}

function renderWorld() {
  grid.innerHTML = "";

  for (let y = 0; y < MAP_HEIGHT; y++) {
    for (let x = 0; x < MAP_WIDTH; x++) {
      const cell = document.createElement("button");
      const type = world[cellIndex(x, y)];

      cell.className = "world-cell " + type;

      if (player.x === x && player.y === y) {
        cell.classList.add("player");
        cell.textContent = "P";
      } else if (target.x === x && target.y === y) {
        cell.classList.add("target");
        cell.textContent = "T";
      } else if (simulatedPath.some(
        p => p.x === x && p.y === y
      )) {
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
        const mode = mapMode.value;

        if (mode === "player") {
          player = { x, y };
        } else if (mode === "target") {
          target = { x, y };
        } else {
          world[cellIndex(x, y)] = mode;
        }

        simulatedPath = [];
        pathResult.textContent =
          "Map updated. Analyze the path again.";

        renderWorld();
      });

      grid.appendChild(cell);
    }
  }
}

function findPath(start, end) {
  const queue = [{
    pos: start,
    path: [start]
  }];

  const visited = new Set([
    cellIndex(start.x, start.y)
  ]);

  // Abstract movement model for simulation only.
  const moves = [
    { x: 1, y: 0, type: "walk" },
    { x: -1, y: 0, type: "walk" },
    { x: 0, y: -1, type: "jump-up" },
    { x: 0, y: 1, type: "drop" },
    { x: 1, y: -1, type: "jump-forward" },
    { x: -1, y: -1, type: "jump-forward" }
  ];

  while (queue.length) {
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
      ) continue;

      const index = cellIndex(nx, ny);

      if (visited.has(index)) continue;

      // Rock and Dirt are treated as obstacles
      // in this abstract navigation model.
      if (["dirt", "rock"].includes(world[index])) {
        continue;
      }

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

document.getElementById("analyzePath")
  .addEventListener("click", () => {

    const result = findPath(player, target);

    if (!result) {
      simulatedPath = [];
      pathResult.textContent =
        "No available path in the current simulation.";
    } else {
      simulatedPath = result;

      const distance = result.length - 1;

      pathResult.textContent =
        `Path found! ${distance} simulated steps. ` +
        `Start: (${player.x}, ${player.y}). ` +
        `Target: (${target.x}, ${target.y}). ` +
        `This is an abstract route, not verified game physics.`;
    }

    renderWorld();
  });

document.getElementById("resetMap")
  .addEventListener("click", () => {

    world.fill("empty");
    player = { x: 2, y: 5 };
    target = { x: 8, y: 3 };
    simulatedPath = [];

    pathResult.textContent =
      "Map reset. Place your blocks and analyze again.";

    renderWorld();
  });

renderWorld();
