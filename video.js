// Clario Video Workspace — Veo 3 scaffold with real video generation
import { auth, db, onReady } from '/auth.js';
import { collection, query, where, orderBy, limit, onSnapshot, doc } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';

(function(){
  // Configuration
  // For real Veo 3 integration, set up a server proxy and point PROXY_URL to it.
  // The proxy should expose POST /start to initiate a job and GET /status?id= to poll status,
  // returning { id, status: 'succeeded'|'running'|'failed', videoUrl? }.
  const DEFAULT_PROXY_URL = (function(){
    try { return localStorage.getItem('clario_proxy_url') || ''; } catch(_){ return ''; }
  })();
  const PROXY_URL = DEFAULT_PROXY_URL; // e.g. http://127.0.0.1:5001/YOUR_PROJECT/us-central1/api or your deployed URL
  const USE_PROXY = !!PROXY_URL;

  // DOM
  const refInput = document.getElementById('ref-file');
  const newBtn = document.getElementById('new-btn');
  const exportWebmBtn = document.getElementById('export-webm');
  const exportMp4Btn = document.getElementById('export-mp4');
  // Modern UI controls
  const modeButtons = document.querySelectorAll('.mode-btn');
  const promptSectionEl = document.getElementById('prompt-section');
  const imageSectionEl = document.getElementById('image-section');
  const promptEl = document.getElementById('prompt');
  const sourceImageEl = document.getElementById('source-image');
  const imagePreviewEl = document.getElementById('image-preview');
  const motionPromptEl = document.getElementById('motion-prompt');
  const durationEl = document.getElementById('duration');
  const withAudioEl = document.getElementById('with-audio');
  const aspectEl = document.getElementById('aspect');
  const resolutionEl = document.getElementById('resolution');
  const styleEl = document.getElementById('style');
  const seedEl = document.getElementById('seed');
  const tierEl = document.getElementById('tier');
  const previewBtn = document.getElementById('preview-btn');
  const exportHdBtn = document.getElementById('export-hd-btn');
  const continueBtn = document.getElementById('continue-btn');
  const continueTweakEl = document.getElementById('continue-tweak');
  const continue16Btn = document.getElementById('continue-16-btn');
  const continue24Btn = document.getElementById('continue-24-btn');
  const overlapEl = document.getElementById('overlap');
  const overlapValueEl = document.getElementById('overlap-value');
  const seamModeRadios = () => document.querySelector('input[name="seam-mode"]:checked');
  const generateBtn = document.getElementById('generate-btn'); // Legacy
  const upgradeBtn = document.getElementById('upgrade-btn');
  const preview = document.getElementById('preview');
  const previewB = document.getElementById('preview-b');
  const loading = document.getElementById('loading');
  const progressBar = document.querySelector('#loading .bar');
  const historyGrid = document.getElementById('history');

  // Toast notification function
  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    toast.style.cssText = `
      position: fixed; top: 20px; right: 20px; z-index: 1000;
      padding: 12px 20px; border-radius: 8px; color: white;
      font-family: 'Plus Jakarta Sans', sans-serif; font-size: 14px;
      max-width: 300px; word-wrap: break-word;
      background: ${type === 'error' ? '#dc3545' : type === 'success' ? '#28a745' : type === 'warning' ? '#ffc107' : '#007bff'};
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      transform: translateX(100%); transition: transform 0.3s ease;
    `;
    document.body.appendChild(toast);
    
    // Animate in
    setTimeout(() => toast.style.transform = 'translateX(0)', 10);
    
    // Auto remove after 4 seconds
    setTimeout(() => {
      toast.style.transform = 'translateX(100%)';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  function resolveCurrentCreationId(){
    try{
      const match = history.find(h => h && h.blobUrl === preview.src);
      if (match && match.videoId) return match.videoId;
      if (lastPreviewVideoId && String(lastPreviewVideoId).length > 0 && !String(lastPreviewVideoId).startsWith('veo-')) return lastPreviewVideoId;
      if (history.length) return history[0]?.videoId || null;
      // Do not return temp file ID (veo-*) as it is not a Firestore creation ID
      return null;
    }catch(_){ return lastPreviewVideoId; }
  }

  // Get a fresh ID token, retrying briefly to avoid race after auth state changes
  async function getIdTokenReliable(maxWaitMs = 5000) {
    try {
      if (!auth || !auth.currentUser) return null;
      const start = Date.now();
      while (Date.now() - start < maxWaitMs) {
        try {
          const t = await auth.currentUser.getIdToken(true);
          if (t) return t;
        } catch(_) { /* ignore and retry */ }
        await new Promise(r => setTimeout(r, 250));
      }
      return null;
    } catch(_) {
      return null;
    }
  }

  function getSelectedTier(){
    return tierEl?.value || 'fast';
  }

  // State
  let isGenerating = false;
  let lastPreviewVideoId = null;
  let currentUser = null;
  let sourceImageFile = null;
  let sourceImageDataUrl = null;
  // Firestore history listener unsubscribe handle
  let historyUnsubscribe = null;
  // Legacy reference asset placeholder (kept for compatibility with older UI controls)
  let refAsset = null;
  // Pending job tracking for async flow
  let awaitingAutoLoad = false;
  let pendingTimer = null;
  let pendingPct = 0;

  function getGenerationMode(){
    const active = document.querySelector('.mode-btn.active');
    return active ? active.dataset.mode : 'image-to-video';
  }

  // Handle generation mode switching with modern buttons
  if (modeButtons && modeButtons.length) {
    modeButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        modeButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const mode = btn.dataset.mode;
        if (mode === 'image-to-video') {
          if (promptSectionEl) promptSectionEl.style.display = 'none';
          if (imageSectionEl) imageSectionEl.style.display = 'block';
        } else {
          if (promptSectionEl) promptSectionEl.style.display = 'block';
          if (imageSectionEl) imageSectionEl.style.display = 'none';
        }
      });
    });
    // Initialize sections based on default active button
    (function(){
      const mode = getGenerationMode();
      if (mode === 'image-to-video') {
        if (promptSectionEl) promptSectionEl.style.display = 'none';
        if (imageSectionEl) imageSectionEl.style.display = 'block';
      } else {
        if (promptSectionEl) promptSectionEl.style.display = 'block';
        if (imageSectionEl) imageSectionEl.style.display = 'none';
      }
    })();
  }

  // Handle source image upload
  if (sourceImageEl) {
    sourceImageEl.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        const okTypes = ['image/png','image/jpeg'];
        if (!okTypes.includes(file.type)) {
          showToast('Please upload a PNG or JPG image', 'error');
          sourceImageEl.value = '';
          return;
        }
        // Check file size (18MB limit to account for base64 overhead in 25MB JSON limit)
        const maxSizeMB = 18;
        if (file.size > maxSizeMB * 1024 * 1024) {
          showToast(`Image too large. Please keep under ${maxSizeMB}MB`, 'error');
          sourceImageEl.value = '';
          return;
        }
        sourceImageFile = file;
        const reader = new FileReader();
        reader.onload = (e) => {
          sourceImageDataUrl = e.target.result;
          imagePreviewEl.innerHTML = `<img src="${sourceImageDataUrl}" style="max-width: 200px; max-height: 200px; border-radius: 8px;" />`;
        };
        reader.readAsDataURL(file);
      }
    });
  }

  const history = [];

  function setLoading(on){
    isGenerating = !!on;
    if(loading){
      loading.classList.toggle('show', !!on);
      loading.setAttribute('aria-hidden', on ? 'false' : 'true');
    }
    [refInput, promptEl, durationEl, aspectEl, resolutionEl, styleEl, seedEl, previewBtn, exportHdBtn, generateBtn, newBtn].forEach(el => {
      if(!el) return;
      if(on){ el.setAttribute('disabled', 'disabled'); }
      else{ el.removeAttribute('disabled'); }
    });
  }

  function setProgress(pct){
    const clamped = Math.max(0, Math.min(100, pct));
    if(progressBar){ progressBar.style.width = clamped + '%'; }
    const textEl = document.querySelector('#loading .loading-text');
    if (textEl) {
      textEl.textContent = `Rendering… ${Math.round(clamped)}%`;
    }
  }

  function startPendingProgress(){
    try { if (pendingTimer) { clearInterval(pendingTimer); pendingTimer = null; } } catch(_){}
    pendingPct = Math.max(8, pendingPct || 8);
    setProgress(pendingPct);
    pendingTimer = setInterval(()=>{
      // Ease up to 95%
      pendingPct = Math.min(95, pendingPct + 1 + Math.random()*2);
      setProgress(pendingPct);
    }, 1000);
  }

  function stopPendingProgress(){
    try { if (pendingTimer) { clearInterval(pendingTimer); pendingTimer = null; } } catch(_){}
    setProgress(100);
    // Reset label back after a short delay
    setTimeout(()=>{
      const textEl = document.querySelector('#loading .loading-text');
      if (textEl) textEl.textContent = 'Generating video…';
      setProgress(0);
    }, 1200);
  }

  function resetWorkspace(){
    preview.src = '';
    exportWebmBtn.disabled = true;
    exportMp4Btn.disabled = true;
    // Allow direct HD export without requiring a prior preview
    if (exportHdBtn) exportHdBtn.disabled = false;
    if (upgradeBtn) upgradeBtn.disabled = false;
    setProgress(0);
  }

  function aspectToWH(aspect, targetHeight){
    const [a,b] = aspect.split(':').map(Number);
    const h = targetHeight;
    const w = Math.round(h * (a/b));
    return {w,h};
  }

  function resolutionToHeight(res){
    const r = String(res);
    if(r === '1080') return 1080;
    if(r === '720') return 720;
    return 480; // default preview
  }

  async function startGeneration(mode) {
    const generationMode = getGenerationMode();
    const duration = 8; // Veo 3 fixed duration
    const aspect = aspectEl?.value || '16:9';
    const resolution = resolutionEl?.value || '720';
    
    let prompt;
    let imageBase64 = null;
    let imageName = null;
    let imageMime = null;
    
    if (generationMode === 'image-to-video') {
      // Prompt required; include source/reference image if provided (for backend retrieval verification)
      prompt = motionPromptEl?.value?.trim();
      if (!prompt) {
        showToast('Please enter a prompt', 'error');
        return;
      }
      const imgFile = sourceImageFile || refAsset || null;
      if (imgFile) {
        try {
          imageBase64 = await fileToBase64(imgFile);
          imageName = imgFile.name || null;
          imageMime = imgFile.type || 'image/png';
        } catch(e){
          console.warn('Failed to read image as base64', e);
        }
      }
    } else {
      // prompt-to-video
      prompt = promptEl?.value?.trim();
      if (!prompt) {
        showToast('Please enter a prompt', 'error');
        return;
      }
      // If user uploaded a reference image via top bar, include it as guidance
      let imgFile = refAsset || null;
      if (imgFile) {
        const okTypes = ['image/png','image/jpeg'];
        if (!okTypes.includes(imgFile.type)) {
          showToast('Reference images must be PNG or JPG', 'error');
          imgFile = null;
        }
      }
      if (imgFile) {
        try {
          imageBase64 = await fileToBase64(imgFile);
          imageName = imgFile.name || null;
          imageMime = imgFile.type || 'image/png';
        } catch(e){
          console.warn('Failed to read reference image as base64', e);
        }
      }
    }

    // 1) Try secure Cloud Function API if signed in
    let serverAttempted = false;
    let serverPending = false;
    try{
      let token = null;
      if (currentUser) {
        token = await getIdTokenReliable(5000);
        if (!token) {
          showToast('Authenticating… please try again in a moment', 'info');
          throw new Error('AUTH_PENDING');
        }
      }
      if(token){
        serverAttempted = true;
        const requestBody = {
          provider: "veo",
          model: "veo-3.0",
          mode: mode,
          durationSec: 8,
          aspect: aspect,
          resolution: resolution,
          generationMode: generationMode,
          generateAudio: !!(withAudioEl && withAudioEl.checked),
          tier: getSelectedTier(),
          async: true
        };
        if (imageBase64) {
          requestBody.imageBase64 = imageBase64;
          if (imageName) requestBody.imageName = imageName;
          if (imageMime) requestBody.imageMime = imageMime;
        }
        
        // Prompt-only for both modes (Veo 3)
        requestBody.prompt = prompt;
        
        console.log('=== DEBUG REQUEST BODY ===');
        console.log('provider:', requestBody.provider);
        console.log('model:', requestBody.model);
        console.log('mode:', mode);
        console.log('durationSec:', duration);
        console.log('generationMode:', generationMode);
        console.log('withAudio:', !!(withAudioEl && withAudioEl.checked));
        console.log('tier:', getSelectedTier());
        console.log('prompt:', prompt);
        console.log('hasImage:', !!imageBase64, 'imageName:', imageName, 'imageMime:', imageMime, 'imageB64Len:', imageBase64 ? imageBase64.length : 0);
        console.log('Full request body keys:', Object.keys(requestBody));
        console.log('=== END DEBUG ===');
        
        // Add dev bypass header for local testing
        const headers = {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        };
        
        // Check if running locally and add dev bypass header
        if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
          headers['x-dev-bypass'] = 'dev-test-2024';
        }

        const response = await fetch('/api/generateVideo', {
          method: 'POST',
          headers: headers,
          body: JSON.stringify(requestBody)
        });
        if (response.status === 202) {
          const pending = await response.json().catch(()=>({}));
          console.log('Async job accepted', pending);
          pendingJobId = pending.jobId;
          showToast('Video queued for processing', 'info');
          serverPending = true;
          awaitingAutoLoad = true;
          // Keep overlay on and simulate progress
          setLoading(true);
          startPendingProgress();
          
          // Listen to this specific job
          if (pendingJobId && db) {
            jobUnsubscribe = onSnapshot(doc(db, 'videoJobs', pendingJobId), (snap) => {
              const data = snap.data();
              if (!data) return;
              
              if (data.status === 'done' && data.url) {
                // Job completed - load the video
                const item = {
                  blobUrl: data.url,
                  videoId: data.creationId || pendingJobId,
                  isRealVideo: true
                };
                loadPreview(item);
                awaitingAutoLoad = false;
                stopPendingProgress();
                setLoading(false);
                showToast('Your video is ready!', 'success');
                
                // Clean up listener
                if (jobUnsubscribe) {
                  jobUnsubscribe();
                  jobUnsubscribe = null;
                }
                pendingJobId = null;
              } else if (data.status === 'failed') {
                // Job failed
                awaitingAutoLoad = false;
                stopPendingProgress();
                setLoading(false);
                const msg = data.userMessage || 'Video generation failed';
                showToast(msg, 'error');
                
                // Clean up listener
                if (jobUnsubscribe) {
                  jobUnsubscribe();
                  jobUnsubscribe = null;
                }
                pendingJobId = null;
              }
            });
          }
          
          throw new Error('PENDING');
        }
        if(response.ok){
          const js = await response.json();
          if(js && js.url){
            // Save to Firestore creations collection (already done by backend)
            // Return the signed URL for immediate use
            return { 
              blobUrl: js.url, 
              videoId: js.videoId, 
              mode: js.mode, 
              creditsUsed: js.creditsUsed, 
              isRealVideo: true,
              modelUsed: js.modelUsed || null,
              aspectUsed: js.aspectUsed || aspect,
              resolutionUsed: js.resolutionUsed || resolution,
              audioUsed: (typeof js.audioUsed === 'boolean') ? js.audioUsed : !!(withAudioEl && withAudioEl.checked)
            };
          }
        } else if(response.status === 402){
          const j = await response.json().catch(()=>null);
          if(j && j.error === 'INSUFFICIENT_CREDITS'){
            showToast(`You don't have enough credits for ${mode} video generation. Redirecting to pricing…`, 'error');
            setTimeout(() => window.location.href = '/#pricing', 2000);
            throw new Error('INSUFFICIENT_CREDITS');
          }
        } else {
          // API error - surface provider error code/message when present
          // Special handling: 502 commonly means Hosting proxy timeout while the Veo LRO continues
          if (response.status === 502) {
            console.log('API 502 received; treating as pending background render. Waiting for history autoload…');
            showToast('Still rendering… it will appear in History shortly and auto-load here.', 'info');
            // Signal to onGenerate that we should not show an error
            serverPending = true;
            awaitingAutoLoad = true;
            setLoading(true);
            startPendingProgress();
            throw new Error('PENDING');
          }
          // Special handling: certain 500s still result in a successful render via async worker
          if (response.status === 500) {
            const j500 = await response.json().catch(() => ({}));
            if (j500 && j500.code === 'VIDEO_API_ERROR') {
              console.log('API 500 VIDEO_API_ERROR; treating as pending background render.');
              showToast('Still rendering… it will appear in History shortly and auto-load here.', 'info');
              serverPending = true;
              awaitingAutoLoad = true;
              setLoading(true);
              startPendingProgress();
              throw new Error('PENDING');
            }
          }
          const j = await response.json().catch(() => ({}));
          if (j && j.code === 'MODEL_UNAVAILABLE') {
            showToast('Selected model is unavailable for this project/region. Please switch to Clario Fast or try again later.', 'error');
            throw new Error('API_ERROR');
          }
          if (j && j.code === 'CONTENT_FILTERED') {
            showToast('Your prompt was flagged. Try softening violent/graphic details.', 'error');
            throw new Error('API_ERROR');
          }
          const retryAfter = typeof j.retryAfter === 'number' ? j.retryAfter : null;
          const providerMsg = j.userMessage || j.message || j.error || j.code || `HTTP ${response.status}`;
          const code = j.code || j.error || '';
          const details = j.detail ? ` (${j.detail})` : '';
          let composed = providerMsg + details;
          if (code && !providerMsg.includes(code)) composed += ` [${code}]`;
          if (retryAfter && (code === 'VIDEO_RATE_LIMIT')) composed += ` · retry in ${retryAfter}s`;
          console.log('API Error Response:', JSON.stringify(j, null, 2));
          console.log('Response status:', response.status);
          showToast(`Video generation failed: ${composed}`, 'error');
          console.log('GenerateVideo error payload:', j);
          throw new Error('API_ERROR');
        }
      }
    }catch(e){
      console.warn('Secure API video gen error', e);
      if (e.message === 'INSUFFICIENT_CREDITS' || e.message === 'API_ERROR' || e.message === 'PENDING' || e.message === 'AUTH_PENDING') {
        throw e; // Re-throw to prevent fallback to placeholder
      }
    }

    // 2) Try user-provided proxy if configured
    if(USE_PROXY && PROXY_URL){
      // Real integration sketch
      const startRes = await fetch(PROXY_URL + '/start', {
        method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(requestBody)
      });
      if(!startRes.ok) throw new Error('Failed to start generation');
      const { id } = await startRes.json();
      let pct = 5;
      setProgress(pct);
      let status = 'running', videoUrl = null;
      while(status === 'running'){
        await new Promise(r=>setTimeout(r, 1200));
        pct = Math.min(95, pct + Math.random()*10); setProgress(pct);
        const poll = await fetch(PROXY_URL + '/status?id=' + encodeURIComponent(id));
        if(!poll.ok) throw new Error('Polling failed');
        const js = await poll.json();
        status = js.status; videoUrl = js.videoUrl;
      }
      if(status !== 'succeeded' || !videoUrl){ throw new Error('Generation failed'); }
      return { blobUrl: videoUrl };
    }

    // 3) Placeholder generation in-browser: synthesize a WebM by animating a canvas
    // Only show placeholder if API is not available and no server attempt occurred
    if (!serverAttempted && !currentUser) {
      showToast('API unavailable, showing placeholder video', 'warning');
      const result = await generatePlaceholderVideo();
      return { ...result, isRealVideo: false };
    }
    // If we attempted server but didn't return, treat as pending to avoid showing placeholder
    throw new Error('PENDING');
  }

  async function generatePlaceholderVideo(){
    const height = resolutionToHeight(resolutionEl?.value || '480');
    const { w:width, h:heightFinal } = aspectToWH(aspectEl?.value || '16:9', height);

    // Create offscreen canvas and animation
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = heightFinal;
    const ctx = canvas.getContext('2d');

    const fps = 30;
    const duration = Math.max(2, Math.min(30, Number(durationEl?.value || 5)));
    const stream = canvas.captureStream(fps);
    const chunks = [];
    const rec = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9' });
    rec.ondataavailable = (e)=>{ if(e.data && e.data.size) chunks.push(e.data); };

    let start = null;
    let rafId = 0;
    function draw(ts){
      if(start == null) start = ts;
      const t = (ts - start)/1000; // seconds

      // Progress update
      const pct = Math.min(95, (t / duration) * 95);
      setProgress(pct);

      // Animated gradient + text
      ctx.fillStyle = '#0b0b0b';
      ctx.fillRect(0,0,width,heightFinal);
      const g = ctx.createLinearGradient(0,0,width,heightFinal);
      const hue = (t*40)%360;
      g.addColorStop(0, `hsl(${(hue+0)%360} 80% 55%)`);
      g.addColorStop(1, `hsl(${(hue+120)%360} 80% 40%)`);
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = g;
      ctx.fillRect(0,0,width,heightFinal);
      ctx.globalAlpha = 1;

      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.font = Math.floor(heightFinal*0.06) + "px 'Plus Jakarta Sans', sans-serif";
      ctx.textAlign = 'center';
      ctx.fillText('Preview (placeholder)', width/2, heightFinal*0.5);
      ctx.font = Math.floor(heightFinal*0.04) + "px 'Plus Jakarta Sans', sans-serif";
      const line = (promptEl?.value||'').slice(0,80);
      ctx.fillText(line, width/2, heightFinal*0.5 + heightFinal*0.08);

      if(t < duration){ rafId = requestAnimationFrame(draw); }
      else { stop(); }
    }

    function stop(){
      cancelAnimationFrame(rafId);
      rec.stop();
      stream.getTracks().forEach(tr=>tr.stop());
    }

    const done = new Promise((resolve)=>{
      rec.onstop = ()=>{
        const blob = new Blob(chunks, {type:'video/webm'});
        resolve({ blob, blobUrl: URL.createObjectURL(blob) });
      };
    });

    rec.start();
    requestAnimationFrame(draw);
    return await done;
  }

  function addToHistory(item){
    history.unshift(item);
    renderHistory();
  }

  function renderHistory(){
    if(!historyGrid) return;
    historyGrid.innerHTML = '';
    
    // Show pending jobs first
    if (pendingJobId && db) {
      const pendingDiv = document.createElement('div');
      pendingDiv.className = 'thumb pending';
      const placeholder = document.createElement('div');
      placeholder.className = 'video-placeholder';
      placeholder.innerHTML = '<div class="spinner-small"></div><span>Rendering...</span>';
      const meta = document.createElement('div');
      meta.className = 'meta';
      meta.innerHTML = '<span class="status-badge queued">Queued</span> Video processing';
      pendingDiv.appendChild(placeholder);
      pendingDiv.appendChild(meta);
      historyGrid.appendChild(pendingDiv);
    }
    
    // Show completed videos
    history.forEach((h, idx)=>{
      if (!h || !h.blobUrl) return;
      const div = document.createElement('div');
      div.className = 'thumb';
      const vid = document.createElement('video');
      vid.src = h.blobUrl; vid.muted = true; vid.loop = true; vid.playsInline = true; vid.autoplay = true;
      const meta = document.createElement('div');
      meta.className = 'meta';
      meta.innerHTML = `<span class="status-badge done">Done</span> ${h.meta || ''}`;
      div.appendChild(vid); div.appendChild(meta);
      div.addEventListener('click', ()=>{ loadPreview(h); });
      historyGrid.appendChild(div);
    });
  }

  function loadPreview(item){
    preview.src = item.blobUrl;
    preview.load(); // Force reload
    // Attempt autoplay (may be blocked on some browsers if not muted)
    try { preview.muted = true; preview.play().catch(()=>{}); } catch(_){}
    exportWebmBtn.disabled = false;
    if (exportMp4Btn) {
      exportMp4Btn.disabled = !item.isRealVideo; // Enable MP4 only for real videos
    }
    exportHdBtn.disabled = false;
    if (upgradeBtn) upgradeBtn.disabled = false;
    // Track which item is currently loaded
    lastPreviewVideoId = item.videoId || null;
  }

  // Track active job subscriptions
  let jobUnsubscribe = null;
  let pendingJobId = null;
  
  // Load video history from Firestore
  function loadHistoryFromFirestore(user) {
    if (historyUnsubscribe) {
      historyUnsubscribe();
      historyUnsubscribe = null;
    }
    if (jobUnsubscribe) {
      jobUnsubscribe();
      jobUnsubscribe = null;
    }
    
    if (!user) return;
    
    // Listen to completed videos
    const q = query(
      collection(db, 'creations'),
      where('uid', '==', user.uid),
      where('type', 'in', ['video-preview', 'video-hd']),
      orderBy('createdAt', 'desc'),
      limit(20)
    );
    
    historyUnsubscribe = onSnapshot(q, (snapshot) => {
      history.length = 0; // Clear existing history
      snapshot.forEach((doc) => {
        const data = doc.data();
        // Skip records that don't have a playable URL yet (e.g., rendering placeholders)
        if (!data || !data.url) {
          return;
        }
        const durationSec = data.durationSec || data.duration || 8;
        let metaStr;
        if (data.provider === 'veo' && data.tier) {
          const tierLabel = data.tier === 'advanced' ? 'Clario Advanced' : 'Clario Fast';
          metaStr = `Veo • ${tierLabel} • ${durationSec}s`;
        } else {
          metaStr = `${data.duration}s · ${data.aspect} · ${data.type?.replace?.('video-', '') || ''} · ${data.creditsUsed} credits · Real`;
        }
        const historyItem = {
          blobUrl: data.url,
          meta: metaStr,
          videoId: doc.id,
          mode: data.type.replace('video-', ''),
          isRealVideo: true,
          prompt: data.prompt,
          duration: durationSec,
          aspect: data.aspect,
          creditsUsed: data.creditsUsed,
          tier: data.tier,
          provider: data.provider
        };
        history.push(historyItem);
      });
      renderHistory();
      const newest = history[0];
      // Auto-load the most recent item either when pending or when idle
      const shouldAutoLoad = awaitingAutoLoad || !isGenerating;
      if (shouldAutoLoad && newest && (!preview.src || !preview.src.length || lastPreviewVideoId !== newest.videoId)) {
        loadPreview(newest);
        if (awaitingAutoLoad) {
          awaitingAutoLoad = false;
          stopPendingProgress();
          setLoading(false);
          showToast('Your video is ready!', 'success');
        }
      }
    });
  }
 
  async function onGenerate(mode = 'preview'){
    if(isGenerating) return;
    
    setLoading(true);
    setProgress(8);

    try{
      const result = await startGeneration(mode);
      
      // Load the video into preview element
      preview.src = result.blobUrl;
      preview.load(); // Force reload
      
      // Enable export buttons
      exportWebmBtn.disabled = false;
      if (exportMp4Btn) {
        exportMp4Btn.disabled = !result.isRealVideo; // Enable MP4 only for real videos
      }
      
      if (mode === 'preview') {
        exportHdBtn.disabled = false;
        if (upgradeBtn) upgradeBtn.disabled = false;
      } else {
        exportHdBtn.disabled = true;
        if (upgradeBtn) upgradeBtn.disabled = true;
      }
      
      setProgress(100);

      const used = (typeof result.creditsUsed === 'number') ? result.creditsUsed : (mode === 'hd' ? 10 : 1);
      const videoType = result.isRealVideo ? 'Real' : 'Placeholder';
      const tierLabel = getSelectedTier() === 'advanced' ? 'Clario Advanced' : 'Clario Fast';
      const usedAspect = result.aspectUsed || aspectEl?.value;
      const usedRes = result.resolutionUsed || resolutionEl?.value;
      const meta = `Veo • ${tierLabel} • 8s · ${usedAspect} · ${usedRes} · ${result.mode || mode} · ${used} credits · ${videoType}`;
      
      const historyItem = {
        blobUrl: result.blobUrl,
        meta: meta,
        videoId: result.videoId,
        mode: result.mode || mode,
        isRealVideo: result.isRealVideo,
        prompt: prompt,
        duration: 8,
        aspect: usedAspect,
        resolution: usedRes,
        creditsUsed: used,
        tier: getSelectedTier(),
        provider: 'veo'
      };
      
      addToHistory(historyItem);

      
      if (result.isRealVideo) {
        showToast(`${mode === 'hd' ? 'HD' : 'Preview'} video generated successfully!`, 'success');
      }
    }catch(err){
      console.error(err);
      if (err.message === 'INSUFFICIENT_CREDITS') {
        return;
      }
      if (err.message === 'PENDING') {
        // Leave UI in non-loading state; history listener will auto-load when ready
        return;
      }
      if (err.message === 'API_ERROR') {
        return; // Toast already shown
      }
      showToast(USE_PROXY ? 'Generation failed. Check the proxy/server logs.' : 'Video generation failed.', 'error');
    }finally{
      // Keep overlay if we are awaiting Firestore to deliver the finished video
      if (!awaitingAutoLoad) {
        setLoading(false);
        setProgress(0);
      }
    }
  }
  
  async function onPreview(){
    await onGenerate('preview');
  }
  
  async function onExportHd(){
    await onGenerate('hd');
  }

  async function fileToBase64(file){
    const arr = await file.arrayBuffer();
    const bytes = new Uint8Array(arr);
    let binary = '';
    for(let i=0;i<bytes.length;i++){ binary += String.fromCharCode(bytes[i]); }
    return btoa(binary);
  }

  async function onExportWebM(){
    if(!preview.src) return;
    try{
      const blob = await fetch(preview.src).then(r=>r.blob());
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `clario-video-${Date.now()}.webm`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(()=>URL.revokeObjectURL(a.href), 2000);
      saveCreationMeta('webm');
      showToast('WebM video downloaded!', 'success');
    }catch(e){ 
      console.warn(e);
      showToast('Failed to download WebM video', 'error');
    }
  }

  async function onExportMp4(){
    if(!preview.src) return;
    try{
      // For real videos, the signed URL should work directly
      const blob = await fetch(preview.src).then(r=>r.blob());
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `clario-video-${Date.now()}.mp4`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(()=>URL.revokeObjectURL(a.href), 2000);
      saveCreationMeta('mp4');
      showToast('MP4 video downloaded!', 'success');
    }catch(e){ 
      console.warn(e);
      showToast('Failed to download MP4 video', 'error');
    }
  }

  function saveCreationMeta(fmt){
    try{
      const key = 'clario_creations';
      const list = JSON.parse(localStorage.getItem(key) || '[]');
      list.unshift({
        type: 'video',
        fmt,
        at: Date.now(),
        meta: {
          prompt: promptEl?.value,
          duration: 8,
          aspect: aspectEl?.value,
          resolution: resolutionEl?.value,
          style: styleEl?.value,
        }
      });
      localStorage.setItem(key, JSON.stringify(list.slice(0,100)));
    }catch(_){/* ignore */}
  }

  function onUpgrade(){
    // Legacy function - now redirects to HD export
    onExportHd();
  }


  // Handle resolution changes - auto-switch to HD for 1080p
  function updateButtonsForResolution(withToast = false) {
    if (!resolutionEl) return;
    const resolution = resolutionEl.value;
    if (resolution === '1080p' || resolution === '1080') {
      // 1080p requires HD mode
      if (previewBtn) {
        previewBtn.disabled = true;
        previewBtn.title = '1080p requires HD export';
      }
      if (exportHdBtn) {
        exportHdBtn.disabled = false;
        exportHdBtn.classList.add('btn-primary');
        exportHdBtn.classList.remove('btn-outline-primary');
      }
      if (withToast) {
        showToast('1080p resolution switched to HD export automatically', 'info');
      }
    } else {
      // Other resolutions allow both modes
      if (previewBtn) {
        previewBtn.disabled = false;
        previewBtn.title = '';
      }
      if (exportHdBtn) {
        exportHdBtn.classList.remove('btn-primary');
        exportHdBtn.classList.add('btn-outline-primary');
      }
    }
  }

  if (resolutionEl) {
    resolutionEl.addEventListener('change', () => updateButtonsForResolution(true));
    // Check initial state on page load
    updateButtonsForResolution(false);
  }

  // Wire events
  refInput.addEventListener('change', ()=>{ 
    const file = refInput.files && refInput.files[0] ? refInput.files[0] : null;
    if (file) {
      const okTypes = ['image/png','image/jpeg'];
      if (!okTypes.includes(file.type)) {
        showToast('Reference images must be PNG or JPG', 'error');
        refInput.value = '';
        refAsset = null;
        return;
      }
      // Check file size (18MB limit to account for base64 overhead in 25MB JSON limit)
      const maxSizeMB = 18;
      if (file.size > maxSizeMB * 1024 * 1024) {
        showToast(`Reference image too large. Please keep under ${maxSizeMB}MB`, 'error');
        refInput.value = '';
        refAsset = null;
        return;
      }
    }
    refAsset = file;
  });
  newBtn.addEventListener('click', ()=>{ promptEl.value=''; seedEl.value=''; resetWorkspace(); });
  
  // New two-tier buttons
  if (previewBtn) previewBtn.addEventListener('click', onPreview);
  if (exportHdBtn) exportHdBtn.addEventListener('click', onExportHd);
  
  // Legacy compatibility
  if (generateBtn) generateBtn.addEventListener('click', onPreview); // Default to preview
  if (upgradeBtn) upgradeBtn.addEventListener('click', onUpgrade);
  
  exportWebmBtn.addEventListener('click', onExportWebM);
  if (exportMp4Btn) exportMp4Btn.addEventListener('click', onExportMp4);

  async function onContinue(){
    if(isGenerating) return;
    const resolvedId = resolveCurrentCreationId();
    if(!resolvedId){ showToast('Load a video first', 'warning'); return; }
    setLoading(true);
    startPendingProgress();
    try{
      let token = null;
      if (currentUser) {
        token = await getIdTokenReliable(5000);
        if (!token) throw new Error('AUTH_PENDING');
      } else {
        showToast('Sign in to extend videos', 'warning');
        throw new Error('AUTH_REQUIRED');
      }
      const headers = { 'Content-Type':'application/json', 'Authorization': `Bearer ${token}` };
      if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        headers['x-dev-bypass'] = 'dev-test-2024';
      }
      const body = {
        creationId: resolvedId,
        tweak: (continueTweakEl?.value || '').trim() || undefined,
        seamMode: (seamModeRadios()?.value || 'crossfade'),
        overlapSeconds: Math.max(0, Math.min(2, Number(overlapEl?.value || 1.0)))
      };
      const resp = await fetch('/api/continueVideo', { method:'POST', headers, body: JSON.stringify(body) });
      if(!resp.ok){
        const j = await resp.json().catch(()=>({}));
        const msg = j?.userMessage || j?.message || j?.error || `HTTP ${resp.status}`;
        showToast(`Extend failed: ${msg}`, 'error');
        throw new Error('API_ERROR');
      }
      const js = await resp.json();
      const url = js.url;
      // Crossfade from current to new result in UI
      await crossfadeTo(url, 900);
      // Add immediate history entry; Firestore will also add a record
      addToHistory({ blobUrl: url, meta: `Smart Continue • +8s`, videoId: js.creationId, isRealVideo: true });
      showToast('Extended by 8s', 'success');
    }catch(e){
      if(e.message==='AUTH_REQUIRED' || e.message==='AUTH_PENDING') return;
      if(e.message==='API_ERROR') return;
    }finally{
      stopPendingProgress();
      setLoading(false);
    }
  }

  async function crossfadeTo(url, fadeMs=800){
    return new Promise(async (resolve)=>{
      try{
        if(!previewB) { preview.src = url; preview.load(); try{ await preview.play(); }catch{} return resolve(); }
        previewB.style.transition = 'none'; previewB.style.opacity = 0;
        previewB.src = url; previewB.load();
        // Sync timing: start overlay muted and playing
        await new Promise(r=>{ previewB.addEventListener('loadeddata', ()=>r(), { once:true }); });
        try{ previewB.currentTime = 0; previewB.play().catch(()=>{}); }catch{}
        // Fade in overlay while base keeps playing
        requestAnimationFrame(()=>{
          previewB.style.transition = `opacity ${Math.max(100,fadeMs)}ms ease`;
          previewB.style.opacity = 1;
          setTimeout(()=>{
            // Switch main preview to new source; hide overlay
            preview.src = url; preview.load();
            try{ preview.play().catch(()=>{}); }catch{}
            previewB.style.transition = 'none'; previewB.style.opacity = 0; previewB.src = '';
            resolve();
          }, Math.max(100,fadeMs));
        });
      }catch(_){ preview.src = url; preview.load(); resolve(); }
    });
  }

  if (continueBtn) continueBtn.addEventListener('click', onContinue);
  if (continue16Btn) continue16Btn.addEventListener('click', ()=> queueContinues(2));
  if (continue24Btn) continue24Btn.addEventListener('click', ()=> queueContinues(3));

  async function queueContinues(times){
    const resolvedIdStart = resolveCurrentCreationId();
    if(!resolvedIdStart){ showToast('Load a video first', 'warning'); return; }
    // Try batch endpoint first for fewer encodes
    const ok = await doBatchContinue(resolvedIdStart, times);
    if (!ok) {
      // Fallback: sequential continues
      let currentId = resolvedIdStart;
      for(let i=0;i<times;i++){
        showToast(`Continuing… Block ${i+1}/${times}`, 'info');
        await doSingleContinue(currentId);
        await new Promise(r=>setTimeout(r, 1200));
        currentId = resolveCurrentCreationId() || currentId;
      }
    }
    showToast(`Extended by +${times*8}s`, 'success');
  }

  async function doBatchContinue(creationId, count){
    setLoading(true); startPendingProgress();
    try{
      let token = null;
      if (currentUser) {
        token = await getIdTokenReliable(5000);
        if (!token) throw new Error('AUTH_PENDING');
      } else { showToast('Sign in to extend videos', 'warning'); throw new Error('AUTH_REQUIRED'); }
      const headers = { 'Content-Type':'application/json', 'Authorization': `Bearer ${token}` };
      if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') headers['x-dev-bypass'] = 'dev-test-2024';
      const body = {
        creationId,
        count,
        tweak: (continueTweakEl?.value || '').trim() || undefined,
        seamMode: (seamModeRadios()?.value || 'crossfade'),
        overlapSeconds: Math.max(0, Math.min(2, Number(overlapEl?.value || 1.0)))
      };
      const resp = await fetch('/api/continueVideoBatch', { method:'POST', headers, body: JSON.stringify(body) });
      if(!resp.ok){ return false; }
      const js = await resp.json(); const url = js.url;
      await crossfadeTo(url, 900);
      addToHistory({ blobUrl: url, meta: `Smart Continue • +${count*8}s (batch)`, videoId: js.creationId, isRealVideo: true });
      return true;
    }catch(e){ return false; }
    finally{ stopPendingProgress(); setLoading(false); }
  }

  async function doSingleContinue(creationId){
    setLoading(true); startPendingProgress();
    try{
      let token = null;
      if (currentUser) {
        token = await getIdTokenReliable(5000);
        if (!token) throw new Error('AUTH_PENDING');
      } else { showToast('Sign in to extend videos', 'warning'); throw new Error('AUTH_REQUIRED'); }
      const headers = { 'Content-Type':'application/json', 'Authorization': `Bearer ${token}` };
      if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') headers['x-dev-bypass'] = 'dev-test-2024';
      const body = {
        creationId,
        tweak: (continueTweakEl?.value || '').trim() || undefined,
        seamMode: (seamModeRadios()?.value || 'crossfade'),
        overlapSeconds: Math.max(0, Math.min(2, Number(overlapEl?.value || 1.0)))
      };
      const resp = await fetch('/api/continueVideo', { method:'POST', headers, body: JSON.stringify(body) });
      if(!resp.ok){ const j = await resp.json().catch(()=>({})); const msg=j?.userMessage||j?.message||j?.error||`HTTP ${resp.status}`; showToast(`Extend failed: ${msg}`, 'error'); throw new Error('API_ERROR'); }
      const js = await resp.json(); const url = js.url;
      await crossfadeTo(url, 900);
      addToHistory({ blobUrl: url, meta: `Smart Continue • +8s`, videoId: js.creationId, isRealVideo: true });
    }catch(e){ if(e.message==='AUTH_REQUIRED'||e.message==='AUTH_PENDING'||e.message==='API_ERROR'){} }
    finally{ stopPendingProgress(); setLoading(false); }
  }

  // Overlap slider label
  if (overlapEl && overlapValueEl){
    overlapEl.addEventListener('input', ()=>{ overlapValueEl.textContent = `${Number(overlapEl.value).toFixed(1)}s`; });
  }

  // Storyboard chips
  const chipsWrap = document.getElementById('continue-chips');
  if (chipsWrap){
    chipsWrap.addEventListener('click', (e)=>{
      const el = (e && e.target && e.target.nodeType === 1) ? e.target : null;
      const btn = el && el.closest ? el.closest('button[data-tweak]') : null;
      if (btn){
        const tweak = btn.getAttribute('data-tweak') || '';
        if (continueTweakEl) continueTweakEl.value = tweak;
      }
    });
  }



  // Initialize with Firebase auth
  onReady((user) => {
    currentUser = user;
    if (user) {
      loadHistoryFromFirestore(user);
    } else {
      // Clear history if not signed in
      if (historyUnsubscribe) {
        historyUnsubscribe();
        historyUnsubscribe = null;
      }
      history.length = 0;
      renderHistory();
    }
  });

  // Clean up on page unload
  window.addEventListener('beforeunload', () => {
    if (historyUnsubscribe) {
      historyUnsubscribe();
    }
  });

  // Init
  resetWorkspace();
})();
