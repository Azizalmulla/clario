// Simple test to verify dev bypass authentication
async function testAuthBypass() {
  try {
    console.log('Testing auth bypass...');
    
    const response = await fetch('https://us-central1-clario-2c575.cloudfunctions.net/api/api/user/credits', {
      method: 'GET',
      headers: {
        // Support both old and new bypass mechanisms
        'X-Dev-Bypass': 'dev-test-2024',
        'x-dev-bypass': '1',
        'Origin': 'http://localhost:5002',
        'Referer': 'http://localhost:5002/video/'
      }
    });

    console.log('Response status:', response.status);
    console.log('Response headers:', Object.fromEntries(response.headers.entries()));

    const responseText = await response.text();
    console.log('Response body:', responseText);

    if (response.ok) {
      console.log('✅ Auth bypass working!');
    } else {
      console.log('❌ Auth bypass failed');
    }

  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

testAuthBypass();
