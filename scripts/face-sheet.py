import sys
from PIL import Image
d=sys.argv[1]; rows=[r.split(',') for r in sys.argv[3:]]
H=420
out=[]
for r in rows:
    ims=[Image.open(f'{d}/{f}.png').convert('RGB') for f in r]
    ims=[im.resize((int(im.width*H/im.height),H)) for im in ims]
    out.append(ims)
W=max(sum(i.width for i in r) for r in out)
sh=Image.new('RGB',(W,H*len(out)),'white')
for j,r in enumerate(out):
    x=0
    for im in r: sh.paste(im,(x,j*H)); x+=im.width
sh.save(sys.argv[2])
