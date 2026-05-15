/**
 * NeonTrace — Hand Gesture Neon Drawing
 * Uses MediaPipe Hands for real-time hand tracking
 * and HTML5 Canvas for neon trail rendering.
 */

// ===== DOM Elements =====
const startOverlay = document.getElementById('startOverlay');
const startBtn = document.getElementById('startBtn');
const video = document.getElementById('cameraFeed');
const drawCanvas = document.getElementById('drawCanvas');
const landmarkCanvas = document.getElementById('landmarkCanvas');
const drawCtx = drawCanvas.getContext('2d');
const landmarkCtx = landmarkCanvas.getContext('2d');
const statusBadge = document.getElementById('statusBadge');
const statusText = document.getElementById('statusText');
const drawModeIndicator = document.getElementById('drawModeIndicator');
const gestureIndicator = document.getElementById('gestureIndicator');
const fingerCursor = document.getElementById('fingerCursor');
const controlsPanel = document.getElementById('controlsPanel');
const colorPicker = document.getElementById('colorPicker');
const brushSlider = document.getElementById('brushSlider');
const toggleDrawBtn = document.getElementById('toggleDrawBtn');
const undoBtn = document.getElementById('undoBtn');
const clearBtn = document.getElementById('clearBtn');
const saveBtn = document.getElementById('saveBtn');
const toggleLandmarks = document.getElementById('toggleLandmarks');
const toggleMirror = document.getElementById('toggleMirror');
const toggleCamera = document.getElementById('toggleCamera');
const toastContainer = document.getElementById('toastContainer');

// ===== State =====
const state = {
  isRunning: false,
  drawingEnabled: true,
  isDrawing: false,
  showLandmarks: true,
  showCamera: true,
  mirrored: true,
  currentColor: '#00f5ff',
  currentColorName: 'cyan',
  brushSize: 4,
  lastPoint: null,
  strokes: [],       // Array of completed stroke ImageData snapshots
  currentStroke: [],  // Current stroke points
  gestureState: 'none', // 'drawing', 'paused', 'erasing'
  smoothPoints: [],   // For smoothing
};

// Color map
const COLORS = {
  cyan:   '#00f5ff',
  pink:   '#ff00e5',
  green:  '#39ff14',
  orange: '#ff6a00',
  purple: '#b000ff',
  yellow: '#f5ff00',
  white:  '#ffffff',
};

// ===== Utility Functions =====
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${type === 'success' ? '✓' : 'ℹ'}</span> ${message}`;
  toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('fade-out');
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}

function resizeCanvases() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  
  // Save current drawing
  const drawData = drawCtx.getImageData(0, 0, drawCanvas.width, drawCanvas.height);
  const oldW = drawCanvas.width;
  const oldH = drawCanvas.height;
  
  drawCanvas.width = w;
  drawCanvas.height = h;
  landmarkCanvas.width = w;
  landmarkCanvas.height = h;
  
  // Restore drawing if dimensions were valid
  if (oldW > 0 && oldH > 0) {
    // Create temp canvas to scale
    const tmp = document.createElement('canvas');
    tmp.width = oldW;
    tmp.height = oldH;
    tmp.getContext('2d').putImageData(drawData, 0, 0);
    drawCtx.drawImage(tmp, 0, 0, w, h);
  }
}

// ===== Hand Gesture Detection =====
function detectGesture(landmarks) {
  // MediaPipe hand landmarks indices:
  // 0 = wrist, 4 = thumb tip, 8 = index tip, 12 = middle tip,
  // 16 = ring tip, 20 = pinky tip
  // PIP joints: 6 = index PIP, 10 = middle PIP, 14 = ring PIP, 18 = pinky PIP
  // MCP joints: 5 = index MCP, 9 = middle MCP, 13 = ring MCP, 17 = pinky MCP

  const tips = [8, 12, 16, 20];
  const pips = [6, 10, 14, 18];
  
  const fingersUp = tips.map((tip, i) => {
    return landmarks[tip].y < landmarks[pips[i]].y;
  });

  // Thumb check (different axis)
  const thumbUp = landmarks[4].x < landmarks[3].x; // for right hand (mirrored)

  const indexUp = fingersUp[0];
  const middleUp = fingersUp[1];
  const ringUp = fingersUp[2];
  const pinkyUp = fingersUp[3];

  // DRAWING: Only index finger is up
  if (indexUp && !middleUp && !ringUp && !pinkyUp) {
    return 'drawing';
  }

  // ERASING: Index + middle fingers up (peace sign)
  if (indexUp && middleUp && !ringUp && !pinkyUp) {
    return 'erasing';
  }

  // PAUSED: Fist (no fingers up) or all fingers up (open palm)
  if (!indexUp && !middleUp && !ringUp && !pinkyUp) {
    return 'paused';
  }

  // Default
  return 'paused';
}

// ===== Neon Drawing Engine =====
function drawNeonLine(ctx, x1, y1, x2, y2, color, size) {
  // Multi-layer glow effect for neon appearance
  const layers = [
    { blur: size * 8,  alpha: 0.04, width: size * 6  },
    { blur: size * 5,  alpha: 0.08, width: size * 4  },
    { blur: size * 3,  alpha: 0.15, width: size * 2.5 },
    { blur: size * 1.5, alpha: 0.3,  width: size * 1.5 },
    { blur: size * 0.5, alpha: 0.6,  width: size      },
    { blur: 0,          alpha: 1,    width: size * 0.5 },
  ];

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const layer of layers) {
    ctx.save();
    ctx.globalAlpha = layer.alpha;
    ctx.shadowColor = color;
    ctx.shadowBlur = layer.blur;
    ctx.strokeStyle = color;
    ctx.lineWidth = layer.width;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.restore();
  }

  // Bright white core for intense neon look
  ctx.save();
  ctx.globalAlpha = 0.9;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = size * 0.25;
  ctx.shadowColor = color;
  ctx.shadowBlur = size * 2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.restore();
}

function drawNeonDot(ctx, x, y, color, size) {
  const layers = [
    { blur: size * 8, alpha: 0.05, radius: size * 3  },
    { blur: size * 4, alpha: 0.1,  radius: size * 2  },
    { blur: size * 2, alpha: 0.2,  radius: size * 1.2 },
    { blur: size,      alpha: 0.5,  radius: size * 0.7 },
    { blur: 0,         alpha: 1,    radius: size * 0.35 },
  ];

  for (const layer of layers) {
    ctx.save();
    ctx.globalAlpha = layer.alpha;
    ctx.shadowColor = color;
    ctx.shadowBlur = layer.blur;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, layer.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function eraseAt(ctx, x, y, radius) {
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ===== Point Smoothing (Exponential Moving Average) =====
function smoothPoint(newPoint) {
  const alpha = 0.45; // Smoothing factor (0 = very smooth, 1 = no smoothing)
  if (!state.lastSmoothed) {
    state.lastSmoothed = { ...newPoint };
    return newPoint;
  }
  state.lastSmoothed.x = state.lastSmoothed.x * (1 - alpha) + newPoint.x * alpha;
  state.lastSmoothed.y = state.lastSmoothed.y * (1 - alpha) + newPoint.y * alpha;
  return { ...state.lastSmoothed };
}

// ===== Landmark Drawing =====
function drawHandLandmarks(landmarks) {
  landmarkCtx.clearRect(0, 0, landmarkCanvas.width, landmarkCanvas.height);
  
  if (!state.showLandmarks) return;

  const w = landmarkCanvas.width;
  const h = landmarkCanvas.height;

  // Connection pairs
  const connections = [
    [0,1],[1,2],[2,3],[3,4],       // thumb
    [0,5],[5,6],[6,7],[7,8],       // index
    [0,9],[9,10],[10,11],[11,12],  // middle (adjusted: 0→9 for wrist to middle MCP)
    [0,13],[13,14],[14,15],[15,16],// ring
    [0,17],[17,18],[18,19],[19,20],// pinky
    [5,9],[9,13],[13,17],          // palm
  ];

  // Draw connections
  landmarkCtx.strokeStyle = 'rgba(0, 245, 255, 0.25)';
  landmarkCtx.lineWidth = 1.5;
  for (const [a, b] of connections) {
    const ax = (state.mirrored ? 1 - landmarks[a].x : landmarks[a].x) * w;
    const ay = landmarks[a].y * h;
    const bx = (state.mirrored ? 1 - landmarks[b].x : landmarks[b].x) * w;
    const by = landmarks[b].y * h;
    landmarkCtx.beginPath();
    landmarkCtx.moveTo(ax, ay);
    landmarkCtx.lineTo(bx, by);
    landmarkCtx.stroke();
  }

  // Draw joints
  for (let i = 0; i < landmarks.length; i++) {
    const x = (state.mirrored ? 1 - landmarks[i].x : landmarks[i].x) * w;
    const y = landmarks[i].y * h;
    const isTip = [4, 8, 12, 16, 20].includes(i);
    
    landmarkCtx.beginPath();
    landmarkCtx.arc(x, y, isTip ? 5 : 3, 0, Math.PI * 2);
    landmarkCtx.fillStyle = isTip ? 'rgba(0, 245, 255, 0.8)' : 'rgba(255, 255, 255, 0.4)';
    if (isTip) {
      landmarkCtx.shadowColor = '#00f5ff';
      landmarkCtx.shadowBlur = 10;
    } else {
      landmarkCtx.shadowBlur = 0;
    }
    landmarkCtx.fill();
  }
  landmarkCtx.shadowBlur = 0;
}

// ===== Update Gesture UI =====
function updateGestureUI(gesture) {
  const indicator = gestureIndicator;
  const modeIndicator = drawModeIndicator;
  
  if (gesture === 'drawing' && state.drawingEnabled) {
    indicator.querySelector('.gesture-icon').textContent = '👆';
    indicator.querySelector('.gesture-text').textContent = 'Drawing';
    indicator.classList.add('visible');
    modeIndicator.textContent = '● DRAWING';
    modeIndicator.className = 'draw-mode-indicator drawing';
  } else if (gesture === 'erasing') {
    indicator.querySelector('.gesture-icon').textContent = '✌️';
    indicator.querySelector('.gesture-text').textContent = 'Erasing';
    indicator.classList.add('visible');
    modeIndicator.textContent = '● ERASING';
    modeIndicator.className = 'draw-mode-indicator drawing';
  } else if (gesture === 'paused') {
    indicator.querySelector('.gesture-icon').textContent = '✊';
    indicator.querySelector('.gesture-text').textContent = 'Paused';
    indicator.classList.add('visible');
    modeIndicator.textContent = '● PAUSED';
    modeIndicator.className = 'draw-mode-indicator paused';
  } else {
    indicator.classList.remove('visible');
    modeIndicator.className = 'draw-mode-indicator';
  }
}

// ===== Update Finger Cursor =====
function updateFingerCursor(x, y, visible) {
  if (visible) {
    fingerCursor.style.left = `${x - 10}px`;
    fingerCursor.style.top = `${y - 10}px`;
    fingerCursor.style.background = state.currentColor;
    fingerCursor.style.boxShadow = `0 0 12px ${state.currentColor}`;
    fingerCursor.classList.add('visible');
  } else {
    fingerCursor.classList.remove('visible');
  }
}

// ===== MediaPipe Results Handler =====
function onHandResults(results) {
  if (!state.isRunning) return;

  const w = drawCanvas.width;
  const h = drawCanvas.height;

  if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
    const landmarks = results.multiHandLandmarks[0];
    
    // Draw hand skeleton
    drawHandLandmarks(landmarks);
    
    // Detect gesture
    const gesture = detectGesture(landmarks);
    state.gestureState = gesture;
    updateGestureUI(gesture);

    // Get index finger tip position (landmark 8)
    const indexTip = landmarks[8];
    const tipX = (state.mirrored ? 1 - indexTip.x : indexTip.x) * w;
    const tipY = indexTip.y * h;

    // Smooth the point
    const smoothed = smoothPoint({ x: tipX, y: tipY });

    // Update cursor
    updateFingerCursor(smoothed.x, smoothed.y, true);

    if (gesture === 'drawing' && state.drawingEnabled) {
      if (state.lastPoint) {
        drawNeonLine(
          drawCtx,
          state.lastPoint.x, state.lastPoint.y,
          smoothed.x, smoothed.y,
          state.currentColor,
          state.brushSize
        );
        state.currentStroke.push({ ...smoothed });
      } else {
        // Start of new stroke — draw a dot
        drawNeonDot(drawCtx, smoothed.x, smoothed.y, state.currentColor, state.brushSize);
        state.currentStroke = [{ ...smoothed }];
      }
      state.lastPoint = { ...smoothed };
      state.isDrawing = true;
    } else if (gesture === 'erasing') {
      eraseAt(drawCtx, smoothed.x, smoothed.y, state.brushSize * 8);
      state.lastPoint = null;
      state.lastSmoothed = null;
      if (state.isDrawing && state.currentStroke.length > 0) {
        // Save stroke snapshot before erasing starts
        saveStrokeSnapshot();
      }
      state.isDrawing = false;
    } else {
      // Paused — finalize current stroke
      if (state.isDrawing && state.currentStroke.length > 0) {
        saveStrokeSnapshot();
      }
      state.lastPoint = null;
      state.lastSmoothed = null;
      state.isDrawing = false;
    }
  } else {
    // No hand detected
    landmarkCtx.clearRect(0, 0, landmarkCanvas.width, landmarkCanvas.height);
    updateFingerCursor(0, 0, false);
    updateGestureUI('none');
    
    if (state.isDrawing && state.currentStroke.length > 0) {
      saveStrokeSnapshot();
    }
    state.lastPoint = null;
    state.lastSmoothed = null;
    state.isDrawing = false;
  }
}

function saveStrokeSnapshot() {
  // Save canvas state for undo
  const snapshot = drawCtx.getImageData(0, 0, drawCanvas.width, drawCanvas.height);
  state.strokes.push(snapshot);
  // Limit undo history to 30
  if (state.strokes.length > 30) {
    state.strokes.shift();
  }
  state.currentStroke = [];
}

// ===== Initialize MediaPipe Hands =====
function initMediaPipe() {
  const hands = new Hands({
    locateFile: (file) => {
      return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
    }
  });

  hands.setOptions({
    maxNumHands: 1,
    modelComplexity: 1,
    minDetectionConfidence: 0.7,
    minTrackingConfidence: 0.6,
  });

  hands.onResults(onHandResults);

  return hands;
}

// ===== Start Camera =====
async function startCamera(hands) {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        facingMode: 'user',
      },
      audio: false,
    });
    
    video.srcObject = stream;
    
    await new Promise((resolve) => {
      video.onloadedmetadata = () => {
        video.play();
        resolve();
      };
    });

    // Use MediaPipe Camera Utils for frame processing
    const camera = new Camera(video, {
      onFrame: async () => {
        await hands.send({ image: video });
      },
      width: 1280,
      height: 720,
    });
    
    camera.start();
    
    state.isRunning = true;
    statusBadge.classList.add('active');
    statusText.textContent = 'Hand Tracking Active';
    showToast('Camera started — show your hand!', 'success');
    
  } catch (err) {
    console.error('Camera error:', err);
    statusText.textContent = 'Camera Error';
    showToast('Could not access camera. Please allow permissions.', 'info');
  }
}

// ===== Event Listeners =====
function bindEvents() {
  // Start button
  startBtn.addEventListener('click', async () => {
    startBtn.innerHTML = '<span class="loading-spinner"></span> Loading Model...';
    startBtn.disabled = true;
    
    const hands = initMediaPipe();
    await startCamera(hands);
    
    startOverlay.classList.add('hidden');
  });

  // Color picker
  colorPicker.addEventListener('click', (e) => {
    const swatch = e.target.closest('.color-swatch');
    if (!swatch) return;
    
    document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
    swatch.classList.add('active');
    
    const colorName = swatch.dataset.color;
    state.currentColor = COLORS[colorName];
    state.currentColorName = colorName;
  });

  // Brush size
  brushSlider.addEventListener('input', (e) => {
    state.brushSize = parseInt(e.target.value);
  });

  // Toggle draw
  toggleDrawBtn.addEventListener('click', () => {
    state.drawingEnabled = !state.drawingEnabled;
    toggleDrawBtn.classList.toggle('primary', state.drawingEnabled);
    toggleDrawBtn.querySelector('.label').textContent = state.drawingEnabled ? 'Draw' : 'Off';
    showToast(state.drawingEnabled ? 'Drawing enabled' : 'Drawing disabled', 'info');
  });

  // Undo
  undoBtn.addEventListener('click', () => {
    if (state.strokes.length > 0) {
      state.strokes.pop(); // Remove last stroke
      if (state.strokes.length > 0) {
        const prev = state.strokes[state.strokes.length - 1];
        drawCtx.putImageData(prev, 0, 0);
      } else {
        drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
      }
      showToast('Undo', 'info');
    }
  });

  // Clear
  clearBtn.addEventListener('click', () => {
    drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
    state.strokes = [];
    state.currentStroke = [];
    state.lastPoint = null;
    state.lastSmoothed = null;
    showToast('Canvas cleared', 'info');
  });

  // Save
  saveBtn.addEventListener('click', () => {
    // Composite: dark background + drawing
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = drawCanvas.width;
    exportCanvas.height = drawCanvas.height;
    const ectx = exportCanvas.getContext('2d');
    
    // Dark background
    ectx.fillStyle = '#0a0a0f';
    ectx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
    
    // Draw the neon artwork
    ectx.drawImage(drawCanvas, 0, 0);
    
    // Export
    const link = document.createElement('a');
    link.download = `neontrace-${Date.now()}.png`;
    link.href = exportCanvas.toDataURL('image/png');
    link.click();
    
    showToast('Image saved!', 'success');
  });

  // Toggle landmarks
  toggleLandmarks.addEventListener('click', () => {
    state.showLandmarks = !state.showLandmarks;
    toggleLandmarks.classList.toggle('active', state.showLandmarks);
    if (!state.showLandmarks) {
      landmarkCtx.clearRect(0, 0, landmarkCanvas.width, landmarkCanvas.height);
    }
  });

  // Toggle mirror
  toggleMirror.addEventListener('click', () => {
    state.mirrored = !state.mirrored;
    video.style.transform = state.mirrored ? 'scaleX(-1)' : 'scaleX(1)';
    toggleMirror.classList.toggle('active', state.mirrored);
    showToast(state.mirrored ? 'Mirrored' : 'Normal', 'info');
  });

  // Toggle camera visibility
  toggleCamera.addEventListener('click', () => {
    state.showCamera = !state.showCamera;
    video.style.opacity = state.showCamera ? '0.35' : '0';
    toggleCamera.classList.toggle('active', state.showCamera);
  });

  // Resize
  window.addEventListener('resize', resizeCanvases);

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.key === 'c' || e.key === 'C') {
      clearBtn.click();
    } else if (e.key === 'z' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      undoBtn.click();
    } else if (e.key === 's' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      saveBtn.click();
    } else if (e.key === 'd' || e.key === 'D') {
      toggleDrawBtn.click();
    }
  });
}

// ===== Glow Fade Effect (subtle ambient decay for trails) =====
function startGlowFade() {
  // Very subtle fade to give a slight afterglow decay effect
  // (uncomment if you want trails to slowly fade)
  /*
  setInterval(() => {
    drawCtx.save();
    drawCtx.globalCompositeOperation = 'destination-out';
    drawCtx.globalAlpha = 0.002;
    drawCtx.fillRect(0, 0, drawCanvas.width, drawCanvas.height);
    drawCtx.restore();
  }, 100);
  */
}

// ===== Initialization =====
function init() {
  resizeCanvases();
  bindEvents();
  startGlowFade();
  
  // Save initial empty state
  state.strokes.push(drawCtx.getImageData(0, 0, drawCanvas.width, drawCanvas.height));
}

// Boot
document.addEventListener('DOMContentLoaded', init);
