import sys
from PIL import Image, ImageDraw, ImageFont
d = sys.argv[1]; out = sys.argv[2]
ref = Image.open('../../refs/girl_model_sheet.png').convert('RGB')
refs = [ref.crop(b) for b in [(60, 30, 400, 370), (460, 30, 800, 370), (850, 30, 1190, 370)]]
mine = [Image.open(f'{d}/head_{n}.png').convert('RGB') for n in ['front', 'q34', 'profile']]
S = 480
sheet = Image.new('RGB', (S * 3, S * 2 + 60), (246, 240, 226))
dr = ImageDraw.Draw(sheet)
try: f = ImageFont.truetype('arial.ttf', 26)
except: f = None
for i, im in enumerate(refs): sheet.paste(im.resize((S, S)), (i * S, 30))
for i, im in enumerate(mine): sheet.paste(im.resize((S, S)), (i * S, S + 60))
dr.text((10, 2), 'model sheet: front / 3-4 / profile', fill=(60, 50, 40), font=f)
dr.text((10, S + 32), 'in game (feature/face): front / 3-4 / profile', fill=(60, 50, 40), font=f)
sheet.save(out)
