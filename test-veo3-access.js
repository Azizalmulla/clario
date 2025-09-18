const { GoogleAuth } = require('./functions/node_modules/google-auth-library');
const fs = require('fs');
const path = require('path');

async function testVeoAccess() {
  try {
    // Try to find service account key
    const candidates = [
      path.resolve(process.cwd(), 'functions', 'service-account-key.json'),
      path.resolve(process.cwd(), 'service-account-key.json'),
      path.resolve(__dirname, '../service-account-key.json'),
      path.resolve(__dirname, '../../service-account-key.json')
    ];
    
    const keyPath = candidates.find(p => {
      try { return fs.existsSync(p); } catch (_) { return false; }
    });
    
    console.log('Service account key found:', !!keyPath);
    if (keyPath) console.log('Key path:', keyPath);
    
    const auth = keyPath 
      ? new GoogleAuth({ keyFile: keyPath, scopes: ['https://www.googleapis.com/auth/cloud-platform'] })
      : new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
    
    const accessToken = await auth.getAccessToken();
    console.log('Access token obtained:', !!accessToken);
    
    // Test Veo 3 Fast model access
    const projectId = 'clario-2c575';
    const location = 'us-central1';
    const model = 'veo-3.0-fast-generate-preview';
    const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:predictLongRunning`;
    
    console.log('Testing URL:', url);
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      },
      body: JSON.stringify({
        instances: [{ prompt: 'A test video of a cat' }],
        parameters: {
          aspectRatio: '16:9',
          durationSeconds: 2,
          resolution: '720p',
          storageUri: 'gs://clario-2c575.appspot.com/test/',
          sampleCount: 1
        }
      })
    });
    
    console.log('Response status:', response.status);
    console.log('Response headers:', Object.fromEntries(response.headers.entries()));
    
    const text = await response.text();
    console.log('Response body:', text.slice(0, 1000));
    
    if (!response.ok) {
      console.log('ERROR: Veo 3 access failed');
      if (response.status === 404) {
        console.log('Model not found - may need enterprise access approval');
      } else if (response.status === 403) {
        console.log('Permission denied - check IAM roles');
      }
    } else {
      console.log('SUCCESS: Veo 3 access confirmed');
      const data = JSON.parse(text);
      console.log('Operation name:', data.name);
    }
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

testVeoAccess();
