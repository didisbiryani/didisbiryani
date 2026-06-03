const sharp = require('sharp');
const fs = require('fs');

async function compressImage() {
    try {
        await sharp('didis_logo.png')
            .webp({ quality: 80 })
            .toFile('didis_logo.webp');
        console.log("Successfully converted didis_logo.png to didis_logo.webp");
    } catch (err) {
        console.error("Error converting image:", err);
    }
}

compressImage();
