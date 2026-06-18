const admin = require('firebase-admin');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            // Replace literal \n with actual newlines
            privateKey: process.env.FIREBASE_PRIVATE_KEY ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') : undefined,
        }),
    });
}

module.exports = async (req, res) => {
    // CORS Protection & Origin Validation
    const allowedOrigins = [
        'https://didisbiryani.in',
        'https://www.didisbiryani.in',
        'http://localhost:5173',
        'http://localhost:3000',
        'http://127.0.0.1:5173'
    ];
    const origin = req.headers.origin || req.headers.referer;
    if (origin) {
        const isAllowed = allowedOrigins.some(o => origin.startsWith(o)) || origin.includes('.vercel.app');
        if (!isAllowed) {
            return res.status(403).json({ error: 'Access forbidden: unauthorized origin' });
        }
        res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
    } else {
        res.setHeader('Access-Control-Allow-Origin', 'https://didisbiryani.in');
    }
    
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    // Firebase Auth Token Verification (Admin only)
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized: Missing or invalid token' });
    }
    const authToken = authHeader.split('Bearer ')[1];
    try {
        const decodedToken = await admin.auth().verifyIdToken(authToken);
        const email = decodedToken.email;
        // Verify sender is authenticated Admin
        const authorizedAdmins = [
            'didisbiryani@gmail.com',
            'admin@gmail.com'
        ];
        if (!authorizedAdmins.includes(email)) {
            return res.status(403).json({ error: 'Forbidden: Admin access required' });
        }
    } catch (authError) {
        console.error("Auth Token Verification Failed:", authError);
        return res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }
    
    const { token, tokens, title, body, data } = req.body;

    if (!token && (!tokens || tokens.length === 0)) {
        return res.status(400).json({ error: 'FCM Token or Tokens array is required' });
    }

    try {
        if (tokens && tokens.length > 0) {
            // Multicast logic
            const chunkSize = 500;
            let successCount = 0;
            let failureCount = 0;
            let allResponses = [];

            for (let i = 0; i < tokens.length; i += chunkSize) {
                const chunk = tokens.slice(i, i + chunkSize);
                const message = {
                    notification: {
                        title: title || "Update from Didi's Biryani",
                        body: body || 'You have a new notification.'
                    },
                    data: data || {},
                    tokens: chunk
                };
                try {
                    const response = await admin.messaging().sendEachForMulticast(message);
                    successCount += response.successCount;
                    failureCount += response.failureCount;
                    allResponses.push(response);
                } catch (e) {
                    console.error("FCM Chunk Error:", e);
                }
            }
            return res.status(200).json({ success: true, successCount, failureCount, responses: allResponses });
        } else {
            // Single cast logic
            const message = {
                notification: {
                    title: title || "Update from Didi's Biryani",
                    body: body || 'You have a new notification.'
                },
                data: data || {},
                token: token
            };
            const response = await admin.messaging().send(message);
            return res.status(200).json({ success: true, messageId: response });
        }
    } catch (error) {
        console.error("FCM Send Error:", error);
        res.status(500).json({ error: 'Failed to send notification', details: error.message });
    }
};
