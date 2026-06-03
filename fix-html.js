const fs = require('fs');
const path = require('path');

const filesToUpdate = [
    'admin.html',
    'cart.html',
    'checkout.html',
    'dashboard.html',
    'delivery.html',
    'index.html',
    'kds.html',
    'payment.html'
];

filesToUpdate.forEach(file => {
    const filePath = path.join(__dirname, file);
    if (fs.existsSync(filePath)) {
        let content = fs.readFileSync(filePath, 'utf8');
        
        // Add type="module" to all js scripts
        content = content.replace(/<script src="(js\/[^"]+)"(><\/script>| >)/g, '<script type="module" src="$1"></script>');
        
        // Ensure index.html doesn't have the wrong noscript in body from my previous mistake
        if (file === 'index.html') {
            // First remove it if it's there
            content = content.replace(/<noscript><img height="1" width="1" style="display:none" src="https:\/\/www\.facebook\.com\/tr\?id=YOUR_META_PIXEL_ID&ev=PageView&noscript=1" \/><\/noscript>/g, '');
            // Then add it right after <body>
            content = content.replace(/<body[^>]*>/i, match => `${match}\n    <noscript><img height="1" width="1" style="display:none" src="https://www.facebook.com/tr?id=YOUR_META_PIXEL_ID&ev=PageView&noscript=1" /></noscript>`);
        }
        
        fs.writeFileSync(filePath, content);
        console.log(`Cleaned up Vite requirements for ${file}`);
    }
});
