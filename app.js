// ═══════════════════════════════════════════════════════════════
    // CONSTANTS
    // ═══════════════════════════════════════════════════════════════
    const STRINGS = [
      { label: '6ª', note: 'E2', freq: 82.41  },
      { label: '5ª', note: 'A2', freq: 110.00 },
      { label: '4ª', note: 'D3', freq: 146.83 },
      { label: '3ª', note: 'G3', freq: 196.00 },
      { label: '2ª', note: 'B3', freq: 246.94 },
      { label: '1ª', note: 'E4', freq: 329.63 },
    ];
    const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
    const A4 = 440;
    const IN_TUNE_THRESHOLD = 5;   // cents
    const RMS_THRESHOLD     = 0.002; // muito mais sensível (era 0.01)
    const SMOOTHING         = 0.7;  // suavização temporal da frequência
    const SILENCE_TIMEOUT   = 600;  // ms sem sinal antes de limpar display

    // ═══════════════════════════════════════════════════════════════
    // STATE
    // ═══════════════════════════════════════════════════════════════
    let audioCtx = null, analyser = null, gainNode = null, source = null;
    let rafId = null, isListening = false;
    let activeStringIndex = -1;
    let refOscillator = null, playingRefIndex = -1;
    let smoothedFreq = null;           // frequência suavizada entre frames
    let silenceTimer  = null;          // timer para limpar display
    let lastDetected  = 0;             // timestamp da última detecção

    // ═══════════════════════════════════════════════════════════════
    // DOM
    // ═══════════════════════════════════════════════════════════════
    const noteName    = document.getElementById('note-name');
    const freqVal     = document.getElementById('freq-val');
    const centsVal    = document.getElementById('cents-val');
    const meterFill   = document.getElementById('meter-fill');
    const meterNeedle = document.getElementById('meter-needle');
    const statusBadge = document.getElementById('status-badge');
    const micBtn      = document.getElementById('mic-btn');
    const stringsGrid = document.getElementById('strings-grid');
    const refButtons  = document.getElementById('ref-buttons');
    const canvas      = document.getElementById('visualizer');
    const ctx2d       = canvas.getContext('2d');

    // ═══════════════════════════════════════════════════════════════
    // BUILD UI
    // ═══════════════════════════════════════════════════════════════
    STRINGS.forEach((s, i) => {
      const btn = document.createElement('button');
      btn.className = 'string-btn';
      btn.innerHTML = `
        <div class="string-num">${s.label}</div>
        <div class="string-note">${s.note.replace(/\d/,'')}</div>
        <div class="string-hz">${s.freq.toFixed(1)}Hz</div>
        <div class="string-indicator"></div>`;
      btn.addEventListener('click', () => selectString(i));
      stringsGrid.appendChild(btn);
    });

    STRINGS.forEach((s, i) => {
      const btn = document.createElement('button');
      btn.className = 'ref-btn';
      btn.innerHTML = `${s.note.replace(/\d/,'')}<span>${s.freq.toFixed(1)}Hz</span>`;
      btn.addEventListener('click', () => playReference(i));
      refButtons.appendChild(btn);
    });

    function selectString(i) {
      activeStringIndex = i;
      document.querySelectorAll('.string-btn').forEach((b, j) => {
        b.classList.toggle('active', j === i);
        if (j !== i) b.classList.remove('in-tune');
      });
    }

    // ═══════════════════════════════════════════════════════════════
    // AUDIO INIT — com pré-amplificador e filtro passa-alta
    // ═══════════════════════════════════════════════════════════════
    async function startListening() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: false,   // desliga pra não distorcer o sinal
            noiseSuppression: false,
            autoGainControl: false,
            sampleRate: 44100,
          }
        });

        audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 44100 });

        // Pré-amplificador: aumenta o ganho do sinal bruto do microfone
        gainNode = audioCtx.createGain();
        gainNode.gain.value = 6.0; // amplifica 6x antes do analyser

        // Filtro passa-alta: remove ruído DC e subsônicos abaixo de 60 Hz
        const hpFilter = audioCtx.createBiquadFilter();
        hpFilter.type = 'highpass';
        hpFilter.frequency.value = 60;
        hpFilter.Q.value = 0.5;

        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 8192;           // boa resolução de frequência
        analyser.smoothingTimeConstant = 0.6; // algum smoothing interno

        source = audioCtx.createMediaStreamSource(stream);
        source.connect(hpFilter);
        hpFilter.connect(gainNode);
        gainNode.connect(analyser);
        // NÃO conectamos ao destination — sem feedback pelo alto-falante

        isListening = true;
        smoothedFreq = null;
        micBtn.classList.add('active');
        setStatus('listening', 'Ouvindo...');
        loop();
      } catch(e) {
        setStatus('idle', 'Acesso negado');
        alert('Permita o acesso ao microfone para usar o afinador.');
      }
    }

    function stopListening() {
      if (rafId) cancelAnimationFrame(rafId);
      if (source) { try { source.mediaStream.getTracks().forEach(t => t.stop()); } catch(e){} }
      if (audioCtx) audioCtx.close();
      audioCtx = analyser = gainNode = source = null;
      isListening = false;
      smoothedFreq = null;
      micBtn.classList.remove('active');
      setStatus('idle', 'Aguardando');
      resetDisplay();
    }

    micBtn.addEventListener('click', () => isListening ? stopListening() : startListening());

    // ═══════════════════════════════════════════════════════════════
    // ALGORITMO YIN — detecção de pitch com normalização CMNDF
    // Muito mais robusto que autocorrelação simples para cordas
    // ═══════════════════════════════════════════════════════════════
    function detectPitchYIN(buffer, sampleRate) {
      const W = Math.floor(buffer.length / 2);

      // 1. Função de diferença
      const diff = new Float32Array(W);
      for (let tau = 1; tau < W; tau++) {
        let s = 0;
        for (let i = 0; i < W; i++) {
          const d = buffer[i] - buffer[i + tau];
          s += d * d;
        }
        diff[tau] = s;
      }

      // 2. CMNDF — Cumulative Mean Normalized Difference Function
      const cmndf = new Float32Array(W);
      cmndf[0] = 1;
      let runningSum = 0;
      for (let tau = 1; tau < W; tau++) {
        runningSum += diff[tau];
        cmndf[tau] = runningSum === 0 ? 0 : diff[tau] * tau / runningSum;
      }

      // 3. Encontra o primeiro mínimo abaixo do threshold
      const threshold = 0.15; // quanto menor, mais exigente
      let tau = 2;
      while (tau < W) {
        if (cmndf[tau] < threshold) {
          // caminha até o mínimo local
          while (tau + 1 < W && cmndf[tau + 1] < cmndf[tau]) tau++;
          break;
        }
        tau++;
      }

      if (tau === W) {
        // Nenhum mínimo claro — pega o mínimo global como fallback
        let minVal = Infinity, minIdx = -1;
        for (let t = 2; t < W; t++) {
          if (cmndf[t] < minVal) { minVal = cmndf[t]; minIdx = t; }
        }
        if (minVal > 0.4) return null; // sinal muito ruidoso
        tau = minIdx;
      }

      if (tau < 2) return null;

      // 4. Interpolação parabólica para sub-sample accuracy
      const s0 = cmndf[tau - 1];
      const s1 = cmndf[tau];
      const s2 = tau + 1 < W ? cmndf[tau + 1] : s1;
      const refinedTau = tau + (s2 - s0) / (2 * (2 * s1 - s0 - s2));

      return sampleRate / refinedTau;
    }

    // ═══════════════════════════════════════════════════════════════
    // HELPERS
    // ═══════════════════════════════════════════════════════════════
    function freqToNote(freq) {
      const semitones = 12 * Math.log2(freq / A4);
      const midi      = Math.round(semitones) + 69;
      const cents     = Math.round((semitones - Math.round(semitones)) * 100);
      const name      = NOTE_NAMES[((midi % 12) + 12) % 12];
      const octave    = Math.floor(midi / 12) - 1;
      return { name, octave, cents, midi };
    }

    function closestString(freq) {
      let best = 0, bestDiff = Infinity;
      STRINGS.forEach((s, i) => {
        const diff = Math.abs(1200 * Math.log2(freq / s.freq));
        if (diff < bestDiff) { bestDiff = diff; best = i; }
      });
      return best;
    }

    function calcRMS(buffer) {
      let sum = 0;
      for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i];
      return Math.sqrt(sum / buffer.length);
    }

    // ═══════════════════════════════════════════════════════════════
    // MAIN LOOP
    // ═══════════════════════════════════════════════════════════════
    function loop() {
      rafId = requestAnimationFrame(loop);

      const bufLen = analyser.fftSize;
      const buffer = new Float32Array(bufLen);
      analyser.getFloatTimeDomainData(buffer);

      const rms = calcRMS(buffer);
      drawWaveform(buffer, rms);

      // Sinal muito fraco — aguarda
      if (rms < RMS_THRESHOLD) {
        const now = performance.now();
        if (now - lastDetected > SILENCE_TIMEOUT) {
          setStatus('listening', 'Ouvindo...');
          resetDisplay(false);
        }
        return;
      }

      // Detecta pitch com YIN
      const rawFreq = detectPitchYIN(buffer, audioCtx.sampleRate);

      // Faixa válida para violão: E2 (82 Hz) a E4+margem (380 Hz)
      if (!rawFreq || rawFreq < 70 || rawFreq > 400) return;

      lastDetected = performance.now();

      // Suavização exponencial — elimina saltos bruscos
      if (smoothedFreq === null) {
        smoothedFreq = rawFreq;
      } else {
        // Se a nota mudou muito (>150 cents), reseta instantâneo
        const jump = Math.abs(1200 * Math.log2(rawFreq / smoothedFreq));
        smoothedFreq = jump > 150
          ? rawFreq
          : SMOOTHING * smoothedFreq + (1 - SMOOTHING) * rawFreq;
      }

      const note    = freqToNote(smoothedFreq);
      const strIdx  = closestString(smoothedFreq);
      const target  = STRINGS[strIdx].freq;
      const centsOff = Math.round(1200 * Math.log2(smoothedFreq / target));

      updateDisplay(note, smoothedFreq, centsOff, strIdx);
    }

    // ═══════════════════════════════════════════════════════════════
    // DISPLAY
    // ═══════════════════════════════════════════════════════════════
    function updateDisplay(note, freq, cents, strIdx) {
      const inTune = Math.abs(cents) <= IN_TUNE_THRESHOLD;
      const sharp  = cents > IN_TUNE_THRESHOLD;
      const cls    = inTune ? 'in-tune' : sharp ? 'sharp' : 'flat';

      noteName.textContent  = note.name + note.octave;
      noteName.className    = 'note-name ' + cls;
      freqVal.textContent   = freq.toFixed(1);
      centsVal.textContent  = (cents >= 0 ? '+' : '') + cents + ' ¢';
      centsVal.className    = 'cents-value ' + cls;
      meterNeedle.className = 'meter-needle ' + cls;

      const clamped = Math.max(-50, Math.min(50, cents));
      const pct = (clamped + 50) / 100;
      meterNeedle.style.left = (pct * 100) + '%';

      if (inTune) {
        meterFill.style.left = '48%'; meterFill.style.width = '4%';
        meterFill.style.background = 'var(--green)';
      } else if (sharp) {
        meterFill.style.left = '50%';
        meterFill.style.width = ((pct - 0.5) * 100) + '%';
        meterFill.style.background = 'var(--red)';
      } else {
        meterFill.style.left  = (pct * 100) + '%';
        meterFill.style.width = ((0.5 - pct) * 100) + '%';
        meterFill.style.background = 'var(--yellow)';
      }

      if (inTune) setStatus('in-tune', 'Afinado ✓');
      else if (sharp) setStatus('sharp', 'Sustenido ↑');
      else setStatus('flat', 'Bemol ↓');

      selectString(strIdx);
      document.querySelectorAll('.string-btn')[strIdx].classList.toggle('in-tune', inTune);
    }

    function resetDisplay(full = true) {
      if (full) {
        noteName.textContent = '—'; noteName.className = 'note-name';
        freqVal.textContent  = '—';
      }
      centsVal.textContent = '— ¢'; centsVal.className = 'cents-value';
      meterNeedle.style.left = '50%'; meterNeedle.className = 'meter-needle';
      meterFill.style.width = '0%';
    }

    function setStatus(type, text) {
      statusBadge.className = 'status-badge ' + type;
      statusBadge.textContent = text;
    }

    // ═══════════════════════════════════════════════════════════════
    // WAVEFORM — colorida pelo nível de RMS
    // ═══════════════════════════════════════════════════════════════
    function drawWaveform(buffer, rms) {
      const cw = canvas.width;
      const ch = canvas.height;
      if (cw === 0 || ch === 0) return;
      ctx2d.clearRect(0, 0, cw, ch);

      const intensity = Math.min(1, rms / 0.05);
      const alpha = 0.15 + intensity * 0.85;

      const grad = ctx2d.createLinearGradient(0, 0, cw, 0);
      grad.addColorStop(0,   `rgba(200,169,110,0)`);
      grad.addColorStop(0.2, `rgba(200,169,110,${alpha * 0.6})`);
      grad.addColorStop(0.5, `rgba(200,169,110,${alpha})`);
      grad.addColorStop(0.8, `rgba(200,169,110,${alpha * 0.6})`);
      grad.addColorStop(1,   `rgba(200,169,110,0)`);

      const step = buffer.length / cw;
      ctx2d.beginPath();
      ctx2d.strokeStyle = grad;
      ctx2d.lineWidth   = 1.5 * devicePixelRatio;
      ctx2d.lineCap     = 'round';

      for (let px = 0; px < cw; px++) {
        const v = buffer[Math.floor(px * step)] || 0;
        const y = ((v * 0.9 + 1) / 2) * ch;
        px === 0 ? ctx2d.moveTo(px, y) : ctx2d.lineTo(px, y);
      }
      ctx2d.stroke();
    }

    function resizeCanvas() {
      const parent = canvas.parentElement;
      canvas.style.width  = '';
      canvas.style.height = '';
      const w = parent.clientWidth;
      const h = parent.clientHeight || 60;
      canvas.width  = Math.round(w * devicePixelRatio);
      canvas.height = Math.round(h * devicePixelRatio);
      canvas.style.width  = w + 'px';
      canvas.style.height = h + 'px';
    }
    requestAnimationFrame(() => requestAnimationFrame(resizeCanvas));
    window.addEventListener('resize', resizeCanvas);

    // ═══════════════════════════════════════════════════════════════
    // TOM DE REFERÊNCIA
    // ═══════════════════════════════════════════════════════════════
    function playReference(i) {
      if (playingRefIndex === i) { stopReference(); return; }
      stopReference();

      const refCtx = new (window.AudioContext || window.webkitAudioContext)();
      refOscillator = refCtx.createOscillator();
      const gain = refCtx.createGain();
      refOscillator.type = 'triangle';
      refOscillator.frequency.value = STRINGS[i].freq;
      gain.gain.setValueAtTime(0, refCtx.currentTime);
      gain.gain.linearRampToValueAtTime(0.35, refCtx.currentTime + 0.05);
      gain.gain.setValueAtTime(0.35, refCtx.currentTime + 2.5);
      gain.gain.linearRampToValueAtTime(0, refCtx.currentTime + 3.0);
      refOscillator.connect(gain);
      gain.connect(refCtx.destination);
      refOscillator.start();
      refOscillator.stop(refCtx.currentTime + 3.1);
      refOscillator.onended = stopReference;

      playingRefIndex = i;
      document.querySelectorAll('.ref-btn').forEach((b, j) => b.classList.toggle('playing', j === i));
      setTimeout(() => { if (playingRefIndex === i) stopReference(); }, 3200);
    }

    function stopReference() {
      if (refOscillator) { try { refOscillator.stop(); } catch(e){} refOscillator = null; }
      playingRefIndex = -1;
      document.querySelectorAll('.ref-btn').forEach(b => b.classList.remove('playing'));
    }

    // ═══════════════════════════════════════════════════════════════
    // PWA INSTALL
    // ═══════════════════════════════════════════════════════════════
    let deferredPrompt = null;
    const installBanner = document.getElementById('install-banner');
    window.addEventListener('beforeinstallprompt', e => {
      e.preventDefault(); deferredPrompt = e; installBanner.style.display = 'block';
    });
    installBanner.addEventListener('click', async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null; installBanner.style.display = 'none';
    });

    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  
    console.log('Afinador de Violão carregado. Permita o acesso ao microfone e toque uma corda para começar a afinar!');
