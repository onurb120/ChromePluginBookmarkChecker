from PIL import Image
import os

banner_path = os.path.join('public', 'store-assets', 'promo-banner.png')
icons_dir = 'icons'

if not os.path.exists(icons_dir):
    os.makedirs(icons_dir)

print(f"Loading banner from {banner_path}")
try:
    img = Image.open(banner_path)
    width, height = img.size
    
    # Crop to center square
    size = min(width, height)
    left = (width - size) / 2
    top = (height - size) / 2
    right = (width + size) / 2
    bottom = (height + size) / 2
    
    print(f"Cropping to {size}x{size}")
    img_cropped = img.crop((left, top, right, bottom))
    
    # Generate 16, 48, 128
    for s in [16, 48, 128]:
        resized = img_cropped.resize((s, s), Image.Resampling.LANCZOS)
        out_path = os.path.join(icons_dir, f"icon{s}.png")
        resized.save(out_path)
        print(f"Saved {out_path}")
        
    print("All icons generated successfully!")
except Exception as e:
    print(f"Error: {e}")
