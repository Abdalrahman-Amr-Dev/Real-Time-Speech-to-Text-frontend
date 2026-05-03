/* ============================================
   VoiceFlow - Particle Animation & Recording System
   ============================================ */

// ========== Configuration ==========
const WS_URL = "https://f63qpccl-5000.uks1.devtunnels.ms";
const SAMPLE_RATE = 16000;
const CHUNK_DURATION = 0.5;

// ========== Global Variables ==========
let socket = null;
let audioContext = null;
let mediaStream = null;
let processor = null;
let isRecording = false;
let recordingStartTime = null;
let recordingTimer = null;
let audioBuffer = [];
let transcript = "";
let buffer = "";
const maxBufferSize = SAMPLE_RATE * 50;

// Particle Animation
let canvas = null;
let ctx = null;
let particles = [];
let animationFrameId = null;

// ========== Initialization ==========
document.addEventListener("DOMContentLoaded", () => {
  initializeParticles();
  initializeWebSocket();
  setupAudioContext();
  setupEventListeners();
  updateStats();
});

// ========== Particle Animation System ==========
function initializeParticles() {
  canvas = document.getElementById("particleCanvas");
  if (!canvas) return;

  ctx = canvas.getContext("2d");
  if (!ctx) return;

  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  // Create particles
  for (let i = 0; i < 100; i++) {
    particles.push({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      vx: (Math.random() - 0.5) * 0.3,
      vy: (Math.random() - 0.5) * 0.3,
      size: Math.random() * 1.5 + 0.5,
    });
  }

  animateParticles();

  // Handle window resize
  window.addEventListener("resize", () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  });
}

function animateParticles() {
  if (!ctx || !canvas) return;

  // Clear with fade effect
  ctx.fillStyle = "rgba(10, 10, 15, 0.08)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  particles.forEach((particle, i) => {
    particle.x += particle.vx;
    particle.y += particle.vy;

    // Bounce off edges
    if (particle.x < 0 || particle.x > canvas.width) particle.vx *= -1;
    if (particle.y < 0 || particle.y > canvas.height) particle.vy *= -1;

    // Draw particle
    ctx.beginPath();
    ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
    const gradient = ctx.createRadialGradient(
      particle.x,
      particle.y,
      0,
      particle.x,
      particle.y,
      particle.size * 2,
    );
    gradient.addColorStop(0, "rgba(99, 102, 241, 0.6)");
    gradient.addColorStop(1, "rgba(99, 102, 241, 0)");
    ctx.fillStyle = gradient;
    ctx.fill();

    // Draw connections between nearby particles
    particles.forEach((otherParticle, j) => {
      if (i === j) return;
      const dx = particle.x - otherParticle.x;
      const dy = particle.y - otherParticle.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance < 120) {
        ctx.beginPath();
        ctx.moveTo(particle.x, particle.y);
        ctx.lineTo(otherParticle.x, otherParticle.y);
        const opacity = 0.15 * (1 - distance / 120);
        ctx.strokeStyle = `rgba(139, 92, 246, ${opacity})`;
        ctx.lineWidth = 0.5;
        ctx.stroke();
      }
    });
  });

  animationFrameId = requestAnimationFrame(animateParticles);
}

// ========== Event Listeners ==========
function setupEventListeners() {
  // No additional listeners needed - onclick handlers are in HTML
}

// ========== WebSocket Functions ==========
function initializeWebSocket() {
  try {
    if (typeof io === "undefined") {
      console.log("Socket.IO library not loaded. Check CDN connection.");
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
    });

    socket.on("disconnect", () => {
      updateConnectionStatus(false);
    });

    socket.on("connect_error", (error) => {
      console.error(`Connection error: ${error.message}`);
    });

    socket.on("connection_response", (data) => {
      console.log(`Server: ${data.data}`);
    });

    socket.on("buffer_update", (data) => {
      // Buffer update - could be used for future features
    });

    socket.on("transcription_result", (data) => {
      displayTranscriptionResult(data.text, data.success);
    });

    socket.on("error", (error) => {
      console.error(`Socket error: ${error}`);
    });
  } catch (error) {
    console.error(`Failed to initialize WebSocket: ${error.message}`);
  }
}

function updateConnectionStatus(isConnected) {
  // Connection status is now managed by the particle animation background
  // UI feedback can be added here if needed
  if (isConnected) {
    console.log("Connected to server");
  } else {
    console.log("Disconnected from server");
  }
}

// ========== Audio Functions ==========
function setupAudioContext() {
  try {
    window.AudioContext = window.AudioContext || window.webkitAudioContext;
    audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
    console.log("Audio context initialized");
  } catch (error) {
    console.error(`Audio context error: ${error.message}`);
  }
}

async function startRecording() {
  try {
    clearBuffer();
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
    updateRecordingUI();
    updateRecordingTime();
    recordingTimer = setInterval(updateRecordingTime, 100);

    // Update UI
    document.getElementById("startBtn").disabled = true;
    document.getElementById("stopBtn").disabled = false;
    // document.getElementById("clearBtn").disabled = false;

    // Add recording animation
    const recordingCircle = document.getElementById("recordingCircle");
    if (recordingCircle) recordingCircle.classList.add("recording");

    console.log("Recording started");
  } catch (error) {
    console.error(`Recording error: ${error.message}`);
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

    // Remove recording animation
    const recordingCircle = document.getElementById("recordingCircle");
    if (recordingCircle) recordingCircle.classList.remove("recording");

    updateRecordingUI();

    // Automatically trigger transcription after stopping
    requestTranscription();

    console.log("Recording stopped");
  } catch (error) {
    console.error(`Stop recording error: ${error.message}`);
  }
}

function updateRecordingUI() {
  const statusDot = document.getElementById("statusDot");
  const statusText = document.getElementById("statusText");

  if (isRecording) {
    if (statusDot) statusDot.classList.add("recording");
    if (statusText) statusText.textContent = "Recording Live";
  } else {
    if (statusDot) statusDot.classList.remove("recording");
    if (statusText) statusText.textContent = "Ready to Record";
  }
}

function updateRecordingTime() {
  if (recordingStartTime) {
    const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
    const minutes = Math.floor(elapsed / 60);
    const seconds = elapsed % 60;
    const formatted = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    const timeDisplay = document.getElementById("recordingTime");
    if (timeDisplay) timeDisplay.textContent = formatted;
  }
}

function sendAudioToServer(audioData) {
  if (!socket || !socket.connected) return;

  try {
    // Accumulate audio in buffer
    audioBuffer.push(...audioData);

    // Send when buffer reaches about 0.5 seconds
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
    console.error("Not connected to server");
    return;
  }

  socket.emit("transcribe_request");
}

function displayTranscriptionResult(text, success) {
  const transcriptContent = document.getElementById("transcriptContent");

  if (success && text && text !== "No audio to transcribe") {
    buffer = text;
    transcript += text;
    updateTranscriptDisplay();
    console.log(`Transcribed: "${text}"`);
  } else if (text === "No audio to transcribe") {
    console.warn("Insufficient audio for transcription");
  } else {
    console.error(`Transcription error: ${text}`);
  }
}

function updateTranscriptDisplay() {
  const transcriptContent = document.getElementById("transcriptContent");
  if (!transcriptContent) return;

  if (!transcript && !buffer) {
    transcriptContent.innerHTML = `
      <div class="empty-state">
        <svg class="empty-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M12 1a3 3 0 0 0-3 3v12a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/></svg>
        <p>Start recording to begin transcription</p>
        <p class="empty-hint">Your words will appear here in real-time</p>
      </div>
    `;
    return;
  }

  let content = "";
  if (transcript) {
    content += `<div class="transcript-text">${escapeHtml(transcript)}</div>`;
  }
  // if (buffer) {
  //   content += `<div class="transcript-text buffer">${escapeHtml(buffer)}<span class="cursor"></span></div>`;
  // }

  transcriptContent.innerHTML = content;
  transcriptContent.scrollTop = transcriptContent.scrollHeight;

  updateStats();
  updateButtonStates();
}

// ========== Buffer Functions ==========
function clearBuffer() {
  if (!socket || !socket.connected) {
    const transcriptContent = document.getElementById("transcriptContent");
    transcriptContent.innerHTML = "";
    console.error("Not connected to server");
    return;
  }

  buffer = "";
  updateTranscriptDisplay();
  socket.emit("clear_buffer");
  console.log("Buffer cleared");
}

// ========== Copy & Download Functions ==========
function copyToClipboard() {
  const fullText = transcript ;
  if (!fullText.trim()) return;

  navigator.clipboard
    .writeText(fullText)
    .then(() => {
      const btn = document.getElementById("copyBtn");
      const originalHTML = btn.innerHTML;
      btn.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>';

      setTimeout(() => {
        btn.innerHTML = originalHTML;
      }, 2000);

      console.log("Copied to clipboard");
    })
    .catch((err) => {
      console.error("Failed to copy:", err);
    });
}

function downloadTranscript() {
  const fullText = transcript ;
  if (!fullText.trim()) return;

  const blob = new Blob([fullText], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `voiceflow-transcript-${new Date().toISOString().split("T")[0]}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  console.log("Transcript downloaded");
}

// ========== Stats Update Function ==========
function updateStats() {
  const fullText = transcript ;
  const words = fullText
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0).length;
  const chars = fullText.trim().replace(/\s+/g, "").length;

  const wordCountEl = document.getElementById("wordCount");
  const charCountEl = document.getElementById("charCount");

  if (wordCountEl) wordCountEl.textContent = words;
  if (charCountEl) charCountEl.textContent = chars;
}

function updateButtonStates() {
  const fullText = transcript + buffer;
  const hasText = fullText.trim().length > 0;

  document.getElementById("copyBtn").disabled = !hasText;
  document.getElementById("downloadBtn").disabled = !hasText;
  // document.getElementById("clearBtn").disabled = !buffer;
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
  console.error(`Uncaught error: ${event.message}`);
});

// Cleanup on page unload
window.addEventListener("beforeunload", () => {
  if (isRecording) {
    stopRecording();
  }
  if (socket) {
    socket.disconnect();
  }
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
  }
});
