const { GoogleAuth } = require('./functions/node_modules/google-auth-library');
const fs = require('fs');
const path = require('path');

async function testDuration(duration) {
  try {
    const keyPath = path.resolve(process.cwd(), 'functions', 'service-account-key.json');
    const auth = new GoogleAuth({ keyFile: keyPath, scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
    const accessToken = await auth.getAccessToken();
    
    const projectId = 'clario-2c575';
    const location = 'us-central1';
    const model = 'veo-3.0-fast-generate-preview';
    const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:predictLongRunning`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      },
      body: JSON.stringify({
        instances: [{ prompt: 'A test video' }],
        parameters: {
          aspectRatio: '16:9',
          durationSeconds: duration,
          resolution: '720p',
          storageUri: 'gs://clario-2c575.appspot.com/test/',
          sampleCount: 1
        }
      })
    });
    
    const text = await response.text();
    console.log(`Duration ${duration}s: Status ${response.status}`);
    
    if (response.status === 400 && text.includes('not allowlisted')) {
      console.log(`  ❌ Duration ${duration}s not allowed`);
      return false;
    } else if (response.ok) {
      console.log(`  ✅ Duration ${duration}s allowed`);
      const data = JSON.parse(text);
      console.log(`  Operation: ${data.name}`);
      return true;
    } else {
      console.log(`  ⚠️  Other error:`, text.slice(0, 200));
      return false;
    }
  } catch (error) {
    console.log(`  ❌ Error testing ${duration}s:`, error.message);
    return false;
  }
}

async function findAllowedDurations() {
  console.log('Testing Veo 3 duration allowlist for project clario-2c575...\n');
  
  // Test user's specific allowed durations
  const durations = [5, 10, 15, 30];
  
  for (const duration of durations) {
    await testDuration(duration);
    await new Promise(r => setTimeout(r, 1000)); // Rate limit
  }
}

findAllowedDurations();
