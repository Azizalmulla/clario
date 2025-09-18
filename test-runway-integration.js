const fs = require('fs');
const path = require('path');

// Test script for Runway image-to-video integration
async function testRunwayIntegration() {
  try {
    // Create a simple test image (1x1 pixel PNG) as base64
    const testImageBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChAHGbKdMWwAAAABJRU5ErkJggg==';
    
    const requestBody = {
      generationMode: 'image-to-video',
      motionPrompt: 'A gentle zoom in with soft lighting',
      sourceImage: testImageBase64,
      durationSec: 5,
      mode: 'preview',
      aspect: '16:9',
      resolution: '720'
    };

    console.log('Testing Runway image-to-video integration...');
    console.log('Request body:', JSON.stringify(requestBody, null, 2));

    const response = await fetch('https://us-central1-clario-2c575.cloudfunctions.net/api/generateVideo', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Dev-Bypass': 'dev-test-2024' // Use dev bypass to skip auth
      },
      body: JSON.stringify(requestBody)
    });

    console.log('Response status:', response.status);
    console.log('Response headers:', Object.fromEntries(response.headers.entries()));

    const responseText = await response.text();
    console.log('Response body:', responseText);

    if (response.ok) {
      const data = JSON.parse(responseText);
      console.log('\n✅ SUCCESS: Video generation completed!');
      console.log('Video URL:', data.url);
      console.log('Video ID:', data.videoId);
      console.log('Duration:', data.duration);
      console.log('Credits used:', data.creditsUsed);
    } else {
      console.log('\n❌ FAILED: Video generation failed');
      try {
        const errorData = JSON.parse(responseText);
        console.log('Error code:', errorData.code);
        console.log('Error message:', errorData.message);
        console.log('Error detail:', errorData.detail);
      } catch (e) {
        console.log('Raw error response:', responseText);
      }
    }

  } catch (error) {
    console.error('❌ Test failed with error:', error.message);
    console.error('Stack trace:', error.stack);
  }
}

// Run the test
testRunwayIntegration();
