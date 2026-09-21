from PIL import Image, ImageChops
import os

input_img_path = r"C:\Users\onur.bayraktar\.gemini\antigravity\brain\6d81a4bb-6b69-40c4-b6b0-df942550efaf\.user_uploaded\media_1789509097806.png"
icons_dir = 'icons'

if not os.path.exists(icons_dir):
    os.makedirs(icons_dir)

def trim_white(im):
    bg = Image.new(im.mode, im.size, im.getpixel((0,0)))
    diff = ImageChops.difference(im, bg)
    diff = ImageChops.add(diff, diff, 2.0, -100)
    bbox = diff.getbbox()
    if bbox:
        return bbox
    return None

try:
    img = Image.open(input_img_path)
    if img.mode != 'RGBA':
        img = img.convert('RGBA')
        
    print(f"Original size: {img.size}")
    
    # Let's crop manually. The logo and text are in the center.
    # To make sure it fits nicely in a square, let's find the bounding box of non-white pixels
    # Since background is white, let's use the trim function
    bbox = trim_white(img)
    if bbox:
        left, top, right, bottom = bbox
        print(f"Content bounding box: {bbox}")
        
        # We want to create a square crop that encompasses this bounding box.
        width = right - left
        height = bottom - top
        size = max(width, height)
        
        # Add some padding (10%)
        padding = int(size * 0.1)
        size += padding * 2
        
        # Center of content
        cx = (left + right) // 2
        cy = (top + bottom) // 2
        
        new_left = cx - size // 2
        new_top = cy - size // 2
        new_right = new_left + size
        new_bottom = new_top + size
        
        print(f"Square crop box: {new_left}, {new_top}, {new_right}, {new_bottom}")
        
        # Create a new white square image
        square_img = Image.new('RGBA', (size, size), (255, 255, 255, 255))
        
        # Paste the original image into the square
        paste_x = -new_left
        paste_y = -new_top
        
        # We paste the cropped portion. Actually, just crop the original and paste.
        cropped = img.crop((new_left, new_top, new_right, new_bottom))
        
        # Make the background transparent where it's white? Optional. 
        # Chrome extensions usually look better with transparent icons. 
        # Let's make white transparent!
        data = cropped.getdata()
        new_data = []
        for item in data:
            # item is (R, G, B, A)
            if item[0] > 240 and item[1] > 240 and item[2] > 240:
                new_data.append((255, 255, 255, 0)) # transparent
            else:
                new_data.append(item)
        cropped.putdata(new_data)
        
        # Generate sizes
        sizes = [16, 32, 48, 128]
        for s in sizes:
            resized = cropped.resize((s, s), Image.Resampling.LANCZOS)
            out_path = os.path.join(icons_dir, f"icon{s}.png")
            resized.save(out_path)
            print(f"Saved {out_path}")
            
        print("All icons generated successfully!")
    else:
        print("Could not find content bounds.")
        
except Exception as e:
    print(f"Error: {e}")
