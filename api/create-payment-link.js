export default async function handler(req, res) {
    if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        return res.status(200).end();
    }
    res.setHeader('Access-Control-Allow-Origin', '*');

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { amount, orderId, customerName, customerPhone } = req.body;

        if (!amount || !orderId) {
            return res.status(400).json({ error: 'Missing amount or orderId' });
        }

        const keyId = process.env.RAZORPAY_KEY_ID;
        const keySecret = process.env.RAZORPAY_KEY_SECRET;

        if (!keyId || !keySecret) {
            console.error("Razorpay API keys missing");
            return res.status(500).json({ error: 'Server misconfigured. Missing Razorpay Keys.' });
        }

        const amountInPaise = Math.round(Number(amount) * 100);
        const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');

        const response = await fetch(`https://api.razorpay.com/v1/payment_links`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Basic ${auth}`
            },
            body: JSON.stringify({
                amount: amountInPaise,
                currency: "INR",
                accept_partial: false,
                reference_id: `${orderId}_${Date.now()}`,
                description: `Order #${orderId}`,
                customer: {
                    name: customerName || "Customer",
                    contact: customerPhone || "+919999999999",
                    email: "customer@didisbiryani.in"
                },
                notify: {
                    sms: false,
                    email: false
                },
                reminder_enable: false
            })
        });

        const data = await response.json();

        if (response.ok) {
            return res.status(200).json({ 
                success: true, 
                paymentLinkId: data.id,
                shortUrl: data.short_url 
            });
        } else {
            console.error("Razorpay Payment Link Error:", data);
            return res.status(400).json({ success: false, error: data.error });
        }
    } catch (error) {
        console.error("Server Error:", error.message);
        return res.status(500).json({ success: false, error: 'Internal Server Error' });
    }
}
