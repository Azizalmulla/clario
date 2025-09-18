// Clario Image Editor - Vertex AI Edition with GCS Storage
// No API keys, all processing server-side via Service Account
(function(){
  // DOM elements
  const fileInput = document.getElementById('file-input');
  const baseCanvas = document.getElementById('base-canvas');
  const maskCanvas = document.getElementById('mask-canvas');
  const promptEl = document.getElementById('prompt');
  const uploadLabel = document.querySelector('label[for="file-input"]');
  const undoBtn = document.getElementById('undo-btn');
  const redoBtn = document.getElementById('redo-btn');
  const exportBtn = document.getElementById('export-btn');
  const applyBtn = document.getElementById('apply-btn');
  const transparentBtn = document.getElementById('transparent-btn');
  const formatSelect = document.getElementById('format-select');
  const galleryTray = document.getElementById('gallery-tray');
  const insertReplaceBtn = document.getElementById('insert-replace');
  const insertOverlayBtn = document.getElementById('insert-overlay');
  const overlayOpacityEl = document.getElementById('overlay-opacity');
  const historyStrip = document.getElementById('history-strip');
  const settingsBtn = document.getElementById('settings-btn');
  const settingsPopover = document.getElementById('settings-popover');
  const historyCapEl = document.getElementById('history-cap');
  const historyCapValueEl = document.getElementById('history-cap-value');
  const galleryCapEl = document.getElementById('gallery-cap');
  const galleryCapValueEl = document.getElementById('gallery-cap-value');
  const galleryClearBtn = document.getElementById('gallery-clear-btn');
  const galleryDownloadBtn = document.getElementById('gallery-download-btn');
  const restoreDefaultsBtn = document.getElementById('restore-defaults-btn');
  const historyDownloadBtn = document.getElementById('history-download-btn');
  const exportSettingsBtn = document.getElementById('export-settings-btn');
  const importSettingsBtn = document.getElementById('import-settings-btn');
  const importSettingsInput = document.getElementById('import-settings-input');
  const storageUsageBar = document.getElementById('storage-usage-bar');
  const storageUsageFill = document.getElementById('storage-usage-fill');
  const storageUsageText = document.getElementById('storage-usage-text');
  const toolMaskBtn = document.getElementById('tool-mask');
  const toolSelectBtn = document.getElementById('tool-select');
  const toolSketchBtn = document.getElementById('tool-sketch');
  const layersListEl = document.getElementById('layers-list');
  const exportCompositeBtn = document.getElementById('export-composite-btn');
  // Phase 3+ UI
  const saveBtn = document.getElementById('save-btn');
  const creationsBtn = document.getElementById('creations-btn');
  const exportPopover = document.getElementById('export-popover');
  const exportQualityEl = document.getElementById('export-quality');
  const exportQualityValueEl = document.getElementById('export-quality-value');
  const exportFillWhiteEl = document.getElementById('export-fill-white');
  const exportRunBtn = document.getElementById('export-run-btn');
  const exportZipBtn = document.getElementById('export-zip-btn');
  const creationsPopover = document.getElementById('creations-popover');
  const tabLocalBtn = document.getElementById('tab-local');
  const tabCloudBtn = document.getElementById('tab-cloud');
  const creationsList = document.getElementById('creations-list');

  if(!baseCanvas || !maskCanvas) return;

  const baseCtx = baseCanvas.getContext('2d');
  const maskCtx = maskCanvas.getContext('2d');

  // Offscreen binary mask
  const maskBinary = document.createElement('canvas');
  const maskBinCtx = maskBinary.getContext('2d');

  // State
  let img = null;
  let imgNaturalW = 0, imgNaturalH = 0;
  let fitRect = {x:0, y:0, w:0, h:0};
  let drawing = false;
  let lastX = 0, lastY = 0;
  let isShift = false;
  let brushSize = 28;
  let transparentBackground = false;
  let outputFormat = 'png';
  let overlayOpacity = 0.85; // 85% default
  let largeCanvasWarned = false;
  let historyCap = 20; // adjustable via Settings (10–50)
  let galleryCap = 50;  // adjustable via Settings (10–100)
  let toolMode = 'mask'; // 'mask' | 'select'

  // General undo/redo of full editor state (base + mask)
  const stateStack = [];
  const stateRedoStack = [];
  // Legacy mask-only stacks retained for compatibility (not used by UI now)
  const undoStack = [];
  const redoStack = [];

  // Gallery state
  let insertMode = 'replace'; // 'replace' | 'overlay'
  const galleryItems = []; // { src: string, thumb?: string }

function reorderSelectedLayer(direction){
  try{
    const L = getSelectedLayer(); if(!L) return;
    const idx = layers.indexOf(L); if(idx<0) return;
    if(direction==='up' && idx < layers.length - 1){
      layers.splice(idx,1); layers.splice(idx+1,0,L);
    } else if(direction==='down' && idx > 0){
      layers.splice(idx,1); layers.splice(idx-1,0,L);
    } else if(direction==='front'){
      layers.splice(idx,1); layers.push(L);
    } else if(direction==='back'){
      layers.splice(idx,1); layers.unshift(L);
    }
  // Template Export wiring
  const templateSizeLabelEl = document.getElementById('template-size-label');
  const exportTemplateRunBtn = document.getElementById('export-template-run-btn');
  const exportTemplatePreviewBtn = document.getElementById('export-template-preview-btn');
  const exportTemplateBgEl = document.getElementById('export-template-bg');
  const exportTemplateTransparentEl = document.getElementById('export-template-transparent');
  function updateTemplateLabel(){
    if(templateSizeLabelEl){
      if(templateTarget){ templateSizeLabelEl.textContent = `${templateTarget.w}×${templateTarget.h}`; }
      else templateSizeLabelEl.textContent = '(no template selected)';
    }
  }
  updateTemplateLabel();
  function currentTemplateFit(){
    const v = (document.querySelector('input[name="export-template-fit"]:checked')?.value || 'contain');
    return (v==='cover')?'cover':'contain';
  }
  async function exportToTemplateSizePreview(){
    if(!templateTarget){ showToast('No template selected', 'warning'); return; }
    const fmt = (document.querySelector('input[name="export-format"]:checked')?.value || 'png');
    const q = Math.max(0.6, Math.min(1, Number(exportQualityEl?.value || 90)/100));
    const fitMode = currentTemplateFit();
    const transparent = !!exportTemplateTransparentEl?.checked;
    const bg = exportTemplateBgEl?.value || '#ffffff';
    const blob = await exportToTemplate(fmt, q, fitMode, transparent, bg);
    if(!blob){ showToast('Preview failed', 'error'); return; }
    // Open preview in a new window/tab
    const url = URL.createObjectURL(blob);
    const w = window.open(url, '_blank');
    setTimeout(()=>URL.revokeObjectURL(url), 20000);
  }
  async function exportToTemplateRun(){
    if(!templateTarget){ showToast('No template selected', 'warning'); return; }
    const fmt = (document.querySelector('input[name="export-format"]:checked')?.value || 'png');
    const q = Math.max(0.6, Math.min(1, Number(exportQualityEl?.value || 90)/100));
    const fitMode = currentTemplateFit();
    const transparent = !!exportTemplateTransparentEl?.checked;
    const bg = exportTemplateBgEl?.value || '#ffffff';
    const blob = await exportToTemplate(fmt, q, fitMode, transparent, bg);
    if(!blob){ showToast('Export failed', 'error'); return; }
    const name = templateTarget ? `clario-${templateTarget.w}x${templateTarget.h}.${fmt==='jpeg'?'jpg':fmt}` : `clario-image.${fmt==='jpeg'?'jpg':fmt}`;
    downloadBlob(blob, name);
  }
  exportTemplatePreviewBtn?.addEventListener('click', exportToTemplateSizePreview);
  exportTemplateRunBtn?.addEventListener('click', exportToTemplateRun);

  async function exportToTemplate(format='png', quality=0.9, fitMode='contain', transparent=false, fillColor='#ffffff'){
    if(!templateTarget){ return null; }
    // Render composite at template size
    const out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(templateTarget.w));
    out.height = Math.max(1, Math.round(templateTarget.h));
    const octx = out.getContext('2d'); octx.imageSmoothingQuality = 'high';
    if(!transparent){ octx.fillStyle = fillColor || '#ffffff'; octx.fillRect(0,0,out.width,out.height); }
    // Prepare a composited source of current view
    const src = document.createElement('canvas');
    src.width = baseCanvas.width; src.height = baseCanvas.height;
    const sctx = src.getContext('2d'); sctx.imageSmoothingQuality = 'high';
    // Draw base
    if(img){
      const rect = baseCanvas.getBoundingClientRect();
      const fit = fitContain(rect.width, rect.height, imgNaturalW, imgNaturalH);
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      sctx.setTransform(dpr,0,0,dpr,0,0);
      sctx.filter = buildCanvasFilter();
      sctx.drawImage(img, fit.x, fit.y, fit.w, fit.h);
      sctx.setTransform(1,0,0,1,0,0);
    }
    drawAllLayers(sctx);
    // Compute fit of src into out
    const sw = src.width, sh = src.height; const tw = out.width, th = out.height;
    const sr = sw/sh, tr = tw/th;
    let dw, dh;
    if((fitMode==='contain' && sr>tr) || (fitMode==='cover' && sr<tr)){
      dw = tw; dh = tw/sr;
    } else {
      dh = th; dw = th*sr;
    }
    const dx = Math.round((tw - dw)/2); const dy = Math.round((th - dh)/2);
    octx.drawImage(src, dx, dy, Math.round(dw), Math.round(dh));
    // Optional export-time sharpen
    if(filterTrueSharpen){ try{ await applyUnsharpMask(out, 0.5); }catch{} }
    const mime = format==='jpeg' ? 'image/jpeg' : (format==='webp' ? 'image/webp' : 'image/png');
    const blob = await new Promise(resolve => out.toBlob(resolve, mime, quality));
    return blob;
  }
    redrawAll(); renderLayersPanel(); pushState('reorder');
  }catch(e){ console.warn('reorderSelectedLayer failed', e); }
}

function duplicateSelectedLayer(){
  try{
    const L = getSelectedLayer(); if(!L) return;
    const img = new Image(); img.crossOrigin = 'anonymous';
    img.onload = ()=>{
      const copy = {
        id: `layer-${Date.now()}-dup`,
        name: (L.name || 'Overlay') + ' copy',
        src: L.src, img,
        w: L.w, h: L.h,
        x: L.x + 12, y: L.y + 12,
        scale: L.scale, scaleX: (typeof L.scaleX==='number')? L.scaleX : (typeof L.scale==='number'? L.scale : 1),
        scaleY: (typeof L.scaleY==='number')? L.scaleY : (typeof L.scale==='number'? L.scale : 1),
        rotation: L.rotation,
        opacity: L.opacity, visible: L.visible, locked: false
      };
      layers.push(copy);
      selectedLayerId = copy.id;
      redrawAll(); renderLayersPanel(); pushState('duplicate');
    };
    img.src = L.src;
  }catch(e){ console.warn('duplicateSelectedLayer failed', e); }
}

// Export Composite (PNG): base + layers only (no mask/gizmo)
function exportCompositePNG(){
  try{
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const rect = baseCanvas.getBoundingClientRect();
    const c = document.createElement('canvas');
    c.width = baseCanvas.width; c.height = baseCanvas.height;
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr,0,0,dpr,0,0);
    // Draw base
    if(img){
      const fit = fitContain(rect.width, rect.height, imgNaturalW, imgNaturalH);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, fit.x, fit.y, fit.w, fit.h);
    }
    // Draw layers
    drawAllLayers(ctx);
    c.toBlob((blob)=>{
      if(!blob){ showToast('Export failed', 'error'); return; }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'clario-composite.png';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(()=>URL.revokeObjectURL(a.href), 2000);
    }, 'image/png');
  }catch(e){ console.error(e); showToast('Export failed', 'error'); }
}
  const GALLERY_KEY = 'clario_gallery_v1';
  const PROJECTS_KEY = 'clario_projects_v1';
  const LAST_SESSION_KEY = 'clario_last_session_v1';
  const STORAGE_BUDGET_BYTES = 4.5 * 1024 * 1024; // ~4.5MB soft budget to stay under 5MB

  // Overlay layers (non-destructive)
  const layers = []; // [{id,name,src,img,w,h,x,y,scale,scaleX,scaleY,rotation,opacity,visible,locked}]
  let selectedLayerId = null;
  const selectedLayerIds = new Set();
  let lastSelectedIndex = -1;
  let overlayCount = 0;
  const SNAP_PX = 6;
  let drag = null; // { mode: 'move'|'scale'|'rotate', handle?:string, layerId, startX, startY, origX,origY,origScale,origRot }
  let snapGuides = []; // [{x1,y1,x2,y2}]
  // Filters state
  let filterBrightness = 100; // percent
  let filterContrast = 100;   // percent
  let filterSharpness = 0;    // 0-100, approximated via contrast/saturate
  let filterTrueSharpen = false; // optional unsharp mask on export
  // Sketch overlay
  const sketchCanvas = document.createElement('canvas');
  const sketchCtx = sketchCanvas.getContext('2d');
  let drawingTarget = 'mask'; // 'mask' | 'sketch'
  let sketchDirty = false;
  let sketchColor = '#000000';
  let sketchBrushSize = 12;
  let sketchOpacity = 0.8; // 0..1
  let sketchEraser = false;
  // Preview sharpen (GPU)
  let previewSharpen = false;
  let glCanvas = null, gl = null, glProgram = null, glPosBuf = null, glTex = null, glLoc = {};
  // Template sizing helper
  let templateTarget = null; // { w:number, h:number, mode:'contain'|'cover' }
  let templateResetChipEl = null;

  // Current job tracking
  let currentJobId = null;
  let pollInterval = null;

  function fitContain(containerW, containerH, mediaW, mediaH){
    const scale = Math.min(containerW / mediaW, containerH / mediaH);
    const w = Math.round(mediaW * scale);
    const h = Math.round(mediaH * scale);
    const x = Math.round((containerW - w) / 2);
    const y = Math.round((containerH - h) / 2);
    return {x,y,w,h, scale};
  }

  // Filters wiring
  const filterBrightnessEl = document.getElementById('filter-brightness');
  const filterContrastEl = document.getElementById('filter-contrast');
  const filterSharpnessEl = document.getElementById('filter-sharpness');
  const filterBrightnessValueEl = document.getElementById('filter-brightness-value');
  const filterContrastValueEl = document.getElementById('filter-contrast-value');
  const filterSharpnessValueEl = document.getElementById('filter-sharpness-value');
  function updateFilters(){ redrawAll(); }
  if(filterBrightnessEl){
    filterBrightness = Number(filterBrightnessEl.value)||100;
    filterBrightnessEl.addEventListener('input', ()=>{ filterBrightness = Number(filterBrightnessEl.value)||100; if(filterBrightnessValueEl) filterBrightnessValueEl.textContent = filterBrightness + '%'; updateFilters(); });
  }
  if(filterContrastEl){
    filterContrast = Number(filterContrastEl.value)||100;
    filterContrastEl.addEventListener('input', ()=>{ filterContrast = Number(filterContrastEl.value)||100; if(filterContrastValueEl) filterContrastValueEl.textContent = filterContrast + '%'; updateFilters(); });
  }
  if(filterSharpnessEl){
    filterSharpness = Number(filterSharpnessEl.value)||0;
    filterSharpnessEl.addEventListener('input', ()=>{ filterSharpness = Number(filterSharpnessEl.value)||0; if(filterSharpnessValueEl) filterSharpnessValueEl.textContent = String(filterSharpness); updateFilters(); });
  }
  const filterTrueSharpenEl = document.getElementById('filter-true-sharpen');
  if(filterTrueSharpenEl){
    filterTrueSharpen = !!filterTrueSharpenEl.checked;
    filterTrueSharpenEl.addEventListener('change', ()=>{ filterTrueSharpen = !!filterTrueSharpenEl.checked; });
  }
  const filterPreviewSharpenEl = document.getElementById('filter-preview-sharpen');
  if(filterPreviewSharpenEl){
    previewSharpen = !!filterPreviewSharpenEl.checked;
    filterPreviewSharpenEl.addEventListener('change', ()=>{ previewSharpen = !!filterPreviewSharpenEl.checked; redrawAll(); });
  }

  // Templates wiring
  const templateProfileBtn = document.getElementById('template-profile');
  const templatePosterBtn = document.getElementById('template-poster');
  const templateLinkedInBtn = document.getElementById('template-linkedin');
  const templateInstagramBtn = document.getElementById('template-instagram');
  const templateYouTubeBtn = document.getElementById('template-youtube');
  function setPromptText(text){ if(promptEl){ promptEl.value = text; } }
  function addTextOverlay(text, w=800, h=200, font='bold 64px system-ui', color='#111', bg='rgba(255,255,255,0.0)'){
    const c = document.createElement('canvas'); c.width=w; c.height=h; const ctx = c.getContext('2d');
    ctx.fillStyle = bg; ctx.fillRect(0,0,w,h);
    ctx.fillStyle = color; ctx.font = font; ctx.textBaseline='middle'; ctx.textAlign='center';
    ctx.fillText(text, w/2, h/2);
    const im = new Image(); im.onload = ()=> addOverlayLayerFromImage(im); im.src = c.toDataURL('image/png');
  }
  templateProfileBtn?.addEventListener('click', ()=>{
    transparentBackground = true;
    if(transparentBtn) transparentBtn.classList.add('active');
    outputFormat = 'png'; if(formatSelect) formatSelect.value = 'png';
    setPromptText('Create a clean professional profile picture. Smooth skin, even lighting, neutral background, transparent background, centered face, high detail.');
    showToast('Profile Picture template applied', 'success');
  });
  templatePosterBtn?.addEventListener('click', ()=>{
    addTextOverlay('Poster Title', 1200, 240, 'bold 128px system-ui', '#111', 'rgba(255,255,255,0.0)');
    addTextOverlay('Subtitle', 900, 160, 'bold 72px system-ui', '#333', 'rgba(255,255,255,0.0)');
    setPromptText('Enhance image for poster layout: vivid colors, clean edges, text-friendly composition.');
    showToast('Poster Layout template added', 'success');
  });
  templateLinkedInBtn?.addEventListener('click', ()=>{
    setPromptText('Prepare a LinkedIn banner (1584x396, 4:1). Keep key content centered, clean, professional, high contrast.');
    addTextOverlay('LinkedIn Banner', 1200, 220, 'bold 96px system-ui', '#0a66c2', 'rgba(255,255,255,0.0)');
    showToast('LinkedIn Banner template applied', 'success');
    templateTarget = { w: 1584, h: 396, mode: 'contain' };
  });
  templateInstagramBtn?.addEventListener('click', ()=>{
    setPromptText('Square Instagram post (1:1). Center subject, vivid color, clean edges, social-ready.');
    addTextOverlay('Instagram', 1000, 260, 'bold 108px system-ui', '#e1306c', 'rgba(255,255,255,0.0)');
    showToast('Instagram Square template applied', 'success');
    templateTarget = { w: 1080, h: 1080, mode: 'cover' };
  });
  templateYouTubeBtn?.addEventListener('click', ()=>{
    setPromptText('YouTube thumbnail (1280x720). Bold composition, high contrast, crisp text area.');
    addTextOverlay('YouTube', 1200, 260, 'bold 108px system-ui', '#ff0000', 'rgba(255,255,255,0.0)');
    showToast('YouTube Thumbnail template applied', 'success');
    templateTarget = { w: 1280, h: 720, mode: 'cover' };
  });

  // Sketch controls wiring
  const sketchColorEl = document.getElementById('sketch-color');
  const sketchWidthEl = document.getElementById('sketch-width');
  const sketchWidthValueEl = document.getElementById('sketch-width-value');
  const clearSketchBtn = document.getElementById('clear-sketch-btn');
  if(sketchColorEl){ sketchColor = sketchColorEl.value || '#000000'; sketchColorEl.addEventListener('input', ()=>{ sketchColor = sketchColorEl.value || '#000000'; }); }
  if(sketchWidthEl){
    sketchBrushSize = Number(sketchWidthEl.value)||12;
    sketchWidthEl.addEventListener('input', ()=>{ sketchBrushSize = Number(sketchWidthEl.value)||12; if(sketchWidthValueEl) sketchWidthValueEl.textContent = String(sketchBrushSize); });
  }
  if(clearSketchBtn){
    clearSketchBtn.addEventListener('click', ()=>{ 
      sketchCtx.clearRect(0,0,sketchCanvas.width, sketchCanvas.height); 
      sketchDirty = false; 
      drawMaskOverlay();
      pushState('clear-sketch');
    });
  }
  const sketchOpacityEl = document.getElementById('sketch-opacity');
  const sketchOpacityValueEl = document.getElementById('sketch-opacity-value');
  if(sketchOpacityEl){
    sketchOpacity = Math.max(0, Math.min(1, Number(sketchOpacityEl.value||80)/100));
    sketchOpacityEl.addEventListener('input', ()=>{ sketchOpacity = Math.max(0, Math.min(1, Number(sketchOpacityEl.value||80)/100)); if(sketchOpacityValueEl) sketchOpacityValueEl.textContent = Math.round(sketchOpacity*100)+'%'; drawMaskOverlay(); });
  }
  const sketchEraserEl = document.getElementById('sketch-eraser');
  if(sketchEraserEl){ sketchEraser = !!sketchEraserEl.checked; sketchEraserEl.addEventListener('change', ()=>{ sketchEraser = !!sketchEraserEl.checked; }); }

  function getDisplayBounds(){
    const rect = baseCanvas.getBoundingClientRect();
    if(img && imgNaturalW && imgNaturalH){
      const fit = fitContain(rect.width, rect.height, imgNaturalW, imgNaturalH);
      return { x: fit.x, y: fit.y, w: fit.w, h: fit.h };
    }
    return { x: 0, y: 0, w: rect.width, h: rect.height };
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
    sketchCanvas.width = Math.floor(rect.width * dpr);
    sketchCanvas.height = Math.floor(rect.height * dpr);
    sketchCanvas.style.width = rect.width + 'px';
    sketchCanvas.style.height = rect.height + 'px';

    baseCtx.setTransform(dpr,0,0,dpr,0,0);
    maskCtx.setTransform(dpr,0,0,dpr,0,0);
    maskBinCtx.setTransform(dpr,0,0,dpr,0,0);
    sketchCtx.setTransform(dpr,0,0,dpr,0,0);

    redrawAll();
  }

  function clearCanvas(ctx){
    ctx.clearRect(0,0,ctx.canvas.width, ctx.canvas.height);
  }

  function redrawAll(){
    clearCanvas(baseCtx);
    clearCanvas(maskCtx);

    if(img){
      const rect = baseCanvas.getBoundingClientRect();
      fitRect = fitContain(rect.width, rect.height, imgNaturalW, imgNaturalH);
      baseCtx.imageSmoothingQuality = 'high';
      // Apply filters to base
      baseCtx.save();
      baseCtx.filter = buildCanvasFilter();
      baseCtx.drawImage(img, fitRect.x, fitRect.y, fitRect.w, fitRect.h);
      baseCtx.restore();
      exportBtn.disabled = false;
      applyBtn.disabled = false;
    } else {
      exportBtn.disabled = true;
      applyBtn.disabled = false; // Allow prompt-only generation
    }

    // Draw non-destructive overlay layers
    drawAllLayers();

    // GPU preview sharpen after compositing content (before overlays/gizmo)
    if(previewSharpen){
      try{ gpuSharpenBase(); }catch(e){ /* ignore */ }
    }

    drawMaskOverlay();
    // Draw transform gizmo if in select mode
    if(toolMode === 'select') drawSelectedGizmo();
  }

  function ensureGL(){
    if(gl) return;
    glCanvas = document.createElement('canvas');
    glCanvas.width = baseCanvas.width; glCanvas.height = baseCanvas.height;
    gl = (glCanvas.getContext('webgl') || glCanvas.getContext('experimental-webgl'));
    if(!gl) throw new Error('WebGL not supported');
    const vsSrc = `attribute vec2 aPos; varying vec2 vUV; void main(){ vUV = (aPos+1.0)*0.5; gl_Position = vec4(aPos,0.0,1.0); }`;
    const fsSrc = `precision mediump float; varying vec2 vUV; uniform sampler2D uTex; uniform vec2 uPx; void main(){
      vec3 c = texture2D(uTex, vUV).rgb;
      vec3 n = texture2D(uTex, vUV + vec2(0.0,-uPx.y)).rgb;
      vec3 s = texture2D(uTex, vUV + vec2(0.0, uPx.y)).rgb;
      vec3 e = texture2D(uTex, vUV + vec2( uPx.x,0.0)).rgb;
      vec3 w = texture2D(uTex, vUV + vec2(-uPx.x,0.0)).rgb;
      vec3 sharpen = (c*5.0 - n - s - e - w);
      gl_FragColor = vec4(clamp(sharpen, 0.0, 1.0), 1.0);
    }`;
    function compile(type, src){ const sh = gl.createShader(type); gl.shaderSource(sh, src); gl.compileShader(sh); if(!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh)); return sh; }
    const vs = compile(gl.VERTEX_SHADER, vsSrc); const fs = compile(gl.FRAGMENT_SHADER, fsSrc);
    glProgram = gl.createProgram(); gl.attachShader(glProgram, vs); gl.attachShader(glProgram, fs); gl.linkProgram(glProgram);
    if(!gl.getProgramParameter(glProgram, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(glProgram));
    gl.useProgram(glProgram);
    glPosBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, glPosBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(glProgram, 'aPos'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    glTex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, glTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    glLoc.uTex = gl.getUniformLocation(glProgram, 'uTex');
    glLoc.uPx = gl.getUniformLocation(glProgram, 'uPx');
  }

  function gpuSharpenBase(){
    ensureGL();
    // Upload from baseCanvas into texture
    gl.bindTexture(gl.TEXTURE_2D, glTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, baseCanvas);
    gl.viewport(0,0, glCanvas.width, glCanvas.height);
    gl.useProgram(glProgram);
    gl.uniform1i(glLoc.uTex, 0);
    gl.uniform2f(glLoc.uPx, 1.0/glCanvas.width, 1.0/glCanvas.height);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    // Draw back onto baseCtx
    baseCtx.save();
    baseCtx.setTransform(1,0,0,1,0,0);
    baseCtx.drawImage(glCanvas, 0, 0);
    baseCtx.restore();
  }

  function computeTemplateRect(bounds, target){
    const bw = bounds.w, bh = bounds.h; const tw = target.w, th = target.h; const mode = target.mode||'contain';
    const br = bw/bh, tr = tw/th;
    let w,h;
    if((mode==='contain' && br>tr) || (mode==='cover' && br<tr)){
      h = bh; w = h*tr;
    } else {
      w = bw; h = w/tr;
    }
    const x = bounds.x + (bw - w)/2; const y = bounds.y + (bh - h)/2;
    return {x,y,w,h};
  }

  function drawMaskOverlay(){
    clearCanvas(maskCtx);
    const temp = document.createElement('canvas');
    temp.width = maskBinary.width; 
    temp.height = maskBinary.height;
    const tctx = temp.getContext('2d');
    tctx.drawImage(maskBinary, 0, 0);
    const imgData = tctx.getImageData(0,0,temp.width,temp.height);
    const data = imgData.data;
    for(let i=0;i<data.length;i+=4){
      const a = data[i+3];
      if(a>0){
        data[i+0] = 46;   // accent blue
        data[i+1] = 124;
        data[i+2] = 246;
        data[i+3] = 80;   // semi transparent
      }
    }
    tctx.putImageData(imgData,0,0);
    const rect = maskCanvas.getBoundingClientRect();
    maskCtx.drawImage(tctx.canvas, 0, 0, rect.width, rect.height);
    // Overlay sketch strokes (rendered as-is, semi-opaque)
    maskCtx.save();
    maskCtx.globalAlpha = Math.max(0, Math.min(1, sketchOpacity));
    maskCtx.drawImage(sketchCanvas, 0, 0, rect.width, rect.height);
    maskCtx.restore();
    // Draw template guides if any
    if(templateTarget){
      try{
        const bounds = getDisplayBounds();
        const tr = computeTemplateRect(bounds, templateTarget);
        maskCtx.save();
        maskCtx.strokeStyle = 'rgba(0,0,0,0.6)'; maskCtx.lineWidth = 2; maskCtx.setLineDash([8,4]);
        maskCtx.strokeRect(tr.x, tr.y, tr.w, tr.h);
        maskCtx.restore();
        // Position a reset chip near the guide (top-right inside)
        const rect = maskCanvas.getBoundingClientRect();
        if(!templateResetChipEl){
          templateResetChipEl = document.createElement('button');
          templateResetChipEl.textContent = 'Reset template';
          templateResetChipEl.className = 'btn btn-light';
          templateResetChipEl.style.position = 'fixed';
          templateResetChipEl.style.zIndex = '2000';
          templateResetChipEl.style.fontSize = '12px';
          templateResetChipEl.style.padding = '2px 8px';
          templateResetChipEl.style.border = '1px solid rgba(0,0,0,0.2)';
          templateResetChipEl.style.borderRadius = '12px';
          templateResetChipEl.style.background = '#fff';
          templateResetChipEl.addEventListener('click', (e)=>{
            e.stopPropagation();
            templateTarget = null;
            if(templateResetChipEl){ templateResetChipEl.style.display = 'none'; }
            try{ updateTemplateLabel(); }catch{}
            redrawAll();
          });
          document.body.appendChild(templateResetChipEl);
        }
        const chipX = Math.round(rect.left + tr.x + tr.w - 110);
        const chipY = Math.round(rect.top + tr.y + 8);
        templateResetChipEl.style.left = chipX + 'px';
        templateResetChipEl.style.top = chipY + 'px';
        templateResetChipEl.style.display = 'block';
      }catch{}
    } else {
      if(templateResetChipEl){ templateResetChipEl.style.display = 'none'; }
    }
  }

  function clearMask(){
    maskBinCtx.clearRect(0,0,maskBinary.width, maskBinary.height);
    drawMaskOverlay();
    updateUndoRedoButtons();
  }

  function hasMask(){
    const data = maskBinCtx.getImageData(0,0,maskBinary.width, maskBinary.height).data;
    for(let i=3;i<data.length;i+=4){ 
      if(data[i]>0) return true; 
    }
    return false;
  }

  function hasSketch(){
    return !!sketchDirty;
  }

  function canvasToBase64PNG(c){
    const dataURL = c.toDataURL('image/png');
    return dataURL.split(',')[1];
  }

  // ---------- Layers: Draw pipeline ----------
  function drawAllLayers(ctx = baseCtx){
    for(const layer of layers){
      if(!layer.visible || !layer.img) continue;
      ctx.save();
      ctx.filter = buildCanvasFilter();
      ctx.globalAlpha = Math.max(0, Math.min(1, layer.opacity ?? 1));
      ctx.imageSmoothingQuality = 'high';
      ctx.translate(layer.x, layer.y);
      ctx.rotate(layer.rotation || 0);
      const sx = (typeof layer.scaleX === 'number') ? layer.scaleX : (typeof layer.scale === 'number' ? layer.scale : 1);
      const sy = (typeof layer.scaleY === 'number') ? layer.scaleY : (typeof layer.scale === 'number' ? layer.scale : 1);
      ctx.scale(sx, sy);
      ctx.drawImage(layer.img, -layer.w/2, -layer.h/2, layer.w, layer.h);
      ctx.restore();
    }
  }

  function buildCanvasFilter(){
    const b = Math.max(50, Math.min(150, filterBrightness));
    const c = Math.max(50, Math.min(150, filterContrast));
    const s = Math.max(0, Math.min(100, filterSharpness));
    // Approximate sharpness by boosting contrast and saturation slightly
    const sharpContrast = 100 + Math.round(s * 0.3);
    const sharpSaturate = 100 + Math.round(s * 0.2);
    return `brightness(${b}%) contrast(${Math.min(200, Math.round(c * sharpContrast / 100))}%) saturate(${sharpSaturate}%)`;
  }

  function getSelectedLayer(){
    return layers.find(l=>l.id===selectedLayerId) || null;
  }

  function drawSelectedGizmo(){
    const layer = getSelectedLayer();
    if(!layer) return;
    // Compute transformed corners
    const corners = getLayerCorners(layer);
    const ctx = maskCtx;
    ctx.save();
    // draw snap guides
    if(snapGuides.length){
      ctx.setLineDash([3,3]);
      ctx.strokeStyle = 'rgba(46,124,246,0.45)';
      ctx.lineWidth = 1;
      for(const g of snapGuides){ ctx.beginPath(); ctx.moveTo(g.x1,g.y1); ctx.lineTo(g.x2,g.y2); ctx.stroke(); }
      ctx.setLineDash([]);
    }
    // degree tick marks around rotation radius (every 15 degrees)
    try{
      const center = getLayerCenter(layer);
      const topCenter = midPoint(corners[0], corners[1]);
      const r = Math.max(24, Math.min(60, Math.hypot(topCenter.x - center.x, topCenter.y - center.y)));
      ctx.save();
      ctx.strokeStyle = 'rgba(46,124,246,0.35)';
      ctx.lineWidth = 1;
      for(let i=0;i<24;i++){
        const ang = i * (Math.PI/12);
        const x1 = center.x + Math.cos(ang) * (r - 6);
        const y1 = center.y + Math.sin(ang) * (r - 6);
        const x2 = center.x + Math.cos(ang) * (r + 6);
        const y2 = center.y + Math.sin(ang) * (r + 6);
        ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();
      }
      ctx.restore();
    }catch{}
    ctx.setLineDash([6,4]);
    ctx.strokeStyle = 'rgba(46,124,246,0.9)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    for(let i=1;i<corners.length;i++) ctx.lineTo(corners[i].x, corners[i].y);
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);
    // Draw handles (corners)
    for(const p of corners){ drawHandle(ctx, p.x, p.y); }
    // Draw side handles (non-uniform scale)
    const sideTop = midPoint(corners[0], corners[1]);
    const sideRight = midPoint(corners[1], corners[2]);
    const sideBottom = midPoint(corners[2], corners[3]);
    const sideLeft = midPoint(corners[3], corners[0]);
    drawHandle(ctx, sideTop.x, sideTop.y);
    drawHandle(ctx, sideRight.x, sideRight.y);
    drawHandle(ctx, sideBottom.x, sideBottom.y);
    drawHandle(ctx, sideLeft.x, sideLeft.y);
    // Rotation handle at top-center
    const topCenter = midPoint(corners[0], corners[1]);
    const center = getLayerCenter(layer);
    const dir = normalize({x: topCenter.x - center.x, y: topCenter.y - center.y});
    const rotHandle = { x: topCenter.x + dir.x * 30, y: topCenter.y + dir.y * 30 };
    ctx.beginPath(); ctx.moveTo(topCenter.x, topCenter.y); ctx.lineTo(rotHandle.x, rotHandle.y); ctx.stroke();
    drawHandle(ctx, rotHandle.x, rotHandle.y, true);
    // HUD (angle/scale) near rotation handle
    try{
      const deg = ((layer.rotation || 0) * 180 / Math.PI);
      const normDeg = ((deg % 360) + 360) % 360;
      const sx = (typeof layer.scaleX === 'number') ? layer.scaleX : (typeof layer.scale === 'number' ? layer.scale : 1);
      const sy = (typeof layer.scaleY === 'number') ? layer.scaleY : (typeof layer.scale === 'number' ? layer.scale : 1);
      const label = `θ ${Math.round(normDeg)}°  •  sx ${Math.round(sx*100)}%  sy ${Math.round(sy*100)}%`;
      ctx.font = '12px system-ui, -apple-system, Segoe UI, Roboto';
      const tw = ctx.measureText(label).width;
      const pad = 6; const bw = tw + pad*2; const bh = 18;
      const bx = rotHandle.x - bw/2; const by = rotHandle.y - 28;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.rect(bx, by, bw, bh); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.fillText(label, bx + pad, by + 13);
    }catch{}
    ctx.restore();
  }

  function drawHandle(ctx, x, y, circle=false){
    ctx.save();
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = 'rgba(46,124,246,0.95)';
    if(circle){ ctx.beginPath(); ctx.arc(x,y,5,0,Math.PI*2); ctx.fill(); ctx.stroke(); }
    else { ctx.beginPath(); ctx.rect(x-5,y-5,10,10); ctx.fill(); ctx.stroke(); }
    ctx.restore();
  }

  function getLayerCenter(layer){ return { x: layer.x, y: layer.y }; }
  function getLayerCorners(layer){
    const hw = layer.w/2, hh = layer.h/2;
    const pts = [ {x:-hw,y:-hh},{x:hw,y:-hh},{x:hw,y:hh},{x:-hw,y:hh} ];
    return pts.map(p=>applyLayerTransform(layer, p.x, p.y));
  }
  function applyLayerTransform(layer, x, y){
    const sx = (typeof layer.scaleX === 'number') ? layer.scaleX : (typeof layer.scale === 'number' ? layer.scale : 1);
    const sy = (typeof layer.scaleY === 'number') ? layer.scaleY : (typeof layer.scale === 'number' ? layer.scale : 1);
    const r = layer.rotation || 0;
    const cos = Math.cos(r), sin = Math.sin(r);
    const rx = (x*sx)*cos - (y*sy)*sin;
    const ry = (x*sx)*sin + (y*sy)*cos;
    return { x: layer.x + rx, y: layer.y + ry };
  }
  function invertLayerPoint(layer, x, y){
    // Convert canvas point -> layer local space
    const dx = x - layer.x; const dy = y - layer.y;
    const r = -(layer.rotation || 0);
    const cos = Math.cos(r), sin = Math.sin(r);
    const px = dx*cos - dy*sin;
    const py = dx*sin + dy*cos;
    const sx = (typeof layer.scaleX === 'number') ? layer.scaleX : (typeof layer.scale === 'number' ? layer.scale : 1);
    const sy = (typeof layer.scaleY === 'number') ? layer.scaleY : (typeof layer.scale === 'number' ? layer.scale : 1);
    return { x: px / sx, y: py / sy };
  }
  function midPoint(a,b){ return { x:(a.x+b.x)/2, y:(a.y+b.y)/2 }; }
  function dist(a,b){ const dx=a.x-b.x, dy=a.y-b.y; return Math.hypot(dx,dy); }

  // ---------- Layers: Create/modify ----------
  function addOverlayLayerFromImage(image){
    const id = `layer-${Date.now()}-${(++overlayCount)}`;
    // Initial placement at canvas center with reasonable scale
    const rect = baseCanvas.getBoundingClientRect();
    fitRect = fitContain(rect.width, rect.height, imgNaturalW || image.naturalWidth, imgNaturalH || image.naturalHeight);
    const maxW = Math.max(80, Math.min(fitRect.w * 0.6, image.naturalWidth));
    const scale = maxW / image.naturalWidth;
    const layer = {
      id,
      name: `Overlay ${overlayCount}`,
      src: image.src,
      img: image,
      w: image.naturalWidth,
      h: image.naturalHeight,
      x: fitRect.x + fitRect.w/2,
      y: fitRect.y + fitRect.h/2,
      scale, // legacy
      scaleX: scale,
      scaleY: scale,
      rotation: 0,
      opacity: overlayOpacity,
      visible: true,
      locked: false
    };
    layers.push(layer);
    selectedLayerId = id;
    selectedLayerIds.clear();
    selectedLayerIds.add(id);
    lastSelectedIndex = layers.indexOf(layer);
    redrawAll();
    renderLayersPanel();
    pushState('add-layer');
  }

  // Upload image to GCS
  async function uploadToGCS(base64Data, imageType = 'source'){
    const getToken = window.clarioGetIdToken;
    const token = typeof getToken === 'function' ? await getToken() : null;
    if(!token) throw new Error('Not authenticated');

    const response = await fetch('/api/uploadImage', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        imageBase64: base64Data,
        imageType: imageType
      })
    });

    if(!response.ok){
      const error = await response.json().catch(()=>({}));
      throw new Error(error.userMessage || 'Upload failed');
    }

    const result = await response.json();
    return result.gcsUrl;
  }

  // Poll job status
  async function pollJobStatus(jobId){
    const getToken = window.clarioGetIdToken;
    const token = typeof getToken === 'function' ? await getToken() : null;
    if(!token) throw new Error('Not authenticated');

    const response = await fetch(`/api/imageJob/${jobId}`, {
      headers: { 
        'Authorization': `Bearer ${token}`
      }
    });

    if(!response.ok){
      const error = await response.json().catch(()=>({}));
      throw new Error(error.userMessage || 'Failed to get job status');
    }

    const result = await response.json();
    return result.job;
  }

  // Start polling for job completion
  function startPolling(jobId){
    if(pollInterval) clearInterval(pollInterval);
    currentJobId = jobId;
    
    let attempts = 0;
    const maxAttempts = 120; // 2 minutes at 1 second intervals
    
    pollInterval = setInterval(async () => {
      attempts++;
      
      try {
        const job = await pollJobStatus(jobId);
        
        if(job.status === 'done' && job.imageUrl){
          clearInterval(pollInterval);
          pollInterval = null;
          await loadImageFromUrl(job.imageUrl);
          // Snapshot immediately AFTER draw, BEFORE clearing mask
          pushStateNow('ai-apply-complete');
          clearMask();
          try{ console.log('[analytics] ai_apply_snapshot_added'); }catch{}
          applyBtn.textContent = 'Apply';
          applyBtn.disabled = false;
          showToast('Image generated successfully!', 'success');
        } else if(job.status === 'failed'){
          clearInterval(pollInterval);
          pollInterval = null;
          applyBtn.textContent = 'Apply';
          applyBtn.disabled = false;
          const msg = job.userMessage || 'Generation failed';
          const extra = job.providerStatus ? ` (upstream ${job.providerStatus}${job.providerModel ? ' ' + job.providerModel : ''})` : '';
          showToast(`${msg}${extra}`, 'error');
          // Developer diagnostics in console
          if (job.providerResponse) {
            try {
              console.groupCollapsed('[Clario] Provider error details');
              console.log('providerStatus:', job.providerStatus);
              console.log('providerModel:', job.providerModel);
              console.log('providerResponse:', job.providerResponse);
            } finally {
              console.groupEnd?.();
            }
          }
        } else if(attempts >= maxAttempts){
          clearInterval(pollInterval);
          pollInterval = null;
          applyBtn.textContent = 'Apply';
          applyBtn.disabled = false;
          showToast('Processing timed out. Please try again.', 'error');
        }
        // Otherwise continue polling (status is queued/processing)
      } catch(err){
        console.error('Polling error:', err);
        if(attempts >= 5){ // Stop after 5 consecutive errors
          clearInterval(pollInterval);
          pollInterval = null;
          applyBtn.textContent = 'Apply';
          applyBtn.disabled = false;
          showToast('Failed to check status. Please try again.', 'error');
        }
      }
    }, 1000);
  }

  // Apply edit using Vertex AI
  async function applyEdit(){
    const prompt = (promptEl.value || '').trim();
    if(!prompt){
      showToast('Please enter a prompt', 'warning');
      return;
    }

    applyBtn.disabled = true;
    applyBtn.textContent = 'Uploading...';

    try{
      const getToken = window.clarioGetIdToken;
      const token = typeof getToken === 'function' ? await getToken() : null;
      if(!token){
        showToast('Please sign in to apply edits', 'error');
        window.location.href = '/signin';
        return;
      }

      let sourceImageUrl = null;
      let maskUrl = null;

      // Upload source image if present
      if(img){
        applyBtn.textContent = 'Uploading image...';
        const imageB64 = canvasToBase64PNG(baseCanvas);
        sourceImageUrl = await uploadToGCS(imageB64, 'source');
      }

      // Upload mask if present
      if(img && hasMask()){
        applyBtn.textContent = 'Uploading mask...';
        const maskB64 = canvasToBase64PNG(maskBinary);
        maskUrl = await uploadToGCS(maskB64, 'mask');
      }
      // Upload sketch if present
      let sketchUrl = null;
      if(img && hasSketch()){
        applyBtn.textContent = 'Uploading sketch...';
        const sketchB64 = canvasToBase64PNG(sketchCanvas);
        sketchUrl = await uploadToGCS(sketchB64, 'sketch');
      }

      applyBtn.textContent = 'Processing...';

      // Submit job to Vertex AI backend
      const response = await fetch('/api/editImage', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          prompt,
          sourceImageUrl,
          maskUrl,
          sketchUrl,
          outputFormat,
          transparentBackground,
          safetyMode: 'balanced'
        })
      });

      if(!response.ok){
        const error = await response.json().catch(()=>({}));
        throw new Error(error.userMessage || `Server error ${response.status}`);
      }

      const result = await response.json();
      // Treat 202 as processing explicitly
      if (response.status === 202 && result.jobId) {
        startPolling(result.jobId);
        applyBtn.textContent = 'Processing...';
      } else if (result.jobId) {
        // Still proceed to poll if backend returned a job id
        startPolling(result.jobId);
        applyBtn.textContent = 'Processing...';
      } else {
        throw new Error('No job ID returned');
      }

    } catch(err){
      console.error('Apply failed:', err);
      showToast(err.message || 'Failed to apply edit', 'error');
      applyBtn.disabled = false;
      applyBtn.textContent = 'Apply';
    }
  }

  // Load image from URL
  async function loadImageFromUrl(url){
    const image = new Image();
    image.crossOrigin = 'anonymous';
    
    return new Promise((resolve, reject) => {
      image.onload = () => {
        img = image;
        imgNaturalW = image.naturalWidth;
        imgNaturalH = image.naturalHeight;
        redrawAll();
        resolve();
      };
      
      image.onerror = async () => {
        // Try proxy if direct load fails
        try {
          const proxyUrl = `/api/proxyImage?url=${encodeURIComponent(url)}`;
          image.src = proxyUrl;
        } catch {
          reject(new Error('Failed to load image'));
        }
      };
      
      image.src = url;
    });
  }
  if(historyDownloadBtn){
    historyDownloadBtn.addEventListener('click', async ()=>{
      try{
        if(typeof JSZip === 'undefined'){
          showToast('Zip library not loaded', 'error');
          return;
        }
        const zip = new JSZip();
        for(let i=0;i<stateStack.length;i++){
          const st = stateStack[i];
          if(!st) continue;
          const baseExt = (st.base.startsWith('data:image/webp') ? 'webp' : st.base.startsWith('data:image/png') ? 'png' : 'jpg');
          const maskExt = 'png';
          zip.file(`history/base_${String(i+1).padStart(3,'0')}.${baseExt}`, (st.base.split(',')[1]||''), { base64: true });
          zip.file(`history/mask_${String(i+1).padStart(3,'0')}.${maskExt}`, (st.mask.split(',')[1]||''), { base64: true });
        }
        const content = await zip.generateAsync({ type: 'blob' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(content);
        a.download = 'clario-history.zip';
        document.body.appendChild(a);
        a.click(); a.remove();
        setTimeout(()=>URL.revokeObjectURL(a.href), 2000);
      }catch(e){ console.error(e); showToast('Failed to create history zip', 'error'); }
    });
  }
  if(exportSettingsBtn){
    exportSettingsBtn.addEventListener('click', ()=>{
      try{
        const data = {
          historyCap,
          galleryCap,
          overlayOpacity: Math.round(overlayOpacity*100),
          storageBytes: estimateLocalStorageBytes(),
          galleryCount: galleryItems.length
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'clario-settings.json';
        document.body.appendChild(a);
        a.click(); a.remove();
        setTimeout(()=>URL.revokeObjectURL(a.href), 2000);
      }catch(e){ console.error(e); showToast('Failed to export settings', 'error'); }
    });
  }
  if(importSettingsBtn && importSettingsInput){
    importSettingsBtn.addEventListener('click', ()=> importSettingsInput.click());
    importSettingsInput.addEventListener('change', async ()=>{
      try{
        const file = importSettingsInput.files && importSettingsInput.files[0];
        if(!file) return;
        const text = await file.text();
        const obj = JSON.parse(text);
        if(typeof obj.historyCap === 'number'){
          historyCap = Math.max(10, Math.min(50, obj.historyCap));
          if(historyCapEl) historyCapEl.value = String(historyCap);
          if(historyCapValueEl) historyCapValueEl.textContent = String(historyCap);
          localStorage.setItem('clario_history_cap', String(historyCap));
          capHistoryIfNeeded();
          renderHistoryStrip();
          updateUndoRedoButtons();
        }
        if(typeof obj.galleryCap === 'number'){
          galleryCap = Math.max(10, Math.min(100, obj.galleryCap));
          if(galleryCapEl) galleryCapEl.value = String(galleryCap);
          if(galleryCapValueEl) galleryCapValueEl.textContent = String(galleryCap);
          localStorage.setItem('clario_gallery_cap', String(galleryCap));
          enforceGalleryCap();
        }
        if(typeof obj.overlayOpacity === 'number' && overlayOpacityEl){
          overlayOpacityEl.value = String(Math.max(30, Math.min(100, obj.overlayOpacity)));
          overlayOpacity = Math.max(0.3, Math.min(1, (Number(overlayOpacityEl.value)||85)/100));
        }
        showToast('Settings imported', 'success');
      }catch(e){ console.error(e); showToast('Failed to import settings', 'error'); }
    });
  }

  // Show toast notification
  function showToast(message, type = 'info'){
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    toast.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      padding: 12px 20px;
      background: ${type === 'error' ? '#f44336' : type === 'success' ? '#4caf50' : type === 'warning' ? '#ff9800' : type === 'info' ? '#2196f3' : '#2196f3'};
      color: white;
      border-radius: 4px;
      box-shadow: 0 2px 5px rgba(0,0,0,0.2);
      z-index: 10000;
      animation: slideIn 0.3s ease;
    `;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.animation = 'slideOut 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  // Handle transparent background toggle
  if(transparentBtn){
    transparentBtn.addEventListener('click', () => {
      transparentBackground = !transparentBackground;
      transparentBtn.classList.toggle('active', transparentBackground);
      
      if(transparentBackground){
        outputFormat = 'png'; // Force PNG for transparency
        if(formatSelect) formatSelect.value = 'png';
        showToast('Transparent background enabled (PNG output)', 'info');
      } else {
        showToast('Transparent background disabled', 'info');
      }
    });
  }

  // Handle format selection
  if(formatSelect){
    formatSelect.addEventListener('change', (e) => {
      outputFormat = e.target.value;
      if(outputFormat === 'jpeg' && transparentBackground){
        transparentBackground = false;
        if(transparentBtn) transparentBtn.classList.remove('active');
        showToast('JPEG does not support transparency', 'warning');
      }
    });
  }

  // Drawing functions
  function setMaskBrush(ctx){
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = brushSize;
  }

  function setSketchBrush(ctx){
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = sketchBrushSize;
  }

  function toCanvasCoords(evt){
    const rect = maskCanvas.getBoundingClientRect();
    const x = (evt.clientX - rect.left);
    const y = (evt.clientY - rect.top);
    return {x,y};
  }

  function clampToImage(x,y){
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
    // Need at least 2 to undo to a previous state
    undoBtn.disabled = stateStack.length <= 1;
    redoBtn.disabled = stateRedoStack.length === 0;
  }

  // Idle callback helper
  const requestIdle = (window.requestIdleCallback || function(cb){ return setTimeout(cb, 0); });

  function capHistoryIfNeeded(){
    const cap = Math.max(10, Math.min(50, Number(historyCap) || 20));
    while(stateStack.length > cap){
      stateStack.shift();
      try{ console.log('[analytics] history_capped'); }catch{}
    }
  }

  // Encode helpers
  function toDataUrlPreferWebP(canvas, quality){
    try{
      const q = (typeof quality === 'number') ? quality : 0.85;
      const url = canvas.toDataURL('image/webp', q);
      if (typeof url === 'string' && url.startsWith('data:image/webp')) return url;
    }catch{}
    return canvas.toDataURL('image/png');
  }

  function getStateSnapshot(){
    try{
      // Preview thumbnail for history strip (composited)
      const area = baseCanvas.width * baseCanvas.height;
      const baseQ = area > 8000000 ? 0.75 : 0.85;
      const preview = toDataUrlPreferWebP(baseCanvas, baseQ);
      // Persist raw base src (not composited) to reconstruct layers accurately
      const baseSrc = img ? img.src : null;
      // Use maskBinary for true resolution of mask
      const mask = maskBinary.toDataURL('image/png');
      // Persist sketch overlay
      const sketch = sketchCanvas.toDataURL('image/png');
      // Serialize layers (excluding Image objects)
      const layersState = layers.map(l=>({
        id:l.id, name:l.name, src:l.src, w:l.w, h:l.h, x:l.x, y:l.y,
        scale:l.scale, // legacy
        scaleX:(typeof l.scaleX==='number')? l.scaleX : (typeof l.scale==='number'? l.scale : 1),
        scaleY:(typeof l.scaleY==='number')? l.scaleY : (typeof l.scale==='number'? l.scale : 1),
        rotation:l.rotation, opacity:l.opacity, visible:l.visible, locked:l.locked
      }));
      // Persist filters
      const filters = { brightness: filterBrightness, contrast: filterContrast, sharpness: filterSharpness };
      return { base: preview, mask, sketch, baseSrc, layers: layersState, filters };
    }catch(e){
      console.warn('getStateSnapshot failed', e);
      return null;
    }
  }

  // Utilities for image compression and thumb generation for gallery persistence
  function loadImageFromDataUrl(dataUrl){
    return new Promise((resolve, reject)=>{
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error('Failed to load image data'));
      im.src = dataUrl;
    });
  }

  async function compressImageDataUrl(dataUrl, maxDim = 1280, quality = 0.85){
    try{
      const im = await loadImageFromDataUrl(dataUrl);
      const w = im.naturalWidth || im.width;
      const h = im.naturalHeight || im.height;
      const scale = Math.min(1, maxDim / Math.max(w, h));
      const cw = Math.max(1, Math.round(w * scale));
      const ch = Math.max(1, Math.round(h * scale));
      const c = document.createElement('canvas');
      c.width = cw; c.height = ch;
      const ctx = c.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(im, 0, 0, cw, ch);
      // Prefer WebP for compression
      const out = toDataUrlPreferWebP(c, quality);
      return out;
    }catch(e){ console.warn('compressImageDataUrl failed', e); return dataUrl; }
  }

  async function makeThumbnailDataUrl(dataUrl, size = 160){
    try{
      const im = await loadImageFromDataUrl(dataUrl);
      const w = im.naturalWidth || im.width;
      const h = im.naturalHeight || im.height;
      const scale = size / Math.max(w, h);
      const cw = Math.max(1, Math.round(w * scale));
      const ch = Math.max(1, Math.round(h * scale));
      const c = document.createElement('canvas');
      c.width = cw; c.height = ch;
      const ctx = c.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(im, 0, 0, cw, ch);
      return toDataUrlPreferWebP(c, 0.8);
    }catch(e){ console.warn('makeThumbnailDataUrl failed', e); return dataUrl; }
  }

  async function restoreState(state){
    if(!state) return;
    // Restore base image (prefer baseSrc when provided for accuracy)
    const baseToLoad = state.baseSrc || state.base;
    await new Promise((resolve,reject)=>{
      if(!baseToLoad) { img = null; imgNaturalW = imgNaturalH = 0; resolve(); return; }
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.onload = ()=>{
        img = image;
        imgNaturalW = image.naturalWidth;
        imgNaturalH = image.naturalHeight;
        resolve();
      };
      image.onerror = ()=>resolve();
      image.src = baseToLoad;
    });
    // Restore mask
    await new Promise((resolve,reject)=>{
      const m = new Image();
      m.onload = ()=>{
        maskBinCtx.clearRect(0,0,maskBinary.width, maskBinary.height);
        // Ensure maskBinary matches current canvas pixel size
        maskBinary.width = baseCanvas.width;
        maskBinary.height = baseCanvas.height;
        const dpr = Math.max(1, window.devicePixelRatio || 1);
        maskBinCtx.setTransform(dpr,0,0,dpr,0,0);
        maskBinCtx.drawImage(m, 0, 0, maskBinary.width, maskBinary.height);
        drawMaskOverlay();
        resolve();
      };
      m.onerror = ()=>resolve(); // ignore mask restore errors
      m.src = state.mask;
    });
    // Restore sketch
    if(state.sketch){
      await new Promise((resolve)=>{
        const sk = new Image();
        sk.onload = ()=>{
          // Match sketch canvas to baseCanvas size
          sketchCanvas.width = baseCanvas.width;
          sketchCanvas.height = baseCanvas.height;
          const dpr = Math.max(1, window.devicePixelRatio || 1);
          sketchCtx.setTransform(dpr,0,0,dpr,0,0);
          sketchCtx.clearRect(0,0,sketchCanvas.width, sketchCanvas.height);
          sketchCtx.drawImage(sk, 0, 0, sketchCanvas.width, sketchCanvas.height);
          sketchDirty = true;
          resolve(null);
        };
        sk.onerror = ()=>resolve(null);
        sk.src = state.sketch;
      });
    }
    // Restore layers if present (backward compatible)
    layers.length = 0;
    if(Array.isArray(state.layers)){
      for(const li of state.layers){
        const image = new Image();
        image.crossOrigin = 'anonymous';
        await new Promise((res)=>{ image.onload = ()=>res(); image.onerror = ()=>res(); image.src = li.src; });
        layers.push({
          id: li.id, name: li.name || 'Overlay', src: li.src, img: image,
          w: li.w || image.naturalWidth || 1, h: li.h || image.naturalHeight || 1,
          x: li.x, y: li.y,
          scale: li.scale || undefined,
          scaleX: (typeof li.scaleX==='number')? li.scaleX : (typeof li.scale==='number'? li.scale : 1),
          scaleY: (typeof li.scaleY==='number')? li.scaleY : (typeof li.scale==='number'? li.scale : 1),
          rotation: li.rotation || 0,
          opacity: (typeof li.opacity==='number')? li.opacity : 1,
          visible: li.visible !== false, locked: !!li.locked
        });
      }
    }
    redrawAll();
    renderLayersPanel();
    renderHistoryStrip();
    // Restore filters
    if(state.filters){
      try{
        filterBrightness = Number(state.filters.brightness)||100;
        filterContrast = Number(state.filters.contrast)||100;
        filterSharpness = Number(state.filters.sharpness)||0;
        if(document.getElementById('filter-brightness')){
          document.getElementById('filter-brightness').value = String(filterBrightness);
          if(document.getElementById('filter-brightness-value')) document.getElementById('filter-brightness-value').textContent = filterBrightness + '%';
        }
        if(document.getElementById('filter-contrast')){
          document.getElementById('filter-contrast').value = String(filterContrast);
          if(document.getElementById('filter-contrast-value')) document.getElementById('filter-contrast-value').textContent = filterContrast + '%';
        }
        if(document.getElementById('filter-sharpness')){
          document.getElementById('filter-sharpness').value = String(filterSharpness);
          if(document.getElementById('filter-sharpness-value')) document.getElementById('filter-sharpness-value').textContent = String(filterSharpness);
        }
        redrawAll();
      }catch{}
    }
  }

  function pushState(label='state'){
    // Schedule snapshotting in idle time to reduce jank
    requestIdle(()=>{
      try{
        const area = baseCanvas.width * baseCanvas.height;
        if(area > 8000000 && !largeCanvasWarned){
          largeCanvasWarned = true;
          showToast('Large canvas; history snapshots trimmed sooner.', 'warning');
        }
        const snap = getStateSnapshot();
        if(!snap) return;
        stateStack.push(snap);
        capHistoryIfNeeded();
        stateRedoStack.length = 0;
        updateUndoRedoButtons();
        renderHistoryStrip();
        // Persist last session (current state)
        saveLastSession(snap);
      }catch(e){ console.warn('pushState failed', e); }
    });
  }

  function pushStateNow(label='state-now'){
    try{
      const snap = getStateSnapshot();
      if(!snap) return;
      stateStack.push(snap);
      capHistoryIfNeeded();
      stateRedoStack.length = 0;
      updateUndoRedoButtons();
      renderHistoryStrip();
      // Persist last session immediately
      saveLastSession(snap);
    }catch(e){ console.warn('pushStateNow failed', e); }
  }

  function jumpToHistoryIndex(index){
    const target = stateStack[index];
    if(!target) return;
    // Move future entries to redo stack
    const future = stateStack.slice(index + 1);
    stateRedoStack.length = 0;
    for(const s of future) stateRedoStack.push(s);
    // Trim state stack to selected index as current
    stateStack.length = index + 1;
    restoreState(target).then(()=>{
      updateUndoRedoButtons();
      renderHistoryStrip();
    });
  }

  function renderHistoryStrip(){
    if(!historyStrip) return;
    try{
      historyStrip.innerHTML = '';
      const currentIdx = stateStack.length - 1;
      for(let i=0;i<stateStack.length;i++){
        const st = stateStack[i];
        const btn = document.createElement('button');
        btn.className = 'hthumb' + (i===currentIdx ? ' current' : '');
        btn.title = i===currentIdx ? 'Current state' : 'Jump to state';
        btn.tabIndex = 0;
        const imgEl = document.createElement('img');
        imgEl.src = st.base;
        imgEl.alt = 'history state ' + (i+1);
        btn.appendChild(imgEl);
        // Add small mask thumbnail shown on hover
        const maskMini = document.createElement('img');
        maskMini.className = 'mask-mini';
        maskMini.src = st.mask;
        maskMini.alt = 'mask mini';
        btn.appendChild(maskMini);
        // Add small sketch thumbnail shown on hover
        if(st.sketch){
          const sketchMini = document.createElement('img');
          sketchMini.className = 'sketch-mini';
          sketchMini.src = st.sketch;
          sketchMini.alt = 'sketch mini';
          btn.appendChild(sketchMini);
        }
        // Toggle chips for mask/sketch
        const toggles = document.createElement('div');
        toggles.style.position='absolute'; toggles.style.left='2px'; toggles.style.top='2px'; toggles.style.display='flex'; toggles.style.gap='2px';
        const mBtn = document.createElement('button'); mBtn.textContent='M'; mBtn.title='Toggle mask overlay'; mBtn.style.fontSize='10px'; mBtn.style.padding='0 4px';
        const sBtn = document.createElement('button'); sBtn.textContent='S'; sBtn.title='Toggle sketch overlay'; sBtn.style.fontSize='10px'; sBtn.style.padding='0 4px';
        let maskOn = true, sketchOn = true;
        mBtn.addEventListener('click', (e)=>{ e.stopPropagation(); maskOn=!maskOn; maskMini.style.display = maskOn ? '' : 'none'; });
        sBtn.addEventListener('click', (e)=>{ e.stopPropagation(); const sm = btn.querySelector('.sketch-mini'); if(sm){ sketchOn=!sketchOn; sm.style.display = sketchOn ? '' : 'none'; }});
        toggles.appendChild(mBtn); toggles.appendChild(sBtn); btn.appendChild(toggles);
        btn.addEventListener('click', ()=> jumpToHistoryIndex(i));
        btn.addEventListener('keydown', (e)=>{
          if(e.key==='Enter') jumpToHistoryIndex(i);
        });
        historyStrip.appendChild(btn);
      }
    }catch(e){ console.warn('renderHistoryStrip failed', e); }
  }

  function drawLineTo(x,y){
    const {x:cx, y:cy} = clampToImage(x,y);
    setMaskBrush(maskBinCtx);
    maskBinCtx.strokeStyle = 'rgba(255,255,255,1)';
    maskBinCtx.globalCompositeOperation = 'source-over';
    maskBinCtx.lineTo(cx, cy);
    maskBinCtx.stroke();
    drawMaskOverlay();
  }

  function drawSketchLineTo(x,y){
    const {x:cx, y:cy} = clampToImage(x,y);
    setSketchBrush(sketchCtx);
    sketchCtx.strokeStyle = sketchColor;
    sketchCtx.globalCompositeOperation = sketchEraser ? 'destination-out' : 'source-over';
    sketchCtx.lineTo(cx, cy);
    sketchCtx.stroke();
    sketchDirty = true;
    drawMaskOverlay();
  }

  function startStroke(evt){
    if(!img) return;
    if(toolMode !== 'mask' && toolMode !== 'sketch') return;
    drawing = true;
    drawingTarget = (toolMode === 'sketch') ? 'sketch' : 'mask';
    const p = toCanvasCoords(evt);
    lastX = p.x; lastY = p.y;
    const {x,y} = clampToImage(lastX, lastY);
    if(drawingTarget==='mask'){
      maskBinCtx.beginPath();
      maskBinCtx.moveTo(x, y);
    } else {
      setSketchBrush(sketchCtx);
      sketchCtx.beginPath();
      sketchCtx.moveTo(x, y);
      sketchDirty = true;
    }
  }

  function moveStroke(evt){
    if(!drawing) return;
    const p = toCanvasCoords(evt);
    let x = p.x, y = p.y;
    if(isShift){
      const dx = Math.abs(x - lastX);
      const dy = Math.abs(y - lastY);
      if(dx > dy) y = lastY; else x = lastX;
    }
    if(drawingTarget==='mask') drawLineTo(x, y); else drawSketchLineTo(x, y);
    lastX = x; lastY = y;
  }

  function endStroke(){
    if(!drawing) return;
    drawing = false;
    if(drawingTarget==='mask'){
      try{ maskBinCtx.closePath(); }catch{}
      snapshotMask();
      pushState('mask-change');
    } else {
      try{ sketchCtx.closePath(); }catch{}
      drawMaskOverlay();
      pushState('sketch-change');
    }
  }

  function onFileSelected(file){
    if(!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const full = reader.result;
      try{
        await addToGallery(full);
      }catch{}
      const image = new Image();
      image.onload = () => {
        if(insertMode === 'overlay' && img){
          addOverlayLayerFromImage(image);
        } else {
          img = image;
          imgNaturalW = image.naturalWidth;
          imgNaturalH = image.naturalHeight;
          clearMask();
          redrawAll();
          pushState('replace');
        }
      };
      image.src = full;
    };
    reader.readAsDataURL(file);
  }

  async function addToGallery(src){
    try{
      // Prepare compressed src and thumb for persistence
      const compressed = await compressImageDataUrl(src, 1280, 0.85);
      const thumb = await makeThumbnailDataUrl(src, 160);

      galleryItems.push({ src: compressed, thumb });
      if(!galleryTray) return;
      const wrap = document.createElement('div');
      wrap.className = 'thumb';
      wrap.tabIndex = 0;
      wrap.setAttribute('role','group');
      wrap.title = 'Click to insert (Replace). Shift+Enter = Overlay';
      const imgEl = document.createElement('img');
      imgEl.src = thumb || compressed;
      imgEl.alt = 'uploaded image';
      wrap.appendChild(imgEl);
      // Menu button
      const menuBtn = document.createElement('button');
      menuBtn.className = 'thumb-menu';
      menuBtn.type = 'button';
      menuBtn.title = 'More';
      menuBtn.textContent = '•••';
      wrap.appendChild(menuBtn);
      // Popover
      const pop = document.createElement('div');
      pop.className = 'thumb-popover';
      pop.hidden = true;
      pop.innerHTML = `
        <button type="button" data-action="insert-replace">Insert (Replace)</button>
        <button type="button" data-action="insert-overlay">Insert (Overlay)</button>
        <button type="button" data-action="remove">Remove</button>
      `;
      wrap.appendChild(pop);

      function insertReplace(){
        const image = new Image();
        image.onload = ()=>{
          img = image;
          imgNaturalW = image.naturalWidth;
          imgNaturalH = image.naturalHeight;
          clearMask();
          redrawAll();
          pushState('replace');
        };
        image.src = compressed;
      }
      function insertOverlay(){
        const image = new Image();
        image.onload = ()=> addOverlayLayerFromImage(image);
        image.src = compressed;
      }
      function removeSelf(){
        try{
          galleryTray.removeChild(wrap);
          const idx = galleryItems.findIndex(i=>i.src===compressed);
          if(idx>=0){ galleryItems.splice(idx,1); saveGallery(); }
        }catch{}
      }

      wrap.addEventListener('click', (e)=>{
        if(e.target === menuBtn) return; // menu toggle handled below
        insertReplace();
      });
      wrap.addEventListener('keydown', (e)=>{
        if(e.key === 'Enter' && !e.shiftKey){ insertReplace(); }
        else if(e.key === 'Enter' && e.shiftKey){ insertOverlay(); }
      });
      menuBtn.addEventListener('click', ()=>{ pop.hidden = !pop.hidden; });
      pop.addEventListener('click', (e)=>{
        const t = e.target;
        if(!(t instanceof HTMLElement)) return;
        const action = t.getAttribute('data-action');
        pop.hidden = true;
        if(action === 'insert-replace') insertReplace();
        if(action === 'insert-overlay') insertOverlay();
        if(action === 'remove') removeSelf();
      });

      galleryTray.appendChild(wrap);
      saveGallery();
      enforceGalleryCap();
      await enforceStorageBudget();
      updateStorageUsageUI();
    }catch(e){ console.warn('addToGallery failed', e); }
  }

  function saveGallery(){
    try{
      const data = galleryItems.map(i=>({ src: i.src, thumb: i.thumb }));
      localStorage.setItem(GALLERY_KEY, JSON.stringify(data));
    }catch(e){ console.warn('saveGallery failed', e); }
  }

  function estimateLocalStorageBytes(){
    try{
      let total = 0;
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        const v = localStorage.getItem(k);
        total += (k?.length || 0) + (v?.length || 0);
      }
      return total;
    }catch{ return 0; }
  }

  async function enforceStorageBudget(){
    try{
      let bytes = estimateLocalStorageBytes();
      if(bytes <= STORAGE_BUDGET_BYTES) return;
      // Try to recompress newest items more aggressively first
      for(let i = galleryItems.length - 1; i >= 0 && bytes > STORAGE_BUDGET_BYTES; i--){
        const it = galleryItems[i];
        const recompressed = await compressImageDataUrl(it.src, 1024, 0.7);
        const thumb = await makeThumbnailDataUrl(it.thumb || it.src, 140);
        it.src = recompressed;
        it.thumb = thumb;
        saveGallery();
        bytes = estimateLocalStorageBytes();
      }
      // If still over, trim oldest until under budget
      while(bytes > STORAGE_BUDGET_BYTES && galleryItems.length > 0){
        galleryItems.shift();
        if(galleryTray && galleryTray.firstChild){ galleryTray.removeChild(galleryTray.firstChild); }
        saveGallery();
        bytes = estimateLocalStorageBytes();
      }
      if(bytes > STORAGE_BUDGET_BYTES){
        showToast('Storage near limit; some items may not persist.', 'warning');
      }
      updateStorageUsageUI();
    }catch(e){ console.warn('enforceStorageBudget failed', e); }
  }

  function updateStorageUsageUI(){
    try{
      const bytes = estimateLocalStorageBytes();
      const pct = Math.min(100, Math.round((bytes / (5 * 1024 * 1024)) * 100));
      if(storageUsageFill){ storageUsageFill.style.width = pct + '%'; }
      if(storageUsageText){
        const mb = (bytes / (1024 * 1024));
        storageUsageText.textContent = `${mb.toFixed(1)} / 5.0 MB`;
      }
    }catch{}
  }

  // -------- Phase 3: Last session + Projects (Local + Cloud) --------
  function saveLastSession(snap){
    try{ localStorage.setItem(LAST_SESSION_KEY, JSON.stringify(snap)); }catch{}
  }
  async function restoreLastSession(){
    try{
      const raw = localStorage.getItem(LAST_SESSION_KEY);
      if(!raw) return false;
      const snap = JSON.parse(raw);
      // Reset stacks and restore
      stateStack.length = 0; stateRedoStack.length = 0;
      await restoreState(snap);
      stateStack.push(snap);
      updateUndoRedoButtons();
      renderHistoryStrip();
      return true;
    }catch(e){ console.warn('restoreLastSession failed', e); return false; }
  }

  function getLocalProjects(){
    try{ return JSON.parse(localStorage.getItem(PROJECTS_KEY) || '[]'); }catch{ return []; }
  }
  function setLocalProjects(arr){
    try{ localStorage.setItem(PROJECTS_KEY, JSON.stringify(arr)); }catch(e){ console.warn('setLocalProjects failed', e); }
  }
  async function saveProjectLocal(name){
    const snap = getStateSnapshot(); if(!snap){ showToast('Nothing to save', 'warning'); return; }
    const id = `p_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
    const proj = { id, name: name || ('Project ' + new Date().toLocaleString()), snap, updatedAt: Date.now() };
    const list = getLocalProjects();
    list.unshift(proj);
    setLocalProjects(list);
    await enforceStorageBudget();
    showToast('Saved locally', 'success');
  }
  async function renameProjectLocal(id, name){
    const list = getLocalProjects();
    const it = list.find(p=>p.id===id); if(!it) return;
    it.name = name; it.updatedAt = Date.now();
    setLocalProjects(list); showToast('Renamed', 'success');
  }
  async function deleteProjectLocal(id){
    let list = getLocalProjects();
    list = list.filter(p=>p.id!==id);
    setLocalProjects(list); showToast('Deleted', 'success');
  }
  async function openProjectLocal(id){
    const it = getLocalProjects().find(p=>p.id===id); if(!it) return;
    await restoreState(it.snap);
    stateStack.length = 0; stateRedoStack.length = 0; stateStack.push(it.snap);
    updateUndoRedoButtons(); renderHistoryStrip(); redrawAll(); renderLayersPanel();
    showToast('Project loaded', 'success');
  }

  async function saveProjectCloud(name, projectId){
    try{
      const snap = getStateSnapshot(); if(!snap){ showToast('Nothing to save', 'warning'); return null; }
      const getToken = window.clarioGetIdToken; const token = typeof getToken==='function'? await getToken(): null;
      if(!token){ await saveProjectLocal(name); return null; }
      const body = { name, projectId: projectId || null, state: snap, thumbDataUrl: snap.base };
      const res = await fetch('/api/saveProject', { method:'POST', headers:{ 'Content-Type':'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify(body) });
      const json = await res.json().catch(()=>({ ok:false }));
      if(!res.ok || !json.ok){ throw new Error(json?.userMessage || 'Save failed'); }
      showToast('Saved to cloud', 'success');
      return json.projectId;
    }catch(e){ console.error(e); showToast('Cloud save failed; saved locally instead', 'warning'); await saveProjectLocal(name); return null; }
  }

  async function fetchCloudProjects(){
    try{
      const getToken = window.clarioGetIdToken; const token = typeof getToken==='function'? await getToken(): null;
      if(!token) return [];
      const res = await fetch('/api/myProjects', { headers: { 'Authorization': `Bearer ${token}` } });
      if(!res.ok) return [];
      const json = await res.json();
      return Array.isArray(json.projects)? json.projects : [];
    }catch{ return []; }
  }
  async function loadCloudProject(projectId){
    try{
      const getToken = window.clarioGetIdToken; const token = typeof getToken==='function'? await getToken(): null;
      if(!token) throw new Error('Not authenticated');
      const res = await fetch(`/api/project/${projectId}`, { headers:{ 'Authorization': `Bearer ${token}` } });
      const json = await res.json();
      if(!res.ok || !json.ok || !json.state) throw new Error(json.userMessage || 'Load failed');
      await restoreState(json.state);
      stateStack.length = 0; stateRedoStack.length = 0; stateStack.push(json.state);
      updateUndoRedoButtons(); renderHistoryStrip(); redrawAll(); renderLayersPanel();
      showToast('Loaded from cloud', 'success');
    }catch(e){ console.error(e); showToast('Failed to load cloud project', 'error'); }
  }
  async function deleteCloudProject(projectId){
    try{
      const getToken = window.clarioGetIdToken; const token = typeof getToken==='function'? await getToken(): null;
      if(!token) throw new Error('Not authenticated');
      const res = await fetch(`/api/project/${projectId}`, { method: 'DELETE', headers:{ 'Authorization': `Bearer ${token}` } });
      if(!res.ok){ const j=await res.json().catch(()=>({})); throw new Error(j.userMessage || 'Delete failed'); }
      showToast('Deleted from cloud', 'success');
    }catch(e){ console.error(e); showToast('Failed to delete cloud project', 'error'); }
  }

  function renderCreationsList(mode='local'){
    if(!creationsList) return;
    creationsList.innerHTML = '';
    if(mode==='local'){
      const items = getLocalProjects();
      for(const it of items){
        const row = document.createElement('div'); row.style.display='flex'; row.style.alignItems='center'; row.style.gap='8px';
        const imgEl = document.createElement('img'); imgEl.src = it.snap.base; imgEl.width=64; imgEl.height=48; imgEl.style.objectFit='cover'; imgEl.alt = it.name;
        const name = document.createElement('span'); name.textContent = it.name; name.style.flex='1'; name.style.fontSize='12px'; name.style.whiteSpace='nowrap'; name.style.overflow='hidden'; name.style.textOverflow='ellipsis';
        const openBtn = document.createElement('button'); openBtn.className='btn btn-light'; openBtn.textContent='Open';
        openBtn.addEventListener('click', ()=>{ creationsPopover?.setAttribute('hidden',''); openProjectLocal(it.id); });
        const renameBtn = document.createElement('button'); renameBtn.className='btn btn-light'; renameBtn.textContent='Rename';
        renameBtn.addEventListener('click', async ()=>{ const nv = prompt('Rename project', it.name); if(nv){ await renameProjectLocal(it.id, nv); renderCreationsList('local'); }});
        const delBtn = document.createElement('button'); delBtn.className='btn btn-light'; delBtn.textContent='Delete';
        delBtn.addEventListener('click', async ()=>{ if(confirm('Delete this project?')){ await deleteProjectLocal(it.id); renderCreationsList('local'); }});
        row.appendChild(imgEl); row.appendChild(name); row.appendChild(openBtn); row.appendChild(renameBtn); row.appendChild(delBtn);
        creationsList.appendChild(row);
      }
      if(items.length===0){ const empty=document.createElement('div'); empty.textContent='No local projects yet.'; empty.style.fontSize='12px'; creationsList.appendChild(empty); }
    } else {
      // cloud
      fetchCloudProjects().then(items=>{
        creationsList.innerHTML='';
        for(const it of items){
          const row = document.createElement('div'); row.style.display='flex'; row.style.alignItems='center'; row.style.gap='8px';
          const imgEl = document.createElement('img'); imgEl.src = it.thumbUrl || ''; imgEl.width=64; imgEl.height=48; imgEl.style.objectFit='cover'; imgEl.alt = it.name || 'project';
          const name = document.createElement('span'); name.textContent = it.name || 'Untitled'; name.style.flex='1'; name.style.fontSize='12px'; name.style.whiteSpace='nowrap'; name.style.overflow='hidden'; name.style.textOverflow='ellipsis';
          const openBtn = document.createElement('button'); openBtn.className='btn btn-light'; openBtn.textContent='Open';
          openBtn.addEventListener('click', ()=>{ creationsPopover?.setAttribute('hidden',''); loadCloudProject(it.id); });
          const delBtn = document.createElement('button'); delBtn.className='btn btn-light'; delBtn.textContent='Delete';
          delBtn.addEventListener('click', async ()=>{ if(confirm('Delete from cloud?')){ await deleteCloudProject(it.id); renderCreationsList('cloud'); }});
          row.appendChild(imgEl); row.appendChild(name); row.appendChild(openBtn); row.appendChild(delBtn);
          creationsList.appendChild(row);
        }
        if(items.length===0){ const empty=document.createElement('div'); empty.textContent='No cloud projects yet.'; empty.style.fontSize='12px'; creationsList.appendChild(empty); }
      });
    }
  }

  function enforceGalleryCap(){
    const cap = Math.max(10, Math.min(100, Number(galleryCap)||50));
    while(galleryItems.length > cap){
      // Remove oldest item from array and UI
      galleryItems.shift();
      try{
        if(galleryTray && galleryTray.firstChild){
          galleryTray.removeChild(galleryTray.firstChild);
        }
      }catch{}
    }
    saveGallery();
    updateStorageUsageUI();
  }

  function clearGallery(){
    try{
      galleryItems.length = 0;
      if(galleryTray){
        while(galleryTray.firstChild){ galleryTray.removeChild(galleryTray.firstChild); }
      }
      saveGallery();
      updateStorageUsageUI();
      showToast('Gallery cleared', 'success');
    }catch(e){ console.warn('clearGallery failed', e); }
  }

  async function restoreGallery(){
    try{
      const raw = localStorage.getItem(GALLERY_KEY);
      if(!raw) return;
      const arr = JSON.parse(raw);
      for(const it of arr){
        // Do not recompress; use stored src + thumb
        await (async ()=>{
          galleryItems.push({ src: it.src, thumb: it.thumb });
          if(!galleryTray) return;
          const wrap = document.createElement('div');
          wrap.className = 'thumb';
          wrap.tabIndex = 0;
          wrap.setAttribute('role','group');
          wrap.title = 'Click to insert (Replace). Shift+Enter = Overlay';
          const imgEl = document.createElement('img');
          imgEl.src = it.thumb || it.src;
          imgEl.alt = 'uploaded image';
          wrap.appendChild(imgEl);
          const menuBtn = document.createElement('button');
          menuBtn.className = 'thumb-menu';
          menuBtn.type = 'button';
          menuBtn.title = 'More';
          menuBtn.textContent = '•••';
          wrap.appendChild(menuBtn);
          const pop = document.createElement('div');
          pop.className = 'thumb-popover';
          pop.hidden = true;
          pop.innerHTML = `
            <button type="button" data-action="insert-replace">Insert (Replace)</button>
            <button type="button" data-action="insert-overlay">Insert (Overlay)</button>
            <button type="button" data-action="remove">Remove</button>
          `;
          wrap.appendChild(pop);

          function insertReplace(){
            const image = new Image();
            image.onload = ()=>{
              img = image;
              imgNaturalW = image.naturalWidth;
              imgNaturalH = image.naturalHeight;
              clearMask();
              redrawAll();
              pushState('replace');
            };
            image.src = it.src;
          }
          function insertOverlay(){
            const image = new Image();
            image.onload = ()=> addOverlayLayerFromImage(image);
            image.src = it.src;
          }
          function removeSelf(){
            try{
              galleryTray.removeChild(wrap);
              const idx = galleryItems.findIndex(g=>g.src===it.src);
              if(idx>=0){ galleryItems.splice(idx,1); saveGallery(); }
            }catch{}
          }

          wrap.addEventListener('click', (e)=>{ if(e.target === menuBtn) return; insertReplace(); });
          wrap.addEventListener('keydown', (e)=>{ if(e.key==='Enter' && !e.shiftKey) insertReplace(); else if(e.key==='Enter' && e.shiftKey) insertOverlay(); });
          menuBtn.addEventListener('click', ()=>{ pop.hidden = !pop.hidden; });
          pop.addEventListener('click', (e)=>{
            const t = e.target;
            if(!(t instanceof HTMLElement)) return;
            const action = t.getAttribute('data-action');
            pop.hidden = true;
            if(action==='insert-replace') insertReplace();
            if(action==='insert-overlay') insertOverlay();
            if(action==='remove') removeSelf();
          });

          galleryTray.appendChild(wrap);
        })();
      }
      enforceGalleryCap();
      await enforceStorageBudget();
      updateStorageUsageUI();
    }catch(e){ console.warn('restoreGallery failed', e); }
  }
// ---------- Selection hit testing and snapping helpers ----------
function hitTestLayer(layer, x, y){
  // Check handles first
  const corners = getLayerCorners(layer);
  for(let i=0;i<corners.length;i++){
    if(Math.abs(corners[i].x - x) <= 8 && Math.abs(corners[i].y - y) <= 8){
      return { type:'scale', handle:['nw','ne','se','sw'][i] };
    }
  }
  // Side handles (non-uniform scaling)
  const mids = [
    {p: midPoint(corners[0], corners[1]), type:'scale-y', handle:'n'},
    {p: midPoint(corners[1], corners[2]), type:'scale-x', handle:'e'},
    {p: midPoint(corners[2], corners[3]), type:'scale-y', handle:'s'},
    {p: midPoint(corners[3], corners[0]), type:'scale-x', handle:'w'}
  ];
  for(const m of mids){
    if(Math.abs(m.p.x - x) <= 8 && Math.abs(m.p.y - y) <= 8){ return { type:m.type, handle:m.handle }; }
  }
  // Rotation handle
  const topCenter = midPoint(corners[0], corners[1]);
  const center = getLayerCenter(layer);
  const dir = normalize({x: topCenter.x - center.x, y: topCenter.y - center.y});
  const rotHandle = { x: topCenter.x + dir.x * 30, y: topCenter.y + dir.y * 30 };
  if(Math.hypot(rotHandle.x - x, rotHandle.y - y) <= 10){ return { type:'rotate' }; }
  // Inside rotated rect?
  const local = invertLayerPoint(layer, x, y);
  if(Math.abs(local.x) <= layer.w/2 && Math.abs(local.y) <= layer.h/2){ return { type:'move' }; }
  return null;
}

function normalize(v){ const m = Math.hypot(v.x,v.y)||1; return { x:v.x/m, y:v.y/m }; }

function applySnapping(layer){
  const bounds = getDisplayBounds();
  const center = getLayerCenter(layer);
  // Snap center to canvas center
  const cx = bounds.x + bounds.w/2;
  const cy = bounds.y + bounds.h/2;
  if(Math.abs(center.x - cx) < SNAP_PX) layer.x = cx;
  if(Math.abs(center.y - cy) < SNAP_PX) layer.y = cy;

  // Compute snapping offsets for edges/corners
  const corners = getLayerCorners(layer);
  const edgesX = [bounds.x, bounds.x + bounds.w];
  const edgesY = [bounds.y, bounds.y + bounds.h];
  const centerXs = [cx];
  const centerYs = [cy];
  // Other layers' edges (axis-aligned bbox) and corners
  for(const M of layers){
    if(M===layer || !M.visible) continue;
    const mc = getLayerCorners(M);
    const minX = Math.min(...mc.map(p=>p.x));
    const maxX = Math.max(...mc.map(p=>p.x));
    const minY = Math.min(...mc.map(p=>p.y));
    const maxY = Math.max(...mc.map(p=>p.y));
    edgesX.push(minX, maxX);
    edgesY.push(minY, maxY);
    for(const p of mc){ edgesX.push(p.x); edgesY.push(p.y); }
    // centers/midlines
    centerXs.push(M.x);
    centerYs.push(M.y);
  }
  let bestDX = 0, bestDY = 0; let dxDist = SNAP_PX+1, dyDist = SNAP_PX+1; let bestVX=null, bestVY=null;
  for(const p of corners){
    for(const ex of edgesX){ const d = ex - p.x; const ad = Math.abs(d); if(ad < dxDist){ dxDist = ad; bestDX = d; bestVX = ex; } }
    for(const ey of edgesY){ const d = ey - p.y; const ad = Math.abs(d); if(ad < dyDist){ dyDist = ad; bestDY = d; bestVY = ey; } }
  }
  snapGuides = [];
  if(dxDist <= SNAP_PX){ layer.x += bestDX; if(bestVX!==null) snapGuides.push({ x1: bestVX, y1: bounds.y, x2: bestVX, y2: bounds.y + bounds.h }); }
  if(dyDist <= SNAP_PX){ layer.y += bestDY; if(bestVY!==null) snapGuides.push({ x1: bounds.x, y1: bestVY, x2: bounds.x + bounds.w, y2: bestVY }); }
  // Center/midline snapping
  let cdx = SNAP_PX+1, cdy = SNAP_PX+1, cdxVal = 0, cdyVal = 0, cBestX=null, cBestY=null;
  for(const ex of centerXs){ const d = ex - layer.x; const ad = Math.abs(d); if(ad < cdx){ cdx = ad; cdxVal = d; cBestX = ex; } }
  for(const ey of centerYs){ const d = ey - layer.y; const ad = Math.abs(d); if(ad < cdy){ cdy = ad; cdyVal = d; cBestY = ey; } }
  if(cdx <= SNAP_PX){ layer.x += cdxVal; if(cBestX!==null) snapGuides.push({ x1: cBestX, y1: bounds.y, x2: cBestX, y2: bounds.y + bounds.h }); }
  if(cdy <= SNAP_PX){ layer.y += cdyVal; if(cBestY!==null) snapGuides.push({ x1: bounds.x, y1: cBestY, x2: bounds.x + bounds.w, y2: cBestY }); }
}

// ---------- Layers panel rendering ----------
function renderLayersPanel(){
  try{
    const list = document.getElementById('layers-list');
    const panel = document.getElementById('layers-panel');
    if(!list) return;
    // Ensure toolbar exists
    if(panel){
      let tb = panel.querySelector('#layers-toolbar');
      if(!tb){
        tb = document.createElement('div'); tb.id='layers-toolbar';
        tb.style.display='flex'; tb.style.flexWrap='wrap'; tb.style.gap='4px'; tb.style.marginBottom='6px';
        const mk = (txt, title, on)=>{ const b=document.createElement('button'); b.textContent=txt; b.title=title; b.className='btn btn-light'; b.style.padding='2px 6px'; b.addEventListener('click',(e)=>{e.stopPropagation(); on();}); return b; };
        tb.appendChild(mk('L','Align Left',()=>alignSelected('left')));
        tb.appendChild(mk('C','Align H-Center',()=>alignSelected('hcenter')));
        tb.appendChild(mk('R','Align Right',()=>alignSelected('right')));
        tb.appendChild(mk('T','Align Top',()=>alignSelected('top')));
        tb.appendChild(mk('M','Align V-Middle',()=>alignSelected('vmiddle')));
        tb.appendChild(mk('B','Align Bottom',()=>alignSelected('bottom')));
        tb.appendChild(mk('DH','Distribute Horizontally',()=>distributeSelected('h')));
        tb.appendChild(mk('DV','Distribute Vertically',()=>distributeSelected('v')));
        panel.insertBefore(tb, list);
      }
    }
    list.innerHTML = '';
    for(let i=layers.length-1;i>=0;i--){
      const L = layers[i];
      const row = document.createElement('div');
      const isSel = selectedLayerIds.has(L.id) || L.id===selectedLayerId;
      row.className = 'layer-item' + (isSel?' current':'');
      row.dataset.layerId = L.id;
      row.draggable = true;
      // drag reorder
      row.addEventListener('dragstart', (e)=>{
        e.dataTransfer?.setData('text/plain', L.id);
      });
      row.addEventListener('dragover', (e)=>{ e.preventDefault(); });
      row.addEventListener('drop', (e)=>{
        e.preventDefault();
        const srcId = e.dataTransfer?.getData('text/plain');
        if(!srcId) return;
        const src = layers.find(x=>x.id===srcId);
        if(!src || src===L) return;
        const a = layers.indexOf(src);
        const b = layers.indexOf(L);
        if(a<0||b<0) return;
        layers.splice(a,1);
        const insertAt = (a<b) ? b : b+1;
        layers.splice(insertAt,0,src);
        redrawAll(); renderLayersPanel(); pushState('reorder');
      });
      // visibility toggle
      const eye = document.createElement('button'); eye.textContent = L.visible ? '👁' : '🙈'; eye.title='Toggle visibility';
      eye.addEventListener('click', (e)=>{ e.stopPropagation(); L.visible = !L.visible; eye.textContent = L.visible?'👁':'🙈'; redrawAll(); });
      // lock toggle
      const lock = document.createElement('button'); lock.textContent = L.locked ? '🔒' : '🔓'; lock.title='Toggle lock';
      lock.addEventListener('click', (e)=>{ e.stopPropagation(); L.locked=!L.locked; lock.textContent = L.locked?'🔒':'🔓'; });
      // thumb
      const thumb = document.createElement('canvas'); thumb.width=40; thumb.height=28; thumb.style.flex='0 0 auto';
      try{
        const tctx = thumb.getContext('2d');
        tctx.imageSmoothingQuality = 'high';
        const sx = L.w, sy=L.h; const sc = Math.min(40/sx, 28/sy);
        const dw = Math.max(1, Math.round(sx*sc)); const dh = Math.max(1, Math.round(sy*sc));
        const dx = Math.floor((40-dw)/2), dy=Math.floor((28-dh)/2);
        tctx.clearRect(0,0,40,28);
        if(L.img) tctx.drawImage(L.img, dx, dy, dw, dh);
      }catch{}
      // name input
      const name = document.createElement('input'); name.type='text'; name.value = L.name || 'Overlay'; name.style.flex='1'; name.style.fontSize='12px'; name.style.minWidth='0';
      name.addEventListener('click', (e)=> e.stopPropagation());
      name.addEventListener('input', ()=>{ L.name = name.value; });
      name.addEventListener('change', ()=>{ pushState('rename-layer'); });
      // opacity slider
      const op = document.createElement('input'); op.type='range'; op.min='0'; op.max='100'; op.value = String(Math.round((typeof L.opacity==='number' ? L.opacity : 1)*100)); op.style.width='80px';
      op.title = 'Layer opacity';
      op.addEventListener('click', (e)=> e.stopPropagation());
      op.addEventListener('input', ()=>{ L.opacity = Math.max(0, Math.min(1, Number(op.value)/100)); redrawAll(); });
      op.addEventListener('change', ()=>{ pushState('layer-opacity'); });
      // up/down
      const up = document.createElement('button'); up.textContent='▲'; up.title='Move up';
      up.addEventListener('click', (e)=>{ e.stopPropagation(); const idx = layers.indexOf(L); if(idx>=0 && idx<layers.length-1){ layers.splice(idx,1); layers.splice(idx+1,0,L); redrawAll(); renderLayersPanel(); pushState('reorder'); } });
      const down = document.createElement('button'); down.textContent='▼'; down.title='Move down';
      down.addEventListener('click', (e)=>{ e.stopPropagation(); const idx = layers.indexOf(L); if(idx>0){ layers.splice(idx,1); layers.splice(idx-1,0,L); redrawAll(); renderLayersPanel(); pushState('reorder'); } });
      // delete
      const del = document.createElement('button'); del.textContent='🗑'; del.title='Delete layer';
      del.addEventListener('click', (e)=>{ e.stopPropagation(); const idx = layers.indexOf(L); if(idx>=0){ layers.splice(idx,1); if(selectedLayerId===L.id) selectedLayerId=null; selectedLayerIds.delete(L.id); redrawAll(); renderLayersPanel(); pushState('delete-layer'); } });
      row.appendChild(eye); row.appendChild(lock); row.appendChild(thumb); row.appendChild(name); row.appendChild(op); row.appendChild(up); row.appendChild(down); row.appendChild(del);
      row.addEventListener('click', (e)=>{
        const idx = layers.indexOf(L);
        if(e.metaKey || e.ctrlKey){
          if(selectedLayerIds.has(L.id)){ selectedLayerIds.delete(L.id); if(selectedLayerId===L.id) selectedLayerId=null; }
          else { selectedLayerIds.add(L.id); selectedLayerId = L.id; lastSelectedIndex = idx; }
        } else if(e.shiftKey && lastSelectedIndex>=0){
          const start = Math.min(lastSelectedIndex, idx); const end = Math.max(lastSelectedIndex, idx);
          selectedLayerIds.clear();
          for(let j=start;j<=end;j++){ selectedLayerIds.add(layers[j].id); }
          selectedLayerId = layers[idx].id;
        } else {
          selectedLayerIds.clear(); selectedLayerIds.add(L.id); selectedLayerId = L.id; lastSelectedIndex = idx;
        }
        renderLayersPanel(); redrawAll();
      });
      list.appendChild(row);
    }
  }catch(e){ console.warn('renderLayersPanel failed', e); }
}

function getSelectedLayers(){
  const ids = selectedLayerIds.size ? Array.from(selectedLayerIds) : (selectedLayerId ? [selectedLayerId] : []);
  return layers.filter(l=>ids.includes(l.id));
}

function getSelectionBounds(selected){
  if(!selected.length) return null;
  let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
  for(const L of selected){
    const cs = getLayerCorners(L);
    for(const p of cs){ minX=Math.min(minX,p.x); maxX=Math.max(maxX,p.x); minY=Math.min(minY,p.y); maxY=Math.max(maxY,p.y); }
  }
  return { minX,maxX,minY,maxY, cx:(minX+maxX)/2, cy:(minY+maxY)/2 };
}

function alignSelected(mode){
  const sel = getSelectedLayers(); if(sel.length<2) return;
  const b = getSelectionBounds(sel); if(!b) return;
  for(const L of sel){
    const c = getLayerCorners(L);
    const lb = { minX: Math.min(...c.map(p=>p.x)), maxX: Math.max(...c.map(p=>p.x)), minY: Math.min(...c.map(p=>p.y)), maxY: Math.max(...c.map(p=>p.y)) };
    const dx = { left: b.minX - lb.minX, right: b.maxX - lb.maxX, hcenter: ((b.cx) - (lb.minX+lb.maxX)/2) };
    const dy = { top: b.minY - lb.minY, bottom: b.maxY - lb.maxY, vmiddle: ((b.cy) - (lb.minY+lb.maxY)/2) };
    if(mode==='left' || mode==='right' || mode==='hcenter'){ L.x += dx[mode]; }
    if(mode==='top' || mode==='bottom' || mode==='vmiddle'){ L.y += dy[mode]; }
  }
  redrawAll(); pushState('align');
}

function distributeSelected(axis){
  const sel = getSelectedLayers(); if(sel.length<3) return;
  const b = getSelectionBounds(sel); if(!b) return;
  // sort by center along axis
  const arr = sel.map(L=>({ L, center: (axis==='h'? getLayerCenter(L).x : getLayerCenter(L).y) })).sort((a,b)=>a.center-b.center);
  const start = axis==='h' ? b.minX : b.minY;
  const end = axis==='h' ? b.maxX : b.maxY;
  const step = (end - start) / (arr.length - 1);
  for(let i=0;i<arr.length;i++){
    const L = arr[i].L;
    if(axis==='h') L.x = start + step * i;
    else L.y = start + step * i;
  }
  redrawAll(); pushState('distribute');
}

  // overlay compositing replaced by non-destructive layers

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

  // Event listeners
  window.addEventListener('resize', resizeCanvases);
  document.addEventListener('keydown', (e)=>{
    if(e.key==='Shift') isShift = true;
    // Ignore shortcuts while typing in inputs/textareas/contenteditable
    const ae = document.activeElement;
    const typing = ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable);
    const L = getSelectedLayer();
    if(toolMode==='select' && L && !L.locked && !typing){
      const step = e.shiftKey ? 10 : 1;
      if(e.key==='ArrowLeft'){ e.preventDefault(); L.x -= step; redrawAll(); }
      if(e.key==='ArrowRight'){ e.preventDefault(); L.x += step; redrawAll(); }
      if(e.key==='ArrowUp'){ e.preventDefault(); L.y -= step; redrawAll(); }
      if(e.key==='ArrowDown'){ e.preventDefault(); L.y += step; redrawAll(); }
      // Reorder shortcuts
      if((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key===']'){ e.preventDefault(); reorderSelectedLayer('up'); }
      if((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key==='['){ e.preventDefault(); reorderSelectedLayer('down'); }
      if((e.metaKey || e.ctrlKey) && e.shiftKey && e.key===']'){ e.preventDefault(); reorderSelectedLayer('front'); }
      if((e.metaKey || e.ctrlKey) && e.shiftKey && e.key==='['){ e.preventDefault(); reorderSelectedLayer('back'); }
      // Duplicate
      if((e.metaKey || e.ctrlKey) && (e.key==='d' || e.key==='D')){ e.preventDefault(); duplicateSelectedLayer(); }
      // Delete
      if(e.key==='Delete' || e.key==='Backspace'){ e.preventDefault(); if(selectedLayerId){ const idx = layers.findIndex(l=>l.id===selectedLayerId); if(idx>=0){ layers.splice(idx,1); selectedLayerId=null; redrawAll(); renderLayersPanel(); pushState('delete-layer'); } } }
      // Quick Edit
      if(e.key==='q' || e.key==='Q'){ e.preventDefault(); applyEdit(); }
      // Export (composite PNG)
      if(e.key==='e' || e.key==='E'){ e.preventDefault(); (async ()=>{ try{ const blob = await exportCurrent('png', 1, false); if(blob) downloadBlob(blob, 'clario-image.png'); }catch(e){} })(); }
    }
  });
  document.addEventListener('keyup', (e)=>{ if(e.key==='Shift') isShift = false; });

  maskCanvas.addEventListener('mousedown', startStroke);
  window.addEventListener('mousemove', moveStroke);
  window.addEventListener('mouseup', endStroke);
  maskCanvas.addEventListener('mouseleave', endStroke);

  // Select/Transform interactions on base canvas
  baseCanvas.addEventListener('mousedown', (e)=>{
    if(toolMode !== 'select') return;
    const p = toCanvasCoords(e);
    // Hit test topmost visible, unlocked layer
    let hit = null; let handle = null;
    for(let i=layers.length-1;i>=0;i--){
      const L = layers[i];
      if(!L.visible || L.locked) continue;
      const h = hitTestLayer(L, p.x, p.y);
      if(h){ hit = L; handle = h; break; }
    }
    if(hit){
      // Alt/Option drag to duplicate before transform
      if(e.altKey){
        const imgCopy = new Image(); imgCopy.crossOrigin='anonymous';
        imgCopy.onload = ()=>{
          const copy = { id:`layer-${Date.now()}-dragdup`, name:(hit.name||'Overlay')+' copy', src: hit.src, img: imgCopy, w: hit.w, h: hit.h, x: hit.x+12, y: hit.y+12, scale: hit.scale, rotation: hit.rotation, opacity: hit.opacity, visible: hit.visible, locked:false };
          layers.push(copy); selectedLayerId = copy.id; selectedLayerIds.clear(); selectedLayerIds.add(copy.id); lastSelectedIndex = layers.indexOf(copy); startDragOnLayer(copy, handle, e);
        };
        imgCopy.src = hit.src;
        return;
      }
      selectedLayerId = hit.id; selectedLayerIds.clear(); selectedLayerIds.add(hit.id); lastSelectedIndex = layers.indexOf(hit); startDragOnLayer(hit, handle, e);
      redrawAll();
    } else {
      selectedLayerId = null; selectedLayerIds.clear(); drag = null; snapGuides = []; redrawAll(); renderLayersPanel();
    }
  });

  function startDragOnLayer(hit, hitHandle, mouseEvent){
    const p = toCanvasCoords(mouseEvent);
    snapGuides = [];
    drag = {
      mode: hitHandle.type,
      handle: hitHandle.handle,
      layerId: hit.id,
      startX: p.x, startY: p.y,
      origX: hit.x, origY: hit.y,
      origScale: (typeof hit.scale==='number')? hit.scale : (typeof hit.scaleX==='number'? hit.scaleX : 1),
      origScaleX: (typeof hit.scaleX==='number')? hit.scaleX : (typeof hit.scale==='number'? hit.scale : 1),
      origScaleY: (typeof hit.scaleY==='number')? hit.scaleY : (typeof hit.scale==='number'? hit.scale : 1),
      origRot: hit.rotation || 0,
      startLocal: invertLayerPoint(hit, p.x, p.y),
      anchorLocal: null,
      anchorWorld: null
    };
    // Anchor at opposite edge/corner for non-Alt scaling (Alt scales from center)
    if(drag.mode === 'scale-x'){
      const opp = drag.handle === 'e' ? {x: -hit.w/2, y: 0} : {x: hit.w/2, y: 0};
      drag.anchorLocal = opp; drag.anchorWorld = applyLayerTransform(hit, opp.x, opp.y);
    } else if(drag.mode === 'scale-y'){
      const opp = drag.handle === 's' ? {x: 0, y: -hit.h/2} : {x: 0, y: hit.h/2};
      drag.anchorLocal = opp; drag.anchorWorld = applyLayerTransform(hit, opp.x, opp.y);
    } else if(drag.mode === 'scale'){
      const map = { nw:{x: hit.w/2, y: hit.h/2}, ne:{x: -hit.w/2, y: hit.h/2}, se:{x: -hit.w/2, y: -hit.h/2}, sw:{x: hit.w/2, y: -hit.h/2} };
      const opp = map[drag.handle] || null;
      if(opp){ drag.anchorLocal = opp; drag.anchorWorld = applyLayerTransform(hit, opp.x, opp.y); }
    }
    renderLayersPanel();
    redrawAll();
  }
  window.addEventListener('mousemove', (e)=>{
    if(toolMode !== 'select' || !drag) return;
    const p = toCanvasCoords(e);
    const L = getSelectedLayer();
    if(!L) return;
    const dx = p.x - drag.startX;
    const dy = p.y - drag.startY;
    if(drag.mode === 'move'){
      L.x = drag.origX + dx; L.y = drag.origY + dy;
      applySnapping(L);
    } else if(drag.mode === 'rotate'){
      const c = getLayerCenter(L);
      const ang = Math.atan2(p.y - c.y, p.x - c.x) - Math.atan2(drag.startY - c.y, drag.startX - c.x);
      let a = drag.origRot + ang;
      if(isShift){
        const step = Math.PI/12; // 15 degrees
        a = Math.round(a / step) * step;
      }
      L.rotation = a;
    } else if(drag.mode === 'scale'){
      // Scale uniformly based on distance change from center to handle point
      const c = getLayerCenter(L);
      const startDist = Math.hypot(drag.startX - c.x, drag.startY - c.y);
      const curDist = Math.hypot(p.x - c.x, p.y - c.y);
      const s = Math.max(0.05, drag.origScale * (curDist / Math.max(1, startDist)));
      L.scaleX = s; L.scaleY = s; L.scale = undefined;
      // Default: keep opposite corner fixed; Alt: scale from center
      if(!e.altKey && drag.anchorLocal){
        const now = applyLayerTransform(L, drag.anchorLocal.x, drag.anchorLocal.y);
        L.x += (drag.anchorWorld.x - now.x); L.y += (drag.anchorWorld.y - now.y);
      }
    } else if(drag.mode === 'scale-x'){
      const curLocal = invertLayerPoint(L, p.x, p.y);
      const ratio = Math.abs(curLocal.x) / Math.max(1, Math.abs(drag.startLocal.x || 1));
      const s = Math.max(0.05, drag.origScaleX * ratio);
      L.scaleX = s; L.scale = undefined;
      if(!e.altKey && drag.anchorLocal){
        const now = applyLayerTransform(L, drag.anchorLocal.x, drag.anchorLocal.y);
        L.x += (drag.anchorWorld.x - now.x); L.y += (drag.anchorWorld.y - now.y);
      }
    } else if(drag.mode === 'scale-y'){
      const curLocal = invertLayerPoint(L, p.x, p.y);
      const ratio = Math.abs(curLocal.y) / Math.max(1, Math.abs(drag.startLocal.y || 1));
      const s = Math.max(0.05, drag.origScaleY * ratio);
      L.scaleY = s; L.scale = undefined;
      if(!e.altKey && drag.anchorLocal){
        const now = applyLayerTransform(L, drag.anchorLocal.x, drag.anchorLocal.y);
        L.x += (drag.anchorWorld.x - now.x); L.y += (drag.anchorWorld.y - now.y);
      }
    }
    redrawAll();
  });
  window.addEventListener('mouseup', ()=>{
    if(toolMode !== 'select') return;
    if(drag){ drag = null; snapGuides = []; redrawAll(); pushState('transform'); }
  });

  undoBtn.addEventListener('click', async ()=>{
    // We need at least 2 states to undo to a previous one
    if(stateStack.length <= 1) return;
    const current = stateStack.pop();
    if(current) stateRedoStack.push(current);
    const prev = stateStack[stateStack.length - 1];
    await restoreState(prev);
    updateUndoRedoButtons();
    renderHistoryStrip();
  });

  redoBtn.addEventListener('click', async ()=>{
    if(stateRedoStack.length === 0) return;
    const next = stateRedoStack.pop();
    if(!next) return;
    stateStack.push(next);
    await restoreState(next);
    updateUndoRedoButtons();
    renderHistoryStrip();
  });

  fileInput.addEventListener('change', ()=>{
    const file = fileInput.files && fileInput.files[0];
    onFileSelected(file);
  });

  uploadLabel.addEventListener('keydown', (e)=>{
    if(e.key==='Enter' || e.key===' '){ 
      fileInput.click(); 
    }
  });

  // Export popover
  if(exportBtn){
    exportBtn.addEventListener('click', (e)=>{
      e.stopPropagation();
      const isHidden = exportPopover.hasAttribute('hidden');
      if(isHidden) exportPopover.removeAttribute('hidden'); else exportPopover.setAttribute('hidden','');
      exportBtn.setAttribute('aria-expanded', String(isHidden));
    });
  }
  document.addEventListener('click', (e)=>{
    if(!exportPopover) return;
    if(!exportPopover.hasAttribute('hidden')){
      const path = e.composedPath ? e.composedPath() : [];
      if(!path.includes(exportPopover) && !path.includes(exportBtn)){
        exportPopover.setAttribute('hidden','');
        if(exportBtn) exportBtn.setAttribute('aria-expanded','false');
      }
    }
  });
  if(exportQualityEl && exportQualityValueEl){
    exportQualityValueEl.textContent = String(exportQualityEl.value);
    exportQualityEl.addEventListener('input', ()=>{
      exportQualityValueEl.textContent = String(exportQualityEl.value);
    });
  }
  if(exportRunBtn){
    exportRunBtn.addEventListener('click', async ()=>{
      try{
        const fmt = (document.querySelector('input[name="export-format"]:checked')?.value || 'png');
        const q = Math.max(0.6, Math.min(1, Number(exportQualityEl?.value || 90)/100));
        const fillWhite = !!exportFillWhiteEl?.checked || fmt==='jpeg';
        const blob = await exportCurrent(fmt, q, fillWhite);
        if(!blob){ showToast('Export failed', 'error'); return; }
        downloadBlob(blob, `clario-image.${fmt==='jpeg'?'jpg':fmt}`);
      }catch(e){ console.error(e); showToast('Export failed', 'error'); }
    });
  }
  if(exportZipBtn){
    exportZipBtn.addEventListener('click', async ()=>{
      try{
        if(typeof JSZip === 'undefined'){ showToast('Zip library not loaded', 'error'); return; }
        const zip = new JSZip();
        const png = await exportCurrent('png', 1, false);
        const jpg = await exportCurrent('jpeg', 0.9, true);
        const webp = await exportCurrent('webp', 0.9, false);
        if(png) zip.file('clario-image.png', png);
        if(jpg) zip.file('clario-image.jpg', jpg);
        if(webp) zip.file('clario-image.webp', webp);
        // Include project state JSON
        const snap = getStateSnapshot();
        if(snap){ zip.file('project.json', JSON.stringify(snap, null, 2)); }
        // Include mask png
        try{
          const maskDataUrl = maskBinary.toDataURL('image/png');
          const maskBlob = await (await fetch(maskDataUrl)).blob();
          zip.file('mask.png', maskBlob);
        }catch{}
        const content = await zip.generateAsync({ type:'blob' });
        downloadBlob(content, 'clario-export.zip');
      }catch(e){ console.error(e); showToast('Failed to create zip', 'error'); }
    });
  }
  if(exportCompositeBtn){ exportCompositeBtn.addEventListener('click', exportCompositePNG); }

  async function exportCurrent(format='png', quality=0.9, fillWhite=false){
    if(!baseCanvas) return null;
    // Composite base + layers onto a clean canvas
    const c = document.createElement('canvas');
    c.width = baseCanvas.width; c.height = baseCanvas.height;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    // Fill background if needed
    if(fillWhite){ ctx.fillStyle = '#fff'; ctx.fillRect(0,0,c.width,c.height); }
    // Draw base image at current fit
    if(img){
      const rect = baseCanvas.getBoundingClientRect();
      const fit = fitContain(rect.width, rect.height, imgNaturalW, imgNaturalH);
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      // Account for device pixel ratio since baseCanvas is scaled
      ctx.setTransform(dpr,0,0,dpr,0,0);
      ctx.filter = buildCanvasFilter();
      ctx.drawImage(img, fit.x, fit.y, fit.w, fit.h);
    }
    // Draw layers
    drawAllLayers(ctx);
    // Optional true sharpen (export-time unsharp mask)
    if(filterTrueSharpen){ try{ await applyUnsharpMask(c, 0.5); }catch{} }
    let mime = format==='jpeg' ? 'image/jpeg' : (format==='webp' ? 'image/webp' : 'image/png');
    const blob = await new Promise(resolve => c.toBlob(resolve, mime, quality));
    return blob;
  }

  async function applyUnsharpMask(canvas, amount=0.6){
    // Simple 3x3 sharpen convolution as an approximation
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    const img = ctx.getImageData(0,0,w,h);
    const src = img.data;
    const out = new Uint8ClampedArray(src.length);
    const kernel = [0,-1,0,-1,5,-1,0,-1,0];
    const ks = 3; const half = 1;
    for(let y=0;y<h;y++){
      for(let x=0;x<w;x++){
        let r=0,g=0,b=0,a=0;
        for(let ky=-half; ky<=half; ky++){
          for(let kx=-half; kx<=half; kx++){
            const px = Math.min(w-1, Math.max(0, x + kx));
            const py = Math.min(h-1, Math.max(0, y + ky));
            const idx = (py*w + px)*4;
            const kval = kernel[(ky+half)*ks + (kx+half)];
            r += src[idx  ] * kval;
            g += src[idx+1] * kval;
            b += src[idx+2] * kval;
            a += src[idx+3];
          }
        }
        const di = (y*w + x)*4;
        out[di  ] = Math.max(0, Math.min(255, r*amount + src[di]*(1-amount)));
        out[di+1] = Math.max(0, Math.min(255, g*amount + src[di+1]*(1-amount)));
        out[di+2] = Math.max(0, Math.min(255, b*amount + src[di+2]*(1-amount)));
        out[di+3] = src[di+3];
      }
    }
    for(let i=0;i<src.length;i++) src[i] = out[i];
    ctx.putImageData(img,0,0);
  }

  function downloadBlob(blob, filename){
    try{
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(()=>URL.revokeObjectURL(a.href), 2000);
    }catch{}
  }
  
  if(applyBtn){
    applyBtn.addEventListener('click', applyEdit);
  }
  // Save button
  if(saveBtn){
    saveBtn.addEventListener('click', async ()=>{
      try{
        const def = 'My Project';
        const name = prompt('Project name', def) || def;
        const getToken = window.clarioGetIdToken; const token = typeof getToken==='function'? await getToken(): null;
        if(token){ await saveProjectCloud(name); }
        else { await saveProjectLocal(name); }
      }catch(e){ console.error(e); showToast('Save failed', 'error'); }
    });
  }
  // My Creations popover and tabs
  if(creationsBtn && creationsPopover){
    creationsBtn.addEventListener('click', async (e)=>{
      e.stopPropagation();
      const isHidden = creationsPopover.hasAttribute('hidden');
      if(isHidden){
        creationsPopover.removeAttribute('hidden');
        creationsBtn.setAttribute('aria-expanded','true');
        if(tabLocalBtn){ tabLocalBtn.classList.add('active'); }
        if(tabCloudBtn){ tabCloudBtn.classList.remove('active'); }
        renderCreationsList('local');
      } else {
        creationsPopover.setAttribute('hidden','');
        creationsBtn.setAttribute('aria-expanded','false');
      }
    });
    document.addEventListener('click', (e)=>{
      if(!creationsPopover.hasAttribute('hidden')){
        const path = e.composedPath ? e.composedPath() : [];
        if(!path.includes(creationsPopover) && !path.includes(creationsBtn)){
          creationsPopover.setAttribute('hidden','');
          creationsBtn.setAttribute('aria-expanded','false');
        }
      }
    });
    if(tabLocalBtn){ tabLocalBtn.addEventListener('click', ()=>{ tabLocalBtn.classList.add('active'); tabCloudBtn?.classList.remove('active'); renderCreationsList('local'); }); }
    if(tabCloudBtn){ tabCloudBtn.addEventListener('click', ()=>{ tabCloudBtn.classList.add('active'); tabLocalBtn?.classList.remove('active'); renderCreationsList('cloud'); }); }
  }

  // Insert mode toggle
  if(insertReplaceBtn && insertOverlayBtn){
    insertReplaceBtn.addEventListener('click', ()=>{
      insertMode = 'replace';
      insertReplaceBtn.classList.add('active');
      insertOverlayBtn.classList.remove('active');
      insertReplaceBtn.setAttribute('aria-pressed','true');
      insertOverlayBtn.setAttribute('aria-pressed','false');
      showToast('Insert mode: Replace', 'info');
    });
    insertOverlayBtn.addEventListener('click', ()=>{
      insertMode = 'overlay';
      insertOverlayBtn.classList.add('active');
      insertReplaceBtn.classList.remove('active');
      insertOverlayBtn.setAttribute('aria-pressed','true');
      insertReplaceBtn.setAttribute('aria-pressed','false');
      showToast('Insert mode: Overlay', 'info');
    });
  }

  // Tool mode toggle
  if(toolMaskBtn && toolSelectBtn){
    toolMaskBtn.addEventListener('click', ()=>{
      toolMode = 'mask';
      toolMaskBtn.classList.add('active');
      toolSelectBtn.classList.remove('active');
      toolSketchBtn?.classList.remove('active');
    });
    toolSelectBtn.addEventListener('click', ()=>{
      toolMode = 'select';
      toolSelectBtn.classList.add('active');
      toolMaskBtn.classList.remove('active');
      toolSketchBtn?.classList.remove('active');
      redrawAll();
    });
    toolSketchBtn?.addEventListener('click', ()=>{
      toolMode = 'sketch';
      toolSketchBtn.classList.add('active');
      toolMaskBtn.classList.remove('active');
      toolSelectBtn.classList.remove('active');
    });
  }

  // Overlay opacity wiring
  if(overlayOpacityEl){
    overlayOpacity = Math.max(0.3, Math.min(1, (Number(overlayOpacityEl.value)||85)/100));
    overlayOpacityEl.addEventListener('input', ()=>{
      const val = Math.max(0.3, Math.min(1, (Number(overlayOpacityEl.value)||85)/100));
      const sel = getSelectedLayer();
      if(toolMode==='select' && sel){ sel.opacity = val; redrawAll(); renderLayersPanel(); }
      else overlayOpacity = val;
    });
  }

  // Settings popover wiring (History cap slider)
  if(historyCapEl && historyCapValueEl){
    try{
      const savedCap = Number(localStorage.getItem('clario_history_cap')||'20');
      if(savedCap) historyCap = Math.max(10, Math.min(50, savedCap));
    }catch{}
    historyCapEl.value = String(historyCap);
    historyCapValueEl.textContent = String(historyCap);
    historyCapEl.addEventListener('input', ()=>{
      historyCap = Math.max(10, Math.min(50, Number(historyCapEl.value)||20));
      historyCapValueEl.textContent = String(historyCap);
      try{ localStorage.setItem('clario_history_cap', String(historyCap)); }catch{}
      capHistoryIfNeeded();
      renderHistoryStrip();
      updateUndoRedoButtons();
    });
  }
  // Settings: Gallery cap + Clear
  if(galleryCapEl && galleryCapValueEl){
    try{
      const saved = Number(localStorage.getItem('clario_gallery_cap')||'50');
      if(saved) galleryCap = Math.max(10, Math.min(100, saved));
    }catch{}
    galleryCapEl.value = String(galleryCap);
    galleryCapValueEl.textContent = String(galleryCap);
    galleryCapEl.addEventListener('input', ()=>{
      galleryCap = Math.max(10, Math.min(100, Number(galleryCapEl.value)||50));
      galleryCapValueEl.textContent = String(galleryCap);
      try{ localStorage.setItem('clario_gallery_cap', String(galleryCap)); }catch{}
      enforceGalleryCap();
    });
  }
  if(galleryClearBtn){
    galleryClearBtn.addEventListener('click', ()=>{
      const confirmClear = window.confirm ? window.confirm('Clear all images from the gallery?') : true;
      if(confirmClear) clearGallery();
    });
  }
  if(galleryDownloadBtn){
    galleryDownloadBtn.addEventListener('click', async ()=>{
      try{
        if(typeof JSZip === 'undefined'){
          showToast('Zip library not loaded', 'error');
          return;
        }
        const zip = new JSZip();
        // Add images (full src if available, else thumb)
        for(let i=0;i<galleryItems.length;i++){
          const it = galleryItems[i];
          const dataUrl = it.src || it.thumb;
          if(!dataUrl) continue;
          const base64 = dataUrl.split(',')[1] || '';
          const ext = (dataUrl.startsWith('data:image/webp') ? 'webp' : dataUrl.startsWith('data:image/png') ? 'png' : 'jpg');
          zip.file(`gallery_${String(i+1).padStart(3,'0')}.${ext}`, base64, { base64: true });
        }
        const content = await zip.generateAsync({ type: 'blob' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(content);
        a.download = 'clario-gallery.zip';
        document.body.appendChild(a);
        a.click(); a.remove();
        setTimeout(()=>URL.revokeObjectURL(a.href), 2000);
      }catch(e){ console.error(e); showToast('Failed to create zip', 'error'); }
    });
  }
  if(restoreDefaultsBtn){
    restoreDefaultsBtn.addEventListener('click', ()=>{
      historyCap = 20; galleryCap = 50;
      try{
        localStorage.setItem('clario_history_cap', String(historyCap));
        localStorage.setItem('clario_gallery_cap', String(galleryCap));
      }catch{}
      if(historyCapEl){ historyCapEl.value = String(historyCap); }
      if(historyCapValueEl){ historyCapValueEl.textContent = String(historyCap); }
      if(galleryCapEl){ galleryCapEl.value = String(galleryCap); }
      if(galleryCapValueEl){ galleryCapValueEl.textContent = String(galleryCap); }
      capHistoryIfNeeded();
      renderHistoryStrip();
      updateUndoRedoButtons();
      enforceGalleryCap();
      showToast('Settings restored to defaults', 'success');
    });
  }
  if(settingsBtn && settingsPopover){
    settingsBtn.addEventListener('click', (e)=>{
      const isHidden = settingsPopover.hasAttribute('hidden');
      if(isHidden) settingsPopover.removeAttribute('hidden'); else settingsPopover.setAttribute('hidden','');
      settingsBtn.setAttribute('aria-expanded', String(isHidden));
      e.stopPropagation();
    });
    document.addEventListener('click', (e)=>{
      if(!settingsPopover.hasAttribute('hidden')){
        const path = e.composedPath ? e.composedPath() : [];
        if(!path.includes(settingsPopover) && !path.includes(settingsBtn)){
          settingsPopover.setAttribute('hidden','');
          settingsBtn.setAttribute('aria-expanded','false');
        }
      }
    });
  }

  // Add CSS for animations
  const style = document.createElement('style');
  style.textContent = `
    @keyframes slideIn {
      from { transform: translateX(100%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
    @keyframes slideOut {
      from { transform: translateX(0); opacity: 1; }
      to { transform: translateX(100%); opacity: 0; }
    }
    .toast { transition: all 0.3s ease; }
    #transparent-btn.active { 
      background: var(--accent); 
      color: white; 
    }
    .gallery-tray{
      display: flex;
      flex-wrap: nowrap;
      gap: 8px;
      overflow-x: auto;
      padding: 6px 2px;
      border-top: 1px solid rgba(0,0,0,0.07);
    }
    .gallery-tray .thumb{
      width: 72px; height: 72px; min-width:72px; min-height:72px;
      border: 1px solid rgba(0,0,0,0.1);
      border-radius: 6px;
      overflow: hidden;
      padding: 0;
      background: #fff;
      display: inline-flex; align-items:center; justify-content:center;
      cursor: pointer;
    }
    .gallery-tray .thumb img{ width: 100%; height: 100%; object-fit: cover; display:block; }
    .gallery-tray .thumb{ position: relative; }
    .gallery-tray .thumb .thumb-menu{
      position: absolute; right: 2px; top: 2px;
      padding: 0 6px; height: 20px; font-size: 12px; line-height: 20px;
      background: rgba(255,255,255,0.9); border: 1px solid rgba(0,0,0,0.1);
      border-radius: 3px; cursor: pointer;
    }
    .gallery-tray .thumb .thumb-popover{
      position: absolute; right: 2px; top: 26px; z-index: 10;
      background: #fff; border: 1px solid rgba(0,0,0,0.15); border-radius: 4px;
      box-shadow: 0 4px 14px rgba(0,0,0,0.1);
      display: flex; flex-direction: column; overflow: hidden;
    }
    .gallery-tray .thumb .thumb-popover button{
      padding: 6px 10px; border: none; background: #fff; text-align: left; cursor: pointer; font-size: 12px;
    }
    .gallery-tray .thumb .thumb-popover button:hover{ background: #f5f5f5; }
    .history-strip{ display:flex; gap:6px; overflow-x:auto; padding: 4px 2px; }
    .history-strip .hthumb{ width: 64px; height: 48px; min-width:64px; min-height:48px; border:1px solid rgba(0,0,0,0.1); border-radius:4px; overflow:hidden; padding:0; background:#fff; display:inline-flex; align-items:center; justify-content:center; cursor:pointer; }
    .history-strip .hthumb.current{ outline:2px solid var(--accent, #2e7cf6); }
    .history-strip .hthumb img{ width:100%; height:100%; object-fit:cover; display:block; }
    .history-strip .hthumb { position: relative; }
    .history-strip .hthumb .mask-mini{ position:absolute; bottom:2px; right:2px; width:20px; height:16px; border:1px solid rgba(0,0,0,0.1); display:none; background:#fff; }
    .history-strip .hthumb:hover .mask-mini{ display:block; }
    .history-strip .hthumb .sketch-mini{ position:absolute; bottom:2px; left:2px; width:20px; height:16px; border:1px solid rgba(0,0,0,0.1); display:none; background:#fff; }
    .history-strip .hthumb:hover .sketch-mini{ display:block; }
    .settings-popover{ position:absolute; background:#fff; border:1px solid rgba(0,0,0,0.15); border-radius:6px; box-shadow:0 8px 20px rgba(0,0,0,0.15); padding:6px; z-index:1000; margin-left:10px; margin-top:6px; }
    .settings-popover .settings-row{ display:flex; align-items:center; gap:8px; }
    .layers-panel{ border:1px solid rgba(0,0,0,0.1); border-radius:6px; padding:6px; max-height:240px; overflow:auto; margin-bottom:10px; }
    .layers-list .layer-item{ display:flex; align-items:center; gap:6px; padding:4px; border-radius:4px; cursor:pointer; }
    .layers-list .layer-item.current{ background:#f5f7ff; }
    .layers-list .layer-item button{ padding:2px 6px; font-size:12px; }
  `;
  document.head.appendChild(style);

  // Initialize
  resizeCanvases();
  updateUndoRedoButtons();
  try{ restoreGallery(); }catch{}
  // Try to restore last session
  try{ restoreLastSession(); }catch{}
  updateStorageUsageUI();
  renderLayersPanel();
  
  console.log('Vertex AI Image Editor initialized');
})();
