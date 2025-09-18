import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import express, { Request, Response } from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import { GoogleAuth } from 'google-auth-library';
// Use require to avoid TS type declaration issues for these native modules
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ffmpeg: any = require('fluent-ffmpeg');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ffmpegStatic: any = require('ffmpeg-static');
import { VEO_CAPABILITIES, validateVeoRequest, getVeoErrorCode, formatVeoRequestSpec } from './veo-capabilities';
import { promises as fsp } from 'fs';

admin.initializeApp();
const db = admin.firestore();
const storage = admin.storage();

const REGION = process.env.GOOGLE_LOCATION || 'us-central1';
const GCS_BUCKET = process.env.GCS_BUCKET; // set via: firebase functions:secrets:set GCS_BUCKET

// Temporary: disable all credit checks/deductions for testing
const DISABLE_VIDEO_CREDITS = true;
const DISABLE_ALL_CREDITS = true;

const app = express();
app.use(cors({ origin: true }));
// Accept larger JSON bodies to accommodate base64-encoded reference images
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ limit: '25mb', extended: true }));

// Initialize Google Auth for Veo API
let veoAuth: GoogleAuth | null = null;
// Configure ffmpeg static path
try { if (ffmpegStatic) { ffmpeg.setFfmpegPath(String(ffmpegStatic)); } } catch(_) {}

function runFfmpegConcat(prevPath: string, nextPath: string, outPath: string, includeAudio: boolean): Promise<void> {
  return new Promise((resolve, reject)=>{
    const filter = includeAudio
      ? '[0:v][0:a][1:v][1:a]concat=n=2:v=1:a=1[v][a]'
      : '[0:v][1:v]concat=n=2:v=1:a=0[v]';
    const maps = includeAudio ? ['-map','[v]','-map','[a]'] : ['-map','[v]'];
    ffmpeg()
      .addInput(prevPath)
      .addInput(nextPath)
      .outputOptions([
        '-filter_complex', filter,
        ...maps,
        '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart'
      ])
      .on('end', ()=>resolve())
      .on('error', (e: any)=>reject(e))
      .save(outPath);
  });
}

function initVeoAuth() {
  if (!veoAuth) {
    try {
      const serviceAccountBase64 = functions.config()?.veo?.service_account;
      if (serviceAccountBase64) {
        const serviceAccountJson = Buffer.from(serviceAccountBase64, 'base64').toString('utf-8');
        const credentials = JSON.parse(serviceAccountJson);
        veoAuth = new GoogleAuth({
          credentials,
          scopes: ['https://www.googleapis.com/auth/cloud-platform']
        });
      }
    } catch (err) {
      functions.logger.error('Failed to initialize Veo auth', err);
    }
  }
  return veoAuth;
}

import { processImageJob } from './vertex-image';

// DEPRECATED: Old Gemini functions - replaced by Vertex AI
// These are kept temporarily for backward compatibility but should not be used
async function generateGeminiImageEdit(
  prompt: string,
  imageBase64?: string | null,
  maskBase64?: string | null
): Promise<{ success: boolean; imageB64?: string; error?: string; providerStatus?: number; providerResponse?: string }>{
  functions.logger.warn('DEPRECATED: generateGeminiImageEdit called - use Vertex AI instead');
  return { success: false, error: 'DEPRECATED_FUNCTION' };
}

async function generatePromptImage(
  prompt: string,
  aspect: '1:1' | '16:9' | '9:16' = '1:1'
): Promise<{ success: boolean; imageB64?: string; error?: string; providerStatus?: number; providerResponse?: string }>{
  functions.logger.warn('DEPRECATED: generatePromptImage called - use Vertex AI instead');
  return { success: false, error: 'DEPRECATED_FUNCTION' };
}

// Veo 3.0 Video Generation with validation and proper error handling
async function generateVeoVideo(
  prompt: any,
  aspect: string,
  resolution: string,
  tier: 'fast' | 'advanced',
  generateAudio: boolean = false,
  image?: { bytesBase64Encoded: string; mimeType?: string },
  uid?: string
): Promise<{
  success: boolean;
  videoBytes?: string;
  error?: string;
  code?: string;
  modelUsed?: string;
  audioUsed?: boolean;
  resolutionUsed?: string;
  aspectUsed?: string;
  requestSpec?: Record<string, any>;
  providerStatus?: number;
  providerResponse?: string;
}> {
  try {
    // Normalize inputs
    const promptText = typeof prompt === 'string' ? prompt : JSON.stringify(prompt);
    const mode: 'prompt-to-video' | 'image-to-video' = image?.bytesBase64Encoded ? 'image-to-video' : 'prompt-to-video';
    
    // Validate request against capability matrix
    const validationError = validateVeoRequest(
      promptText,
      aspect,
      resolution,
      tier,
      generateAudio,
      mode,
      image
    );
    
    if (validationError) {
      functions.logger.error('Veo request validation failed', validationError);
      return {
        success: false,
        error: validationError.message,
        code: validationError.code
      };
    }
    
    const auth = initVeoAuth();
    if (!auth) {
      return { success: false, error: 'Veo authentication not configured', code: 'AUTH_MISSING' };
    }

    const client = await auth.getClient();
    const projectId = 'clario-2c575';
    const location = VEO_CAPABILITIES.location;
    const selectedModel = tier === 'advanced' ? VEO_CAPABILITIES.models.advanced : VEO_CAPABILITIES.models.fast;
    
    // Normalize resolution format
    const resolutionNormalized = resolution.endsWith('p') ? resolution : `${resolution}p`;
    
    // Log request spec for debugging
    const requestSpec = formatVeoRequestSpec(
      selectedModel,
      location,
      mode,
      promptText,
      aspect,
      resolutionNormalized,
      VEO_CAPABILITIES.duration,
      generateAudio,
      !!image?.bytesBase64Encoded,
      image?.mimeType
    );
    functions.logger.info('Veo request spec', requestSpec);

    // Get access token
    const accessTokenResponse = await client.getAccessToken();
    const accessToken = accessTokenResponse.token;
    if (!accessToken) {
      return { success: false, error: 'Failed to get access token', code: 'TOKEN_FAILED' };
    }

    // Prefer inline base64 seed image to avoid INVALID_ARGUMENT on gcsUri
    // If needed later, we can fall back to GCS gs:// URIs (not signed HTTPS URLs)
    let referenceImageInline: { bytesBase64Encoded: string; mimeType?: string } | undefined;
    if (image?.bytesBase64Encoded) {
      referenceImageInline = { bytesBase64Encoded: image.bytesBase64Encoded, mimeType: image.mimeType || 'image/png' };
    }

    // Prepare request
    const params = {
      sampleCount: 1,
      aspectRatio: aspect,
      resolution: resolutionNormalized,
      durationSeconds: VEO_CAPABILITIES.duration,
      generateAudio,
      personGeneration: 'allow_adult',
      seed: Math.floor(Math.random() * 1000000)
    };

    const instance: any = { prompt: promptText };
    if (referenceImageInline) {
      instance.referenceImage = referenceImageInline;
    }

    const startUrl = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${selectedModel}:predictLongRunning`;
    
    // Rate limit
    await veoRateLimiter.throttle();
    
    // Start long-running operation (no automatic fallbacks)
    const startResponse = await fetch(startUrl, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ instances: [instance], parameters: params })
    });

    if (!startResponse.ok) {
      const errorText = await startResponse.text().catch(() => '');
      const errorCode = getVeoErrorCode(startResponse.status, errorText);
      
      functions.logger.error('Veo start failed', {
        status: startResponse.status,
        errorCode,
        body: errorText.slice(0, 1000),
        requestSpec
      });
      
      return {
        success: false,
        error: `Veo API error: ${errorCode}`,
        code: errorCode,
        requestSpec,
        providerStatus: startResponse.status,
        providerResponse: errorText.slice(0, 500)
      };
    }

    const startResult = await startResponse.json();
    const operationName = startResult.name;
    try {
      const snapshot = JSON.stringify(startResult).slice(0, 1000);
      functions.logger.info('Veo startResult snapshot', { name: operationName, snapshot });
    } catch(_) {}

    if (!operationName) {
      functions.logger.error('No operation name in start response', startResult);
      return { success: false, error: 'No operation name returned', code: 'NO_OPERATION' };
    }

    functions.logger.info('Veo operation started', { operationName });

    // Poll for completion using fetchPredictOperation exclusively
    const fetchUrl = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${selectedModel}:fetchPredictOperation`;
    let attempts = 0;
    const pollIntervalMs = 2000;
    // Allow longer time for HD/1080p; Veo LROs can take a few minutes
    const targetMaxSeconds = (resolutionNormalized === '1080p' || tier === 'advanced') ? 360 : 240; // 6 min for HD, 4 min otherwise
    const maxAttempts = Math.ceil((targetMaxSeconds * 1000) / pollIntervalMs);
    
    while (attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
      attempts++;

      // Per official docs, fetchPredictOperation expects { operationName }
      const body = { operationName } as const;
      functions.logger.info('Veo poll fetchPredictOperation', { attempt: attempts, bodyKeys: Object.keys(body) });
      const resp = await fetch(fetchUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });
      let pollResponse: any = null;
      if (resp.ok) {
        pollResponse = resp;
      } else {
        const errTxt = await resp.text().catch(() => '');
        functions.logger.error('Veo poll fetchPredictOperation failed', { status: resp.status, body: errTxt?.slice?.(0, 1500) });
      }

      if (!pollResponse) {
        // transient issue; continue polling
        continue;
      }

      const pollResult = await pollResponse.json();
      if (!pollResult || typeof pollResult !== 'object') {
        functions.logger.error('Invalid pollResult payload');
        continue;
      }

      if (pollResult.done) {
        functions.logger.info('Veo operation completed', { attempts });
        if (pollResult.error) {
          const errObj = pollResult.error || {};
          const errMsg = String(errObj.message || 'Generation failed');
          const errCode = typeof errObj.code !== 'undefined' ? String(errObj.code) : 'GENERATION_FAILED';
          functions.logger.error('Veo operation failed', { errObj, requestSpec });
          return { success: false, error: errMsg, code: errCode };
        }
        try {
          const response = pollResult.response;
          // RAI filter
          const raiCount = response?.raiMediaFilteredCount || 0;
          const raiReasons = response?.raiMediaFilteredReasons || [];
          if (raiCount > 0 || raiReasons.length > 0) {
            functions.logger.warn('Veo content filtered', { raiCount, raiReasons });
            return { success: false, error: 'Content filtered: Try a neutral prompt like "a purple dinosaur dancing in a meadow"', code: 'CONTENT_FILTERED' };
          }
          // Extract videos first then predictions
          const videos = response?.videos || [];
          const predictions = response?.predictions || [];
          let videoBytes: string | null = null;
          if (videos.length > 0) {
            videoBytes = videos[0]?.bytesBase64Encoded || null;
          }
          if (!videoBytes && predictions.length > 0) {
            const prediction = predictions[0];
            videoBytes = prediction?.bytesBase64Encoded
              || prediction?.video?.bytesBase64Encoded
              || prediction?.outputVideo?.bytesBase64Encoded
              || prediction?.outputs?.[0]?.bytesBase64Encoded
              || null;
          }
          if (!videoBytes) {
            const snapshot = (() => { try { return JSON.stringify(response || pollResult).slice(0, 2000); } catch { return ''; } })();
            functions.logger.error('Veo done but no video bytes. Response snapshot:', snapshot);
            return { success: false, error: 'No video data in response', code: 'NO_VIDEO_BYTES' };
          }
          return { 
            success: true, 
            videoBytes, 
            modelUsed: selectedModel, 
            audioUsed: generateAudio, 
            resolutionUsed: resolutionNormalized, 
            aspectUsed: aspect,
            requestSpec
          };
        } catch (parseErr) {
          functions.logger.error('Failed to parse Veo response', parseErr);
          return { success: false, error: 'Failed to parse response', code: 'PARSE_ERROR' };
        }
      }
      // not done yet: continue polling
    }
    return { success: false, error: 'Generation timed out', code: 'TIMEOUT' };

  } catch (err) {
    functions.logger.error('Veo generation error', err);
    return { 
      success: false, 
      error: err instanceof Error ? err.message : 'Unknown error', 
      code: 'INTERNAL_ERROR' 
    };
  }
}

// Temporary dev bypass for credit checks (remove before public launch)
function isLocalhost(req: Request): boolean {
  const origin = req.get('origin') || '';
  const referer = req.get('referer') || '';
  return /localhost|127\.0\.0\.1/.test(origin) || /localhost|127\.0\.0\.1/.test(referer);
}
function isDevBypass(req: Request): boolean {
  // Allow dev credit-bypass ONLY when invoked from localhost with the special header.
  // This ensures production always enforces real credit checks.
  const header = (req.get('x-dev-bypass') || '').toLowerCase();
  return header === 'dev-test-2024' && isLocalhost(req);
}

// Enhanced retry helper with jitter and timeout
async function fetchWithRetry(url: string, options: any, attempts = 3, backoffMs = 400, timeoutMs = 30000): Promise<any> {
  let lastErr: any = null;
  const startTime = Date.now();
  
  for (let i = 0; i < attempts; i++) {
    try {
      // Add timeout to request
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      
      const fetchOptions = { ...options, signal: controller.signal };
      const res: any = await (globalThis as any).fetch(url, fetchOptions);
      clearTimeout(timeout);
      
      if (res.ok) return res;
      
      // Don't retry client errors (4xx)
      if (res.status >= 400 && res.status < 500) {
        return res;
      }
      
      // Check if we've exceeded total time
      if (Date.now() - startTime > timeoutMs * 2) {
        throw new Error('PROVIDER_TIMEOUT');
      }
      
      lastErr = new Error(`Upstream status ${res.status}`);
    } catch (err: any) {
      if (err.name === 'AbortError') {
        lastErr = new Error('PROVIDER_TIMEOUT');
      } else {
        lastErr = err;
      }
    }
    
    // Don't retry on last attempt
    if (i < attempts - 1) {
      // Exponential backoff with jitter
      const jitter = Math.random() * 0.3 * backoffMs;
      const delay = backoffMs * Math.pow(2, i) + jitter;
      await new Promise((r) => setTimeout(r, Math.min(delay, 10000)));
    }
  }
  
  if (lastErr) throw lastErr;
  throw new Error('TRANSIENT_UPSTREAM');
}

// Structured error codes
const ERROR_CODES = {
  PROVIDER_TIMEOUT: { message: 'Provider took too long to respond', userMessage: 'The service is slow right now. Please try again.' },
  PROVIDER_RATE_LIMIT: { message: 'Rate limit exceeded', userMessage: 'Too many requests. Please wait a moment and try again.' },
  PROVIDER_SAFETY: { message: 'Content filtered', userMessage: 'Your content was flagged. Try rephrasing or using different imagery.' },
  TRANSIENT_UPSTREAM: { message: 'Temporary provider error', userMessage: 'Temporary issue with the service. Please try again.' },
  SIGN_URL_ERROR: { message: 'Failed to create signed URL', userMessage: 'Could not prepare your file. Please try again.' },
  VALIDATION: { message: 'Invalid input', userMessage: 'Please check your input and try again.' },
  NO_IMAGE_RETURNED: { message: 'No image in response', userMessage: 'The service did not return an image. Please try again.' },
  INSUFFICIENT_CREDITS: { message: 'Not enough credits', userMessage: 'You need more credits for this action.' }
};

function mapProviderError(error: any): { code: string; userMessage: string } {
  const errorStr = String(error?.message || error || '');
  
  if (errorStr.includes('PROVIDER_TIMEOUT')) return { code: 'PROVIDER_TIMEOUT', userMessage: ERROR_CODES.PROVIDER_TIMEOUT.userMessage };
  if (errorStr.includes('429') || errorStr.includes('rate')) return { code: 'PROVIDER_RATE_LIMIT', userMessage: ERROR_CODES.PROVIDER_RATE_LIMIT.userMessage };
  if (errorStr.includes('safety') || errorStr.includes('filtered')) return { code: 'PROVIDER_SAFETY', userMessage: ERROR_CODES.PROVIDER_SAFETY.userMessage };
  if (errorStr.includes('INSUFFICIENT_CREDITS')) return { code: 'INSUFFICIENT_CREDITS', userMessage: ERROR_CODES.INSUFFICIENT_CREDITS.userMessage };
  if (errorStr.includes('VALIDATION') || errorStr.includes('INVALID_ARGUMENT') || errorStr.includes('code: 3')) return { code: 'VALIDATION', userMessage: ERROR_CODES.VALIDATION.userMessage };
  
  return { code: 'TRANSIENT_UPSTREAM', userMessage: ERROR_CODES.TRANSIENT_UPSTREAM.userMessage };
}

// MyFatoorah config & plan definitions
type PlanId = 'starter' | 'pro' | 'enterprise';

const PLAN_CONFIG: Record<PlanId, { name: string; price: number; credits: number }> = {
  starter: { name: 'Clario Starter', price: 29.99, credits: 300 },
  pro: { name: 'Clario Pro', price: 59.99, credits: 1000 },
  enterprise: { name: 'Clario Enterprise', price: 149.99, credits: 3000 },
};

const MF = {
  apikey: functions.config()?.myfatoorah?.apikey || process.env.MYFATOORAH_API_KEY || 'BVv9muWYBfKEGZrloacGyxGSY6NixKcKhV9pMpvFDCTIT58Au62t-CzX1w7PA_ffIYFkT0jz7cKMIbxwVeLuNihUdJBh93GLRXR5h1ZkX5Y3v4ixPto7rXHBmYs0rW8taOT92MnnykfYJ_FaBni_kKXFYlQ_PBBw57dnRFkmw32aesvwgKXo2-ZWNok8BFMUqiYvwwrbdd5sMIhU9p-h0PMddKBGp_p0strb5-3yOk0JD9mpqmH_YIwVxvdFfZi9gDhzjUqVgD3jd6zHlaMfmaaQ0v6bjy5hCuad4ph0nkCVjfV4qW_9J7Jxjtpi_stH-_5vKisYqj3Akac78WrcxEbWMNxlklFs7mKrsSeqDj9ailoe-ERs8PfJCvDOLuTJv-j-GtsBV3bMNx_QA6AmsJa0KgmayAqAF6PIjG-JCvUBzDfo8z22kRKLduX2NX3CrNFE_1m464m367EEV1cyuM3nj8YMjhGA4_ngG9H0dRMb2cSZod_DJMV2ptI9SWAeqDlS2ZNrYOgjs1AkuO3yQCAVKhqIbTAb-4zDmKC0xQsSiw5CvP9nOKwMJOzzCOTR8f3V9L7NlQS1-O5vXlDroK5cYjLOt43NjsgXIGe87RU3y5sRh6Ugfix5YukNGVpdVRDhN_LEypBe3kKMIi-EXIuf0_UzaVzVnBGohLRWLSqgvCK2cW0xWKnDETmVdaQAR79stg',
  baseUrl: functions.config()?.myfatoorah?.base_url || process.env.MYFATOORAH_BASE_URL || 'https://apitest.myfatoorah.com',
  siteBase: functions.config()?.myfatoorah?.site_base || process.env.SITE_BASE_URL || 'https://clariostudio.com',
  webhookSecret: functions.config()?.myfatoorah?.webhook_secret || process.env.MYFATOORAH_WEBHOOK_SECRET || 'T04aNgD7FgWhC/GLx/Lo+AYOfhesQP+faM39kemOGJnnOSIFtXyYsMr46jJfFu64p8Fxlsu69qFph9lK1Gso6g==',
};

function assertMF() {
  if (!MF.apikey || !MF.baseUrl || !MF.siteBase) {
    throw new Error('NOT_CONFIGURED: Missing MyFatoorah config');
  }
}

// Types
interface AuthedRequest extends Request {
  uid?: string;
  email?: string;
}

// NextFunction type from Express
type NextFunction = (err?: any) => void;

// Type for rate limiter
class SimpleRateLimiter {}

// Job status type
type JobStatus = 'queued' | 'processing' | 'done' | 'failed';

// Rate limiter for provider calls
class RateLimiter {
  private queue: Array<() => void> = [];
  private processing = false;
  private lastCall = 0;
  private minInterval: number;
  
  constructor(callsPerSecond: number = 2) {
    this.minInterval = 1000 / callsPerSecond;
  }
  
  async throttle(): Promise<void> {
    return new Promise((resolve) => {
      this.queue.push(resolve);
      this.process();
    });
  }
  
  private async process() {
    if (this.processing || this.queue.length === 0) return;
    this.processing = true;
    
    const now = Date.now();
    const timeSinceLastCall = now - this.lastCall;
    const delay = Math.max(0, this.minInterval - timeSinceLastCall);
    
    await new Promise(r => setTimeout(r, delay));
    
    const resolve = this.queue.shift();
    if (resolve) {
      this.lastCall = Date.now();
      resolve();
    }
    
    this.processing = false;
    if (this.queue.length > 0) {
      this.process();
    }
  }
}

// Create rate limiter instances
const veoRateLimiter = new RateLimiter(2); // 2 calls per second for Veo
const geminiRateLimiter = new RateLimiter(5); // 5 calls per second for Gemini

// Middleware to verify Firebase ID token
function verifyAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  const idToken = authHeader.split('Bearer ')[1];
  
  admin.auth().verifyIdToken(idToken)
    .then((decodedToken) => {
      (req as AuthedRequest).uid = decodedToken.uid;
      (req as AuthedRequest).email = decodedToken.email;
      next();
    })
    .catch((error) => {
      functions.logger.error('Token verification failed:', error);
      res.status(401).json({ error: 'Unauthorized' });
    });
}

// Helper to decrement credits
async function decrementCredits(uid: string, type: string) {
  // Implementation placeholder - credits disabled for testing
  if (DISABLE_ALL_CREDITS || DISABLE_VIDEO_CREDITS) {
    return;
  }
  // Add actual credit deduction logic here when ready
}

// POST /generateVideo endpoint
app.post(['/generateVideo', '/api/generateVideo'], verifyAuth, async (req: AuthedRequest, res: Response) => {
  const uid = req.uid!;
  const startTime = Date.now();
  
  try {
    functions.logger.info('video_request', { uid });
    
    const {
      prompt,
      mode = 'preview',
      generationMode = 'prompt-to-video',
      aspect = '16:9',
      resolution = '720',
      generateAudio = false,
      imageBase64,
      imageMime,
      imageName
    } = req.body;
    
    // Validate inputs
    if (!prompt) {
      return res.status(400).json({ ok: false, error: 'MISSING_PROMPT', message: 'Prompt is required' });
    }
    
    const tier: 'fast' | 'advanced' = mode === 'hd' ? 'advanced' : 'fast';
    const hasRefImage = !!imageBase64;
    const devBypass = isDevBypass(req);
    
    if (generationMode === 'prompt-to-video') {
      // Veo 3.0 prompt-to-video generation
      functions.logger.info('Starting Veo 3.0 prompt-to-video generation', { prompt, aspect, resolution, tier, mode, generateAudio });
      
      const veoResult = await generateVeoVideo(
        prompt,
        aspect,
        resolution,
        tier,
        generateAudio,
        hasRefImage ? { bytesBase64Encoded: imageBase64, mimeType: imageMime } : undefined,
        uid
      );
      
      if (!veoResult.success) {
        if (veoResult.code === 'MODEL_UNAVAILABLE') {
          return res.status(501).json({ ok: false, code: 'MODEL_UNAVAILABLE', message: 'Selected model is unavailable in this project/region' });
        }
        if (veoResult.code === 'AUTH_MISSING') {
          return res.status(501).json({ ok: false, error: 'VEO_NOT_CONFIGURED', code: 'VEO_NOT_CONFIGURED', message: 'Veo credentials not configured on server' });
        }
        const validationCodes = new Set([
          'EMPTY_PROMPT','UNSUPPORTED_ASPECT','UNSUPPORTED_RESOLUTION','AUDIO_NOT_SUPPORTED',
          'IMAGE_REQUIRED','IMAGE_TOO_SMALL','UNSUPPORTED_IMAGE_TYPE','PROMPT_TOO_LONG','INVALID_PARAMETERS'
        ]);
        const isValidation = !!veoResult.code && validationCodes.has(String(veoResult.code));
        const status = isValidation
          ? 400
          : (veoResult.providerStatus && veoResult.providerStatus >= 400 && veoResult.providerStatus < 500
              ? veoResult.providerStatus
              : 502);
        return res.status(status).json({
          ok: false,
          error: 'VEO_GENERATION_FAILED',
          message: veoResult.error,
          code: veoResult.code,
          requestSpec: veoResult.requestSpec || null,
          providerStatus: veoResult.providerStatus || null,
          providerResponse: veoResult.providerResponse || null
        });
      }

      // Upload video to Firebase Storage
      const videoId = `veo-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const fileName = `videos/${uid}/${videoId}.mp4`;
      
      const file = storage.bucket().file(fileName);
      await file.save(Buffer.from(veoResult.videoBytes || '', 'base64'), {
        metadata: { 
          contentType: 'video/mp4',
          metadata: {
            prompt,
            generatedBy: veoResult.modelUsed || ((functions.config()?.video as any)?.model_fast || 'veo-3.0-fast-generate-001'),
            createdAt: new Date().toISOString()
          }
        }
      });

      // Generate signed URL
      const [signedUrl] = await file.getSignedUrl({
        action: 'read',
        expires: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
      });

      // Deduct credits (disabled while DISABLE_VIDEO_CREDITS=true)
      const base = mode === 'hd' ? 10 : 1;
      const tierMult = tier === 'advanced' ? 3 : 1; // Advanced is ~3x cost
      const audioSurcharge = generateAudio ? (mode === 'hd' ? 5 : 1) : 0;
      const creditsUsed = base * tierMult + audioSurcharge;
      if (!DISABLE_VIDEO_CREDITS) {
        if (!devBypass) {
          await decrementCredits(uid, mode === 'hd' ? 'video-hd' : 'video-preview');
        } else {
          functions.logger.warn('DEV_BYPASS_CREDITS (Veo) enabled, skipping credit deduction for uid:', uid);
        }
      } else {
        functions.logger.warn('DISABLE_VIDEO_CREDITS=true, skipping credit deduction (Veo)');
      }

      // Save to Firestore
      const videoCfg = (functions.config()?.video as any) || {};
      const modelFast = videoCfg.model_fast || 'veo-3.0-fast-generate-001';
      const modelHd = videoCfg.model_hd || 'veo-3.0-generate-001';
      const usedModel = veoResult.modelUsed || (tier === 'advanced' ? modelHd : modelFast);
      await db.collection('creations').add({
        uid,
        type: mode === 'hd' ? 'video-hd' : 'video-preview',
        url: signedUrl,
        prompt,
        duration: 8, // legacy field
        durationSec: 8,
        aspect: veoResult.aspectUsed || aspect,
        resolution: veoResult.resolutionUsed || resolution,
        creditsUsed: DISABLE_VIDEO_CREDITS ? 0 : (devBypass ? 0 : creditsUsed),
        provider: 'veo',
        sourceType: 'prompt-to-video',
        tier,
        model: usedModel,
        audio: (typeof veoResult.audioUsed === 'boolean') ? veoResult.audioUsed : generateAudio,
        refImageReceived: hasRefImage,
        refImageName: imageName || null,
        refImageMime: imageMime || null,
        refImageB64Len: hasRefImage ? imageBase64.length : 0,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });

      return res.json({
        ok: true,
        url: signedUrl,
        videoId,
        mode,
        creditsUsed: DISABLE_VIDEO_CREDITS ? 0 : (devBypass ? 0 : creditsUsed),
        duration: 8,
        tier,
        modelUsed: usedModel,
        resolutionUsed: veoResult.resolutionUsed || resolution,
        aspectUsed: veoResult.aspectUsed || aspect,
        audioUsed: (typeof veoResult.audioUsed === 'boolean') ? veoResult.audioUsed : generateAudio
      });
      
    } else if (generationMode === 'image-to-video') {
      try {
        // Veo 3 generation (image-to-video aliasing prompt-only)
        const veoResult = await generateVeoVideo(
          prompt,
          aspect,
          String(resolution || ''),
          tier,
          generateAudio,
          hasRefImage ? { bytesBase64Encoded: imageBase64, mimeType: imageMime } : undefined,
          uid
        );
        if (!veoResult.success) {
          if (veoResult.code === 'MODEL_UNAVAILABLE') {
            return res.status(501).json({ ok: false, code: 'MODEL_UNAVAILABLE', message: 'Selected model is unavailable in this project/region' });
          }
          if (veoResult.code === 'AUTH_MISSING') {
            return res.status(501).json({ ok: false, error: 'VEO_NOT_CONFIGURED', code: 'VEO_NOT_CONFIGURED', message: 'Veo credentials not configured on server' });
          }
          const validationCodes = new Set([
            'EMPTY_PROMPT','UNSUPPORTED_ASPECT','UNSUPPORTED_RESOLUTION','AUDIO_NOT_SUPPORTED',
            'IMAGE_REQUIRED','IMAGE_TOO_SMALL','UNSUPPORTED_IMAGE_TYPE','PROMPT_TOO_LONG','INVALID_PARAMETERS'
          ]);
          const isValidation = !!veoResult.code && validationCodes.has(String(veoResult.code));
          const status = isValidation
            ? 400
            : (veoResult.providerStatus && veoResult.providerStatus >= 400 && veoResult.providerStatus < 500
                ? veoResult.providerStatus
                : 502);
          return res.status(status).json({
            ok: false,
            error: 'VEO_GENERATION_FAILED',
            message: veoResult.error,
            code: veoResult.code,
            requestSpec: veoResult.requestSpec || null,
            providerStatus: veoResult.providerStatus || null,
            providerResponse: veoResult.providerResponse || null
          });
        }

        // Upload Veo video to Firebase Storage
        const videoId = `veo-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const fileName = `videos/${uid}/${videoId}.mp4`;
        
        const file = storage.bucket().file(fileName);
        await file.save(Buffer.from(veoResult.videoBytes || '', 'base64'), {
          metadata: { 
            contentType: 'video/mp4',
            metadata: {
              prompt,
              generatedBy: veoResult.modelUsed || 'veo-3.0-fast',
              createdAt: new Date().toISOString()
            }
          }
        });

        // Generate signed URL
        const [signedUrl] = await file.getSignedUrl({
          action: 'read',
          expires: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
        });

        // Deduct credits (disabled while DISABLE_VIDEO_CREDITS=true)
        const base2 = mode === 'hd' ? 10 : 1;
        const tierMult2 = tier === 'advanced' ? 3 : 1; // Advanced higher price
        const audioSurcharge2 = generateAudio ? (mode === 'hd' ? 5 : 1) : 0;
        const creditsUsed = base2 * tierMult2 + audioSurcharge2;
        if (!DISABLE_VIDEO_CREDITS) {
          if (!devBypass) {
            await decrementCredits(uid, mode === 'hd' ? 'video-hd' : 'video-preview');
          } else {
            functions.logger.warn('DEV_BYPASS_CREDITS (Veo) enabled, skipping credit deduction for uid:', uid);
          }
        } else {
          functions.logger.warn('DISABLE_VIDEO_CREDITS=true, skipping credit deduction (Veo)');
        }

        // Save to Firestore
        const videoCfg2 = (functions.config()?.video as any) || {};
        const modelFast2 = videoCfg2.model_fast || 'veo-3.0-fast-generate-001';
        const modelHd2 = videoCfg2.model_hd || 'veo-3.0-generate-001';
        const usedModel = veoResult.modelUsed || (tier === 'advanced' ? modelHd2 : modelFast2);
        await db.collection('creations').add({
          uid,
          type: mode === 'hd' ? 'video-hd' : 'video-preview',
          url: signedUrl,
          prompt,
          duration: 8, // legacy
          durationSec: 8,
          aspect: veoResult.aspectUsed || aspect,
          resolution: veoResult.resolutionUsed || resolution,
          creditsUsed: DISABLE_VIDEO_CREDITS ? 0 : (devBypass ? 0 : creditsUsed),
          provider: 'veo',
          sourceType: 'image-to-video',
          tier,
          model: usedModel,
          audio: (typeof veoResult.audioUsed === 'boolean') ? veoResult.audioUsed : generateAudio,
          refImageReceived: hasRefImage,
          refImageName: imageName || null,
          refImageMime: imageMime || null,
          refImageB64Len: hasRefImage ? imageBase64.length : 0,
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });

        return res.json({
          ok: true,
          url: signedUrl,
          videoId,
          mode,
          creditsUsed: DISABLE_VIDEO_CREDITS ? 0 : (devBypass ? 0 : creditsUsed),
          duration: 8,
          tier,
          modelUsed: usedModel,
          resolutionUsed: veoResult.resolutionUsed || resolution,
          aspectUsed: veoResult.aspectUsed || aspect,
          audioUsed: (typeof veoResult.audioUsed === 'boolean') ? veoResult.audioUsed : generateAudio
        });
        
        
      } catch (e: any) {
        functions.logger.error('Veo video generation failed', e);
        return res.status(500).json({ ok: false, code: 'VIDEO_API_ERROR', status: 500, message: 'Veo video generation failed', detail: String(e?.message || e) });
      }
    } else {
      // Unsupported generation mode
      return res.status(501).json({ ok: false, code: 'NOT_IMPLEMENTED', message: 'Unsupported generation mode' });
    }

  } catch (err: any) {
    const msg = String(err?.message || err);
    if (msg.includes('INSUFFICIENT_CREDITS')) {
      return res.status(402).json({ ok: false, error: 'INSUFFICIENT_CREDITS' });
    }
    if (msg.startsWith('NOT_CONFIGURED')) {
      return res.status(501).json({ ok: false, error: msg });
    }
    functions.logger.error('generateVideo error', err);
    // Do not leak model names in generic errors
    return res.status(500).json({ ok: false, code: 'VIDEO_API_ERROR', status: 500, message: 'Upstream video API error' });
  }
});

export const videoJobWorker = functions
  .region(REGION)
  .runWith({ timeoutSeconds: 540, memory: '1GB' })
  .firestore.document('videoJobs/{jobId}')
  .onCreate(async (snap, context) => {
    const jobId = context.params.jobId;
    const data = snap.data() || {} as any;
    const uid: string | undefined = data.uid;
    if (!uid) {
      await snap.ref.update({ status: 'failed', error: 'MISSING_UID' });
      return;
    }

    try {
      await snap.ref.update({ status: 'running', startedAt: admin.firestore.FieldValue.serverTimestamp() });

      const mode: 'preview' | 'hd' = (data.mode === 'hd') ? 'hd' : 'preview';
      const generationMode: 'prompt-to-video' | 'image-to-video' = (data.generationMode === 'image-to-video') ? 'image-to-video' : 'prompt-to-video';
      const prompt: any = data.prompt;
      const aspect: string = data.aspect || '16:9';
      const resolution: string = String(data.resolution || '720');
      const generateAudio: boolean = !!data.generateAudio;
      const tier: 'fast' | 'advanced' = (mode === 'hd') ? 'advanced' : 'fast';
      let imageBase64: string | null = data.imageBase64 || null; // legacy path
      const imageMime: string | null = data.imageMime || null;
      const imageStoragePath: string | null = data.imageStoragePath || null;

      // If image is referenced by storage path, load it now
      if (!imageBase64 && imageStoragePath) {
        try {
          const file = storage.bucket().file(imageStoragePath);
          const [buf] = await file.download();
          imageBase64 = buf.toString('base64');
        } catch (e) {
          functions.logger.error('Failed to read image from Storage', { imageStoragePath, error: String((e as any)?.message || e) });
        }
      }

      // Generate video via Veo (supports both prompt-to-video and image-to-video)
      let veoOutcome = await generateVeoVideo(
        prompt,
        aspect,
        resolution,
        tier,
        generateAudio,
        imageBase64 ? { bytesBase64Encoded: imageBase64, mimeType: imageMime || undefined } : undefined
      );

      // If INVALID_ARGUMENT (code 3) and we used an image, retry once without the image
      if (!veoOutcome.success && imageBase64) {
        const codeStr = String(veoOutcome.code || '');
        const errStr = String(veoOutcome.error || '');
        if (codeStr.includes('3') || /invalid_argument/i.test(errStr)) {
          functions.logger.warn('Veo returned INVALID_ARGUMENT; retrying without image parameter', { jobId });
          veoOutcome = await generateVeoVideo(
            prompt,
            aspect,
            resolution,
            tier,
            generateAudio,
            undefined
          );
          // If still failing, try a minimal profile: no image, audio off, 720p
          if (!veoOutcome.success) {
            const codeStr2 = String(veoOutcome.code || '');
            const errStr2 = String(veoOutcome.error || '');
            if (codeStr2.includes('3') || /invalid_argument/i.test(errStr2)) {
              functions.logger.warn('Veo INVALID_ARGUMENT persists; retrying with audio=false and 720p', { jobId });
              veoOutcome = await generateVeoVideo(
                prompt,
                aspect,
                '720',
                tier,
                false,
                undefined
              );
            }
          }
        }
      }

      if (!veoOutcome.success) {
        const mapped = mapProviderError(new Error(`${veoOutcome.error || ''} ${veoOutcome.code ? `code: ${veoOutcome.code}` : ''}`.trim()))
        await snap.ref.update({ 
          status: 'failed', 
          error: mapped.code,
          userMessage: mapped.userMessage,
          providerCode: veoOutcome.code || null,
          providerError: veoOutcome.error || null,
          failedAt: admin.firestore.FieldValue.serverTimestamp() 
        });
        return;
      }

      // Upload to Firebase Storage
      const videoId = `veo-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const fileName = `videos/${uid}/${videoId}.mp4`;
      const file = storage.bucket().file(fileName);
      await file.save(Buffer.from(veoOutcome.videoBytes || '', 'base64'), {
        metadata: { 
          contentType: 'video/mp4',
          metadata: {
            prompt: typeof prompt === 'string' ? prompt.slice(0, 2000) : JSON.stringify(prompt).slice(0, 2000),
            generatedBy: veoOutcome.modelUsed || 'veo-3',
            createdAt: new Date().toISOString()
          }
        }
      });

      // Signed URL (7 days)
      const [signedUrl] = await file.getSignedUrl({ action: 'read', expires: Date.now() + 7 * 24 * 60 * 60 * 1000 });

      // Compute credits used (currently disabled when DISABLE_VIDEO_CREDITS=true)
      const base = mode === 'hd' ? 10 : 1;
      const tierMult = tier === 'advanced' ? 3 : 1;
      const audioSurcharge = generateAudio ? (mode === 'hd' ? 5 : 1) : 0;
      const creditsUsed = base * tierMult + audioSurcharge;

      // Save creation
      const videoCfg = (functions.config()?.video as any) || {};
      const modelFast = videoCfg.model_fast || 'veo-3.0-fast-generate-001';
      const modelHd = videoCfg.model_hd || 'veo-3.0-generate-001';
      const usedModel = veoOutcome.modelUsed || (tier === 'advanced' ? modelHd : modelFast);

      const creationRef = await db.collection('creations').add({
        uid,
        type: mode === 'hd' ? 'video-hd' : 'video-preview',
        url: signedUrl,
        prompt,
        duration: 8,
        durationSec: 8,
        aspect: veoOutcome.aspectUsed || aspect,
        resolution: veoOutcome.resolutionUsed || resolution,
        creditsUsed: DISABLE_VIDEO_CREDITS ? 0 : creditsUsed,
        provider: 'veo',
        sourceType: generationMode,
        tier,
        model: usedModel,
        audio: (typeof veoOutcome.audioUsed === 'boolean') ? veoOutcome.audioUsed : generateAudio,
        refImageReceived: !!imageBase64,
        refImageMime: imageMime || null,
        refImageB64Len: imageBase64 ? imageBase64.length : 0,
        providerCode: veoOutcome.code || null,
        providerError: veoOutcome.error || null,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });

      // Update job document
      await snap.ref.update({
        status: 'done',
        creationId: creationRef.id,
        url: signedUrl,
        modelUsed: usedModel,
        aspectUsed: veoOutcome.aspectUsed || aspect,
        resolutionUsed: veoOutcome.resolutionUsed || resolution,
        audioUsed: (typeof veoOutcome.audioUsed === 'boolean') ? veoOutcome.audioUsed : generateAudio,
        finishedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      // Best-effort cleanup of temp ref image
      if (imageStoragePath) {
        try { await storage.bucket().file(imageStoragePath).delete({ ignoreNotFound: true }); } catch(_) {}
      }

    } catch (err: any) {
      functions.logger.error('video_job_failed', { jobId: context.params.jobId, error: err?.message });
      
      const mapped = mapProviderError(err);
      await snap.ref.update({ 
        status: 'failed', 
        error: mapped.code,
        userMessage: mapped.userMessage,
        failedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }
  });

// POST /api/uploadImage - Upload image to GCS for processing
app.post('/api/uploadImage', verifyAuth, async (req: AuthedRequest, res: Response) => {
  const uid = req.uid!;
  
  try {
    const { imageBase64, imageName, imageType = 'source' } = req.body;
    
    if (!imageBase64) {
      return res.status(400).json({ 
        ok: false, 
        code: 'MISSING_IMAGE',
        userMessage: 'No image provided'
      });
    }
    
    // Validate size (max 10MB)
    const sizeInBytes = (imageBase64.length * 3) / 4;
    if (sizeInBytes > 10 * 1024 * 1024) {
      return res.status(400).json({ 
        ok: false, 
        code: 'PAYLOAD_INVALID',
        userMessage: 'Image too large. Maximum size is 10MB.'
      });
    }
    
    // Generate GCS path
    const timestamp = Date.now();
    const randomId = Math.random().toString(36).substring(2, 9);
    const folder = imageType === 'mask' ? 'masks' : 'uploads';
    const fileName = imageName || `${timestamp}-${randomId}.png`;
    const gcsPath = `${folder}/${uid}/${fileName}`;
    
    // Upload to GCS
    const bucket = storage.bucket();
    const file = bucket.file(gcsPath);
    
    await file.save(Buffer.from(imageBase64, 'base64'), {
      metadata: { 
        contentType: 'image/png',
        metadata: {
          uploadedBy: uid,
          uploadedAt: new Date().toISOString()
        }
      }
    });
    
    // Return GCS URL
    const gcsUrl = `gs://${bucket.name}/${gcsPath}`;
    
    return res.json({
      ok: true,
      gcsUrl,
      path: gcsPath
    });
    
  } catch (err: any) {
    functions.logger.error('upload_image_error', err);
    return res.status(500).json({ 
      ok: false, 
      code: 'UPLOAD_FAILED',
      userMessage: 'Failed to upload image. Please try again.'
    });
  }
});

// GET /api/imageJob/:jobId - Get job status (with ownership check)
app.get('/api/imageJob/:jobId', verifyAuth, async (req: AuthedRequest, res: Response) => {
  const uid = req.uid!;
  const jobId = req.params.jobId;
  
  try {
    const jobDoc = await db.collection('imageJobs').doc(jobId).get();
    
    if (!jobDoc.exists) {
      return res.status(404).json({ 
        ok: false, 
        code: 'JOB_NOT_FOUND',
        userMessage: 'Job not found'
      });
    }
    
    const jobData = jobDoc.data()!;
    
    // Verify ownership
    if (jobData.uid !== uid) {
      return res.status(403).json({ 
        ok: false, 
        code: 'FORBIDDEN',
        userMessage: 'Access denied'
      });
    }
    
    return res.json({
      ok: true,
      job: {
        id: jobId,
        status: jobData.status,
        imageUrl: jobData.imageUrl || null,
        error: jobData.error || null,
        userMessage: jobData.userMessage || null,
        providerStatus: jobData.providerStatus || null,
        providerResponse: jobData.providerResponse || null,
        providerModel: jobData.providerModel || null,
        createdAt: jobData.createdAt,
        completedAt: jobData.completedAt || null
      }
    });
    
  } catch (err: any) {
    functions.logger.error('get_job_error', err);
    return res.status(500).json({ 
      ok: false, 
      code: 'INTERNAL_ERROR',
      userMessage: 'Failed to get job status'
    });
  }
});

// POST /editImage - New Vertex AI implementation with GCS storage
app.post(['/editImage', '/api/editImage'], verifyAuth, async (req: AuthedRequest, res: Response) => {
  const uid = req.uid!;
  const startTime = Date.now();
  
  // Set strict CORS
  const origin = req.get('origin') || '';
  const allowedOrigins = ['https://clario-2c575.web.app', 'https://clariostudio.com'];
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  
  try {
    functions.logger.info('vertex_image_request', { uid });
    
    const { 
      prompt, 
      sourceImageUrl, 
      maskUrl, 
      sketchUrl,
      outputFormat = 'png',
      transparentBackground = false,
      safetyMode = 'balanced' 
    } = req.body || {};
    
    // Validation
    if (!prompt) {
      return res.status(400).json({ 
        ok: false, 
        code: 'VALIDATION', 
        userMessage: 'Please provide a prompt'
      });
    }
    
    // Validate GCS URLs if provided
    if (sourceImageUrl && !sourceImageUrl.startsWith('gs://') && !sourceImageUrl.includes('storage.googleapis.com')) {
      return res.status(400).json({ 
        ok: false, 
        code: 'VALIDATION', 
        userMessage: 'Invalid source image URL'
      });
    }
    
    if (maskUrl && !maskUrl.startsWith('gs://') && !maskUrl.includes('storage.googleapis.com')) {
      return res.status(400).json({ 
        ok: false, 
        code: 'VALIDATION', 
        userMessage: 'Invalid mask URL'
      });
    }
    if (sketchUrl && !String(sketchUrl).startsWith('gs://') && !String(sketchUrl).includes('storage.googleapis.com')) {
      return res.status(400).json({ 
        ok: false, 
        code: 'VALIDATION', 
        userMessage: 'Invalid sketch URL'
      });
    }
    
    // Create job document
    const jobRef = db.collection('imageJobs').doc();
    const jobId = jobRef.id;
    
    await jobRef.set({
      uid,
      status: 'queued' as JobStatus,
      prompt,
      sourceImageUrl: sourceImageUrl || null,
      maskUrl: maskUrl || null,
      sketchUrl: sketchUrl || null,
      outputFormat,
      transparentBackground,
      safetyMode,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    functions.logger.info('vertex_job_created', { 
      uid, 
      jobId,
      latency_ms: Date.now() - startTime 
    });
    
    // Return immediately with 202 Accepted
    return res.status(202).json({ 
      ok: true, 
      jobId, 
      status: 'queued',
      message: 'Processing your image...'
    });
    
  } catch (err) {
    functions.logger.error('vertex_image_error', err);
    return res.status(500).json({ 
      ok: false, 
      code: 'INTERNAL_ERROR',
      userMessage: 'An error occurred. Please try again.'
    });
  }
});

// Proxy remote images so canvas can load them without CORS issues
app.get('/api/proxyImage', async (req: Request, res: Response) => {
  const url = String(req.query.url || '');
  if (!url) return res.status(400).send('Missing url');
  try {
    const upstream = await fetch(url);
    if (!upstream.ok) {
      const text = await upstream.text().catch(() => '');
      return res.status(upstream.status).send(text || 'Upstream error');
    }
    res.set('Content-Type', upstream.headers.get('content-type') || 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=3600');
    const buf = Buffer.from(await upstream.arrayBuffer());
    return res.status(200).send(buf);
  } catch (e: any) {
    functions.logger.error('proxyImage_failed', { url, error: e?.message || String(e) });
    return res.status(500).send('Proxy failed');
  }
});

// ---------- Projects (Save / Load / List / Delete) ----------
// POST /api/saveProject - Save or update a project (JSON state + thumbnail) to GCS with Firestore metadata
app.post('/api/saveProject', verifyAuth, async (req: AuthedRequest, res: Response) => {
  const uid = req.uid!;
  // Strict CORS for production origins
  const origin = req.get('origin') || '';
  const allowedOrigins = ['https://clario-2c575.web.app', 'https://clariostudio.com'];
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }

  try {
    const { name, projectId, state, thumbDataUrl } = req.body || {};
    if (!state) {
      return res.status(400).json({ ok: false, userMessage: 'Missing project state' });
    }
    const id: string = projectId || `proj_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const bucket = storage.bucket();
    const basePath = `projects/${uid}`;
    const jsonPath = `${basePath}/${id}.json`;
    const jsonFile = bucket.file(jsonPath);
    const jsonData = JSON.stringify(state);
    // Save JSON project state
    await jsonFile.save(Buffer.from(jsonData, 'utf-8'), {
      metadata: { contentType: 'application/json', metadata: { uid, projectId: id } }
    });

    // Save thumbnail if provided
    let thumbPath: string | null = null;
    if (typeof thumbDataUrl === 'string' && thumbDataUrl.startsWith('data:image/')) {
      try {
        const match = /^data:(image\/[a-zA-Z0-9+.-]+);base64,(.*)$/.exec(thumbDataUrl);
        const mime = match?.[1] || 'image/webp';
        const b64 = match?.[2] || '';
        const ext = mime.includes('jpeg') ? 'jpg' : mime.split('/')[1] || 'webp';
        thumbPath = `${basePath}/${id}.${ext}`;
        const thumbFile = bucket.file(thumbPath);
        await thumbFile.save(Buffer.from(b64, 'base64'), {
          metadata: { contentType: mime, metadata: { uid, projectId: id } }
        });
      } catch (_) {
        // Ignore thumb save errors; project JSON is primary
        thumbPath = null;
      }
    }

    // Upsert Firestore metadata
    const docRef = db.collection('projects').doc(id);
    const now = admin.firestore.FieldValue.serverTimestamp();
    const doc = await docRef.get();
    if (doc.exists) {
      // Ownership check for update
      const data = doc.data() as any;
      if (data.uid !== uid) {
        return res.status(403).json({ ok: false, userMessage: 'Access denied' });
      }
      await docRef.update({
        uid,
        name: name || data.name || 'Untitled',
        jsonPath,
        thumbPath: thumbPath ?? data.thumbPath ?? null,
        updatedAt: now
      });
    } else {
      await docRef.set({
        uid,
        name: name || 'Untitled',
        jsonPath,
        thumbPath: thumbPath || null,
        createdAt: now,
        updatedAt: now
      });
    }

    return res.json({ ok: true, projectId: id, name: name || doc?.data()?.name || 'Untitled' });
  } catch (err) {
    functions.logger.error('saveProject_failed', err);
    return res.status(500).json({ ok: false, userMessage: 'Failed to save project' });
  }
});

// GET /api/myProjects - List user projects (returns ephemeral signed URLs for thumbs)
app.get('/api/myProjects', verifyAuth, async (req: AuthedRequest, res: Response) => {
  const uid = req.uid!;
  const origin = req.get('origin') || '';
  const allowedOrigins = ['https://clario-2c575.web.app', 'https://clariostudio.com'];
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  try {
    const snap = await db.collection('projects').where('uid', '==', uid).orderBy('updatedAt', 'desc').limit(100).get();
    const bucket = storage.bucket();
    const projects: Array<{ id: string; name: string; thumbUrl?: string | null }> = [];
    for (const doc of snap.docs) {
      const data = doc.data() as any;
      let thumbUrl: string | null = null;
      if (data.thumbPath) {
        try {
          const [url] = await bucket.file(data.thumbPath).getSignedUrl({ action: 'read', expires: Date.now() + 60 * 60 * 1000 });
          thumbUrl = url;
        } catch (_) {
          thumbUrl = null;
        }
      }
      projects.push({ id: doc.id, name: data.name || 'Untitled', thumbUrl });
    }
    return res.json({ ok: true, projects });
  } catch (err) {
    functions.logger.error('myProjects_failed', err);
    return res.status(500).json({ ok: false, userMessage: 'Failed to list projects' });
  }
});

// GET /api/project/:id - Load a single project (returns JSON state)
app.get('/api/project/:id', verifyAuth, async (req: AuthedRequest, res: Response) => {
  const uid = req.uid!;
  const origin = req.get('origin') || '';
  const allowedOrigins = ['https://clario-2c575.web.app', 'https://clariostudio.com'];
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  try {
    const id = req.params.id;
    const doc = await db.collection('projects').doc(id).get();
    if (!doc.exists) return res.status(404).json({ ok: false, userMessage: 'Project not found' });
    const data = doc.data() as any;
    if (data.uid !== uid) return res.status(403).json({ ok: false, userMessage: 'Access denied' });
    const path = data.jsonPath as string;
    if (!path) return res.status(500).json({ ok: false, userMessage: 'Corrupt project metadata' });
    const file = storage.bucket().file(path);
    const [buf] = await file.download();
    const json = JSON.parse(buf.toString('utf-8'));
    return res.json({ ok: true, state: json, name: data.name || 'Untitled' });
  } catch (err) {
    functions.logger.error('getProject_failed', err);
    return res.status(500).json({ ok: false, userMessage: 'Failed to load project' });
  }
});

// DELETE /api/project/:id - Delete a project (metadata + files)
app.delete('/api/project/:id', verifyAuth, async (req: AuthedRequest, res: Response) => {
  const uid = req.uid!;
  const origin = req.get('origin') || '';
  const allowedOrigins = ['https://clario-2c575.web.app', 'https://clariostudio.com'];
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  try {
    const id = req.params.id;
    const docRef = db.collection('projects').doc(id);
    const doc = await docRef.get();
    if (!doc.exists) return res.status(404).json({ ok: false, userMessage: 'Project not found' });
    const data = doc.data() as any;
    if (data.uid !== uid) return res.status(403).json({ ok: false, userMessage: 'Access denied' });
    const tasks: Promise<any>[] = [];
    const bucket = storage.bucket();
    if (data.jsonPath) tasks.push(bucket.file(data.jsonPath).delete({ ignoreNotFound: true } as any));
    if (data.thumbPath) tasks.push(bucket.file(data.thumbPath).delete({ ignoreNotFound: true } as any));
    await Promise.allSettled(tasks);
    await docRef.delete();
    return res.json({ ok: true });
  } catch (err) {
    functions.logger.error('deleteProject_failed', err);
    return res.status(500).json({ ok: false, userMessage: 'Failed to delete project' });
  }
});

// Background worker for image jobs - uses Vertex AI
export const imageJobWorker = functions
  .runWith({ timeoutSeconds: 300, memory: '2GB' })
  .firestore.document('imageJobs/{jobId}')
  .onCreate(async (snap, context) => {
    const jobId = context.params.jobId;
    const data = snap.data();
    const uid = data.uid;
    
    // Verify ownership
    if (!uid) {
      await snap.ref.update({ 
        status: 'failed', 
        error: 'INVALID_JOB',
        userMessage: 'Invalid job configuration'
      });
      return;
    }
    
    functions.logger.info('vertex_image_job_start', { jobId, uid });
    
    // Process using Vertex AI
    await processImageJob(
      jobId,
      uid,
      data.prompt,
      data.sourceImageUrl,
      data.maskUrl,
      data.sketchUrl,
      {
        outputFormat: data.outputFormat || 'png',
        transparentBackground: data.transparentBackground || false,
        safetyMode: data.safetyMode || 'balanced'
      }
    );
  });

// Export the Express app as Cloud Function with extended timeout
exports.api = functions
  .runWith({ timeoutSeconds: 540, memory: '2GB' })
  .https.onRequest(app);

// ----------------- Smart Continue (extend video) -----------------
app.post('/api/continueVideo', verifyAuth, async (req: AuthedRequest, res: Response) => {
  const uid = req.uid!;
  try{
    const { creationId, tweak = '', overlapSeconds = 1.0, seamMode = 'crossfade' } = req.body || {};
    if (!creationId) {
      return res.status(400).json({ ok: false, code: 'VALIDATION', userMessage: 'Missing creationId' });
    }
    // Load creation, verify ownership
    const docRef = db.collection('creations').doc(String(creationId));
    const docSnap = await docRef.get();
    if (!docSnap.exists) {
      return res.status(404).json({ ok: false, code: 'NOT_FOUND', userMessage: 'Creation not found' });
    }
    const data = docSnap.data() as any;
    if (!data || data.uid !== uid) {
      return res.status(403).json({ ok: false, code: 'FORBIDDEN', userMessage: 'Access denied' });
    }
    const url: string = data.url;
    const originalPrompt: string = String(data.prompt || '').slice(0, 8000);
    const aspect: string = String(data.aspect || '16:9');
    const resolution: string = String(data.resolution || '720');
    const tier: 'fast' | 'advanced' = (data.tier === 'advanced') ? 'advanced' : 'fast';
    const generateAudio: boolean = !!data.audio;
    const baseDuration: number = Number(data.durationSec || data.duration || 8) || 8;

    // Download original video to tmp
    const prevPath = `/tmp/prev_${creationId}.mp4`;
    const resp = await (globalThis as any).fetch(url);
    if (!resp.ok) {
      return res.status(502).json({ ok: false, code: 'DOWNLOAD_FAILED', userMessage: 'Failed to download original video' });
    }
    const arrbuf = await resp.arrayBuffer();
    await admin.storage().bucket(); // noop to ensure admin initialized
    await fsWriteFile(prevPath, Buffer.from(arrbuf));

    // Extract near-last frame without ffprobe by seeking to baseDuration-0.1s
    const lastPng = `/tmp/last_${creationId}.png`;
    await new Promise<void>((resolve, reject)=>{
      try{
        const seekTime = Math.max(0, baseDuration - 0.1);
        ffmpeg(prevPath)
          .seekInput(seekTime)
          .outputOptions(['-frames:v 1'])
          .output(lastPng)
          .on('end', ()=>resolve())
          .on('error', (e: any)=>reject(e))
          .run();
      }catch(e){ reject(e); }
    });
    const lastBuf = await fsReadFile(lastPng);
    const imageBase64 = lastBuf.toString('base64');

    // Compose continuation prompt
    let finalPrompt = originalPrompt || '';
    const directive = ' Continue seamlessly for 8 seconds; maintain subject, lighting, color palette, and camera motion; avoid new scenes or sudden changes.';
    if (tweak && String(tweak).trim().length) {
      finalPrompt += ' ' + String(tweak).trim();
    }
    finalPrompt += directive;

    // Generate next 8s segment with image seed
    const veoRes = await generateVeoVideo(
      finalPrompt,
      aspect,
      resolution,
      tier,
      generateAudio,
      { bytesBase64Encoded: imageBase64, mimeType: 'image/png' },
      uid
    );
    if (!veoRes.success || !veoRes.videoBytes) {
      return res.status(502).json({ ok: false, code: 'GEN_FAILED', userMessage: 'Failed to generate continuation', detail: veoRes.error || veoRes.code || '' });
    }
    const nextPath = `/tmp/next_${creationId}.mp4`;
    await fsWriteFile(nextPath, Buffer.from(veoRes.videoBytes, 'base64'));

    // Stitch according to seamMode (assumes both are 8s clips)
    const stitchedPath = `/tmp/stitched_${creationId}.mp4`;
    if (String(seamMode) === 'cut'){
      // Hard cut concat
      try {
        await runFfmpegConcat(prevPath, nextPath, stitchedPath, true);
      } catch(_){
        await runFfmpegConcat(prevPath, nextPath, stitchedPath, false);
      }
    } else {
      // Crossfade with overlap
      const fadeDur = Math.max(0.3, Math.min(2.0, Number(overlapSeconds) || 1.0));
      const offset = Math.max(0, (baseDuration || 8) - fadeDur);
      // Try video+audio crossfade first, then fallback to video-only
      try{
        await runFfmpegCrossfade(prevPath, nextPath, stitchedPath, fadeDur, offset, true);
      }catch(_){
        await runFfmpegCrossfade(prevPath, nextPath, stitchedPath, fadeDur, offset, false);
      }
    }

    // Upload stitched to Storage
    const seriesId = `series_${creationId}_${Date.now()}`;
    const outName = `videos/${uid}/${seriesId}.mp4`;
    const outFile = storage.bucket().file(outName);
    const stitchedBuf = await fsReadFile(stitchedPath);
    await outFile.save(stitchedBuf, { metadata: { contentType: 'video/mp4', metadata: { continuedFrom: creationId } } });
    const [signedUrl] = await outFile.getSignedUrl({ action: 'read', expires: Date.now() + 7*24*60*60*1000 });

    // Save creation record
    const creationRef = await db.collection('creations').add({
      uid,
      type: data.type || 'video-preview',
      url: signedUrl,
      prompt: originalPrompt,
      continuationTweak: String(tweak || ''),
      duration: (baseDuration || 8) + 8,
      durationSec: (baseDuration || 8) + 8,
      aspect,
      resolution,
      creditsUsed: DISABLE_VIDEO_CREDITS ? 0 : (tier==='advanced' ? 3 : 1),
      provider: 'veo',
      sourceType: 'image-to-video',
      tier,
      model: veoRes.modelUsed || null,
      audio: (typeof veoRes.audioUsed==='boolean') ? veoRes.audioUsed : generateAudio,
      continuedFrom: creationId,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return res.json({ ok: true, url: signedUrl, creationId: creationRef.id, combinedDuration: (baseDuration||8)+8 });
  }catch(e:any){
    functions.logger.error('continueVideo_failed', e);
    return res.status(500).json({ ok: false, code: 'INTERNAL', userMessage: 'Failed to continue video', detail: String(e?.message || e) });
  }
});

// Batch continuation: generate N segments and stitch once to reduce re-encodes
app.post('/api/continueVideoBatch', verifyAuth, async (req: AuthedRequest, res: Response) => {
  const uid = req.uid!;
  try{
    const { creationId, count = 2, tweak = '', overlapSeconds = 1.0, seamMode = 'crossfade' } = req.body || {};
    const n = Math.max(1, Math.min(4, Number(count) || 2));
    if (!creationId) return res.status(400).json({ ok: false, code: 'VALIDATION', userMessage: 'Missing creationId' });

    // Load creation and verify
    const docRef = db.collection('creations').doc(String(creationId));
    const docSnap = await docRef.get();
    if (!docSnap.exists) return res.status(404).json({ ok: false, code: 'NOT_FOUND', userMessage: 'Creation not found' });
    const data = docSnap.data() as any;
    if (!data || data.uid !== uid) return res.status(403).json({ ok: false, code: 'FORBIDDEN', userMessage: 'Access denied' });

    const origUrl: string = data.url;
    const originalPrompt: string = String(data.prompt || '').slice(0, 8000);
    const aspect: string = String(data.aspect || '16:9');
    const resolution: string = String(data.resolution || '720');
    const tier: 'fast' | 'advanced' = (data.tier === 'advanced') ? 'advanced' : 'fast';
    const generateAudio: boolean = !!data.audio;
    const baseDuration: number = Number(data.durationSec || data.duration || 8) || 8;

    // Download original
    const basePath = `/tmp/batch_prev_${creationId}.mp4`;
    const resp = await fetch(origUrl);
    if (!resp.ok) return res.status(502).json({ ok: false, code: 'DOWNLOAD_FAILED', userMessage: 'Failed to download original video' });
    const buf = Buffer.from(await resp.arrayBuffer());
    await fsWriteFile(basePath, buf);

    // Generate N continuation segments using last frame of previous segment as seed
    const nextPaths: string[] = [];
    let seedFromPath = basePath;
    for (let i=0;i<n;i++){
      const seek = (i === 0) ? Math.max(0, baseDuration - 0.1) : 7.9; // assume 8s new segments
      const pngPath = `/tmp/batch_seed_${creationId}_${i}.png`;
      await extractLastFrame(seedFromPath, seek, pngPath);
      const lastBuf = await fsReadFile(pngPath);
      const imageBase64 = lastBuf.toString('base64');

      let finalPrompt = originalPrompt || '';
      if (tweak && String(tweak).trim().length) finalPrompt += ' ' + String(tweak).trim();
      finalPrompt += ' Continue seamlessly for 8 seconds; maintain subject, lighting, color palette, and camera motion; avoid new scenes or sudden changes.';

      const veoRes = await generateVeoVideo(
        finalPrompt,
        aspect,
        resolution,
        tier,
        generateAudio,
        { bytesBase64Encoded: imageBase64, mimeType: 'image/png' },
        uid
      );
      if (!veoRes.success || !veoRes.videoBytes) {
        return res.status(502).json({ ok: false, code: 'GEN_FAILED', userMessage: 'Failed to generate continuation', detail: veoRes.error || veoRes.code || '' });
      }
      const nextPath = `/tmp/batch_next_${creationId}_${i}.mp4`;
      await fsWriteFile(nextPath, Buffer.from(veoRes.videoBytes, 'base64'));
      nextPaths.push(nextPath);
      seedFromPath = nextPath; // next iteration seeds from this
    }

    // Single-pass stitch
    const stitchedPath = `/tmp/batch_stitched_${creationId}.mp4`;
    const includeAudio = !!generateAudio;
    if (String(seamMode) === 'cut'){
      try { await runFfmpegConcatMulti([basePath, ...nextPaths], stitchedPath, includeAudio); }
      catch(_){ await runFfmpegConcatMulti([basePath, ...nextPaths], stitchedPath, false); }
    } else {
      const fadeDur = Math.max(0.3, Math.min(2.0, Number(overlapSeconds) || 1.0));
      try { await runFfmpegCrossfadeMulti(basePath, nextPaths, stitchedPath, fadeDur, baseDuration, includeAudio); }
      catch(_){ await runFfmpegCrossfadeMulti(basePath, nextPaths, stitchedPath, fadeDur, baseDuration, false); }
    }

    // Upload
    const outName = `videos/${uid}/series_${creationId}_${Date.now()}_x${n}.mp4`;
    const file = storage.bucket().file(outName);
    const stitchedBuf = await fsReadFile(stitchedPath);
    await file.save(stitchedBuf, { metadata: { contentType: 'video/mp4', metadata: { continuedFrom: creationId, segments: String(n) } } });
    const [signedUrl] = await file.getSignedUrl({ action: 'read', expires: Date.now() + 7*24*60*60*1000 });

    // Duration calc
    const total = (String(seamMode) === 'cut')
      ? baseDuration + n * 8
      : baseDuration + n * 8 - n * Math.max(0.3, Math.min(2.0, Number(overlapSeconds) || 1.0));

    const creationRef = await db.collection('creations').add({
      uid,
      type: data.type || 'video-preview',
      url: signedUrl,
      prompt: originalPrompt,
      continuationTweak: String(tweak || ''),
      duration: total,
      durationSec: total,
      aspect,
      resolution,
      creditsUsed: DISABLE_VIDEO_CREDITS ? 0 : (tier==='advanced' ? 3*n : 1*n),
      provider: 'veo',
      sourceType: 'image-to-video',
      tier,
      model: data.model || null,
      audio: includeAudio,
      continuedFrom: creationId,
      segmentsAppended: n,
      seamMode: String(seamMode),
      overlapSeconds: Number(overlapSeconds) || 1.0,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return res.json({ ok: true, url: signedUrl, creationId: creationRef.id, combinedDuration: total });
  }catch(e:any){
    functions.logger.error('continueVideoBatch_failed', e);
    return res.status(500).json({ ok: false, code: 'INTERNAL', userMessage: 'Failed to batch-extend video', detail: String(e?.message || e) });
  }
});

// --- local helpers for fs and ffmpeg crossfade ---
async function fsWriteFile(p: string, buf: Buffer){ await fsp.writeFile(p, buf); }
async function fsReadFile(p: string){ return await fsp.readFile(p); }

function runFfmpegCrossfade(prevPath: string, nextPath: string, outPath: string, duration: number, offset: number, includeAudio: boolean): Promise<void> {
  return new Promise((resolve, reject)=>{
    const filterParts = [
      `[0:v][1:v]xfade=transition=fade:duration=${duration}:offset=${offset}[v]`
    ];
    const maps = ['-map', '[v]'];
    if (includeAudio) {
      filterParts.push(`[0:a][1:a]acrossfade=d=${duration}[a]`);
      maps.push('-map', '[a]');
    }
    const cmd = ffmpeg()
      .addInput(prevPath)
      .addInput(nextPath)
      .outputOptions([
        '-filter_complex', filterParts.join('; '),
        ...maps,
        '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart'
      ])
      .on('end', ()=>resolve())
      .on('error', (e: any)=>reject(e))
      .save(outPath);
  });
}

// Multi-clip concat in one pass
function runFfmpegConcatMulti(paths: string[], outPath: string, includeAudio: boolean): Promise<void> {
  return new Promise((resolve, reject)=>{
    const cmd = ffmpeg();
    paths.forEach(p => cmd.addInput(p));
    const inputsVA: string[] = [];
    for (let i=0;i<paths.length;i++){
      inputsVA.push(`[${i}:v]`);
      if (includeAudio) inputsVA.push(`[${i}:a]`);
    }
    const filter = includeAudio
      ? `${inputsVA.join('')}concat=n=${paths.length}:v=1:a=1[v][a]`
      : `${inputsVA.join('')}concat=n=${paths.length}:v=1:a=0[v]`;
    const maps = includeAudio ? ['-map','[v]','-map','[a]'] : ['-map','[v]'];
    cmd.outputOptions([
      '-filter_complex', filter,
      ...maps,
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart'
    ])
    .on('end', ()=>resolve())
    .on('error', (e:any)=>reject(e))
    .save(outPath);
  });
}

// Multi-clip crossfade chain in one pass
function runFfmpegCrossfadeMulti(basePath: string, nextPaths: string[], outPath: string, fadeDur: number, baseDuration: number, includeAudio: boolean): Promise<void> {
  return new Promise((resolve, reject)=>{
    const cmd = ffmpeg();
    cmd.addInput(basePath);
    nextPaths.forEach(p => cmd.addInput(p));

    const filters: string[] = [];
    let currentV = '0:v';
    let currentA = includeAudio ? '0:a' : '';
    let sumDur = Math.max(0, baseDuration);

    for (let i=0; i<nextPaths.length; i++){
      const inV = `${i+1}:v`;
      const inA = `${i+1}:a`;
      const outV = `v${i}`;
      const outA = `a${i}`;
      const offset = Math.max(0, sumDur - fadeDur);
      filters.push(`[${currentV}][${inV}]xfade=transition=fade:duration=${fadeDur}:offset=${offset}[${outV}]`);
      if (includeAudio) filters.push(`[${currentA}][${inA}]acrossfade=d=${fadeDur}[${outA}]`);
      currentV = outV;
      if (includeAudio) currentA = outA;
      sumDur = sumDur + 8 - fadeDur;
    }

    const maps = includeAudio ? ['-map', `[${currentV}]`, '-map', `[${currentA}]`] : ['-map', `[${currentV}]`];
    cmd.outputOptions([
      '-filter_complex', filters.join('; '),
      ...maps,
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart'
    ])
    .on('end', ()=>resolve())
    .on('error', (e:any)=>reject(e))
    .save(outPath);
  });
}

// Extract a frame at specific time to PNG
async function extractLastFrame(inPath: string, seekSeconds: number, outPng: string): Promise<void> {
  return new Promise((resolve, reject)=>{
    try{
      ffmpeg(inPath)
        .seekInput(Math.max(0, seekSeconds))
        .outputOptions(['-frames:v 1'])
        .output(outPng)
        .on('end', ()=>resolve())
        .on('error', (e:any)=>reject(e))
        .run();
    }catch(e){ reject(e); }
  });
}
