const pickButton = document.querySelector("#pick-button");
const fileInput = document.querySelector("#file-input");
const trackName = document.querySelector("#track-name");
const trackPathView = document.querySelector("#track-path-view");
const listenCount = document.querySelector("#listen-count");
const statusView = document.querySelector("#status");
const playButton = document.querySelector("#play-button");
const stopButton = document.querySelector("#stop-button");
const clearButton = document.querySelector("#clear-button");
const repeatToggle = document.querySelector("#repeat-toggle");
const audioPlayer = document.querySelector("#audio-player");
const progressCurrent = document.querySelector("#progress-current");
const progressTotal = document.querySelector("#progress-total");
const progressFill = document.querySelector("#progress-fill");
const progressSlider = document.querySelector("#progress-slider");

let currentTrackKey = "";
let currentObjectUrl = "";
let listenSession = createListenSession();
let isScrubbing = false;

function createListenSession() {
  return {
    furthestPoint: 0,
    previousTime: 0,
    startedNearBeginning: true,
    shouldCountOnEnd: false
  };
}

function setStatus(message, isError = false) {
  statusView.textContent = message;
  statusView.style.color = isError ? "#8a1f11" : "";
}

function updateControls(enabled) {
  playButton.disabled = !enabled;
  stopButton.disabled = !enabled;
  clearButton.disabled = !enabled;
  progressSlider.disabled = !enabled;
}

function clearObjectUrl() {
  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = "";
  }
}

function resetListenSession() {
  listenSession = createListenSession();
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "0:00";
  }

  const totalSeconds = Math.floor(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;
  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

function updateProgress() {
  const current = Number.isFinite(audioPlayer.currentTime) ? audioPlayer.currentTime : 0;
  const total = Number.isFinite(audioPlayer.duration) ? audioPlayer.duration : 0;
  const ratio = total > 0 ? Math.min(current / total, 1) : 0;

  progressCurrent.textContent = formatTime(current);
  progressTotal.textContent = formatTime(total);
  progressFill.style.width = `${ratio * 100}%`;
  if (!isScrubbing) {
    progressSlider.value = String(Math.round(ratio * 1000));
  }
}

async function requestJson(url, options) {
  const response = await fetch(url, options);
  const contentType = response.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");
  const rawText = await response.text();
  const data = isJson && rawText ? JSON.parse(rawText) : null;

  if (!response.ok) {
    const message =
      data?.error ||
      (rawText.trim() === "Not found"
        ? "The server is outdated and does not provide the Finder picker API. Restart it with `npm start`."
        : rawText.trim() || "Request failed");
    throw new Error(message);
  }

  return data;
}

function applyTrackInfo(info) {
  currentTrackKey = info.countKey;
  clearObjectUrl();
  trackName.textContent = info.name;
  trackPathView.textContent = "Local file on this device";
  listenCount.textContent = String(info.count);
  resetListenSession();
  updateProgress();
  setStatus("Track metadata loaded.");
}

async function recordListen() {
  const result = await requestJson("/api/listens", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ countKey: currentTrackKey })
  });
  listenCount.textContent = String(result.count);
}

function startNewCycle() {
  listenSession = {
    furthestPoint: 0,
    previousTime: 0,
    startedNearBeginning: audioPlayer.currentTime <= 1,
    shouldCountOnEnd: true
  };
}

async function resetTrackState(errorMessage) {
  currentTrackKey = "";
  clearObjectUrl();
  audioPlayer.removeAttribute("src");
  audioPlayer.load();
  trackName.textContent = "No track selected";
  trackPathView.textContent = "-";
  listenCount.textContent = "0";
  resetListenSession();
  updateProgress();
  updateControls(false);
  setStatus(errorMessage, true);
}

pickButton.addEventListener("click", () => {
  fileInput?.click();
});

fileInput?.addEventListener("change", async () => {
  const [file] = fileInput.files || [];
  if (!file) {
    setStatus("File selection was cancelled.");
    return;
  }

  setStatus("Loading local file...");
  try {
    const info = await requestJson(`/api/track-info?name=${encodeURIComponent(file.name)}`);
    clearObjectUrl();
    currentObjectUrl = URL.createObjectURL(file);
    currentTrackKey = info.countKey || file.name;
    trackName.textContent = file.name;
    trackPathView.textContent = `Local file on this device (${file.type || "audio"})`;
    listenCount.textContent = String(info.count);
    audioPlayer.src = currentObjectUrl;
    audioPlayer.load();
    audioPlayer.pause();
    audioPlayer.currentTime = 0;
    resetListenSession();
    updateProgress();
    updateControls(true);
    setStatus("Local file loaded. Press play.");
  } catch (error) {
    await resetTrackState(error.message);
  } finally {
    fileInput.value = "";
  }
});

playButton.addEventListener("click", async () => {
  if (!audioPlayer.src || !currentTrackKey) {
    return;
  }

  if (audioPlayer.paused) {
    if (audioPlayer.currentTime <= 0.05 || audioPlayer.ended) {
      audioPlayer.currentTime = 0;
      startNewCycle();
    } else if (!listenSession.shouldCountOnEnd) {
      startNewCycle();
      listenSession.startedNearBeginning = false;
    }
  }

  try {
    await audioPlayer.play();
    setStatus(repeatToggle.checked ? "Playing. The track will repeat automatically." : "Playing.");
  } catch (error) {
    setStatus(`Playback failed: ${error.message}`, true);
  }
});

stopButton.addEventListener("click", () => {
  audioPlayer.pause();
  updateProgress();
  setStatus("Paused.");
});

clearButton.addEventListener("click", async () => {
  if (!currentTrackKey) {
    return;
  }

  const shouldClear = window.confirm("Clear the play count for this track?");
  if (!shouldClear) {
    setStatus("Clear count cancelled.");
    return;
  }

  try {
    const result = await requestJson("/api/clear-count", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ countKey: currentTrackKey })
    });
    listenCount.textContent = String(result.count);
    setStatus("Play count cleared for this track.");
  } catch (error) {
    setStatus(error.message, true);
  }
});

audioPlayer.addEventListener("timeupdate", () => {
  updateProgress();

  if (!listenSession.shouldCountOnEnd) {
    return;
  }

  const currentTime = audioPlayer.currentTime;
  listenSession.furthestPoint = Math.max(listenSession.furthestPoint, currentTime);
  listenSession.previousTime = currentTime;
});

audioPlayer.addEventListener("ended", async () => {
  updateProgress();
  const duration = Number.isFinite(audioPlayer.duration) ? audioPlayer.duration : 0;
  listenSession.furthestPoint = Math.max(listenSession.furthestPoint, duration);
  const shouldCount =
    listenSession.shouldCountOnEnd &&
    listenSession.startedNearBeginning &&
    duration > 0;

  if (shouldCount) {
    try {
      await recordListen();
      setStatus("Playback finished. Count saved.");
    } catch (error) {
      setStatus(`Failed to save count: ${error.message}`, true);
    }
  } else {
    setStatus("Playback finished, but it was treated as skipped and was not counted.");
  }

  if (repeatToggle.checked) {
    audioPlayer.currentTime = 0;
    startNewCycle();
    try {
      await audioPlayer.play();
      setStatus("Count saved. Repeating playback.");
    } catch (error) {
      setStatus(`Repeat playback failed: ${error.message}`, true);
    }
    return;
  }

  resetListenSession();
});

audioPlayer.addEventListener("loadedmetadata", updateProgress);
audioPlayer.addEventListener("emptied", updateProgress);
audioPlayer.addEventListener("durationchange", updateProgress);

progressSlider.addEventListener("input", () => {
  if (!Number.isFinite(audioPlayer.duration) || audioPlayer.duration <= 0) {
    return;
  }

  isScrubbing = true;
  const ratio = Number(progressSlider.value) / 1000;
  const nextTime = audioPlayer.duration * ratio;
  progressFill.style.width = `${ratio * 100}%`;
  progressCurrent.textContent = formatTime(nextTime);
});

progressSlider.addEventListener("change", () => {
  if (!Number.isFinite(audioPlayer.duration) || audioPlayer.duration <= 0) {
    isScrubbing = false;
    return;
  }

  const ratio = Number(progressSlider.value) / 1000;
  audioPlayer.currentTime = audioPlayer.duration * ratio;
  isScrubbing = false;
  updateProgress();
});
