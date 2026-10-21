from PIL import Image,ImageDraw
from pathlib import Path
out=Path('data/t24/visual-review');out.mkdir(exist_ok=True)
for browser in ('landscape-chrome2','landscape-edge2'):
 for size in ('1038x465','844x390','740x360','667x375','640x360'):
  paths=sorted((Path('data/reports/t24')/browser).glob(f'landscape-{size}-*.png'))
  if not paths:continue
  w,h=320,155; sheet=Image.new('RGB',(w*4,(h+22)*((len(paths)+3)//4)),'#eee');d=ImageDraw.Draw(sheet)
  for i,p in enumerate(paths):
   im=Image.open(p).convert('RGB');im.thumbnail((w,h));x=i%4*w;y=i//4*(h+22);sheet.paste(im,(x,y+22));d.text((x+2,y+3),p.stem.split(size+'-')[1],fill='black')
  sheet.save(out/f'{browser}-{size}.png')
