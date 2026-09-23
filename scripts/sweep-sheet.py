"""Assemble crank-sweep frames into one sheet: rows = views, columns = 12 crank angles."""
import sys
from PIL import Image, ImageDraw

d, out = sys.argv[1], sys.argv[2]
views = ['side', 'front', 'q34', 'chase']
S = 220
sheet = Image.new('RGB', (S * 12 + 70, S * len(views)), (246, 240, 226))
dr = ImageDraw.Draw(sheet)
for r, v in enumerate(views):
    dr.text((6, r * S + S // 2), v, fill=(40, 30, 20))
    for k in range(12):
        im = Image.open(f'{d}/{v}_{k:02d}.png').convert('RGB').resize((S, S), Image.LANCZOS)
        sheet.paste(im, (70 + k * S, r * S))
        if r == 0:
            dr.text((70 + k * S + 4, 4), f'{k * 30} deg', fill=(255, 255, 255))
sheet.save(out)
