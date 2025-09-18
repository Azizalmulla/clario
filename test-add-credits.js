// Helper script to add credits for the dev test user via Cloud Functions
// Uses dev bypass auth header to authenticate as dev-test-user

async function addCredits() {
  try {
    const body = {
      credits: 100,
      previewCredits: 50,
      hdCredits: 10,
    };

    console.log('Seeding credits for dev-test-user...');
    const res = await fetch('https://us-central1-clario-2c575.cloudfunctions.net/api/test/addCredits', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // verifyAuth dev bypass expects this exact value
        'X-Dev-Bypass': 'dev-test-2024',
      },
      body: JSON.stringify(body),
    });

    console.log('Response status:', res.status);
    const text = await res.text();
    console.log('Response body:', text);

    if (!res.ok) {
      process.exitCode = 1;
    } else {
      console.log('✅ Credits seeded successfully.');
    }
  } catch (e) {
    console.error('❌ Failed to add credits:', e);
    process.exitCode = 1;
  }
}

addCredits();
