import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import fetch from 'node-fetch';

const storage = admin.storage();
const db = admin.firestore();

// Retry helper with exponential backoff
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelayMs: number = 1000
): Promise<T> {
  let lastError: any;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      
      // Don't retry on 4xx errors (client errors)
      if (error.status >= 400 && error.status < 500) {
        throw error;
      }
      
      // Calculate delay with exponential backoff and jitter
      const delay = baseDelayMs * Math.pow(2, i) + Math.random() * 1000;
      
      if (i < maxRetries - 1) {
        functions.logger.warn(`Retry attempt ${i + 1}/${maxRetries} after ${delay}ms`, { error: error.message });
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError;
}

// Download image from GCS
async function downloadFromGCS(gcsUrl: string): Promise<Buffer> {
  // Parse gs://bucket/path or https://storage.googleapis.com/bucket/path
  let bucket: string, path: string;
  
  if (gcsUrl.startsWith('gs://')) {
    const parts = gcsUrl.slice(5).split('/');
    bucket = parts[0];
    path = parts.slice(1).join('/');
  } else if (gcsUrl.includes('storage.googleapis.com')) {
    const url = new URL(gcsUrl);
    const parts = url.pathname.slice(1).split('/');
    bucket = parts[0];
    path = parts.slice(1).join('/');
  } else {
    throw new Error('Invalid GCS URL format');
  }
  
  const file = storage.bucket(bucket).file(path);
  const [buffer] = await file.download();
  return buffer;
}

// Upload to GCS and return signed URL
async function uploadToGCS(
  buffer: Buffer,
  destination: string,
  contentType: string = 'image/png'
): Promise<string> {
  const bucket = storage.bucket();
  const file = bucket.file(destination);
  
  await file.save(buffer, {
    metadata: { contentType },
    resumable: false
  });
  
  // Generate signed URL (7 days)
  const [signedUrl] = await file.getSignedUrl({
    action: 'read',
    expires: Date.now() + 7 * 24 * 60 * 60 * 1000
  });
  
  return signedUrl;
}

// Call Gemini 2.5 Flash Image Preview with API key
export async function callVertexImageAPI(
  prompt: string,
  sourceImageUrl?: string,
  maskUrl?: string,
  sketchUrl?: string,
  options: {
    outputFormat?: 'png' | 'jpeg';
    transparentBackground?: boolean;
    safetyMode?: 'strict' | 'balanced' | 'relaxed';
  } = {}
): Promise<{
  success: boolean;
  imageBuffer?: Buffer;
  error?: string;
  code?: string;
  retries?: number;
  providerStatus?: number;
  providerResponse?: string;
  providerModel?: string;
}> {
  const apiKey = 'AIzaSyC06slbtbcnpOiUa8PrKigsFYZ-Xzs9YpU';
  
  try {

    // Use Gemini 2.5 Flash Image Preview via Generative Language API with API key
    const model = 'gemini-2.5-flash-image-preview';
    
    // Build multimodal request for Gemini
    const parts: any[] = [];
    
    if (sourceImageUrl) {
      // Add source image for editing
      const imageBuffer = await downloadFromGCS(sourceImageUrl);
      parts.push({
        inlineData: {
          mimeType: 'image/png',
          data: imageBuffer.toString('base64')
        }
      });
    }
    
    if (maskUrl) {
      // Add mask for inpainting
      const maskBuffer = await downloadFromGCS(maskUrl);
      parts.push({
        inlineData: {
          mimeType: 'image/png',
          data: maskBuffer.toString('base64')
        }
      });
      parts.push({
        text: 'Use this mask: white/opaque areas should be edited, black/transparent areas should remain unchanged.'
      });
    }
    if (sketchUrl) {
      // Add sketch guidance
      const sketchBuffer = await downloadFromGCS(sketchUrl);
      parts.push({
        inlineData: {
          mimeType: 'image/png',
          data: sketchBuffer.toString('base64')
        }
      });
      parts.push({ text: 'Use this sketch as guidance: refine or generate details following these strokes and structure.' });
    }
    
    // Add the main prompt
    let finalPrompt = prompt;
    if (options.transparentBackground) {
      finalPrompt += ' with transparent background, isolated subject, no background';
    }
    parts.push({ text: finalPrompt });
    
    const requestBody = {
      contents: [{
        role: 'user',
        parts
      }],
      generationConfig: {
        temperature: 0.4,
        topK: 32,
        topP: 1
      },
      safetySettings: getSafetySettings(options.safetyMode || 'balanced')
    };
    
    // Use Generative Language API endpoint with API key
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    
    // Make request with retry
    let retries = 0;
    const response = await retryWithBackoff(async () => {
      retries++;
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });
      
      if (!resp.ok) {
        const errorText = await resp.text();
        const status = resp.status;
        // Log exact upstream error for diagnostics
        functions.logger.error('gemini_upstream_error', {
          model,
          status,
          body: errorText.slice(0, 2000)
        });
        const error = new Error(`Gemini API error: ${status}`);
        (error as any).status = status;
        (error as any).body = errorText;
        if (status === 429) (error as any).code = 'PROVIDER_RATE_LIMIT';
        if (status === 403 || status === 401) (error as any).code = 'AUTHENTICATION_FAILED';
        if (status === 404) (error as any).code = 'MODEL_NOT_FOUND';
        if (status === 400 && errorText.includes('safety')) (error as any).code = 'PROVIDER_SAFETY';
        throw error;
      }
      
      return resp;
    });
    
    const result = await response.json() as any;
    
    // Extract image from Gemini response
    const candidates = result.candidates || [];
    for (const candidate of candidates) {
      const parts = candidate.content?.parts || [];
      for (const part of parts) {
        if (part.inlineData?.data) {
          const imageBuffer = Buffer.from(part.inlineData.data, 'base64');
          return { success: true, imageBuffer, retries: retries - 1 };
        }
      }
    }
    
    // Check for safety filtering
    if (result.promptFeedback?.blockReason) {
      return { 
        success: false, 
        error: 'Content was filtered for safety reasons', 
        code: 'PROVIDER_SAFETY' 
      };
    }
    
    return { 
      success: false, 
      error: 'No image in response', 
      code: 'NO_IMAGE_RETURNED' 
    };
    
  } catch (error: any) {
    const status: number | undefined = error?.status;
    const body: string | undefined = error?.body;
    const code: string | undefined = error?.code;
    // Log with full context
    functions.logger.error('gemini_request_failed', {
      model: 'gemini-2.5-flash-image-preview',
      status,
      code,
      body: (body || '').slice(0, 2000)
    });

    // Map errors to user-friendly codes/messages
    if (code === 'PROVIDER_RATE_LIMIT' || status === 429) {
      return {
        success: false,
        error: 'Too many requests. Please wait a moment and try again.',
        code: 'PROVIDER_RATE_LIMIT',
        providerStatus: status,
        providerResponse: body,
        providerModel: 'gemini-2.5-flash-image-preview'
      };
    }
    if (code === 'PROVIDER_SAFETY') {
      return {
        success: false,
        error: 'Your content was flagged. Please rephrase or use different imagery.',
        code: 'PROVIDER_SAFETY',
        providerStatus: status,
        providerResponse: body,
        providerModel: 'gemini-2.5-flash-image-preview'
      };
    }
    if (status === 401 || status === 403 || code === 'AUTHENTICATION_FAILED') {
      return {
        success: false,
        error: 'Authentication failed to Gemini. Verify Service Account access and scopes.',
        code: 'AUTHENTICATION_FAILED',
        providerStatus: status,
        providerResponse: body,
        providerModel: 'gemini-2.5-flash-image-preview'
      };
    }
    if (status === 404 || code === 'MODEL_NOT_FOUND') {
      return {
        success: false,
        error: 'Requested model not found or not enabled in this project/region.',
        code: 'MODEL_NOT_FOUND',
        providerStatus: status,
        providerResponse: body,
        providerModel: 'gemini-2.5-flash-image-preview'
      };
    }
    if (status === 413) {
      return {
        success: false,
        error: 'Image too large. Please use a smaller image.',
        code: 'PAYLOAD_INVALID',
        providerStatus: status,
        providerResponse: body,
        providerModel: 'gemini-2.5-flash-image-preview'
      };
    }
    // Generic error
    return {
      success: false,
      error: 'Image generation failed. Please try again.',
      code: 'INTERNAL_ERROR',
      providerStatus: status,
      providerResponse: body,
      providerModel: 'gemini-2.5-flash-image-preview'
    };
  }
}

// Safety settings helper
function getSafetySettings(mode: 'strict' | 'balanced' | 'relaxed') {
  const thresholds = {
    strict: 'BLOCK_LOW_AND_ABOVE',
    balanced: 'BLOCK_MEDIUM_AND_ABOVE', 
    relaxed: 'BLOCK_ONLY_HIGH'
  };
  
  const threshold = thresholds[mode];
  
  return [
    { category: 'HARM_CATEGORY_HATE_SPEECH', threshold },
    { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold },
    { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold },
    { category: 'HARM_CATEGORY_HARASSMENT', threshold }
  ];
}

// Process image job
export async function processImageJob(
  jobId: string,
  uid: string,
  prompt: string,
  sourceImageUrl?: string,
  maskUrl?: string,
  sketchUrl?: string,
  options: any = {}
) {
  const jobRef = db.collection('imageJobs').doc(jobId);
  
  try {
    // Update status to processing
    await jobRef.update({
      status: 'processing',
      startedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    // Call Vertex AI
    const result = await callVertexImageAPI(
      prompt,
      sourceImageUrl,
      maskUrl,
      sketchUrl,
      options
    );
    
    if (!result.success || !result.imageBuffer) {
      await jobRef.update({
        status: 'failed',
        error: result.code || 'GENERATION_FAILED',
        userMessage: result.error || 'Image generation failed',
        providerStatus: result.providerStatus || null,
        providerResponse: result.providerResponse ? String(result.providerResponse).slice(0, 5000) : null,
        providerModel: result.providerModel || 'gemini-2.5-flash-image-preview',
        failedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      return;
    }
    
    // Upload result to GCS
    const outputPath = `renders/${uid}/${jobId}.${options.outputFormat || 'png'}`;
    const signedUrl = await uploadToGCS(
      result.imageBuffer,
      outputPath,
      options.outputFormat === 'jpeg' ? 'image/jpeg' : 'image/png'
    );
    
    // Update job as complete
    await jobRef.update({
      status: 'done',
      imageUrl: signedUrl,
      outputPath,
      retries: result.retries || 0,
      completedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    functions.logger.info('Image job completed', { 
      jobId, 
      uid, 
      retries: result.retries,
      outputSize: result.imageBuffer.length 
    });
    
  } catch (error: any) {
    functions.logger.error('Image job processing error', { jobId, error: error.message });
    
    await jobRef.update({
      status: 'failed',
      error: 'INTERNAL_ERROR',
      userMessage: 'An unexpected error occurred. Please try again.',
      failedAt: admin.firestore.FieldValue.serverTimestamp()
    });
  }
}
