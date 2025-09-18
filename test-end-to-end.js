// Test the deployed /api/generateVideo endpoint end-to-end
async function testVideoGeneration() {
  try {
    console.log('Testing /api/generateVideo endpoint...\n');
    
    const response = await fetch('https://us-central1-clario-2c575.cloudfunctions.net/api/generateVideo', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer fake-token-for-testing', // Will get 401 but shows endpoint accessibility
        'x-dev-bypass': '1' // Try dev bypass
      },
      body: JSON.stringify({
        prompt: 'A cat playing in a sunny garden',
        durationSec: 5, // Will be overridden to 8s
        mode: 'preview',
        aspect: '16:9'
      })
    });
    
    console.log('Response Status:', response.status);
    console.log('Response Headers:', Object.fromEntries(response.headers.entries()));
    
    const data = await response.json();
    console.log('Response Body:', JSON.stringify(data, null, 2));
    
    if (response.status === 401) {
      console.log('\n✅ Endpoint accessible (expected 401 without valid auth)');
    } else if (response.status === 200) {
      console.log('\n🎉 SUCCESS: Video generation worked!');
      console.log('Video URL:', data.url);
    } else {
      console.log('\n⚠️  Unexpected response');
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

testVideoGeneration();
