const nodemailer = require('nodemailer');
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

    // Firebase Auth Token Verification
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized: Missing or invalid token' });
    }
    const token = authHeader.split('Bearer ')[1];
    try {
        const decodedToken = await admin.auth().verifyIdToken(token);
        const email = decodedToken.email;
        // Verify sender is authenticated Admin or Driver
        const authorizedEmails = [
            'didisbiryani@gmail.com',
            'admin@gmail.com',
            'driver@didisbiryani.in'
        ];
        if (!authorizedEmails.includes(email)) {
            return res.status(403).json({ error: 'Forbidden: Unauthorized user' });
        }
    } catch (authError) {
        console.error("Auth Token Verification Failed:", authError);
        return res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }

    const { to, subject, html } = req.body;

    if (!to || !subject || !html) {
        return res.status(400).json({ error: 'Missing required fields: to, subject, html' });
    }

    const emailUser = process.env.EMAIL_USER;
    const emailPass = process.env.EMAIL_PASS;

    if (!emailUser || !emailPass) {
        return res.status(500).json({ error: 'Server email credentials are not configured.' });
    }

    try {
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: emailUser,
                pass: emailPass
            }
        });

        const plainText = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

        const info = await transporter.sendMail({
            from: `"Didi's Biryani" <${emailUser}>`,
            replyTo: emailUser,
            to: to,
            subject: subject,
            text: plainText,
            html: html
        });

        res.status(200).json({ success: true, messageId: info.messageId });
    } catch (error) {
        console.error("Email Send Error:", error);
        res.status(500).json({ error: 'Failed to send email', details: error.message });
    }
};
