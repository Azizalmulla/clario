// Veo 3.0 Capability Matrix and Validation
// Defines what parameter combinations are supported for each model tier

export interface VeoCapabilities {
  models: {
    fast: string;
    advanced: string;
  };
  location: string;
  duration: number;
  aspects: string[];
  resolutions: {
    fast: string[];
    advanced: string[];
  };
  audio: {
    promptToVideo: {
      fast: boolean;
      advanced: boolean;
    };
    imageToVideo: {
      fast: boolean;
      advanced: boolean;
    };
  };
  imageMimeTypes: string[];
  minImageSize: number; // in bytes
  maxPromptLength: number;
}

export const VEO_CAPABILITIES: VeoCapabilities = {
  models: {
    fast: 'veo-3.0-fast-generate-001',
    advanced: 'veo-3.0-generate-001'
  },
  location: 'us-central1',
  duration: 8, // Fixed 8 seconds for all Veo generations
  aspects: ['16:9', '9:16'], // Only these two are supported
  resolutions: {
    fast: ['480p', '720p', '1080p'],
    advanced: ['480p', '720p', '1080p']
  },
  audio: {
    promptToVideo: {
      fast: true,
      advanced: true
    },
    imageToVideo: {
      fast: true, // Allow audio with image-to-video
      advanced: true // Allow audio with image-to-video
    }
  },
  imageMimeTypes: ['image/png', 'image/jpeg', 'image/jpg'],
  minImageSize: 1024, // 1KB minimum
  maxPromptLength: 5000
};

export interface VeoValidationError {
  code: string;
  field: string;
  message: string;
  details?: any;
}

export function validateVeoRequest(
  prompt: string,
  aspect: string,
  resolution: string,
  tier: 'fast' | 'advanced',
  generateAudio: boolean,
  mode: 'prompt-to-video' | 'image-to-video',
  imageData?: { bytesBase64Encoded: string; mimeType?: string }
): VeoValidationError | null {
  // Check prompt
  if (!prompt || prompt.trim().length === 0) {
    return {
      code: 'EMPTY_PROMPT',
      field: 'prompt',
      message: 'Prompt cannot be empty'
    };
  }
  
  if (prompt.length > VEO_CAPABILITIES.maxPromptLength) {
    return {
      code: 'PROMPT_TOO_LONG',
      field: 'prompt',
      message: `Prompt exceeds ${VEO_CAPABILITIES.maxPromptLength} characters`,
      details: { length: prompt.length }
    };
  }

  // Check aspect ratio
  if (!VEO_CAPABILITIES.aspects.includes(aspect)) {
    return {
      code: 'UNSUPPORTED_ASPECT',
      field: 'aspect',
      message: `Aspect ratio ${aspect} not supported. Use: ${VEO_CAPABILITIES.aspects.join(', ')}`,
      details: { requested: aspect, supported: VEO_CAPABILITIES.aspects }
    };
  }

  // Check resolution for tier
  const supportedResolutions = tier === 'advanced' 
    ? VEO_CAPABILITIES.resolutions.advanced 
    : VEO_CAPABILITIES.resolutions.fast;
  
  const normalizedResolution = resolution.endsWith('p') ? resolution : `${resolution}p`;
  if (!supportedResolutions.includes(normalizedResolution)) {
    return {
      code: 'UNSUPPORTED_RESOLUTION',
      field: 'resolution',
      message: `Resolution ${normalizedResolution} not supported for ${tier} tier. Use: ${supportedResolutions.join(', ')}`,
      details: { requested: normalizedResolution, tier, supported: supportedResolutions }
    };
  }

  // Check audio support based on mode
  if (generateAudio) {
    const audioSupported = mode === 'prompt-to-video'
      ? VEO_CAPABILITIES.audio.promptToVideo[tier]
      : VEO_CAPABILITIES.audio.imageToVideo[tier];
    
    if (!audioSupported) {
      return {
        code: 'AUDIO_NOT_SUPPORTED',
        field: 'generateAudio',
        message: `Audio generation not supported for ${mode} with ${tier} tier`,
        details: { mode, tier, audioRequested: true }
      };
    }
  }

  // Check image data for image-to-video mode
  if (mode === 'image-to-video') {
    if (!imageData || !imageData.bytesBase64Encoded) {
      return {
        code: 'IMAGE_REQUIRED',
        field: 'image',
        message: 'Image data required for image-to-video mode'
      };
    }

    // Check image size
    const imageSize = Buffer.from(imageData.bytesBase64Encoded, 'base64').length;
    if (imageSize < VEO_CAPABILITIES.minImageSize) {
      return {
        code: 'IMAGE_TOO_SMALL',
        field: 'image',
        message: `Image size ${imageSize} bytes is below minimum ${VEO_CAPABILITIES.minImageSize} bytes`,
        details: { size: imageSize, minimum: VEO_CAPABILITIES.minImageSize }
      };
    }

    // Check mime type
    const mimeType = imageData.mimeType || 'image/png';
    if (!VEO_CAPABILITIES.imageMimeTypes.includes(mimeType.toLowerCase())) {
      return {
        code: 'UNSUPPORTED_IMAGE_TYPE',
        field: 'image',
        message: `Image type ${mimeType} not supported. Use: ${VEO_CAPABILITIES.imageMimeTypes.join(', ')}`,
        details: { mimeType, supported: VEO_CAPABILITIES.imageMimeTypes }
      };
    }
  }

  return null; // Request is valid
}

export function getVeoErrorCode(httpStatus: number, errorBody: any): string {
  // Map common Veo/Vertex AI error patterns to readable codes
  const errorStr = JSON.stringify(errorBody).toLowerCase();
  
  if (httpStatus === 404) {
    if (errorStr.includes('model')) return 'MODEL_NOT_FOUND';
    if (errorStr.includes('location')) return 'LOCATION_MISMATCH';
    return 'ENDPOINT_NOT_FOUND';
  }
  
  if (httpStatus === 400 || errorStr.includes('invalid_argument')) {
    if (errorStr.includes('prompt')) return 'INVALID_PROMPT';
    if (errorStr.includes('image')) return 'INVALID_IMAGE';
    if (errorStr.includes('resolution')) return 'INVALID_RESOLUTION';
    if (errorStr.includes('aspect')) return 'INVALID_ASPECT';
    if (errorStr.includes('audio')) return 'INVALID_AUDIO_CONFIG';
    if (errorStr.includes('duration')) return 'INVALID_DURATION';
    return 'INVALID_PARAMETERS';
  }
  
  if (httpStatus === 401 || httpStatus === 403) {
    return 'AUTHENTICATION_FAILED';
  }
  
  if (httpStatus === 429) {
    return 'RATE_LIMIT_EXCEEDED';
  }
  
  if (httpStatus === 503) {
    return 'SERVICE_UNAVAILABLE';
  }
  
  if (errorStr.includes('safety') || errorStr.includes('filtered')) {
    return 'CONTENT_FILTERED';
  }
  
  if (errorStr.includes('timeout')) {
    return 'GENERATION_TIMEOUT';
  }
  
  return 'PROVIDER_ERROR';
}

export function formatVeoRequestSpec(
  model: string,
  location: string,
  mode: 'prompt-to-video' | 'image-to-video',
  prompt: string,
  aspect: string,
  resolution: string,
  duration: number,
  generateAudio: boolean,
  hasImage: boolean,
  imageMimeType?: string
): Record<string, any> {
  return {
    model,
    location,
    mode,
    promptLength: prompt.length,
    promptPreview: prompt.slice(0, 100),
    aspect,
    resolution,
    duration,
    generateAudio,
    hasImage,
    imageMimeType: imageMimeType || null,
    timestamp: new Date().toISOString()
  };
}
