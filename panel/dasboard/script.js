
const itemSelect = document.getElementById("itemSelect");
const targetCount = document.getElementById("targetCount");
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const activityList = document.getElementById("activityList");

let monitoring = false;

function addLog(message) {
  const empty = activityList.querySelector(".empty");
  if (empty) empty.remove();

  const entry = document.createElement("div");
  entry.className = "activity-entry";

  const messageElement = document.createElement("span");
  messageElement.textContent = message;

  const timeElement = document.createElement("small");
  timeElement.textContent = new Date().toLocaleTimeString();

  entry.append(messageElement, timeElement);
  activityList.prepend(entry);
}

itemSelect.addEventListener("change", () => {
  document.getElementById("selectedItem").textContent =
    itemSelect.value;

  addLog("Selected item: " + itemSelect.value);
});

startBtn.addEventListener("click", () => {
  if (monitoring) return;

  const target = Number(targetCount.value);

  if (!Number.isInteger(target) || target < 1) {
    alert("Enter a valid target.");
    return;
  }

  monitoring = true;

  document.getElementById("monitorStatus").textContent =
    "Preview";

  addLog("Monitoring preview started.");
});

stopBtn.addEventListener("click", () => {
  if (!monitoring) return;

  monitoring = false;

  document.getElementById("monitorStatus").textContent =
    "Idle";

  addLog("Monitoring preview stopped.");
});

document.getElementById("clearLog").addEventListener("click", () => {
  activityList.innerHTML =
    '<div class="empty">No activity recorded yet.</div>';
});
