import { db, collection, addDoc, getDoc, doc, auth } from './firebase-config.js';

// --- Safe Date Formatting Helper ---
function safeFormatDate(timestamp, formatType = 'date') {
    if (!timestamp) return 'N/A';
    const dateObj = new Date(timestamp);
    if (isNaN(dateObj.getTime())) return 'N/A';
    if (formatType === 'date') {
        return dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } else if (formatType === 'time') {
        return dateObj.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    }
    return dateObj.toLocaleDateString();
}

function generateInvoiceHTML(o) {
    let itemsHtml = '';
    let calculatedSubtotal = 0;
    (o.items || []).forEach(i => {
        const itemTotal = Number(i.price) * Number(i.quantity);
        calculatedSubtotal += itemTotal;
        const customizations = i.customizations ? Object.values(i.customizations).join(', ') : '';
        itemsHtml += `
            <tr>
                <td style="padding: 8px 12px; font-size: 12px; color: #ffffff; font-weight: 600; border-bottom: 1px dotted rgba(212, 160, 23, 0.4); text-align: left;">
                    <div style="font-weight: bold;">${i.name}</div>
                    ${customizations ? `<div style="font-size: 9px; color: #d4a017; margin-top: 2px;">${customizations}</div>` : ''}
                </td>
                <td style="padding: 8px 12px; font-size: 12px; color: #ffffff; font-weight: 600; border-bottom: 1px dotted rgba(212, 160, 23, 0.4); text-align: center;">${i.quantity}</td>
                <td style="padding: 8px 12px; font-size: 12px; color: #ffffff; font-weight: 600; border-bottom: 1px dotted rgba(212, 160, 23, 0.4); text-align: right;">₹${Number(i.price).toFixed(2)}</td>
                <td style="padding: 8px 12px; font-size: 12px; color: #ffffff; font-weight: 600; border-bottom: 1px dotted rgba(212, 160, 23, 0.4); text-align: right;">₹${Number(itemTotal).toFixed(2)}</td>
            </tr>
        `;
    });

    let totalsHtml = `
        <tr>
            <td style="padding: 4px 0; color: #d4a017; font-weight: 700; font-size: 11px;">SUBTOTAL</td>
            <td style="padding: 4px 0; color: #ffffff; font-weight: 700; font-size: 11px; text-align: right; border-bottom: 1.5px solid rgba(212, 160, 23, 0.5);">₹${Number(calculatedSubtotal).toFixed(2)}</td>
        </tr>
        <tr>
            <td style="padding: 4px 0; color: #d4a017; font-weight: 700; font-size: 11px;">DELIVERY CHARGE</td>
            <td style="padding: 4px 0; color: #ffffff; font-weight: 700; font-size: 11px; text-align: right; border-bottom: 1.5px solid rgba(212, 160, 23, 0.5);">₹${Number(o.deliveryCharge || 0).toFixed(2)}</td>
        </tr>
        <tr>
            <td style="padding: 4px 0; color: #d4a017; font-weight: 700; font-size: 11px;">DISCOUNT</td>
            <td style="padding: 4px 0; color: #ffffff; font-weight: 700; font-size: 11px; text-align: right; border-bottom: 1.5px solid rgba(212, 160, 23, 0.5);">₹${Number(o.discount || 0).toFixed(2)}</td>
        </tr>
    `;

    if (Number(o.taxAmount || 0) > 0) {
        totalsHtml += `
        <tr>
            <td style="padding: 4px 0; color: #d4a017; font-weight: 700; font-size: 11px;">PACKING CHARGES</td>
            <td style="padding: 4px 0; color: #ffffff; font-weight: 700; font-size: 11px; text-align: right; border-bottom: 1.5px solid rgba(212, 160, 23, 0.5);">₹${Number(o.taxAmount).toFixed(2)}</td>
        </tr>
        `;
    }
    if (Number(o.tipAmount || 0) > 0) {
        totalsHtml += `
        <tr>
            <td style="padding: 4px 0; color: #d4a017; font-weight: 700; font-size: 11px;">DRIVER TIP</td>
            <td style="padding: 4px 0; color: #ffffff; font-weight: 700; font-size: 11px; text-align: right; border-bottom: 1.5px solid rgba(212, 160, 23, 0.5);">₹${Number(o.tipAmount).toFixed(2)}</td>
        </tr>
        `;
    }

    totalsHtml += `
        <tr>
            <td colspan="2" style="padding-top: 8px;">
                <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #d4a017; border-radius: 6px;">
                    <tr>
                        <td style="padding: 8px 12px; color: #000000; font-size: 13px; font-weight: 900; letter-spacing: 1px;">GRAND TOTAL</td>
                        <td style="padding: 8px 12px; color: #000000; font-size: 15px; font-weight: 900; text-align: right;">₹${Number(o.total).toFixed(2)}</td>
                    </tr>
                </table>
            </td>
        </tr>
    `;

    const addressParts = (o.address || '').split(',').map(p => p.trim()).filter(Boolean);
    const line1 = addressParts[0] || 'Outlet Pickup';
    const line2 = addressParts.slice(1).join(', ') || '&nbsp;';
    const dateStr = safeFormatDate(o.timestamp, 'date');
    const timeStr = safeFormatDate(o.timestamp, 'time');
    const invNo = o.orderNumber ? String(o.orderNumber).padStart(5, '0') : o.id.substring(0, 6).toUpperCase();
    const isDelivery = o.orderType === 'delivery';

    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Invoice</title>
</head>
<body style="background-color: #ffffff; padding: 20px; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; margin: 0; -webkit-font-smoothing: antialiased;">
    <table width="100%" cellpadding="0" cellspacing="0" border="0" align="center" style="max-width: 650px; margin: 0 auto;">
        <tr>
            <td style="background-color: #0a0a0a; border: 3px double #d4a017; padding: 6px;">
                <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border: 1px solid rgba(212, 160, 23, 0.5); padding: 16px;">
                    <!-- Header Row -->
                    <tr>
                        <td width="110" style="padding-bottom: 12px;">
                            <img src="https://res.cloudinary.com/dbcvuhcyu/image/upload/v1780180720/didis_logo_yp2lqj.webp" alt="Didi's Logo" style="width: 95px; height: 95px; border-radius: 50%; border: 2px solid #d4a017; display: block; background-color: #000000;">
                        </td>
                        <td style="padding-bottom: 12px; text-align: center;">
                            <h1 style="color: #d4a017; font-size: 32px; font-weight: bold; margin: 0 0 5px 0;">Didi's Biryani</h1>
                            <p style="color: #ffffff; font-size: 16px; margin: 0; font-style: italic;">Homemade Fresh Bengali Flavours ❤️</p>
                            <div style="height: 2px; background-color: #d4a017; margin-top: 8px; margin-left: 20px; margin-right: 20px;"></div>
                        </td>
                    </tr>
                    
                    <!-- Banner -->
                    <tr>
                        <td colspan="2" align="center" style="padding-top: 10px; padding-bottom: 20px;">
                            <table cellpadding="0" cellspacing="0" border="0">
                                <tr>
                                    <td style="background-color: #d4a017; color: #000000; font-weight: bold; font-size: 16px; letter-spacing: 4px; padding: 6px 40px;">
                                        INVOICE
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>

                    <!-- Meta Grid -->
                    <tr>
                        <td colspan="2" style="padding-bottom: 20px;">
                            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size: 13px; color: #ffffff;">
                                <tr>
                                    <!-- Left Meta -->
                                    <td width="48%" valign="top">
                                        <table width="100%" cellpadding="0" cellspacing="0" border="0">
                                            <tr>
                                                <td width="90" style="color: #d4a017; font-weight: bold; padding-bottom: 8px;">Invoice No.</td>
                                                <td width="10" style="color: #d4a017; padding-bottom: 8px;">:</td>
                                                <td style="border-bottom: 1px solid rgba(212, 160, 23, 0.5); padding-bottom: 2px; font-weight: bold; padding-bottom: 8px;">INV-${invNo}</td>
                                            </tr>
                                            <tr>
                                                <td width="90" style="color: #d4a017; font-weight: bold; padding-bottom: 8px;">Date</td>
                                                <td width="10" style="color: #d4a017; padding-bottom: 8px;">:</td>
                                                <td style="border-bottom: 1px solid rgba(212, 160, 23, 0.5); padding-bottom: 2px; font-weight: bold; padding-bottom: 8px;">${dateStr}</td>
                                            </tr>
                                            <tr>
                                                <td width="90" style="color: #d4a017; font-weight: bold;">Time</td>
                                                <td width="10" style="color: #d4a017;">:</td>
                                                <td style="border-bottom: 1px solid rgba(212, 160, 23, 0.5); padding-bottom: 2px; font-weight: bold;">${timeStr}</td>
                                            </tr>
                                        </table>
                                    </td>
                                    <!-- Spacer -->
                                    <td width="4%"></td>
                                    <!-- Right Meta -->
                                    <td width="48%" valign="top">
                                        <table width="100%" cellpadding="0" cellspacing="0" border="0">
                                            <tr>
                                                <td width="90" style="color: #d4a017; font-weight: bold; padding-bottom: 8px;">Order Type</td>
                                                <td width="10" style="color: #d4a017; padding-bottom: 8px;">:</td>
                                                <td style="padding-bottom: 8px; font-weight: bold;">
                                                    ${isDelivery ? '☑' : '☐'} Delivery &nbsp;&nbsp; ${!isDelivery ? '☑' : '☐'} Takeaway
                                                </td>
                                            </tr>
                                            <tr>
                                                <td width="90" style="color: #d4a017; font-weight: bold; padding-bottom: 8px;">Order No.</td>
                                                <td width="10" style="color: #d4a017; padding-bottom: 8px;">:</td>
                                                <td style="border-bottom: 1px solid rgba(212, 160, 23, 0.5); padding-bottom: 2px; font-weight: bold; padding-bottom: 8px;">ORD-${invNo}</td>
                                            </tr>
                                            <tr>
                                                <td width="90" style="color: #d4a017; font-weight: bold;">Payment</td>
                                                <td width="10" style="color: #d4a017;">:</td>
                                                <td style="border-bottom: 1px solid rgba(212, 160, 23, 0.5); padding-bottom: 2px; font-weight: bold; text-transform: uppercase;">${o.paymentMethod || 'ONLINE'}</td>
                                            </tr>
                                        </table>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>

                    <!-- Customer Box -->
                    <tr>
                        <td colspan="2" style="padding-bottom: 20px;">
                            <table width="100%" cellpadding="12" cellspacing="0" border="0" style="border: 1px solid #d4a017; border-radius: 8px; background-color: #111111; font-size: 12px; color: #ffffff;">
                                <tr>
                                    <td width="50%" valign="top" style="padding-bottom: 0;">
                                        <span style="color: #d4a017; font-weight: bold;">👤 Customer Name:</span><br>
                                        <div style="border-bottom: 1px solid rgba(212, 160, 23, 0.4); padding-bottom: 4px; padding-top: 4px; font-weight: bold;">${o.customer || 'N/A'}</div>
                                    </td>
                                    <td width="50%" valign="top" style="padding-bottom: 0;">
                                        <span style="color: #d4a017; font-weight: bold;">📍 Delivery Address:</span><br>
                                        <div style="border-bottom: 1px solid rgba(212, 160, 23, 0.4); padding-bottom: 4px; padding-top: 4px; font-weight: bold;">${line1}</div>
                                        ${line2 && line2 !== '&nbsp;' ? `<div style="border-bottom: 1px solid rgba(212, 160, 23, 0.4); padding-bottom: 4px; padding-top: 4px; font-weight: bold;">${line2}</div>` : ''}
                                    </td>
                                </tr>
                                <tr>
                                    <td colspan="2" valign="top">
                                        <span style="color: #d4a017; font-weight: bold;">📞 Phone Number:</span><br>
                                        <div style="border-bottom: 1px solid rgba(212, 160, 23, 0.4); padding-bottom: 4px; padding-top: 4px; font-weight: bold;">${o.phone || 'N/A'}</div>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>

                    <!-- Items Table -->
                    <tr>
                        <td colspan="2" style="padding-bottom: 20px;">
                            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border: 1px solid #d4a017; border-radius: 8px; background-color: #000000;">
                                <tr>
                                    <th width="55%" style="background-color: #d4a017; color: #000000; font-weight: bold; font-size: 12px; letter-spacing: 1px; padding: 8px 12px; text-align: left;">ITEM NAME</th>
                                    <th width="10%" style="background-color: #d4a017; color: #000000; font-weight: bold; font-size: 12px; letter-spacing: 1px; padding: 8px 12px; text-align: center;">QTY</th>
                                    <th width="15%" style="background-color: #d4a017; color: #000000; font-weight: bold; font-size: 12px; letter-spacing: 1px; padding: 8px 12px; text-align: right;">PRICE (₹)</th>
                                    <th width="20%" style="background-color: #d4a017; color: #000000; font-weight: bold; font-size: 12px; letter-spacing: 1px; padding: 8px 12px; text-align: right;">TOTAL (₹)</th>
                                </tr>
                                ${itemsHtml}
                            </table>
                        </td>
                    </tr>

                    <!-- Summary & Thanks -->
                    <tr>
                        <td colspan="2" style="padding-bottom: 20px;">
                            <table width="100%" cellpadding="0" cellspacing="0" border="0">
                                <tr>
                                    <td width="50%" valign="top" style="padding-right: 15px;">
                                        <h3 style="color: #d4a017; font-size: 24px; margin: 0 0 5px 0; font-weight: bold;">Thank You ❤️</h3>
                                        <p style="color: #ffffff; font-size: 13px; font-weight: bold; margin: 0 0 5px 0;">for choosing Didi's Biryani!</p>
                                        <p style="color: rgba(255, 255, 255, 0.7); font-size: 11px; margin: 0; font-style: italic;">Made with love, delivered to you.</p>
                                    </td>
                                    <td width="50%" valign="top">
                                        <table width="100%" cellpadding="0" cellspacing="0" border="0">
                                            ${totalsHtml}
                                        </table>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>

                    <!-- Contacts Footer -->
                    <tr>
                        <td colspan="2" style="padding-bottom: 20px;">
                            <table width="100%" cellpadding="10" cellspacing="0" border="0" style="border: 1px dashed #d4a017; border-radius: 8px; background-color: #111111;">
                                <tr>
                                    <td width="33%" align="center" style="border-right: 1px solid rgba(212, 160, 23, 0.4);">
                                        <div style="font-size: 11px; font-weight: bold; color: #ffffff;">📞 6001572756</div>
                                        <div style="font-size: 9px; color: rgba(255, 255, 255, 0.6);">Call / WhatsApp</div>
                                    </td>
                                    <td width="33%" align="center" style="border-right: 1px solid rgba(212, 160, 23, 0.4);">
                                        <div style="font-size: 11px; font-weight: bold; color: #ffffff;">📍 Udharbond</div>
                                        <div style="font-size: 9px; color: rgba(255, 255, 255, 0.6);">Durganagar Part 5</div>
                                    </td>
                                    <td width="34%" align="center">
                                        <div style="font-size: 11px; font-weight: bold; color: #ffffff;">📸 didis.biryani</div>
                                        <div style="font-size: 9px; color: rgba(255, 255, 255, 0.6);">Instagram</div>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>

                    <!-- Decal -->
                    <tr>
                        <td colspan="2" align="center">
                            <table cellpadding="0" cellspacing="0" border="0">
                                <tr>
                                    <td style="background-color: #d4a017; color: #000000; font-size: 10px; font-weight: bold; letter-spacing: 2px; padding: 6px 25px; border-radius: 4px;">
                                        HOMEMADE &bull; FRESH &bull; DELIVERED
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>`;
}

export async function sendInvoiceEmail(order) {
    if (!order.email) {
        console.warn("No email address found for customer, skipping invoice email.");
        if (window.showToast) {
            window.showToast("Order has no customer email address. Skipping email.", "info");
        }
        return;
    }

    try {
        const invoiceHtml = generateInvoiceHTML(order);
        const subject = `Your Invoice for Didi's Biryani Order #${order.orderNumber ? String(order.orderNumber).padStart(5, '0') : order.id.substring(0, 6).toUpperCase()}`;

        let token = '';
        if (auth.currentUser) {
            token = await auth.currentUser.getIdToken(true);
        } else {
            console.warn("sendInvoiceEmail: Firebase auth.currentUser is null, waiting for auth state...");
            await new Promise(r => setTimeout(r, 1000));
            if (auth.currentUser) {
                token = await auth.currentUser.getIdToken(true);
            } else {
                console.error("sendInvoiceEmail: Firebase auth is completely unauthenticated.");
            }
        }

        const response = await fetch('/api/send-email', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': token ? `Bearer ${token}` : ''
            },
            body: JSON.stringify({
                to: order.email,
                subject: subject,
                html: invoiceHtml
            })
        });

        const result = await response.json();

        if (response.ok && result.success) {
            console.log(`Invoice email sent successfully to ${order.email} for order ${order.id}`);
            if (window.showToast) {
                window.showToast("Invoice email sent to customer!", "success");
            }
        } else {
            console.error("Vercel API failed to send email:", result);
            if (window.showToast) {
                window.showToast("Email failed to dispatch: " + (result.error || "Unknown error"), "error");
            }
            throw new Error(result.error || "Unknown error");
        }
    } catch (err) {
        console.error("Error sending invoice email:", err);
        throw err;
    }
}
