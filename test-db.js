require('dotenv').config({ path: '.env.local' });
const admin = require('firebase-admin');

admin.initializeApp({
    credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    }),
});

async function checkTokens() {
    console.log("Checking Firestore for FCM Tokens...");
    const db = admin.firestore();
    const snapshot = await db.collection('users').get();
    let tokenCount = 0;
    snapshot.forEach(doc => {
        const data = doc.data();
        if (data.fcmToken) {
            console.log(`User ${doc.id} has token: ${data.fcmToken.substring(0, 20)}...`);
            tokenCount++;
        }
    });
    console.log(`Total users with FCM tokens: ${tokenCount}`);
    process.exit(0);
}

checkTokens().catch(err => {
    console.error("Error:", err);
    process.exit(1);
});
