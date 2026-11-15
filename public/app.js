/**
 * ỨNG DỤNG NHẬN DIỆN BUỒN NGỦ VÀ CẢNH BÁO THÔNG MINH 2 CẤP ĐỘ
 * Sử dụng: TensorFlow.js, Teachable Machine Image, Web Audio API, Web Speech API
 */

// ==========================================
// 1. CẤU HÌNH & BIẾN TRẠNG THÁI TOÀN CỤC
// ==========================================
const MODEL_URL = '/my_model/'; // Đường dẫn serve từ Express
let model = null;
let webcam = null;
let isRunning = false;
let animationFrameId = null;

// CẤU HÌNH CỐ ĐỊNH CHUẨN TỐI ƯU
const CONF_THRESHOLD = 0.85; // Ngưỡng độ tin cậy buồn ngủ 85%
const LEVEL1_DELAY = 1.5;    // Trễ kích hoạt Mức 1: 1.5s
const LEVEL2_DELAY = 3.0;    // Trễ kích hoạt Mức 2: 3.0s

// Nhãn mô hình
let labels = [];
let drowsyLabelIndex = -1;
let awakeLabelIndex = -1;

// AudioContext & Synthesizer
let audioCtx = null;
let level2Osc = null;
let level2Lfo = null;
let level2Gain = null;
let isLevel2AlarmPlaying = false;
let vietnameseVoice = null;

// Bộ đếm thời gian & Logic cảnh báo
let drowsyStartTime = null;
let level1Triggered = false; // Đã phát ting + giọng nói mức 1 chưa
let level2Active = false;    // Đang ở mức 2 chưa
let level2Logged = false;    // Đã ghi log mức 2 chưa
let lastDrowsyConfidence = 0;

// Thống kê phiên
let statLevel1Count = 0;
let statLevel2Count = 0;
let sessionStartTime = null;
let sessionTimerInterval = null;

// Tính FPS
let lastFrameTime = performance.now();
let frameCount = 0;
let currentFps = 0;

// Các phần tử DOM
const DOM = {
  // Badges & Camera Info
  stateBadge: document.getElementById('state-badge'),
  stateText: document.getElementById('state-text'),
  fpsDisplay: document.getElementById('fps-display'),

  // Camera & Visuals
  cameraWrapper: document.getElementById('camera-wrapper'),
  cameraTagDot: document.getElementById('camera-tag-dot'),
  webcamContainer: document.getElementById('webcam-container'),
  cameraPlaceholder: document.getElementById('camera-placeholder'),
  alertBanner: document.getElementById('alert-banner'),
  alertIcon: document.getElementById('alert-icon'),
  alertMessage: document.getElementById('alert-message'),
  timerOverlay: document.getElementById('timer-overlay'),
  timerSeconds: document.getElementById('timer-seconds'),

  // Buttons
  btnStartCamera: document.getElementById('btn-start-camera'),
  btnStopCamera: document.getElementById('btn-stop-camera'),
  btnTestLevel1: document.getElementById('btn-test-level1'),
  btnTestLevel2: document.getElementById('btn-test-level2'),
  btnRefreshLogs: document.getElementById('btn-refresh-logs'),
  btnClearLogs: document.getElementById('btn-clear-logs'),

  // AI Probability
  percentDrowsy: document.getElementById('percent-drowsy'),
  barDrowsy: document.getElementById('bar-drowsy'),
  percentAwake: document.getElementById('percent-awake'),
  barAwake: document.getElementById('bar-awake'),

  // Stats
  statLevel1Count: document.getElementById('stat-level1-count'),
  statLevel2Count: document.getElementById('stat-level2-count'),
  statRuntime: document.getElementById('stat-runtime'),

  // Logs
  logsCount: document.getElementById('logs-count'),
  logsTableBody: document.getElementById('logs-table-body'),
  toastContainer: document.getElementById('toast-container')
};

// ==========================================
// 2. KHỞI TẠO ÂM THANH (WEB AUDIO & SPEECH)
// ==========================================

/**
 * Mở khóa và khởi tạo AudioContext sau tương tác của người dùng
 */
function initAudio() {
  try {
    if (!audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        audioCtx = new AudioContextClass();
      }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume();
    }

    if (DOM.audioStatusPill) {
      DOM.audioStatusPill.textContent = 'Web Audio: Sẵn sàng 🔊';
      DOM.audioStatusPill.style.color = '#10b981';
    }

    // Khởi tạo và nạp giọng đọc tiếng Việt
    loadSpeechVoice();
  } catch (err) {
    console.warn('Lỗi khởi tạo AudioContext:', err);
  }
}

/**
 * Tìm kiếm giọng đọc tiếng Việt (vi-VN) trong SpeechSynthesis
 */
function loadSpeechVoice() {
  if (!('speechSynthesis' in window)) return;
  const voices = window.speechSynthesis.getVoices();
  vietnameseVoice = voices.find(v => v.lang.includes('vi') || v.lang.includes('VN')) || null;
}

if ('speechSynthesis' in window) {
  window.speechSynthesis.onvoiceschanged = loadSpeechVoice;
}

/**
 * Phát tiếng "ting" êm tai (Cảnh báo Mức 1)
 * Sóng sine, tần số 480Hz, âm lượng 35%
 */
function playTingSound() {
  initAudio();
  if (!audioCtx) return;

  try {
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(480, now);
    // Tần số hơi trượt nhẹ lên để tạo âm sắc chuông ting ấm áp
    osc.frequency.exponentialRampToValueAtTime(520, now + 0.3);

    // Âm lượng 35% và giảm dần êm ái
    gainNode.gain.setValueAtTime(0.35, now);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);

    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    osc.start(now);
    osc.stop(now + 0.5);
  } catch (err) {
    console.error('Lỗi phát âm ting:', err);
  }
}

/**
 * Đọc giọng nói cảnh báo bằng Web Speech API (vi-VN)
 */
function playSpeechWarning(text = 'Chú ý, bạn đang có dấu hiệu buồn ngủ') {
  if (!('speechSynthesis' in window)) return;

  // Hủy các câu đang đọc dở để tránh chồng chéo
  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'vi-VN';
  if (vietnameseVoice) {
    utterance.voice = vietnameseVoice;
  }
  utterance.rate = 1.05; // Tốc độ vừa phải, dứt khoát
  utterance.pitch = 1.0;
  utterance.volume = 1.0;

  window.speechSynthesis.speak(utterance);
}

/**
 * Kích hoạt còi báo động dồn dập Mức 2 (Continuous Siren)
 * Sóng sawtooth/square, dao động tần số 880Hz - 1000Hz, âm lượng 100%
 */
function startLevel2Alarm() {
  if (isLevel2AlarmPlaying) return;
  initAudio();
  if (!audioCtx) return;

  try {
    // Ngắt giọng nói Mức 1 ngay lập tức
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }

    const now = audioCtx.currentTime;

    // Oscillator phát sóng chính
    level2Osc = audioCtx.createOscillator();
    level2Osc.type = 'sawtooth'; // Âm thanh sắc nét, cảnh báo mạnh
    level2Osc.frequency.setValueAtTime(940, now);

    // LFO điều chế tần số (tạo âm còi hú dồn dập 880Hz - 1000Hz)
    level2Lfo = audioCtx.createOscillator();
    level2Lfo.frequency.setValueAtTime(5, now); // Tốc độ quét 5 lần/giây dồn dập

    const lfoGain = audioCtx.createGain();
    lfoGain.gain.setValueAtTime(80, now); // Dao động +- 80Hz quanh 940Hz (tức là 860Hz -> 1020Hz)

    level2Lfo.connect(lfoGain);
    lfoGain.connect(level2Osc.frequency);

    // Gain node âm lượng 100%
    level2Gain = audioCtx.createGain();
    level2Gain.gain.setValueAtTime(1.0, now);

    level2Osc.connect(level2Gain);
    level2Gain.connect(audioCtx.destination);

    level2Osc.start(now);
    level2Lfo.start(now);
    isLevel2AlarmPlaying = true;
  } catch (err) {
    console.error('Lỗi kích hoạt còi báo động Mức 2:', err);
  }
}

/**
 * Tắt còi báo động Mức 2
 */
function stopLevel2Alarm() {
  if (!isLevel2AlarmPlaying) return;

  try {
    if (level2Osc) {
      level2Osc.stop();
      level2Osc.disconnect();
      level2Osc = null;
    }
    if (level2Lfo) {
      level2Lfo.stop();
      level2Lfo.disconnect();
      level2Lfo = null;
    }
    if (level2Gain) {
      level2Gain.disconnect();
      level2Gain = null;
    }
  } catch (err) {
    console.warn('Lỗi ngắt còi Mức 2:', err);
  } finally {
    isLevel2AlarmPlaying = false;
  }
}

// ==========================================
// 3. TẢI MÔ HÌNH TEACHABLE MACHINE
// ==========================================
async function loadAIModel() {
  try {
    if (DOM.aiModelStatus) {
      DOM.aiModelStatus.innerHTML = `
        <span class="status-dot warning"></span>
        <span class="status-text">Đang tải mô hình AI...</span>
      `;
    }

    const modelJsonPath = `${MODEL_URL}model.json`;
    const metadataJsonPath = `${MODEL_URL}metadata.json`;

    model = await tmImage.load(modelJsonPath, metadataJsonPath);
    labels = model.getClassLabels();

    console.log('Mô hình AI tải thành công. Danh sách nhãn:', labels);

    // Xác định index nhãn Buồn ngủ và Không buồn ngủ
    labels.forEach((lbl, idx) => {
      const lower = lbl.toLowerCase();
      if (lower.includes('không') || lower.includes('awake') || lower.includes('open')) {
        awakeLabelIndex = idx;
      } else if (lower.includes('buồn ngủ') || lower.includes('drowsy') || lower.includes('close')) {
        drowsyLabelIndex = idx;
      }
    });

    // Nếu không khớp chuỗi trên, gán mặc định nhãn 0 là Buồn ngủ, nhãn 1 là Tỉnh táo
    if (drowsyLabelIndex === -1) drowsyLabelIndex = 0;
    if (awakeLabelIndex === -1) awakeLabelIndex = labels.length > 1 ? 1 : 0;

    if (DOM.aiModelStatus) {
      DOM.aiModelStatus.innerHTML = `
        <span class="status-dot success"></span>
        <span class="status-text">AI Sẵn Sàng (${labels.length} nhãn)</span>
      `;
    }

    showToast('Tải mô hình AI thành công!', 'success');
  } catch (err) {
    console.error('Lỗi khi tải mô hình AI:', err);
    if (DOM.aiModelStatus) {
      DOM.aiModelStatus.innerHTML = `
        <span class="status-dot danger"></span>
        <span class="status-text">Lỗi tải mô hình</span>
      `;
    }
    showToast('Không thể tải mô hình AI. Vui lòng kiểm tra thư mục ./my_model/', 'danger');
  }
}

// ==========================================
// 4. QUẢN LÝ WEBCAM & VÒNG LẶP NHẬN DIỆN
// ==========================================
async function startWebcam() {
  initAudio();

  if (!model) {
    await loadAIModel();
    if (!model) return;
  }

  try {
    DOM.btnStartCamera.disabled = true;
    DOM.btnStartCamera.innerHTML = `
      <span class="status-dot warning" style="display:inline-block;"></span>
      Đang khởi động Camera...
    `;

    // Cấu hình webcam (rộng: 400, cao: 300, lật gương: true)
    const width = 400;
    const height = 300;
    const flip = true; // Lật gương tự nhiên

    webcam = new tmImage.Webcam(width, height, flip);

    // Ưu tiên Camera trước (Selfie camera) cho Mobile & Tablet (Yêu cầu 2)
    await webcam.setup({ facingMode: "user" });

    // Đảm bảo playsinline và muted cho iOS Safari và Android Chrome
    if (webcam.webcam) {
      webcam.webcam.setAttribute('playsinline', 'true');
      webcam.webcam.setAttribute('webkit-playsinline', 'true');
      webcam.webcam.muted = true;
    }
    if (webcam.canvas) {
      webcam.canvas.setAttribute('playsinline', 'true');
    }

    await webcam.play();

    isRunning = true;

    // Xóa placeholder và hiển thị canvas webcam
    DOM.cameraPlaceholder.style.display = 'none';
    DOM.webcamContainer.innerHTML = '';
    DOM.webcamContainer.appendChild(webcam.canvas);

    // Cập nhật trạng thái các nút (Yêu cầu 4 & 5)
    DOM.btnStartCamera.disabled = true;
    DOM.btnStartCamera.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
        <polygon points="5 3 19 12 5 21 5 3"/>
      </svg>
      Đang Giám Sát
    `;
    DOM.btnStopCamera.disabled = false;
    DOM.btnStopCamera.classList.add('btn-danger-active'); // Nút đỏ nổi bật khi camera đang bật

    // Cập nhật chấm tròn trên nhãn Camera sang xanh lá tươi #10B981 (Yêu cầu 5)
    if (DOM.cameraTagDot) {
      DOM.cameraTagDot.classList.add('active');
    }

    // Bắt đầu đếm thời gian phiên làm việc
    if (!sessionStartTime) {
      sessionStartTime = Date.now();
      sessionTimerInterval = setInterval(updateSessionRuntime, 1000);
    }

    // Đặt trạng thái ban đầu là bình thường
    setVisualState('normal', 'Trạng thái: Tỉnh táo');

    // Chạy vòng lặp nhận diện AI
    window.requestAnimationFrame(predictLoop);

    showToast('Đã bật camera và kích hoạt giám sát thời gian thực!', 'success');
  } catch (err) {
    console.error('Lỗi bật webcam:', err);
    DOM.btnStartCamera.disabled = false;
    DOM.btnStartCamera.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polygon points="5 3 19 12 5 21 5 3"/>
      </svg>
      Bật Camera & Giám Sát
    `;
    showToast('Không thể truy cập Webcam. Vui lòng cấp quyền!', 'danger');
  }
}

function stopWebcam() {
  isRunning = false;
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }

  if (webcam) {
    webcam.stop();
    webcam = null;
  }

  // Tắt âm thanh nếu đang kêu
  stopLevel2Alarm();
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }

  // Reset trạng thái hiển thị
  DOM.webcamContainer.innerHTML = '';
  DOM.cameraPlaceholder.style.display = 'flex';
  DOM.webcamContainer.appendChild(DOM.cameraPlaceholder);

  DOM.btnStartCamera.disabled = false;
  DOM.btnStartCamera.innerHTML = `
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
      <polygon points="5 3 19 12 5 21 5 3"/>
    </svg>
    Bật Camera & Giám Sát
  `;
  DOM.btnStopCamera.disabled = true;
  DOM.btnStopCamera.classList.remove('btn-danger-active'); // Trở lại xám nhạt disabled khi camera tắt

  // Cập nhật chấm tròn trên nhãn Camera về màu đen #0F172A (Yêu cầu 5)
  if (DOM.cameraTagDot) {
    DOM.cameraTagDot.classList.remove('active');
  }

  // Reset đồng hồ
  if (sessionTimerInterval) {
    clearInterval(sessionTimerInterval);
    sessionTimerInterval = null;
    sessionStartTime = null;
  }
  DOM.statRuntime.textContent = '00:00';
  DOM.fpsDisplay.textContent = '0 FPS';

  // Reset các thanh tiến trình
  updatePredictionUI(0, 0);
  setVisualState('normal', 'Camera đã tắt');
  DOM.timerOverlay.classList.add('hidden');

  showToast('Đã dừng camera giám sát.', 'info');
}

/**
 * Vòng lặp nhận diện AI thời gian thực
 */
async function predictLoop() {
  if (!isRunning || !webcam) return;

  webcam.update(); // Cập nhật khung hình camera

  // Tính toán FPS
  frameCount++;
  const now = performance.now();
  if (now - lastFrameTime >= 1000) {
    currentFps = Math.round((frameCount * 1000) / (now - lastFrameTime));
    DOM.fpsDisplay.textContent = `${currentFps} FPS`;
    frameCount = 0;
    lastFrameTime = now;
  }

  // Chạy mô hình dự đoán từ canvas webcam
  const predictions = await model.predict(webcam.canvas);

  let drowsyProb = 0;
  let awakeProb = 0;

  if (predictions && predictions.length > 0) {
    drowsyProb = predictions[drowsyLabelIndex] ? predictions[drowsyLabelIndex].probability : 0;
    awakeProb = predictions[awakeLabelIndex] ? predictions[awakeLabelIndex].probability : (1 - drowsyProb);
  }

  // Cập nhật giao diện thanh xác suất
  updatePredictionUI(drowsyProb, awakeProb);

  // Xử lý bộ máy cảnh báo 2 cấp độ
  processDrowsinessLogic(drowsyProb);

  // Tiếp tục khung hình kế tiếp
  animationFrameId = window.requestAnimationFrame(predictLoop);
}

// ==========================================
// 5. BỘ MÁY XỬ LÝ CẢNH BÁO 2 CẤP ĐỘ (THÔNG SỐ CỐ ĐỊNH CHUẨN)
// ==========================================
function processDrowsinessLogic(drowsyProb) {
  // Bộ thông số cố định tối ưu chuẩn
  const confThreshold = CONF_THRESHOLD; // 0.85 (85%)
  const level1Delay = LEVEL1_DELAY;     // 1.5 giây
  const level2Delay = LEVEL2_DELAY;     // 3.0 giây

  lastDrowsyConfidence = drowsyProb;

  // Nếu độ tin cậy vượt ngưỡng buồn ngủ
  if (drowsyProb >= confThreshold) {
    if (drowsyStartTime === null) {
      drowsyStartTime = performance.now();
    }

    const elapsedSeconds = (performance.now() - drowsyStartTime) / 1000;

    // Cập nhật overlay đồng hồ đếm giây nhắm mắt
    DOM.timerOverlay.classList.remove('hidden');
    DOM.timerSeconds.textContent = `${elapsedSeconds.toFixed(1)}s`;

    // -------------------------------------------------------------
    // CẤP ĐỘ 2: BÁO ĐỘNG KHẨN CẤP (Kéo dài trên 3.0s)
    // -------------------------------------------------------------
    if (elapsedSeconds >= level2Delay) {
      if (!level2Active) {
        level2Active = true;
        setVisualState('danger', 'NGUY HIỂM! ĐANG NGỦ GẬT!');
        startLevel2Alarm();

        // Ghi log sự cố lên backend (chỉ ghi 1 lần cho đợt này)
        if (!level2Logged) {
          level2Logged = true;
          statLevel2Count++;
          DOM.statLevel2Count.textContent = statLevel2Count;
          if (DOM.statTotalAlerts) DOM.statTotalAlerts.textContent = statLevel1Count + statLevel2Count;

          sendAlertLog({
            level: 'Mức 2',
            duration: elapsedSeconds,
            confidence: drowsyProb,
            note: 'Ngủ gật kéo dài trên 3s'
          });
        }
      } else {
        // Vẫn đang ở mức 2, cập nhật message
        setVisualState('danger', 'NGUY HIỂM! ĐANG NGỦ GẬT!');
      }
    }
    // -------------------------------------------------------------
    // CẤP ĐỘ 1: CẢNH BÁO NHẸ (Kéo dài từ 1.5s đến < 3.0s)
    // -------------------------------------------------------------
    else if (elapsedSeconds >= level1Delay) {
      setVisualState('warning', 'Bạn có dấu hiệu mệt mỏi, hãy tập trung!');

      // Kích hoạt âm thanh Mức 1 & Gửi log duy nhất 1 lần cho đợt này
      if (!level1Triggered) {
        level1Triggered = true;
        statLevel1Count++;
        DOM.statLevel1Count.textContent = statLevel1Count;
        if (DOM.statTotalAlerts) DOM.statTotalAlerts.textContent = statLevel1Count + statLevel2Count;

        // 1. Phát tiếng ting trầm êm tai (480Hz, 35%)
        playTingSound();

        // 2. Đọc lời nhắc nhở bằng tiếng Việt sau 350ms
        setTimeout(() => {
          // Chỉ đọc nếu chưa bị chuyển sang Mức 2 và vẫn đang buồn ngủ
          if (!level2Active && drowsyStartTime !== null) {
            playSpeechWarning('Chú ý, bạn đang có dấu hiệu buồn ngủ');
          }
        }, 350);

        // 3. Tự động lưu lịch sử Mức 1 lên Backend API (Yêu cầu 2)
        sendAlertLog({
          level: 'Mức 1',
          duration: elapsedSeconds,
          confidence: drowsyProb,
          note: 'Chớm buồn ngủ (nhắc nhở nhẹ)'
        });
      }
    }
  } else {
    // -------------------------------------------------------------
    // TRẠNG THÁI BÌNH THƯỜNG (TỈNH TÁO)
    // -------------------------------------------------------------
    if (drowsyStartTime !== null) {
      // Người dùng vừa mở mắt tỉnh táo trở lại
      const totalDuration = (performance.now() - drowsyStartTime) / 1000;

      // Nếu vừa thoát khỏi Mức 2, gửi cập nhật log thời lượng chính xác
      if (level2Active) {
        stopLevel2Alarm();
      }

      // Reset toàn bộ cờ cảnh báo
      drowsyStartTime = null;
      level1Triggered = false;
      level2Active = false;
      level2Logged = false;
    }

    // Đảm bảo còi tắt
    stopLevel2Alarm();

    // Cập nhật giao diện xanh lá bình thường
    setVisualState('normal', 'Trạng thái: Tỉnh táo');
    DOM.timerOverlay.classList.add('hidden');
  }
}

/**
 * Đổi màu sắc viền camera, banner và badge trạng thái
 * @param {'normal' | 'warning' | 'danger'} state 
 * @param {string} message 
 */
function setVisualState(state, message) {
  // Reset các class cũ
  DOM.cameraWrapper.className = `camera-wrapper state-${state}`;
  DOM.stateBadge.className = `state-badge ${state}`;
  DOM.alertBanner.className = `alert-banner banner-${state}`;

  DOM.alertMessage.textContent = message;

  if (state === 'normal') {
    DOM.stateText.textContent = isRunning ? 'TỈNH TÁO' : 'SẴN SÀNG';
    DOM.alertIcon.textContent = '✓';
  } else if (state === 'warning') {
    DOM.stateText.textContent = 'MỨC 1 - CẢNH BÁO';
    DOM.alertIcon.textContent = '⚠️';
  } else if (state === 'danger') {
    DOM.stateText.textContent = 'MỨC 2 - NGUY HIỂM';
    DOM.alertIcon.textContent = '🚨';
  }
}

/**
 * Cập nhật thanh tiến trình % dự đoán của từng nhãn
 */
function updatePredictionUI(drowsyProb, awakeProb) {
  const drowsyPercent = (drowsyProb * 100).toFixed(1);
  const awakePercent = (awakeProb * 100).toFixed(1);

  DOM.percentDrowsy.textContent = `${drowsyPercent}%`;
  DOM.barDrowsy.style.width = `${drowsyPercent}%`;

  DOM.percentAwake.textContent = `${awakePercent}%`;
  DOM.barAwake.style.width = `${awakePercent}%`;
}

// ==========================================
// 6. THỬ NGHIỆM PHẢN XẠ ÂM THANH (TEST BUTTONS)
// ==========================================
let testTimeout = null;

function testLevel1Alert() {
  initAudio();
  clearTimeout(testTimeout);
  stopLevel2Alarm();

  showToast('Đang thử nghiệm Cảnh báo Mức 1...', 'warning');
  setVisualState('warning', 'Bạn có dấu hiệu mệt mỏi, hãy tập trung!');

  // Phát tiếng ting
  playTingSound();

  // Đọc lời nhắc
  setTimeout(() => {
    playSpeechWarning('Chú ý, bạn đang có dấu hiệu buồn ngủ');
  }, 400);

  // Tự động khôi phục sau 3.5 giây
  testTimeout = setTimeout(() => {
    if (!isRunning) {
      setVisualState('normal', 'Trạng thái: Sẵn sàng');
    }
  }, 3500);
}

function testLevel2Alert() {
  initAudio();
  clearTimeout(testTimeout);

  showToast('Đang thử nghiệm Báo động Mức 2 (Nhấp nháy đỏ + Còi hú dồn dập)...', 'danger');
  setVisualState('danger', 'NGUY HIỂM! ĐANG NGỦ GẬT!');
  startLevel2Alarm();

  // Tự động tắt sau 3 giây
  testTimeout = setTimeout(() => {
    stopLevel2Alarm();
    if (!isRunning) {
      setVisualState('normal', 'Trạng thái: Sẵn sàng');
    } else {
      setVisualState('normal', 'Trạng thái: Tỉnh táo');
    }
    showToast('Đã dừng thử nghiệm Mức 2.', 'info');
  }, 3000);
}

// ==========================================
// 7. KẾT NỐI API BACKEND (ALERT LOGS)
// ==========================================

/**
 * Helper tách thời gian thành 2 dòng: HH:MM:SS ở dòng trên và DD/MM/YYYY ở dòng dưới
 */
function formatLogTimestamp(ts) {
  if (!ts) return { time: '--:--:--', date: '' };

  const str = String(ts).trim();
  const parts = str.split(/[,\s]+/);
  if (parts.length >= 2) {
    const timePart = parts.find(p => p.includes(':')) || parts[0];
    const datePart = parts.find(p => p.includes('/') || p.includes('-')) || parts[1];
    return { time: timePart, date: datePart };
  }

  const dateObj = new Date(ts);
  if (!isNaN(dateObj.getTime())) {
    const hours = String(dateObj.getHours()).padStart(2, '0');
    const minutes = String(dateObj.getMinutes()).padStart(2, '0');
    const seconds = String(dateObj.getSeconds()).padStart(2, '0');
    const day = String(dateObj.getDate()).padStart(2, '0');
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const year = dateObj.getFullYear();
    return {
      time: `${hours}:${minutes}:${seconds}`,
      date: `${day}/${month}/${year}`
    };
  }

  return { time: str, date: '' };
}

/**
 * Gửi ghi nhận cảnh báo lên backend API POST /api/alert-logs
 */
async function sendAlertLog(logData) {
  try {
    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
    const dateStr = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
    const payload = {
      ...logData,
      timestamp: logData.timestamp || `${timeStr} ${dateStr}`
    };

    const response = await fetch('/api/alert-logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const result = await response.json();
    if (result.success) {
      // Làm mới danh sách log trên giao diện
      loadAlertLogs();
    }
  } catch (err) {
    console.error('Lỗi gửi alert log lên backend:', err);
  }
}

/**
 * Tải danh sách logs từ backend API GET /api/alert-logs
 */
async function loadAlertLogs() {
  try {
    const response = await fetch('/api/alert-logs');
    const data = await response.json();

    if (data.success && Array.isArray(data.logs)) {
      renderLogsTable(data.logs);
      DOM.logsCount.textContent = data.logs.length;
      if (DOM.backendStatus) {
        DOM.backendStatus.innerHTML = `
          <span class="status-dot success"></span>
          <span class="status-text">Backend Online</span>
        `;
      }
    }
  } catch (err) {
    console.warn('Lỗi tải logs từ backend:', err);
    if (DOM.backendStatus) {
      DOM.backendStatus.innerHTML = `
        <span class="status-dot danger"></span>
        <span class="status-text">Backend Offline</span>
      `;
    }
  }
}

/**
 * Hiển thị dữ liệu lên bảng Nhật ký Logs (Định dạng cột Thời gian 2 dòng theo Yêu cầu 1)
 */
function renderLogsTable(logs) {
  if (!logs || logs.length === 0) {
    DOM.logsTableBody.innerHTML = `
      <tr class="empty-row">
        <td colspan="5">Chưa có bản ghi cảnh báo nào</td>
      </tr>
    `;
    return;
  }

  DOM.logsTableBody.innerHTML = logs.map(item => {
    const badgeClass = item.level === 'Mức 1' ? 'level-1' : 'level-2';
    const { time, date } = formatLogTimestamp(item.timestamp);
    return `
      <tr>
        <td class="col-time tabular-number">
          <div class="log-time-row">${time}</div>
          ${date ? `<div class="log-date-row">${date}</div>` : ''}
        </td>
        <td class="col-level"><span class="log-badge ${badgeClass}">${item.level}</span></td>
        <td class="col-duration tabular-number" style="font-weight: 600;">${item.duration}</td>
        <td class="col-conf tabular-number" style="color: #D97706; font-weight: 700;">${item.confidence}</td>
        <td class="col-note" style="color: var(--text-muted);">${item.note || '-'}</td>
      </tr>
    `;
  }).join('');
}

/**
 * Xóa toàn bộ nhật ký
 */
async function clearAllLogs() {
  if (!confirm('Bạn có chắc chắn muốn xóa toàn bộ lịch sử nhật ký cảnh báo?')) return;

  try {
    const res = await fetch('/api/alert-logs', { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      showToast('Đã xóa toàn bộ nhật ký.', 'info');
      loadAlertLogs();
    }
  } catch (err) {
    console.error('Lỗi khi xóa nhật ký:', err);
    showToast('Lỗi khi xóa nhật ký', 'danger');
  }
}

// ==========================================
// 8. TIỆN ÍCH PHỤ TRỢ (TOAST, RUNTIME)
// ==========================================
function updateSessionRuntime() {
  if (!sessionStartTime) return;
  const elapsed = Math.floor((Date.now() - sessionStartTime) / 1000);
  const minutes = Math.floor(elapsed / 60).toString().padStart(2, '0');
  const seconds = (elapsed % 60).toString().padStart(2, '0');
  DOM.statRuntime.textContent = `${minutes}:${seconds}`;
}

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;

  if (type === 'danger') toast.style.borderColor = 'var(--color-danger)';
  if (type === 'warning') toast.style.borderColor = 'var(--color-warning)';
  if (type === 'success') toast.style.borderColor = 'var(--color-success)';

  DOM.toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ==========================================
// 9. BIND EVENT LISTENERS & KHỞI CHẠY
// ==========================================
function setupEventListeners() {
  // Nút camera
  DOM.btnStartCamera.addEventListener('click', startWebcam);
  DOM.btnStopCamera.addEventListener('click', stopWebcam);

  // Nút test phản xạ âm thanh
  DOM.btnTestLevel1.addEventListener('click', testLevel1Alert);
  DOM.btnTestLevel2.addEventListener('click', testLevel2Alert);

  // Nút logs
  DOM.btnRefreshLogs.addEventListener('click', () => {
    loadAlertLogs();
    showToast('Đã làm mới dữ liệu nhật ký', 'info');
  });
  DOM.btnClearLogs.addEventListener('click', clearAllLogs);

  // Tương tác bất kỳ mở khóa AudioContext
  document.body.addEventListener('click', () => {
    initAudio();
  }, { once: true });
}

// Khi trang load xong
window.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  loadAIModel();
  loadAlertLogs();
});

