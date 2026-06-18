import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

if (!getApps().length) {
    initializeApp({
        credential: cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
        })
    });
}

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
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.status(200).end();

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // Firebase Auth Token Verification
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized: Missing or invalid token' });
    }
    const authToken = authHeader.split('Bearer ')[1];
    try {
        await getAuth().verifyIdToken(authToken);
    } catch (authError) {
        console.error("Auth Token Verification Failed:", authError);
        return res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }

    try {
        const {
            orderNumber,
            customerName,
            phone,
            address,
            items,
            total,
            paymentMethod,
            orderType,
            isManual,
            deliveryCharge,
            taxAmount,
            discount,
            walletApplied,
            amountDue,
            donationAmount
        } = req.body;

        const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8878378532:AAFKGo_ZM2oEnMYTR9ogiZSmkpB9gg0kLA0';
        const CHAT_ID = process.env.TELEGRAM_CHAT_ID || '-1003748942394';

        // Format order number
        const orderNum = orderNumber ? String(orderNumber).padStart(5, '0') : '-----';

        // Build items list
        let itemsText = '';
        if (items && items.length > 0) {
            items.forEach(item => {
                const itemTotal = (item.price * item.quantity);
                let line = `   🍽 ${item.name}`;
                if (item.variantLabel) line += ` (${item.variantLabel})`;
                // Addon details
                if (item.addonDetails && item.addonDetails.length > 0) {
                    line += ` (inc. addons)`;
                }
                line += ` x${item.quantity} — ₹${itemTotal}`;
                itemsText += line + '\n';

                if (item.addonDetails && item.addonDetails.length > 0) {
                    item.addonDetails.forEach(ad => {
                        itemsText += `      ➕ ${ad.name} — ₹${ad.price}\n`;
                    });
                }
            });
        }

        // Order type emoji
        const typeEmoji = orderType === 'delivery' ? '🚚 Delivery' : '🏪 Pickup';
        const manualTag = isManual ? ' 📞 *MANUAL ORDER*' : '';
        
        // Payment method
        let payIcon = '💵';
        if (paymentMethod && (paymentMethod.toLowerCase().includes('online') || paymentMethod.toLowerCase().includes('razorpay'))) {
            payIcon = '💳';
        } else if (paymentMethod && paymentMethod.toLowerCase().includes('link')) {
            payIcon = '🔗';
        }

        const dateStr = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

        // Build the full message
        const message = `🔔 *NEW ORDER \\#${orderNum}*${manualTag}\n` +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `👤 *${escapeMarkdown(customerName || 'Unknown')}*\n` +
            `📞 ${escapeMarkdown(phone || 'N/A')}\n` +
            (address ? `📍 ${escapeMarkdown(address)}\n` : '') +
            `\n` +
            `🛒 *Items:*\n${escapeMarkdown(itemsText)}\n` +
            (deliveryCharge ? `🚛 Delivery: ₹${escapeMarkdown(deliveryCharge)}\n` : '') +
            (taxAmount ? `📦 Tax/Packing: ₹${escapeMarkdown(taxAmount)}\n` : '') +
            (discount ? `🎫 Discount: \\-₹${escapeMarkdown(discount)}\n` : '') +
            (donationAmount ? `💝 Tip: ₹${escapeMarkdown(donationAmount)}\n` : '') +
            `━━━━━━━━━━━━━━━━━━━━\n` +
            `💰 *Total: ₹${escapeMarkdown(total || 0)}*\n` +
            (walletApplied ? `💳 Wallet Used: \\-₹${escapeMarkdown(walletApplied)}\n` +
                             `🎯 *Amount Due: ₹${escapeMarkdown(amountDue || 0)}*\n` : '') +
            `${payIcon} Payment: ${escapeMarkdown(paymentMethod || 'COD')}\n` +
            `${escapeMarkdown(typeEmoji)}\n` +
            `⏰ ${escapeMarkdown(dateStr)}`;

        // Send to Telegram
        const telegramUrl = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
        const telegramRes = await fetch(telegramUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: CHAT_ID,
                text: message,
                parse_mode: 'MarkdownV2',
                disable_web_page_preview: true
            })
        });

        const telegramData = await telegramRes.json();

        if (!telegramData.ok) {
            // Retry without markdown if formatting fails
            console.error("Telegram MarkdownV2 failed, retrying plain text:", telegramData);
            const plainMessage = `🔔 NEW ORDER #${orderNum}${manualTag}\n` +
                `━━━━━━━━━━━━━━━━━━━━\n` +
                `👤 ${customerName || 'Unknown'}\n` +
                `📞 ${phone || 'N/A'}\n` +
                (address ? `📍 ${address}\n` : '') +
                `\n🛒 Items:\n${itemsText}\n` +
                (deliveryCharge ? `🚛 Delivery: ₹${deliveryCharge}\n` : '') +
                (taxAmount ? `📦 Tax/Packing: ₹${taxAmount}\n` : '') +
                (discount ? `🎫 Discount: -₹${discount}\n` : '') +
                (donationAmount ? `💝 Tip: ₹${donationAmount}\n` : '') +
                `━━━━━━━━━━━━━━━━━━━━\n` +
                `💰 Total: ₹${total || 0}\n` +
                (walletApplied ? `💳 Wallet Used: -₹${walletApplied}\n` +
                                 `🎯 Amount Due: ₹${amountDue || 0}\n` : '') +
                `${payIcon} Payment: ${paymentMethod || 'COD'}\n` +
                `${typeEmoji}\n` +
                `⏰ ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`;

            const retryRes = await fetch(telegramUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: CHAT_ID,
                    text: plainMessage,
                    disable_web_page_preview: true
                })
            });
            const retryData = await retryRes.json();
            
            if (!retryData.ok) {
                console.error("Telegram plain text also failed:", retryData);
                return res.status(500).json({ success: false, error: 'Telegram send failed' });
            }
        }

        return res.status(200).json({ success: true });

    } catch (error) {
        console.error("Telegram notification error:", error.message);
        return res.status(500).json({ success: false, error: 'Internal Server Error' });
    }
}

// Escape special characters for Telegram MarkdownV2
function escapeMarkdown(text) {
    if (!text) return '';
    return String(text).replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}
