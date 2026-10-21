from PIL import Image, ImageDraw
from pathlib import Path
out=Path('data/t24/visual-review');out.mkdir(parents=True,exist_ok=True)
for browser in ('mobile-revision-chrome3','mobile-revision-edge3'):
    for size in ('1440x900','390x844','360x740'):
        paths=[Path('data/reports/t24')/browser/f'projection-{size}-{mode}-{font}-{base}.png' for mode in ('mercator','orthographic','laea') for font in ('system','courier') for base in ('dark','light')]
        tw,th=(360,225) if size=='1440x900' else (180,390)
        sheet=Image.new('RGB',(tw*4,(th+24)*3),'#eee');draw=ImageDraw.Draw(sheet)
        for i,p in enumerate(paths):
            image=Image.open(p).convert('RGB');image.thumbnail((tw,th))
            x=(i%4)*tw;y=(i//4)*(th+24)
            sheet.paste(image,(x,y+24));draw.text((x+2,y+4),p.stem.split(size+'-')[1],fill='black')
        sheet.save(out/f'{browser}-{size}.png')


