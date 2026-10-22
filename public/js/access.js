(() => {
  'use strict';
  const byId = (id) => document.getElementById(id);
  const t = (key) => window.tourT
    ? window.tourT(key)
    : window.TOUR_TRANSLATIONS?.vi?.[key] ?? key;
  const storageKey = 'tourist-access-token';
  const listeners = new Set();
  let token = null;
  let deadline = 0;
  let timer = null;
  let busy = false;
  let disposed = false;
  let controller = null;
  let requestStartedAt = 0;
  let messageKey = 'accessHelp';
  let ticketMinutes = null;
  let ticketExpiry = null;
  let cameraMessageKey = 'qrPointCamera';
  let accessState = 'initial';

  function message(text, tone = 'neutral') {
    messageKey = Object.keys(window.TOUR_TRANSLATIONS?.vi || {}).find((key) => t(key) === text) || null;
    byId('access-message').textContent = text;
    byId('access-message').dataset.tone = tone;
  }

  function active() { return !!token && performance.now() < deadline && !disposed; }
  function notify() {
    byId('toggle-tour').disabled = !active();
    for (const listener of listeners) listener(active());
  }

  function lose(text = t('sessionExpired')) {
    accessState = 'lost';
    token = null;
    deadline = 0;
    ticketMinutes = null;
    ticketExpiry = null;
    clearTimeout(timer);
    timer = null;
    try { sessionStorage.removeItem(storageKey); } catch { /* Storage may be blocked. */ }
    byId('access-status').textContent = t('noValidSession');
    byId('access-countdown').textContent = '00:00';
    byId('access-expiry').textContent = '—';
    message(text, 'error');
    notify();
  }

  function tick() {
    clearTimeout(timer);
    if (!active()) { lose(); return; }
    const seconds = Math.ceil((deadline - performance.now()) / 1000);
    byId('access-countdown').textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
    timer = setTimeout(tick, Math.min(1000, deadline - performance.now()));
  }

  function accept(data, accessToken) {
    const serverRemaining = Date.parse(data?.expiresAt) - Date.parse(data?.serverTime);
    const remaining = serverRemaining - Math.max(0, performance.now() - requestStartedAt);
    if (!/^[a-f0-9]{64}$/.test(accessToken || '') || ![15, 60, 120].includes(data?.durationMinutes)
      || !Number.isFinite(remaining) || remaining <= 0 || serverRemaining > data.durationMinutes * 60000) {
      throw new Error(t('invalidSessionResponse'));
    }
    token = accessToken;
    accessState = 'active';
    // Countdown uses server time + monotonic elapsed time, not the wall clock.
    // Backend still checks its own expiry on every protected request.
    deadline = performance.now() + remaining;
    ticketMinutes = data.durationMinutes;
    ticketExpiry = data.expiresAt;
    try { sessionStorage.setItem(storageKey, token); } catch { /* Memory-only fallback. */ }
    byId('access-status').textContent =  t('ticketActivatedStatus').replace('{minutes}', data.durationMinutes);
    byId('access-expiry').textContent = new Date(data.expiresAt).toLocaleString(byId('language')?.value || 'vi');
    message(t('ticketActivated'), 'success');
    tick();
    notify();
  }

  async function request(url, options) {
    // Subtract the full round trip conservatively: a slow response must never
    // extend local playback beyond the duration supplied by the server.
    requestStartedAt = performance.now();
    controller = new AbortController();
    const current = controller;
    const timeout = setTimeout(() => current.abort(), 10000);
    try {
      const response = await fetch(url, { ...options, signal: current.signal, cache: 'no-store' });
      if (!response.ok) {
        if (response.status === 409) throw new Error(t('ticketUsed'));
        if (response.status === 400) throw new Error(t('invalidTicket'));
        if (response.status === 429) throw new Error(t('tooManyAttempts'));
        if (response.status === 401) throw new Error(t('sessionInvalid'));
        throw new Error(t('requestFailed'));      }
      try { return await response.json(); } catch { throw new Error(t('invalidSessionResponse')); }
    } catch (error) {
      if (error.name === 'AbortError' || error instanceof TypeError) {
        throw new Error(t('connectionError'));
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      if (controller === current) controller = null;
    }
  }

  async function redeem(event) {
    event.preventDefault();
    if (busy || disposed) return;
    let code = byId('voucher-code').value.trim();
    try {
      const url = new URL(code);
      if (['http:', 'https:'].includes(url.protocol)) code = url.searchParams.get('voucher') || '';
    } catch { /* A raw code is accepted below. */ }
    if (!/^(?:[a-f0-9]{64}|[A-Za-z0-9]{7})$/.test(code)) { message(t('invalidTicket'), 'error'); return; }
    busy = true;
    byId('activate-voucher').disabled = true;
    message(t('activatingTicket'));
    try {
      const data = await request('/api/access/redeem', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ code }),
      });
      if (disposed) return;
      // Switching tickets also cancels playback/requests from the old session.
      if (token) lose(t('switchingTicket'));
      accept(data, data.accessToken);
      byId('voucher-code').value = '';
      const url = new URL(window.location.href);
      url.searchParams.delete('voucher');
      window.history.replaceState(null, '', url.pathname + url.search + url.hash);
    } catch (error) { if (!disposed) message(error.message, 'error'); }
    finally { busy = false; byId('activate-voucher').disabled = false; }
  }

  async function checkSession(savedToken = token) {
    if (!savedToken || busy || disposed) return;
    busy = true;
    byId('activate-voucher').disabled = true;
    try {
      const data = await request('/api/access/session', { headers: { Authorization: `Bearer ${savedToken}`, Accept: 'application/json' } });
      if (!disposed) accept(data, savedToken);
    } catch (error) { if (!disposed) lose(error.message); }
    finally { busy = false; byId('activate-voucher').disabled = false; }
  }

  window.TOUR_ACCESS = {
    active,
    headers: () => active() ? { Authorization: `Bearer ${token}` } : {},
    lose,
    refreshLanguage: () => {
      byId('access-status').textContent = active()
        ? t('ticketActivatedStatus').replace('{minutes}', ticketMinutes)
        : t(accessState === 'initial' ? 'accessStatus' : 'noValidSession');
      if (ticketExpiry) byId('access-expiry').textContent = new Date(ticketExpiry).toLocaleString(byId('language').value);
      if (messageKey) byId('access-message').textContent = t(messageKey);
      if (!qrCameraPanel.hidden) qrCameraMessage.textContent = t(cameraMessageKey);
    },
    subscribe: (listener) => { listeners.add(listener); listener(active()); },
  };
    // Chức năng đọc QR: chỉ điền mã, không tự kích hoạt vé.
  const qrCameraButton = byId('start-qr-camera');
  const qrCameraPanel = byId('qr-camera-panel');
  const qrVideo = byId('qr-video');
  const qrCameraMessage = byId('qr-camera-message');
  const qrImageInput = byId('qr-image');
  const stopQrButton = byId('stop-qr-camera');

  let qrStream = null;
  let qrFrame = null;
  let qrBusy = false;

  function cameraMessage(key) {
    cameraMessageKey = key;
    qrCameraMessage.textContent = t(key);
  }

  function stopQrCamera() {
    if (qrFrame !== null) {
      cancelAnimationFrame(qrFrame);
    }
    qrFrame = null;

    if (qrStream) {
      qrStream.getTracks().forEach((track) => track.stop());
      qrStream = null;
    }

    qrVideo.pause();
    qrVideo.srcObject = null;
    qrCameraPanel.hidden = true;
    qrCameraButton.disabled = false;
  }

  function fillVoucherFromQr(value) {
    let code = value.trim();

    // Nếu QR chứa liên kết có ?voucher=..., lấy mã voucher từ liên kết.
    try {
      const url = new URL(code);
      const voucher = url.searchParams.get('voucher');
      if (voucher) code = voucher.trim();
    } catch {
      // Nếu không phải liên kết thì coi nội dung QR là mã trực tiếp.
    }

    if (!/^[a-f0-9]{64}$/i.test(code)) {
      message(t('qrInvalid'), 'error');
      return false;
    }

    byId('voucher-code').value = code;
    message(t('qrReadSuccess'), 'success');
    stopQrCamera();
    return true;
  }

  function decodeQrImage(imageData) {
    if (typeof window.jsQR !== 'function') {
      message(
        t('qrLibraryError'),
        'error'
      );
      return null;
    }

    const result = window.jsQR(
      imageData.data,
      imageData.width,
      imageData.height,
      { inversionAttempts: 'attemptBoth' }
    );

    return result?.data || null;
  }

  function scanQrFrame() {
    if (!qrStream || qrCameraPanel.hidden) return;

    if (
      qrVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
      !qrBusy
    ) {
      qrBusy = true;

      try {
        const canvas = document.createElement('canvas');
        canvas.width = qrVideo.videoWidth;
        canvas.height = qrVideo.videoHeight;

        const context = canvas.getContext('2d', {
          willReadFrequently: true,
        });

        context.drawImage(
          qrVideo,
          0,
          0,
          canvas.width,
          canvas.height
        );

        const value = decodeQrImage(
          context.getImageData(0, 0, canvas.width, canvas.height)
        );

        if (value) {
          const valid = fillVoucherFromQr(value);

          if (!valid) {
            cameraMessage('qrInvalidFrame');
          }

          if (qrStream) {
            qrFrame = requestAnimationFrame(scanQrFrame);
          }
          return;
        }
      } catch {
        cameraMessage('qrImageError');
      } finally {
        qrBusy = false;
      }
    }

    if (qrStream) {
      qrFrame = requestAnimationFrame(scanQrFrame);
    }
  }

  qrCameraButton.addEventListener('click', async () => {
    if (qrStream) return;

    if (!navigator.mediaDevices?.getUserMedia) {
      message(
        t('cameraUnavailable'),
        'error'
      );
      return;
    }

    if (typeof window.jsQR !== 'function') {
      message(
        t('qrLibraryError'),
        'error'
      );
      return;
    }

    try {
      qrCameraButton.disabled = true;
      qrCameraPanel.hidden = false;
      cameraMessage('cameraOpening');

      qrStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });

      qrVideo.srcObject = qrStream;
      await qrVideo.play();

      cameraMessage('qrPointCamera');
      scanQrFrame();
    } catch {
      stopQrCamera();
      message(
        t('cameraError'),
        'error'
      );
    }
  });

  stopQrButton.addEventListener('click', stopQrCamera);

  qrImageInput.addEventListener('change', async () => {
    const file = qrImageInput.files?.[0];
    if (!file) return;

    try {
      if (typeof window.jsQR !== 'function') {
        throw new Error(
          t('qrLibraryError')
        );
      }

      if (!file.type.startsWith('image/')) {
        throw new Error(t('selectImage'));
      }

      const image = await createImageBitmap(file);

      try {
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;

        const context = canvas.getContext('2d', {
          willReadFrequently: true,
        });

        context.drawImage(image, 0, 0);

        const value = decodeQrImage(
          context.getImageData(0, 0, canvas.width, canvas.height)
        );

        if (!value) {
          throw new Error(
            t('qrNotFound')
          );
        }

        fillVoucherFromQr(value);
      } finally {
        image.close();
      }
    } catch (error) {
      message(error.message || t('qrImageReadError'), 'error');
    } finally {
      qrImageInput.value = '';
    }
  });

  window.addEventListener('pagehide', stopQrCamera);
  byId('access-form').addEventListener('submit', redeem);
  byId('toggle-tour').disabled = true;
  const code = new URL(window.location.href).searchParams.get('voucher');
  if (code) {
    byId('voucher-code').value = code;
    message(t('qrReceived'));
  }
  let savedToken;
  try { savedToken = sessionStorage.getItem(storageKey); } catch { /* Start inactive. */ }
  if (savedToken) checkSession(savedToken);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && token) checkSession(); });
  window.addEventListener('pagehide', () => {
    disposed = true;
    clearTimeout(timer);
    if (controller) controller.abort();
  });
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) { disposed = false; if (token) checkSession(); }
  });
})();
