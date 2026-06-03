const fs = require('fs');
const path = require('path');

const adminHtml = fs.readFileSync(path.join(__dirname, 'admin.html'), 'utf-8');
const lines = adminHtml.split('\n');

// Extract CSS
const cssStart = lines.findIndex(l => l.includes('/* Print Invoice Card Styling */'));
const cssEnd = lines.findIndex((l, idx) => idx > cssStart && l.includes('</style>'));
const cssContent = lines.slice(cssStart, cssEnd).join('\n');

// Extract HTML template parts
// Header up to Metadata Grid
// We will manually build the HTML to inject variables

let newEmailHelper = fs.readFileSync(path.join(__dirname, 'js/email-helper.js'), 'utf-8');

// The replacement function
const generateInvoiceHTMLCode = `
function generateInvoiceHTML(o) {
    let itemsHtml = '';
    let calculatedSubtotal = 0;
    (o.items || []).forEach(i => {
        const itemTotal = Number(i.price) * Number(i.quantity);
        calculatedSubtotal += itemTotal;
        const customizations = i.customizations ? Object.values(i.customizations).join(', ') : '';
        itemsHtml += \`
            <tr>
                <td class="col-item text-left">
                    <div style="font-weight: bold;">\${i.name}</div>
                    \${customizations ? \`<div style="font-size: 9px; color: #d4a017; margin-top: 2px;">\${customizations}</div>\` : ''}
                </td>
                <td class="col-qty text-center">\${i.quantity}</td>
                <td class="col-price text-right">₹\${Number(i.price).toFixed(2)}</td>
                <td class="col-total text-right">₹\${Number(itemTotal).toFixed(2)}</td>
            </tr>
        \`;
    });

    let totalsHtml = \`
        <div class="total-row">
            <span class="total-label">SUBTOTAL</span>
            <span class="total-separator"></span>
            <span class="total-val-line">₹\${Number(calculatedSubtotal).toFixed(2)}</span>
        </div>
        <div class="total-row">
            <span class="total-label">DELIVERY CHARGE</span>
            <span class="total-separator"></span>
            <span class="total-val-line">₹\${Number(o.deliveryCharge || 0).toFixed(2)}</span>
        </div>
        <div class="total-row">
            <span class="total-label">DISCOUNT</span>
            <span class="total-separator"></span>
            <span class="total-val-line">₹\${Number(o.discount || 0).toFixed(2)}</span>
        </div>
    \`;

    if (Number(o.taxAmount || 0) > 0) {
        totalsHtml += \`
        <div class="total-row">
            <span class="total-label">PACKING CHARGES</span>
            <span class="total-separator"></span>
            <span class="total-val-line">₹\${Number(o.taxAmount).toFixed(2)}</span>
        </div>
        \`;
    }
    if (Number(o.tipAmount || 0) > 0) {
        totalsHtml += \`
        <div class="total-row">
            <span class="total-label">DRIVER TIP</span>
            <span class="total-separator"></span>
            <span class="total-val-line">₹\${Number(o.tipAmount).toFixed(2)}</span>
        </div>
        \`;
    }

    totalsHtml += \`
        <div class="grand-total-row">
            <div class="grand-total-capsule">
                <span class="grand-total-label">GRAND TOTAL</span>
                <span class="grand-total-separator"></span>
                <span class="grand-total-val">₹\${Number(o.total).toFixed(2)}</span>
            </div>
        </div>
    \`;

    const addressParts = (o.address || '').split(',').map(p => p.trim()).filter(Boolean);
    const line1 = addressParts[0] || 'Outlet Pickup';
    const line2 = addressParts.slice(1).join(', ') || '&nbsp;';
    const dateStr = safeFormatDate(o.timestamp, 'date');
    const timeStr = safeFormatDate(o.timestamp, 'time');
    const invNo = o.orderNumber ? String(o.orderNumber).padStart(5, '0') : o.id.substring(0, 6).toUpperCase();
    const isDelivery = o.orderType === 'delivery';

    return \`
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <style>
            @import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@700&family=Great+Vibes&family=Outfit:wght@400;600;700;900&family=Dancing+Script:wght@700&display=swap');
            body { background-color: #000000; padding: 20px; font-family: 'Outfit', sans-serif; }
            \${cssContent.replace(/\\r?\\n/g, '\\n            ')}
        </style>
    </head>
    <body>
        <div class="invoice-card">
            <div class="invoice-border-inner">
                <!-- Header -->
                <div class="invoice-header">
                    <div class="invoice-logo-container">
                        <img src="https://didisbiryani.in/didis_logo.webp" alt="Didi's Logo" class="invoice-logo">
                    </div>
                    <div class="invoice-brand">
                        <h1 class="invoice-title">
                            <span style="font-family: 'Great Vibes', cursive; font-size: 1.4em; font-weight: 400; color: #d4a017 !important; text-transform: capitalize; padding-right: 4px; letter-spacing: 1px; -webkit-text-fill-color: #d4a017 !important;">Didi's</span>
                            <span style="font-family: 'Cinzel', serif; font-size: 1em; font-weight: 700; color: #d4a017 !important; letter-spacing: 1px; -webkit-text-fill-color: #d4a017 !important;">biryani</span>
                        </h1>
                        <p class="invoice-subtitle">Homemade Fresh Bengali Flavours ❤️</p>
                        <div class="invoice-gold-divider"></div>
                    </div>
                </div>

                <!-- Ribbon Label -->
                <div class="invoice-banner-wrap">
                    <div class="invoice-banner">INVOICE</div>
                </div>

                <!-- Metadata Grid -->
                <div class="invoice-meta-grid">
                    <div class="invoice-meta-col">
                        <div class="invoice-meta-row">
                            <span class="meta-label">Invoice No.</span>
                            <span class="meta-separator">:</span>
                            <span class="meta-value-line">INV-\${invNo}</span>
                        </div>
                        <div class="invoice-meta-row">
                            <span class="meta-label">Date</span>
                            <span class="meta-separator">:</span>
                            <span class="meta-value-line">\${dateStr}</span>
                        </div>
                        <div class="invoice-meta-row">
                            <span class="meta-label">Time</span>
                            <span class="meta-separator">:</span>
                            <span class="meta-value-line">\${timeStr}</span>
                        </div>
                    </div>
                    <div class="invoice-meta-col">
                        <div class="invoice-meta-row">
                            <span class="meta-label">Order Type</span>
                            <span class="meta-separator">:</span>
                            <span class="meta-checkboxes">
                                <span class="chk-item"><span class="chk-box">\${isDelivery ? '☑' : '☐'}</span> Delivery</span>
                                <span class="chk-item"><span class="chk-box">\${!isDelivery ? '☑' : '☐'}</span> Takeaway</span>
                            </span>
                        </div>
                        <div class="invoice-meta-row">
                            <span class="meta-label">Order No.</span>
                            <span class="meta-separator">:</span>
                            <span class="meta-value-line">ORD-\${invNo}</span>
                        </div>
                        <div class="invoice-meta-row">
                            <span class="meta-label">Payment Type</span>
                            <span class="meta-separator">:</span>
                            <span class="meta-value-line" style="text-transform: uppercase;">\${o.paymentMethod || 'ONLINE'}</span>
                        </div>
                    </div>
                </div>

                <!-- Customer Box -->
                <div class="invoice-customer-box">
                    <div class="cust-row">
                        <div class="cust-field flex-item">
                            <span class="cust-icon">👤</span>
                            <span class="cust-label">Customer Name :</span>
                            <span class="cust-value-line">\${o.customer || 'N/A'}</span>
                        </div>
                        <div class="cust-field flex-item flex-address">
                            <span class="cust-icon">📍</span>
                            <span class="cust-label">Delivery Address :</span>
                            <div class="address-lines-container">
                                <span class="cust-value-line address-line">\${line1}</span>
                                \${line2 && line2 !== '&nbsp;' ? \`<span class="cust-value-line address-line">\${line2}</span>\` : ''}
                            </div>
                        </div>
                    </div>
                    <div class="cust-row">
                        <div class="cust-field flex-item">
                            <span class="cust-icon">📞</span>
                            <span class="cust-label">Phone Number :</span>
                            <span class="cust-value-line">\${o.phone || 'N/A'}</span>
                        </div>
                    </div>
                </div>

                <!-- Table -->
                <div class="invoice-table-wrapper">
                    <img src="https://didisbiryani.in/didis_logo.webp" class="invoice-table-watermark" alt="Watermark">
                    <table class="invoice-table">
                        <thead>
                            <tr>
                                <th class="col-item">ITEM NAME</th>
                                <th class="col-qty">QTY</th>
                                <th class="col-price">PRICE (₹)</th>
                                <th class="col-total">TOTAL (₹)</th>
                            </tr>
                        </thead>
                        <tbody>
                            \${itemsHtml}
                        </tbody>
                    </table>
                </div>

                <!-- Summary & Thanks -->
                <div class="invoice-summary-section">
                    <div class="invoice-thanks">
                        <h3 class="thanks-title">Thank You ❤️</h3>
                        <p class="thanks-subtitle">for choosing Didi's Biryani!</p>
                        <p class="thanks-tagline">Made with love, delivered to you.</p>
                    </div>
                    <div class="invoice-totals">
                        \${totalsHtml}
                    </div>
                </div>

                <!-- Contacts Footer -->
                <div class="invoice-footer-contacts">
                    <div class="contact-col border-right">
                        <div class="contact-icon-circle">📞</div>
                        <div class="contact-text">
                            <span class="contact-title">6001572756</span>
                            <span class="contact-sub">Call / WhatsApp</span>
                        </div>
                    </div>
                    <div class="contact-col border-right">
                        <div class="contact-icon-circle">📍</div>
                        <div class="contact-text">
                            <span class="contact-title">Udharbond</span>
                            <span class="contact-sub">Durganagar Part 5</span>
                        </div>
                    </div>
                    <div class="contact-col border-right">
                        <div class="contact-icon-circle">📸</div>
                        <div class="contact-text">
                            <span class="contact-title">didis.biryani</span>
                            <span class="contact-sub">Didi's Biryani</span>
                        </div>
                    </div>
                    <div class="contact-col">
                        <img src="https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=https://didisbiryani.in" alt="QR Code" class="footer-qr">
                        <span class="qr-text">Scan to Order</span>
                    </div>
                </div>

                <!-- Decal -->
                <div class="invoice-bottom-decal-wrap">
                    <div class="invoice-bottom-decal">
                        HOMEMADE &bull; FRESH &bull; DELIVERED
                    </div>
                </div>
            </div>
        </div>
    </body>
    </html>
    \`;
}
`;

const startIndex = newEmailHelper.indexOf('function generateInvoiceHTML(o) {');
const endIndex = newEmailHelper.indexOf('export async function sendInvoiceEmail(order) {');

if (startIndex !== -1 && endIndex !== -1) {
    newEmailHelper = newEmailHelper.substring(0, startIndex) + generateInvoiceHTMLCode + '\n' + newEmailHelper.substring(endIndex);
    fs.writeFileSync(path.join(__dirname, 'js/email-helper.js'), newEmailHelper);
    console.log('Successfully updated email-helper.js');
} else {
    console.error('Could not find replace markers');
}
