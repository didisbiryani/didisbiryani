import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// Initialize Firebase Admin SDK (only once)
if (!getApps().length) {
    initializeApp({
        credential: cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
        })
    });
}

const adminDb = getFirestore();

export default async function handler(req, res) {
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
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { paymentId, amount, orderId } = req.body;

        if (!paymentId) {
            return res.status(400).json({ error: 'Missing paymentId' });
        }

        const keyId = process.env.RAZORPAY_KEY_ID;
        const keySecret = process.env.RAZORPAY_KEY_SECRET;

        if (!keyId || !keySecret) {
            console.error("Razorpay API keys missing from Vercel Environment Variables.");
            return res.status(500).json({ error: 'Server misconfigured. Missing Razorpay Keys.' });
        }

        const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');

        // 1. Verify the payment with Razorpay
        const verifyResponse = await fetch(`https://api.razorpay.com/v1/payments/${paymentId}`, {
            method: 'GET',
            headers: { 'Authorization': `Basic ${auth}` }
        });

        const paymentData = await verifyResponse.json();

        if (!verifyResponse.ok) {
            console.error("Razorpay payment verification failed:", paymentData);
            return res.status(400).json({ success: false, error: 'Payment verification failed' });
        }

        // 2. Check if payment is actually captured/authorized
        const isPaymentValid = paymentData.status === 'captured' || paymentData.status === 'authorized';

        if (!isPaymentValid && amount) {
            // Try to capture it if it's authorized but not captured
            try {
                const amountInPaise = typeof amount === 'number' ? amount : Math.round(Number(amount) * 100);
                const captureResponse = await fetch(`https://api.razorpay.com/v1/payments/${paymentId}/capture`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Basic ${auth}`
                    },
                    body: JSON.stringify({ amount: amountInPaise, currency: "INR" })
                });
                const captureData = await captureResponse.json();
                if (!captureResponse.ok && captureData.error?.description !== "This payment has already been captured") {
                    console.error("Capture failed:", captureData);
                }
            } catch (captureErr) {
                console.error("Capture attempt error:", captureErr);
            }
        }

        // 3. Update the order in Firestore using Admin SDK (bypasses security rules)
        if (orderId) {
            try {
                // Replay attack prevention: verify if this payment ID has already been used on a DIFFERENT order
                const duplicateCheck = await adminDb.collection('orders')
                    .where('razorpayPaymentId', '==', paymentId)
                    .get();
                
                let isDuplicate = false;
                duplicateCheck.forEach(doc => {
                    if (doc.id !== orderId) {
                        isDuplicate = true;
                    }
                });
                
                if (isDuplicate) {
                    console.error(`Replay attack detected! paymentId ${paymentId} already used.`);
                    return res.status(400).json({ success: false, error: 'Replay attack blocked: Payment ID already used.' });
                }

                const orderRef = adminDb.collection('orders').doc(orderId);
                const orderSnap = await orderRef.get();
                
                if (orderSnap.exists) {
                    const orderData = orderSnap.data();
                    const updatePayload = {
                        paymentMethod: 'Online (Razorpay)',
                        paymentStatus: 'Paid',
                        razorpayPaymentId: paymentId
                    };

                    // Auto-accept manual orders that were pending payment
                    if (orderData.isManual && orderData.status === 'Pending') {
                        updatePayload.status = 'Accepted';
                    }

                    await orderRef.update(updatePayload);
                    console.log(`Order ${orderId} updated: paymentStatus=Paid, status=${updatePayload.status || orderData.status}`);
                } else {
                    console.error(`Order ${orderId} not found in Firestore`);
                }
            } catch (firestoreErr) {
                console.error("Firestore update error:", firestoreErr);
                // Don't fail the whole request — payment was still valid
            }
        }

        return res.status(200).json({ success: true, paymentStatus: paymentData.status });

    } catch (error) {
        console.error("Server Error:", error.message);
        return res.status(500).json({ success: false, error: 'Internal Server Error' });
    }
}
