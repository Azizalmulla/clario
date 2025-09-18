// Quick test script for video generation API
const testVideoGeneration = async () => {
  try {
    // Test the deployed function directly
    const response = await fetch('https://us-central1-clario-2c575.cloudfunctions.net/api/generateVideo', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer test-token', // This will fail auth but show us the endpoint structure
      },
      body: JSON.stringify({
        prompt: 'A beautiful sunset over mountains',
        durationSec: 5,
        mode: 'preview',
        aspect: '16:9'
      })
    });

    const result = await response.text();
    console.log('Status:', response.status);
    console.log('Response:', result);
    
    if (response.status === 401) {
      console.log('✓ Endpoint is accessible (expected auth error)');
    } else {
      console.log('Response details:', result);
    }
  } catch (error) {
    console.error('Error testing API:', error);
  }
};

// Test locally if running on localhost
const testLocal = async () => {
  try {
    const response = await fetch('/api/generateVideo', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-dev-bypass': '1'
      },
      body: JSON.stringify({
        prompt: 'A beautiful sunset over mountains',
        durationSec: 5,
        mode: 'preview',
        aspect: '16:9'
      })
    });

    const result = await response.text();
    console.log('Local Status:', response.status);
    console.log('Local Response:', result);
  } catch (error) {
    console.error('Error testing local API:', error);
  }
};

// Run tests
console.log('Testing video generation API...');
testVideoGeneration();

if (window.location.hostname === 'localhost') {
  console.log('Also testing local endpoint...');
  testLocal();
}
