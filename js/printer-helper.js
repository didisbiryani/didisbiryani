// printer-helper.js

// Shared print CSS for thermal printers (58mm width optimized)
const printerCss = `
<style>
    @import url('https://fonts.googleapis.com/css2?family=Courier+Prime:wght@400;700&display=swap');
    
    * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
    }
    
    body {
        font-family: 'Courier Prime', 'Courier New', monospace;
        color: #000;
        background: #fff;
        width: 58mm; /* standard 2-inch thermal printer */
        margin: 0 auto;
        padding: 5px;
        font-size: 12px;
        line-height: 1.2;
    }
    
    .text-center { text-align: center; }
    .text-left { text-align: left; }
    .text-right { text-align: right; }
    .bold { font-weight: bold; }
    
    .divider {
        border-top: 1px dashed #000;
        margin: 8px 0;
    }
    .divider-solid {
        border-top: 1px solid #000;
        margin: 8px 0;
    }
    
    .header-title {
        font-size: 16px;
        font-weight: bold;
        text-transform: uppercase;
        margin-bottom: 2px;
    }
    
    .sub-text {
        font-size: 10px;
    }
    
    .order-no {
        font-size: 20px;
        font-weight: bold;
        margin: 5px 0;
        border: 2px solid #000;
        padding: 4px;
        display: inline-block;
    }
    
    table {
        width: 100%;
        border-collapse: collapse;
    }
    
    th, td {
        padding: 4px 0;
        vertical-align: top;
    }
    
    .col-qty { width: 15%; }
    .col-item { width: 60%; }
    .col-price { width: 25%; text-align: right; }
    
    .customization {
        font-size: 10px;
        font-style: italic;
        padding-left: 5px;
    }
    
    .veg-icon {
        display: inline-block;
        width: 8px;
        height: 8px;
        border: 1px solid #000;
        border-radius: 50%;
        margin-right: 4px;
        position: relative;
        top: -1px;
    }
    .veg-icon.non-veg {
        border-radius: 0;
    }
</style>
`;

/**
 * Triggers the browser print dialog using a hidden iframe.
 * @param {string} htmlContent - The full HTML string to print.
 */
function doPrint(htmlContent) {
    let iframe = document.getElementById('printer-iframe');
    if (!iframe) {
        iframe = document.createElement('iframe');
        iframe.id = 'printer-iframe';
        iframe.style.position = 'absolute';
        iframe.style.width = '0px';
        iframe.style.height = '0px';
        iframe.style.border = 'none';
        iframe.style.left = '-9999px';
        document.body.appendChild(iframe);
    }
    
    const doc = iframe.contentWindow.document;
    doc.open();
    doc.write(htmlContent);
    doc.close();

    // Wait slightly for fonts/styles to load then print
    setTimeout(() => {
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
    }, 500);
}

function safeFormatDate(timestamp) {
    if (!timestamp) return new Date().toLocaleTimeString();
    return new Date(timestamp).toLocaleString('en-IN', {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
}

function getOrderNumberStr(order) {
    return order.orderNumber ? String(order.orderNumber).padStart(5, '0') : order.id.substring(0, 6).toUpperCase();
}

/**
 * Generates and prints a Kitchen Order Ticket (KOT).
 * Optimized for chefs (large order number, items, customizations).
 */
export function printKOT(order) {
    const invNo = getOrderNumberStr(order);
    const dateStr = safeFormatDate(order.timestamp);
    
    let itemsHtml = '';
    (order.items || []).forEach(item => {
        const isVeg = item.isVeg || (item.category && item.category.toLowerCase().includes('veg') && !item.category.toLowerCase().includes('non-veg'));
        const vegClass = isVeg ? '' : 'non-veg';
        const vegIndicator = `<span class="veg-icon ${vegClass}"></span>`;
        
        let customHtml = '';
        if (item.customizations) {
            const custText = Object.values(item.customizations).join(', ');
            if (custText) {
                customHtml = `<div class="customization">* ${custText}</div>`;
            }
        }
        
        let variantText = item.variantLabel ? ` (${item.variantLabel})` : '';

        itemsHtml += `
            <tr>
                <td class="col-qty bold">${item.quantity} x</td>
                <td class="col-item">
                    ${vegIndicator}${item.name}${variantText}
                    ${customHtml}
                </td>
            </tr>
        `;
    });

    const typeStr = order.orderType === 'delivery' ? 'DELIVERY' : 'TAKEAWAY';

    const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        ${printerCss}
    </head>
    <body>
        <div class="text-center">
            <div class="header-title">KOT</div>
            <div class="sub-text">${dateStr}</div>
            <div class="divider"></div>
            <div class="bold" style="font-size:14px;">${typeStr}</div>
            <div class="order-no">#${invNo}</div>
            <div class="divider"></div>
        </div>
        
        <table>
            <thead>
                <tr>
                    <th class="text-left sub-text">QTY</th>
                    <th class="text-left sub-text">ITEM</th>
                </tr>
            </thead>
            <tbody>
                ${itemsHtml}
            </tbody>
        </table>
        
        <div class="divider"></div>
        <div class="text-center sub-text">End of KOT</div>
        <div class="divider-solid"></div>
    </body>
    </html>
    `;

    doPrint(html);
}

/**
 * Generates and prints a Delivery Slip/Invoice.
 * Contains customer details, prices, and totals.
 */
export function printDeliverySlip(order) {
    const invNo = getOrderNumberStr(order);
    const dateStr = safeFormatDate(order.timestamp);
    
    let itemsHtml = '';
    (order.items || []).forEach(item => {
        let customHtml = '';
        if (item.customizations) {
            const custText = Object.values(item.customizations).join(', ');
            if (custText) {
                customHtml = `<div class="customization">${custText}</div>`;
            }
        }
        let variantText = item.variantLabel ? ` (${item.variantLabel})` : '';

        itemsHtml += `
            <tr>
                <td class="col-qty">${item.quantity}</td>
                <td class="col-item">
                    ${item.name}${variantText}
                    ${customHtml}
                </td>
                <td class="col-price">${Number(item.price * item.quantity).toFixed(2)}</td>
            </tr>
        `;
    });

    let paymentStatus = order.paymentMethod === 'Cash on Delivery' || order.paymentMethod === 'cod' ? 'CASH TO COLLECT' : 'PAID ONLINE';
    if (order.paymentStatus === 'paid') paymentStatus = 'PAID ONLINE';
    
    const dueAmt = order.amountDue !== undefined ? order.amountDue : order.total;

    const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        ${printerCss}
    </head>
    <body>
        <div class="text-center">
            <div class="header-title">DIDI'S BIRYANI</div>
            <div class="sub-text">Homemade Fresh Bengali Flavours</div>
            <div class="divider"></div>
            <div class="bold" style="font-size:14px;">INVOICE</div>
            <div class="order-no">#${invNo}</div>
            <div class="sub-text">${dateStr}</div>
            <div class="divider"></div>
        </div>
        
        <div class="text-left" style="margin-bottom: 8px;">
            <div class="bold">Customer Details:</div>
            <div>${order.customer || 'N/A'}</div>
            <div>Ph: ${order.phone || 'N/A'}</div>
            <div class="sub-text" style="margin-top: 2px;">
                ${order.orderType === 'delivery' ? 'Delivery Address:' : 'Takeaway (Pickup)'}<br>
                ${order.address || ''}
            </div>
        </div>
        
        <div class="divider"></div>
        
        <table>
            <thead>
                <tr>
                    <th class="text-left sub-text border-bottom">Q</th>
                    <th class="text-left sub-text border-bottom">ITEM</th>
                    <th class="text-right sub-text border-bottom">AMT</th>
                </tr>
            </thead>
            <tbody>
                ${itemsHtml}
            </tbody>
        </table>
        
        <div class="divider"></div>
        
        <table style="font-size: 11px;">
            <tr>
                <td>Subtotal</td>
                <td class="text-right">${Number(order.total - (order.deliveryCharge||0) - (order.taxAmount||0) - (order.tipAmount||0) + (order.discount||0)).toFixed(2)}</td>
            </tr>
            ${order.deliveryCharge ? `<tr><td>Delivery</td><td class="text-right">${Number(order.deliveryCharge).toFixed(2)}</td></tr>` : ''}
            ${order.taxAmount ? `<tr><td>Packing</td><td class="text-right">${Number(order.taxAmount).toFixed(2)}</td></tr>` : ''}
            ${order.discount ? `<tr><td>Discount</td><td class="text-right">-${Number(order.discount).toFixed(2)}</td></tr>` : ''}
        </table>
        
        <div class="divider"></div>
        
        <table>
            <tr class="bold" style="font-size: 14px;">
                <td>TOTAL</td>
                <td class="text-right">Rs. ${Number(order.total).toFixed(2)}</td>
            </tr>
        </table>
        
        <div class="divider-solid"></div>
        
        <div class="text-center" style="margin-top: 10px; margin-bottom: 5px;">
            <div class="bold" style="font-size:14px;">${paymentStatus}</div>
            ${paymentStatus === 'CASH TO COLLECT' ? `<div class="bold" style="font-size:16px;">Rs. ${Number(dueAmt).toFixed(2)}</div>` : ''}
        </div>
        
        <div class="divider-solid"></div>
        
        <div class="text-center sub-text" style="margin-top: 10px;">
            Thank you for ordering!<br>
            Please visit didisbiryani.in
        </div>
        
        <div style="height: 30px;"></div>
    </body>
    </html>
    `;

    doPrint(html);
}
