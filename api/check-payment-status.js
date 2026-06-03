export default async function handler(req, res) {
    if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        return res.status(200).end();
    }
    res.setHeader('Access-Control-Allow-Origin', '*');

    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { paymentLinkId } = req.query;

        if (!paymentLinkId) {
            return res.status(400).json({ error: 'Missing paymentLinkId' });
        }

        const keyId = process.env.RAZORPAY_KEY_ID;
        const keySecret = process.env.RAZORPAY_KEY_SECRET;

        if (!keyId || !keySecret) {
            console.error("Razorpay API keys missing");
            return res.status(500).json({ error: 'Server misconfigured. Missing Razorpay Keys.' });
        }

        const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');

        const response = await fetch(`https://api.razorpay.com/v1/payment_links/${paymentLinkId}`, {
            method: 'GET',
            headers: {
                'Authorization': `Basic ${auth}`
            }
        });

        const data = await response.json();

        if (response.ok) {
            return res.status(200).json({ 
                success: true, 
                status: data.status,
                paymentId: data.payment_id || null
            });
        } else {
            console.error("Razorpay Payment Link Check Error:", data);
            return res.status(400).json({ success: false, error: data.error });
        }
    } catch (error) {
        console.error("Server Error:", error.message);
        return res.status(500).json({ success: false, error: 'Internal Server Error' });
    }
}
