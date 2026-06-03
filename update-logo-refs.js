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
    'payment.html',
    'manifest.json',
    'update_email.js',
    'js/email-helper.js',
    'js/payment.js',
    'js/printer-helper.js'
];

filesToUpdate.forEach(file => {
    const filePath = path.join(__dirname, file);
    if (fs.existsSync(filePath)) {
        let content = fs.readFileSync(filePath, 'utf8');
        content = content.replace(/didis_logo\.png/g, 'didis_logo.webp');
        fs.writeFileSync(filePath, content);
        console.log(`Updated ${file}`);
    }
});
