const admin = require('firebase-admin');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: process.env.FIREBASE_PRIVATE_KEY ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') : undefined,
        }),
    });
}

module.exports = async (req, res) => {
    // CORS configuration
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
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { orderId } = req.body;
    if (!orderId) {
        return res.status(400).json({ error: 'orderId is required' });
    }

    try {
        // Validate the order exists in Firestore
        const db = admin.firestore();
        const orderRef = await db.collection('orders').doc(orderId).get();
        
        if (!orderRef.exists) {
            return res.status(404).json({ error: 'Order not found' });
        }

        const orderData = orderRef.data();
        
        // Prevent abuse: Check if order is recent (created within last 5 minutes)
        if (orderData.createdAt && orderData.createdAt.toDate) {
            const orderTime = orderData.createdAt.toDate().getTime();
            const now = Date.now();
            if (now - orderTime > 5 * 60 * 1000) {
                return res.status(400).json({ error: 'Order is too old to trigger notification' });
            }
        }

        // Send high priority push notification to drivers/admins
        const message = {
            data: {
                title: "🚨 New Order Arrived!",
                body: `Order #${orderData.orderId || orderId} has been placed. Please prepare it.`,
                orderId: orderId,
                click_action: "FLUTTER_NOTIFICATION_CLICK" // if needed
            },
            topic: "delivery_orders",
            android: {
                priority: "high"
            }
        };

        const response = await admin.messaging().send(message);
        return res.status(200).json({ success: true, messageId: response });

    } catch (error) {
        console.error("Notify Admin Error:", error);
        res.status(500).json({ error: 'Failed to notify admin', details: error.message });
    }
};
