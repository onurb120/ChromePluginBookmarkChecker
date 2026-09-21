const Jimp = require('jimp');
const fs = require('fs');
const path = require('path');

const bannerPath = path.join(__dirname, 'public', 'store-assets', 'promo-banner.png');
const iconsDir = path.join(__dirname, 'icons');

async function generateIcons() {
  try {
    if (!fs.existsSync(iconsDir)) {
      fs.mkdirSync(iconsDir, { recursive: true });
    }

    console.log('Loading banner from', bannerPath);
    const image = await Jimp.read(bannerPath);
    
    // Crop to a center square
    const width = image.getWidth();
    const height = image.getHeight();
    const size = Math.min(width, height);
    
    const x = (width - size) / 2;
    const y = (height - size) / 2;
    
    console.log(`Cropping square of size ${size} at (${x}, ${y})`);
    image.crop(x, y, size, size);
    
    // Generate sizes
    const sizes = [16, 48, 128];
    for (const s of sizes) {
      const outputPath = path.join(iconsDir, `icon${s}.png`);
      const resized = image.clone().resize(s, s);
      await resized.writeAsync(outputPath);
      console.log(`Generated ${outputPath}`);
    }
    
    console.log('All icons generated successfully!');
  } catch (error) {
    console.error('Error generating icons:', error);
  }
}

generateIcons();
