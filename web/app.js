/**
 * LED Matrix Controller — app.js
 * 8×8 multi-frame editor — per-pixel RGB color format
 * POST /update  { scroll_speed, padding, sentence: [ [[R,G,B]×64], … ] }
 */

(() => {
  // ─── State ───────────────────────────────────────────────────────────
  const ROWS = 8, COLS = 8;

  /**
   * frames: number[][][]
   * frames[f][i] = [R, G, B]   (i = 0‥63)
   */
  let frames = [emptyFrame()];
  let currentFrame = 0;

  let paintMode = null; // 'on' | 'off'  while mouse/touch held

  // ─── DOM refs ────────────────────────────────────────────────────────
  const grid          = document.getElementById('led-grid');
  const frameCur      = document.getElementById('frame-cur');
  const frameTotal    = document.getElementById('frame-total');
  const btnPrev       = document.getElementById('btn-prev');
  const btnNext       = document.getElementById('btn-next');
  const btnReset      = document.getElementById('btn-reset');
  const btnAdd        = document.getElementById('btn-add');
  const btnDelete     = document.getElementById('btn-delete');
  const btnSend       = document.getElementById('btn-send');
  const btnSave       = document.getElementById('btn-save');
  const btnLoad       = document.getElementById('btn-load');
  const fileInput     = document.getElementById('file-input');
  const colorPicker   = document.getElementById('color-picker');
  const colorHex      = document.getElementById('color-hex');
  const scrollSpeed   = document.getElementById('scroll-speed');
  const speedDisplay  = document.getElementById('speed-display');
  const paddingInput  = document.getElementById('padding-input');
  const paddingDisplay= document.getElementById('padding-display');
  const previewCanvas = document.getElementById('preview-canvas');
  const statusDot     = document.getElementById('status-dot');
  const statusMsg     = document.getElementById('status-msg');
  const raspiIp       = document.getElementById('raspi-ip');
  const ctx           = previewCanvas.getContext('2d');

  // ─── Helpers ─────────────────────────────────────────────────────────
  /** 64셀 모두 [0,0,0] 인 빈 프레임 */
  function emptyFrame() {
    return Array.from({ length: ROWS * COLS }, () => [0, 0, 0]);
  }

  /** "#RRGGBB" → [R, G, B] */
  function hexToRgb(hex) {
    return [
      parseInt(hex.slice(1, 3), 16),
      parseInt(hex.slice(3, 5), 16),
      parseInt(hex.slice(5, 7), 16),
    ];
  }

  /** [R,G,B] → "#RRGGBB" */
  function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
  }

  /** 픽셀이 켜진 상태인지 (모두 0이면 꺼짐) */
  function isPixelOn([r, g, b]) {
    return r > 0 || g > 0 || b > 0;
  }

  function setStatus(msg, state /* 'ok'|'err'|'' */) {
    statusMsg.textContent = msg;
    statusDot.className = 'status-dot' + (state ? ' ' + state : '');
  }

  // ─── Grid build ──────────────────────────────────────────────────────
  function buildGrid() {
    grid.innerHTML = '';
    for (let i = 0; i < ROWS * COLS; i++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.idx = i;
      grid.appendChild(cell);
    }
    attachGridEvents();
  }

  // ─── Grid render ─────────────────────────────────────────────────────
  function renderGrid() {
    const cells = grid.querySelectorAll('.cell');
    const frame = frames[currentFrame];

    cells.forEach((cell, i) => {
      const px = frame[i];
      const on = isPixelOn(px);
      cell.classList.toggle('on', on);
      if (on) {
        const [r, g, b] = px;
        cell.style.background = `rgb(${r},${g},${b})`;
        cell.style.boxShadow  = `0 0 6px rgb(${r},${g},${b})`;
      } else {
        cell.style.background = '';
        cell.style.boxShadow  = '';
      }
    });

    frameCur.textContent   = currentFrame + 1;
    frameTotal.textContent = frames.length;
    btnPrev.disabled = currentFrame === 0;
    btnNext.disabled = currentFrame === frames.length - 1;

    renderPreview();
  }

  // ─── Preview canvas ──────────────────────────────────────────────────
  function renderPreview() {
    const W     = previewCanvas.width;
    const H     = previewCanvas.height;
    const cellW = W / COLS;
    const cellH = H / ROWS;
    const frame = frames[currentFrame];

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#ebebeb';
    ctx.fillRect(0, 0, W, H);

    frame.forEach((px, i) => {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const x = col * cellW;
      const y = row * cellH;

      if (isPixelOn(px)) {
        const [r, g, b] = px;
        ctx.fillStyle   = `rgb(${r},${g},${b})`;
        ctx.shadowColor = `rgb(${r},${g},${b})`;
        ctx.shadowBlur  = 6;
        ctx.fillRect(x + 1, y + 1, cellW - 2, cellH - 2);
        ctx.shadowBlur  = 0;
      } else {
        ctx.fillStyle = '#d8d8d8';
        ctx.fillRect(x + 1, y + 1, cellW - 2, cellH - 2);
      }
    });
  }

  // ─── Cell paint ──────────────────────────────────────────────────────
  function attachGridEvents() {
    grid.addEventListener('mousedown', (e) => {
      const cell = e.target.closest('.cell');
      if (!cell) return;
      e.preventDefault();
      const idx = Number(cell.dataset.idx);
      paintMode = isPixelOn(frames[currentFrame][idx]) ? 'off' : 'on';
      setCellValue(idx, paintMode);
    });

    grid.addEventListener('mouseover', (e) => {
      if (paintMode === null) return;
      const cell = e.target.closest('.cell');
      if (!cell) return;
      setCellValue(Number(cell.dataset.idx), paintMode);
    });
  }

  document.addEventListener('mouseup', () => { paintMode = null; });

  // 터치 지원
  grid.addEventListener('touchstart', (e) => {
    const t    = e.touches[0];
    const cell = document.elementFromPoint(t.clientX, t.clientY)?.closest('.cell');
    if (!cell) return;
    e.preventDefault();
    const idx = Number(cell.dataset.idx);
    paintMode = isPixelOn(frames[currentFrame][idx]) ? 'off' : 'on';
    setCellValue(idx, paintMode);
  }, { passive: false });

  grid.addEventListener('touchmove', (e) => {
    const t    = e.touches[0];
    const cell = document.elementFromPoint(t.clientX, t.clientY)?.closest('.cell');
    if (!cell || paintMode === null) return;
    e.preventDefault();
    setCellValue(Number(cell.dataset.idx), paintMode);
  }, { passive: false });

  document.addEventListener('touchend', () => { paintMode = null; });

  function setCellValue(idx, mode) {
    frames[currentFrame][idx] = mode === 'on'
      ? hexToRgb(colorPicker.value)
      : [0, 0, 0];
    renderGrid();
  }

  // ─── Navigation ──────────────────────────────────────────────────────
  btnPrev.addEventListener('click', () => {
    if (currentFrame > 0) { currentFrame--; renderGrid(); }
  });

  btnNext.addEventListener('click', () => {
    if (currentFrame < frames.length - 1) { currentFrame++; renderGrid(); }
  });

  // ─── Frame management ────────────────────────────────────────────────
  btnAdd.addEventListener('click', () => {
    frames.splice(currentFrame + 1, 0, emptyFrame());
    currentFrame++;
    renderGrid();
    setStatus(`프레임 추가됨 (${frames.length}개)`, '');
  });

  btnDelete.addEventListener('click', () => {
    if (frames.length === 1) {
      setStatus('최소 1개의 프레임이 필요합니다.', 'err');
      return;
    }
    frames.splice(currentFrame, 1);
    if (currentFrame >= frames.length) currentFrame = frames.length - 1;
    renderGrid();
    setStatus(`프레임 삭제됨 (${frames.length}개)`, '');
  });

  btnReset.addEventListener('click', () => {
    frames[currentFrame] = emptyFrame();
    renderGrid();
    setStatus('현재 프레임 초기화', '');
  });

  // ─── Brush Color ─────────────────────────────────────────────────────
  colorPicker.addEventListener('input', () => {
    colorHex.value = colorPicker.value.toUpperCase();
  });

  colorHex.addEventListener('change', () => {
    const v = colorHex.value.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(v)) {
      colorPicker.value = v;
      colorHex.value    = v.toUpperCase();
    } else {
      colorHex.value = colorPicker.value.toUpperCase();
    }
  });

  // ─── Scroll Speed ────────────────────────────────────────────────────
  scrollSpeed.addEventListener('input', () => {
    speedDisplay.textContent = parseFloat(scrollSpeed.value).toFixed(2);
  });

  // ─── Padding ─────────────────────────────────────────────────────────
  paddingInput.addEventListener('input', () => {
    paddingDisplay.textContent = paddingInput.value;
  });

  // ─── Build payload ───────────────────────────────────────────────────
  function buildPayload() {
    return {
      scroll_speed: parseFloat(scrollSpeed.value),
      padding:      parseInt(paddingInput.value, 10),
      sentence:     frames.map(frame => frame.map(px => [...px]))
    };
  }

  // ─── SAVE ────────────────────────────────────────────────────────────
  btnSave.addEventListener('click', () => {
    const json = JSON.stringify(buildPayload(), null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);

    const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const a  = document.createElement('a');
    a.href     = url;
    a.download = `led-matrix-${ts}.json`;
    a.click();
    URL.revokeObjectURL(url);

    setStatus(`저장 완료 — led-matrix-${ts}.json (${frames.length}개 프레임)`, 'ok');
  });

  // ─── LOAD ────────────────────────────────────────────────────────────
  btnLoad.addEventListener('click', () => {
    fileInput.value = '';
    fileInput.click();
  });

  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);

        // ── 유효성 검사 ──
        if (!Array.isArray(data.sentence) || data.sentence.length === 0)
          throw new Error('"sentence" 배열이 없거나 비어 있습니다.');

        data.sentence.forEach((frame, fi) => {
          if (!Array.isArray(frame) || frame.length !== ROWS * COLS)
            throw new Error(`프레임 ${fi + 1}: 셀 수가 ${ROWS * COLS}이어야 합니다.`);
          frame.forEach((px, pi) => {
            if (!Array.isArray(px) || px.length !== 3 ||
                px.some(v => typeof v !== 'number' || v < 0 || v > 255))
              throw new Error(`프레임 ${fi + 1}, 픽셀 ${pi}: [R,G,B] 형식이어야 합니다.`);
          });
        });

        // ── 상태 복원 ──
        frames       = data.sentence.map(frame => frame.map(px => [...px]));
        currentFrame = 0;

        // 스크롤 속도 복원
        if (typeof data.scroll_speed === 'number') {
          const c = Math.min(0.30, Math.max(0.01, data.scroll_speed));
          scrollSpeed.value        = c;
          speedDisplay.textContent = c.toFixed(2);
        }

        // 패딩 복원
        if (typeof data.padding === 'number') {
          const c = Math.min(8, Math.max(0, Math.round(data.padding)));
          paddingInput.value         = c;
          paddingDisplay.textContent = c;
        }

        renderGrid();
        setStatus(`로드 완료 — ${file.name} (${frames.length}개 프레임)`, 'ok');

      } catch (err) {
        setStatus(`JSON 파싱 실패: ${err.message}`, 'err');
      }
    };
    reader.readAsText(file);
  });

  // ─── SEND ────────────────────────────────────────────────────────────
  btnSend.addEventListener('click', async () => {
    const ip = raspiIp.value.trim();
    if (!ip) {
      setStatus('라즈베리파이 IP를 입력해주세요.', 'err');
      return;
    }

    const url = `http://${ip}:5000/update`;
    btnSend.classList.add('loading');
    btnSend.textContent = 'SENDING...';
    setStatus(`${url} 로 전송 중…`, '');

    try {
      const res = await fetch(url, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(buildPayload()),
      });

      if (res.ok) {
        const text = await res.text();
        setStatus(`전송 성공 (${res.status}) — ${text.slice(0, 80)}`, 'ok');
      } else {
        setStatus(`서버 오류: HTTP ${res.status}`, 'err');
      }
    } catch (err) {
      setStatus(`연결 실패: ${err.message}`, 'err');
    } finally {
      btnSend.classList.remove('loading');
      btnSend.textContent = 'SEND';
    }
  });

  // ─── Init ────────────────────────────────────────────────────────────
  buildGrid();
  renderGrid();
  setStatus('브러시 색상을 선택하고 셀을 클릭/드래그해 그린 후 SEND를 눌러주세요.', '');

})();
