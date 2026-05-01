// WebSocket and Audio Configuration
const WS_URL = "http://localhost:5000";
const SAMPLE_RATE = 16000;
const CHUNK_DURATION = 0.5;

// Global Variables
let socket = null;
let audioContext = null;
let mediaStream = null;
let processor = null;
let isRecording = false;
let recordingStartTime = null;
let recordingTimer = null;
let audioBuffer = []; // Buffer to accumulate audio chunks
let continuousMode = false; // Toggle continuous transcription
let fullTranscription = ""; // Store full transcription
const maxBufferSize = SAMPLE_RATE * 5;

// Initialize on page load
document.addEventListener("DOMContentLoaded", () => {
  initializeWebSocket();
  setupAudioContext();
  updateLog("Application loaded", "info");
});

// ========== WebSocket Functions ==========
function initializeWebSocket() {
  try {
    // Check if Socket.IO is loaded
    if (typeof io === "undefined") {
      updateLog("Socket.IO library not loaded. Check CDN connection.", "error");
      return;
    }

    socket = io(WS_URL, {
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: 5,
      transports: ["websocket", "polling"],
    });

    socket.on("connect", () => {
      updateConnectionStatus(true);
      updateLog("Connected to server", "success");
    });

    socket.on("disconnect", () => {
      updateConnectionStatus(false);
      updateLog("Disconnected from server", "warning");
    });

    socket.on("connect_error", (error) => {
      updateLog(`Connection error: ${error.message}`, "error");
    });

    socket.on("connection_response", (data) => {
      updateLog(`Server: ${data.data}`, "info");
    });

    socket.on("buffer_update", (data) => {
      updateBufferDisplay(data.buffer_size);
    });

    socket.on("transcription_result", (data) => {
      // Handle both continuous and manual transcription
      if (data.continuous) {
        // Continuous transcription - append results
        displayContinuousTranscription(data.text);
      } else {
        // Manual transcription - replace and show success
        displayTranscriptionResult(data.text, data.success);
      }
      if (document.getElementById("transcribeBtn")) {
        document.getElementById("transcribeBtn").disabled = false;
      }
    });

    socket.on("error", (error) => {
      updateLog(`Socket error: ${error}`, "error");
    });
  } catch (error) {
    updateLog(`Failed to initialize WebSocket: ${error.message}`, "error");
  }
}

function updateConnectionStatus(isConnected) {
  const statusDot = document.getElementById("connectionStatus");
  const statusText = document.getElementById("statusText");

  if (isConnected) {
    statusDot.classList.remove("disconnected");
    statusDot.classList.add("connected");
    statusText.textContent = "Connected";
  } else {
    statusDot.classList.remove("connected");
    statusDot.classList.add("disconnected");
    statusText.textContent = "Disconnected";
  }
}

// ========== Audio Functions ==========
function setupAudioContext() {
  try {
    window.AudioContext = window.AudioContext || window.webkitAudioContext;
    audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
    updateLog("Audio context initialized", "info");
  } catch (error) {
    updateLog(`Audio context error: ${error.message}`, "error");
  }
}

async function startRecording() {
  try {
    if (!navigator.mediaDevices) {
      throw new Error("MediaDevices API not supported");
    }

    // Resume audio context if suspended
    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }

    // Request microphone access
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });

    // Create audio processor with proper configuration
    const source = audioContext.createMediaStreamSource(mediaStream);
    processor = audioContext.createScriptProcessor(4096, 1, 1);

    source.connect(processor);
    processor.connect(audioContext.destination);

    // Set up audio processing callback
    processor.onaudioprocess = (event) => {
      if (isRecording) {
        const audioData = event.inputBuffer.getChannelData(0);
        sendAudioToServer(audioData);
      }
    };

    isRecording = true;
    recordingStartTime = Date.now();
    updateRecordingTime();
    recordingTimer = setInterval(updateRecordingTime, 100);

    // Update UI
    document.getElementById("startBtn").disabled = true;
    document.getElementById("stopBtn").disabled = false;
    document.getElementById("transcribeBtn").disabled = false;
    document.getElementById("clearBtn").disabled = false;

    updateLog("Recording started", "success");
  } catch (error) {
    updateLog(`Recording error: ${error.message}`, "error");
    isRecording = false;
  }
}

function stopRecording() {
  try {
    isRecording = false;

    if (recordingTimer) {
      clearInterval(recordingTimer);
    }

    // Send any remaining buffered audio
    if (audioBuffer.length > 0) {
      const float32Data = new Float32Array(audioBuffer);
      const bytes = new Uint8Array(float32Data.buffer);

      socket.emit("audio_stream", {
        audio: Array.from(bytes),
      });

      audioBuffer = [];
    }

    if (processor) {
      processor.disconnect();
    }

    if (mediaStream) {
      mediaStream.getTracks().forEach((track) => track.stop());
    }

    // Update UI
    document.getElementById("startBtn").disabled = false;
    document.getElementById("stopBtn").disabled = true;

    updateLog("Recording stopped", "warning");
  } catch (error) {
    updateLog(`Stop recording error: ${error.message}`, "error");
  }
}

function updateRecordingTime() {
  if (recordingStartTime) {
    const elapsed = (Date.now() - recordingStartTime) / 1000;
    document.getElementById("recordingTime").textContent =
      elapsed.toFixed(1) + "s";
  }
}

function sendAudioToServer(audioData) {
  if (!socket || !socket.connected) return;

  try {
    // Accumulate audio in buffer
    audioBuffer.push(...audioData);

    // Send when buffer reaches about 0.5 seconds (faster sending)
    if (audioBuffer.length >= SAMPLE_RATE * 0.5) {
      const chunkSize = Math.floor(SAMPLE_RATE * 0.5);
      const float32Data = new Float32Array(audioBuffer.slice(0, chunkSize));
      const bytes = new Uint8Array(float32Data.buffer);

      socket.emit("audio_stream", {
        audio: Array.from(bytes),
      });

      audioBuffer = audioBuffer.slice(chunkSize);
    }
  } catch (error) {
    console.error("Audio send error:", error);
  }
}

function float32ToUint8(float32Array) {
  // Legacy function - kept for compatibility but not used
  let index = 0;
  const view = new Uint8Array(float32Array.length * 2);
  for (let i = 0; i < float32Array.length; i++) {
    view[index++] = float32Array[i];
    view[index++] = float32Array[i] >> 8;
  }
  return view;
}

// ========== Transcription Functions ==========
function requestTranscription() {
  if (!socket || !socket.connected) {
    updateLog("Not connected to server", "error");
    return;
  }

  continuousMode = !continuousMode;
  const btn = document.getElementById("transcribeBtn");

  if (continuousMode) {
    // Entering continuous mode
    fullTranscription = "";
    btn.textContent = "⏸️ Stop Transcription";
    btn.classList.add("recording");
    document.getElementById("transcriptionStatus").textContent =
      "Continuous transcription ON";
    updateLog("Continuous transcription started", "success");
  } else {
    // Exiting continuous mode
    btn.textContent = "▶️ Start Transcription";
    btn.classList.remove("recording");
    document.getElementById("transcriptionStatus").textContent =
      "Transcription paused";
    updateLog("Continuous transcription paused", "warning");
  }
}

function displayContinuousTranscription(text) {
  if (!text || text === "No audio to transcribe") return;

  // Append to full transcription
  if (fullTranscription.length > 0) {
    fullTranscription += " " + text;
  } else {
    fullTranscription = text;
  }

  const output = document.getElementById("transcriptionOutput");
  output.innerHTML = `<p>${escapeHtml(fullTranscription)}</p>`;
  output.classList.remove("error");
  output.classList.add("success");
  output.scrollTop = output.scrollHeight;
}

function displayTranscriptionResult(text, success) {
  const output = document.getElementById("transcriptionOutput");
  const status = document.getElementById("transcriptionStatus");

  if (success && text && text !== "No audio to transcribe") {
    output.innerHTML = `<p>${escapeHtml(text)}</p>`;
    output.classList.remove("error");
    output.classList.add("success");
    status.textContent = "Transcription complete ✓";
    updateLog(`Transcribed: "${text}"`, "success");
  } else if (text === "No audio to transcribe") {
    output.innerHTML =
      '<p class="placeholder">Insufficient audio for transcription. Please record more audio.</p>';
    output.classList.remove("success", "error");
    status.textContent = "No audio to transcribe";
    updateLog("Insufficient audio for transcription", "warning");
  } else {
    output.innerHTML = `<p style="color: #f5576c;">${escapeHtml(text)}</p>`;
    output.classList.remove("success");
    output.classList.add("error");
    status.textContent = "Transcription failed ✗";
    updateLog(`Error: ${text}`, "error");
  }
}

// ========== Buffer Functions ==========
function clearBuffer() {
  if (!socket || !socket.connected) {
    updateLog("Not connected to server", "error");
    return;
  }

  audioBuffer = []; // Clear frontend buffer too
  socket.emit("clear_buffer");
  updateLog("Buffer cleared", "info");
}

function updateBufferDisplay(bufferSize) {
  const bufferElement = document.getElementById("bufferSize");
  const bufferBar = document.getElementById("bufferBar");

  bufferElement.textContent = bufferSize.toLocaleString() + " samples";

  // Calculate percentage (5 second buffer = 80,000 samples at 16kHz)
  const percentage = (bufferSize / maxBufferSize) * 100;
  bufferBar.style.width = Math.min(percentage, 100) + "%";
}

// ========== Logging Functions ==========
function updateLog(message, type = "info") {
  const logElement = document.getElementById("eventLog");
  const entry = document.createElement("div");
  const timestamp = new Date().toLocaleTimeString();

  entry.className = `log-entry ${type}`;
  entry.textContent = `[${timestamp}] ${message}`;

  logElement.appendChild(entry);
  logElement.scrollTop = logElement.scrollHeight;

  // Keep only last 50 entries
  while (logElement.children.length > 50) {
    logElement.removeChild(logElement.firstChild);
  }
}

function clearLog() {
  document.getElementById("eventLog").innerHTML = "";
  updateLog("Log cleared", "info");
}

// ========== Utility Functions ==========
function escapeHtml(text) {
  const map = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  };
  return text.replace(/[&<>"']/g, (m) => map[m]);
}

// ========== Error Handling ==========
window.addEventListener("error", (event) => {
  updateLog(`Uncaught error: ${event.message}`, "error");
});

// Cleanup on page unload
window.addEventListener("beforeunload", () => {
  if (isRecording) {
    stopRecording();
  }
  if (socket) {
    socket.disconnect();
  }
});
