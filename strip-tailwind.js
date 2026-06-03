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
        
        // Remove the tailwind CDN block
        const regex = /<script src="js\/tailwind-cdn\.js"><\/script>\s*<script>\s*tailwind\.config[\s\S]*?<\/script>/;
        content = content.replace(regex, '');
        
        // Ensure style.css is linked (it usually is, but just checking)
        if (!content.includes('css/style.css')) {
            content = content.replace('</head>', '    <link rel="stylesheet" href="css/style.css">\n</head>');
        }
        
        fs.writeFileSync(filePath, content);
        console.log(`Cleaned up ${file}`);
    }
});
