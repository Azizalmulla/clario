// Clario Image Editor — Canvas-first editor with mask + Gemini call
(function(){
  // Config
  // All model calls must go through the secure backend. No client API keys.

  // DOM
  const fileInput = document.getElementById('file-input');
  const baseCanvas = document.getElementById('base-canvas');
  const maskCanvas = document.getElementById('mask-canvas');
  const promptEl = document.getElementById('prompt');
  const uploadLabel = document.querySelector('label[for="file-input"]');
  const undoBtn = document.getElementById('undo-btn');
  const redoBtn = document.getElementById('redo-btn');
  const exportBtn = document.getElementById('export-btn');
  const applyBtn = document.getElementById('apply-btn');

  // Debug: Log all DOM elements
  console.log('DOM Elements:', {
    fileInput: !!fileInput,
    baseCanvas: !!baseCanvas,
    maskCanvas: !!maskCanvas,
    promptEl: !!promptEl,
    uploadLabel: !!uploadLabel,
    undoBtn: !!undoBtn,
    redoBtn: !!redoBtn,
    exportBtn: !!exportBtn,
    applyBtn: !!applyBtn
  });

  if(!baseCanvas || !maskCanvas) return;

  const baseCtx = baseCanvas.getContext('2d');
  const maskCtx = maskCanvas.getContext('2d');

  // Offscreen binary mask for API
  const maskBinary = document.createElement('canvas');
  const maskBinCtx = maskBinary.getContext('2d');

  // State
  let img = null; // HTMLImageElement of current image
  let imgNaturalW = 0, imgNaturalH = 0;
  let fitRect = {x:0, y:0, w:0, h:0}; // where the image sits inside the canvas
  let drawing = false;
  let lastX = 0, lastY = 0;
  let isShift = false;
  let brushSize = 28;

  // Undo/Redo for mask only
  const undoStack = [];
  const redoStack = [];

  function fitContain(containerW, containerH, mediaW, mediaH){
    const scale = Math.min(containerW / mediaW, containerH / mediaH);
    const w = Math.round(mediaW * scale);
    const h = Math.round(mediaH * scale);
    const x = Math.round((containerW - w) / 2);
    const y = Math.round((containerH - h) / 2);
    return {x,y,w,h, scale};
  }

  function resizeCanvases(){
    const wrap = baseCanvas.parentElement;
    const rect = wrap.getBoundingClientRect();
    const dpr = Math.max(1, window.devicePixelRatio || 1);

    [baseCanvas, maskCanvas, maskBinary].forEach(c => {
      c.width = Math.floor(rect.width * dpr);
      c.height = Math.floor(rect.height * dpr);
      c.style.width = rect.width + 'px';
      c.style.height = rect.height + 'px';
    });

    baseCtx.setTransform(dpr,0,0,dpr,0,0);
    maskCtx.setTransform(dpr,0,0,dpr,0,0);
    maskBinCtx.setTransform(dpr,0,0,dpr,0,0);

    redrawAll();
  }

  function clearCanvas(ctx){
    ctx.clearRect(0,0,ctx.canvas.width, ctx.canvas.height);
  }

  function redrawAll(){
    clearCanvas(baseCtx);
    clearCanvas(maskCtx);

    // redraw base image fitted
    if(img){
      const rect = baseCanvas.getBoundingClientRect();
      fitRect = fitContain(rect.width, rect.height, imgNaturalW, imgNaturalH);
      baseCtx.imageSmoothingQuality = 'high';
      baseCtx.drawImage(img, fitRect.x, fitRect.y, fitRect.w, fitRect.h);
      if (exportBtn) exportBtn.disabled = false;
      if (applyBtn) applyBtn.disabled = false;
    } else {
      if (exportBtn) exportBtn.disabled = true;
      // Allow prompt-only generation without a base image
      if (applyBtn) applyBtn.disabled = false;
    }

    // draw visible mask overlay from binary mask
    drawMaskOverlay();
  }

  function drawMaskOverlay(){
    clearCanvas(maskCtx);
    // Render binary mask as semi-transparent accent overlay for the user
    const temp = document.createElement('canvas');
    temp.width = maskBinary.width; temp.height = maskBinary.height;
    const tctx = temp.getContext('2d');
    tctx.drawImage(maskBinary, 0, 0);
    const imgData = tctx.getImageData(0,0,temp.width,temp.height);
    const data = imgData.data;
    for(let i=0;i<data.length;i+=4){
      // where mask alpha > 0, tint with accent color
      const a = data[i+3];
      if(a>0){
        data[i+0] = 46;   // accent blue-ish  var(--accent) approx 0x2E
        data[i+1] = 124;  // 0x7C
        data[i+2] = 246;  // 0xF6
        data[i+3] = 80;   // semi transparent
      }
    }
    tctx.putImageData(imgData,0,0);
    const rect = maskCanvas.getBoundingClientRect();
    maskCtx.drawImage(tctx.canvas, 0, 0, rect.width, rect.height);
  }

  function setMaskBrush(ctx){
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = brushSize;
  }

  function toCanvasCoords(evt){
    const rect = maskCanvas.getBoundingClientRect();
    const x = (evt.clientX - rect.left);
    const y = (evt.clientY - rect.top);
    return {x,y};
  }

  function clampToImage(x,y){
    // optional: restrict painting to image rect
    const cx = Math.min(Math.max(x, fitRect.x), fitRect.x + fitRect.w);
    const cy = Math.min(Math.max(y, fitRect.y), fitRect.y + fitRect.h);
    return {x:cx, y:cy};
  }

  function snapshotMask(){
    try{
      const data = maskBinCtx.getImageData(0,0,maskBinary.width, maskBinary.height);
      undoStack.push(data);
      redoStack.length = 0;
      updateUndoRedoButtons();
    }catch(e){
      console.warn('Snapshot failed', e);
    }
  }

  function updateUndoRedoButtons(){
    undoBtn.disabled = undoStack.length === 0;
    redoBtn.disabled = redoStack.length === 0;
  }

  function drawLineTo(x,y){
    const {x:cx, y:cy} = clampToImage(x,y);
    setMaskBrush(maskBinCtx);
    maskBinCtx.strokeStyle = 'rgba(255,255,255,1)'; // opaque white for mask
    maskBinCtx.globalCompositeOperation = 'source-over';
    maskBinCtx.lineTo(cx, cy);
    maskBinCtx.stroke();
    drawMaskOverlay();
  }

  function startStroke(evt){
    if(!img) return;
    drawing = true;
    const p = toCanvasCoords(evt);
    lastX = p.x; lastY = p.y;
    const {x,y} = clampToImage(lastX, lastY);
    maskBinCtx.beginPath();
    maskBinCtx.moveTo(x, y);
  }

  function moveStroke(evt){
    if(!drawing) return;
    const p = toCanvasCoords(evt);
    let x = p.x, y = p.y;
    if(isShift){
      // constrain to horizontal/vertical
      const dx = Math.abs(x - lastX);
      const dy = Math.abs(y - lastY);
      if(dx > dy) y = lastY; else x = lastX;
    }
    drawLineTo(x, y);
    lastX = x; lastY = y;
  }

  function endStroke(){
    if(!drawing) return;
    drawing = false;
    maskBinCtx.closePath();
    snapshotMask();
  }

  function clearMask(){
    maskBinCtx.clearRect(0,0,maskBinary.width, maskBinary.height);
    drawMaskOverlay();
    updateUndoRedoButtons();
  }

  function hasMask(){
    const data = maskBinCtx.getImageData(0,0,maskBinary.width, maskBinary.height).data;
    for(let i=3;i<data.length;i+=4){ if(data[i]>0) return true; }
    return false;
  }

  function canvasToBase64PNG(c){
    const dataURL = c.toDataURL('image/png');
    return dataURL.split(',')[1];
  }

  async function applyEdit(){
    const prompt = (promptEl.value || '').trim();
    if(!prompt){
      alert('Please enter a prompt');
      return;
    }
    const hasBaseImage = !!img;
    let imageB64 = null;
    let maskB64 = null;
    if (hasBaseImage) {
      imageB64 = canvasToBase64PNG(baseCanvas);
      const includeMask = hasMask();
      maskB64 = includeMask ? canvasToBase64PNG(maskBinary) : null;
    }

    console.log('Apply clicked:', { hasBaseImage, prompt: prompt.slice(0, 50) + '...' });
    applyBtn.disabled = true;
    applyBtn.textContent = 'Applying…';

    try{
      const getToken = window.clarioGetIdToken;
      const token = typeof getToken === 'function' ? await getToken() : null;
      if(!token){
        alert('Please sign in to apply edits.');
        window.location.href = '/signin';
        return;
      }

      const payload = { prompt };
      if (imageB64) payload.imageBase64 = imageB64;
      if (maskB64) payload.maskBase64 = maskB64;
      console.log('Sending payload:', { ...payload, imageBase64: imageB64 ? '[base64 data]' : null, maskBase64: maskB64 ? '[base64 data]' : null });

      const apiRes = await fetch('/api/editImage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(payload)
      });

      console.log('API Response status:', apiRes.status);
      
      // Handle async job queue (202 Accepted)
      if(apiRes.status === 202){
        const js = await apiRes.json();
        console.log('Image job queued:', js);
        applyBtn.textContent = 'Processing…';
        applyBtn.disabled = true;
        
        // Real-time subscribe to this job's status
        const jobId = js.jobId;
        const db = window.clarioDb;
        const docFn = window.clarioDoc;
        const onSnapshotFn = window.clarioOnSnapshot;
        if (!db || !docFn || !onSnapshotFn) {
          // Fallback: keep the old synchronous path if Firestore isn't available
          alert('Processing started; please keep this tab open.');
          return;
        }
        const jobRef = docFn(db, 'imageJobs', jobId);
        
        // Long max-timeout (15 minutes) to avoid false failures
        let unsub = null;
        const hardTimeout = setTimeout(() => {
          try { if (unsub) unsub(); } catch(_){ }
          applyBtn.textContent = 'Apply';
          applyBtn.disabled = false;
          alert('Still processing… Please check Recent or try again in a minute.');
        }, 15 * 60 * 1000);
        
        unsub = onSnapshotFn(jobRef, async (snap) => {
          const data = snap.data();
          if (!data) return;
          // Status-driven UI; never error while pending/processing
          if (data.status === 'queued' || data.status === 'processing' || data.status === 'running' || data.status === 'rendering') {
            applyBtn.textContent = 'Processing…';
            applyBtn.disabled = true;
            return;
          }
          if (data.status === 'done' && data.imageUrl) {
            clearTimeout(hardTimeout);
            try { if (unsub) unsub(); } catch(_){ }
            await drawUrlToBaseCanvas(data.imageUrl);
            clearMask();
            // Reset Apply button after success
            applyBtn.textContent = 'Apply';
            applyBtn.disabled = false;
            return;
          }
          if (data.status === 'failed') {
            clearTimeout(hardTimeout);
            try { if (unsub) unsub(); } catch(_){ }
            const userMsg = data.userMessage || 'Image generation failed';
            alert(userMsg);
            // Reset Apply button after failure
            applyBtn.textContent = 'Apply';
            applyBtn.disabled = false;
            return;
          }
        });
        
        return; // Exit applyEdit; the listener will handle completion
      }
      
      if(apiRes.ok){
        const js = await apiRes.json();
        console.log('API Response:', { ...js, imageBase64: js.imageBase64 ? '[base64 data]' : null });
        if(js && js.imageBase64){
          await drawBase64ToBaseCanvas(js.imageBase64);
          clearMask();
          return;
        }
        throw new Error('Unexpected response from server');
      }

      if(apiRes.status === 402){
        const j = await apiRes.json().catch(()=>null);
        if(j && j.error === 'INSUFFICIENT_CREDITS'){
          alert('You are out of image credits. Redirecting to pricing…');
          window.location.href = '/#pricing';
          return;
        }
      }

      // Handle structured error responses
      const errJson = await apiRes.json().catch(()=> null);
      if(errJson?.userMessage){
        throw new Error(errJson.userMessage);
      }
      
      // Fallback to text error
      const errText = await apiRes.text().catch(()=> '');
      console.error('API Error:', { status: apiRes.status, text: errText });
      throw new Error(`Server error ${apiRes.status}: ${errText}`);
    }catch(err){
      console.error('Apply failed:', err);
      // Show user-friendly error message
      const msg = err.message || 'Failed to apply edit';
      alert(msg);
    }finally{
      // Only reset if not actively processing a queued job
      if (applyBtn.textContent !== 'Processing…') {
        applyBtn.disabled = false;
        applyBtn.textContent = 'Apply';
      }
    }
  }

  async function drawBase64ToBaseCanvas(b64){
    const image = new Image();
    image.onload = () => {
      img = image;
      imgNaturalW = image.naturalWidth; imgNaturalH = image.naturalHeight;
      redrawAll();
    };
    image.onerror = () => alert('Failed to load returned image');
    image.src = 'data:image/png;base64,' + b64;
  }

  async function drawUrlToBaseCanvas(url){
    const image = new Image();
    image.crossOrigin = 'anonymous';
    let triedProxy = false;
    
    image.onload = () => {
      img = image;
      imgNaturalW = image.naturalWidth; imgNaturalH = image.naturalHeight;
      redrawAll();
    };
    image.onerror = () => {
      if (!triedProxy) {
        triedProxy = true;
        const proxied = `/api/proxyImage?url=${encodeURIComponent(url)}`;
        image.src = proxied;
      } else {
        alert('Failed to load image from server');
      }
    };
    image.src = url;
  }

  function onFileSelected(file){
    if(!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        img = image;
        imgNaturalW = image.naturalWidth; imgNaturalH = image.naturalHeight;
        clearMask();
        redrawAll();
        // redrawAll() already handles button states correctly
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  function exportPNG(){
    if(!img) return;
    baseCanvas.toBlob((blob)=>{
      if(!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'clario-image.png';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(()=>URL.revokeObjectURL(a.href), 2000);
    }, 'image/png');
  }

  // Events
  window.addEventListener('resize', resizeCanvases);
  document.addEventListener('keydown', (e)=>{ if(e.key==='Shift') isShift = true; });
  document.addEventListener('keyup', (e)=>{ if(e.key==='Shift') isShift = false; });

  maskCanvas.addEventListener('mousedown', startStroke);
  window.addEventListener('mousemove', moveStroke);
  window.addEventListener('mouseup', endStroke);
  maskCanvas.addEventListener('mouseleave', endStroke);

  undoBtn.addEventListener('click', ()=>{
    if(undoStack.length===0) return;
    const snap = undoStack.pop();
    try{
      const current = maskBinCtx.getImageData(0,0,maskBinary.width, maskBinary.height);
      redoStack.push(current);
      maskBinCtx.putImageData(snap,0,0);
      drawMaskOverlay();
    }catch(e){ console.warn(e); }
    updateUndoRedoButtons();
  });

  redoBtn.addEventListener('click', ()=>{
    if(redoStack.length===0) return;
    const snap = redoStack.pop();
    try{
      const current = maskBinCtx.getImageData(0,0,maskBinary.width, maskBinary.height);
      undoStack.push(current);
      maskBinCtx.putImageData(snap,0,0);
      drawMaskOverlay();
    }catch(e){ console.warn(e); }
    updateUndoRedoButtons();
  });

  fileInput.addEventListener('change', ()=>{
    const file = fileInput.files && fileInput.files[0];
    onFileSelected(file);
  });

  uploadLabel.addEventListener('keydown', (e)=>{
    if(e.key==='Enter' || e.key===' '){ fileInput.click(); }
  });

  if (exportBtn) exportBtn.addEventListener('click', exportPNG);
  
  // Debug: Check if Apply button exists and add click handler
  console.log('Apply button found:', !!applyBtn, applyBtn);
  if (applyBtn) {
    applyBtn.addEventListener('click', (e) => {
      console.log('Apply button clicked!', e);
      applyEdit();
    });
  } else {
    console.error('Apply button not found!');
  }

  // Init sizes
  resizeCanvases();
  updateUndoRedoButtons();
})();
