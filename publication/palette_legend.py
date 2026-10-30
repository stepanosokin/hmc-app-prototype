"""Bounded WMS legend for the same physical LUT used by the browser."""
import io

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from decoder.palettes import rgb


def render(palette: dict, units: str, width: int = 256, height: int = 72) -> bytes:
    width, height = max(1, width), max(1, height)
    low, high = palette['range']
    values = np.linspace(low, high, width)[None, :]
    strip = Image.fromarray(rgb(values, palette)).resize((width, max(1, min(20, height))))
    image = Image.new('RGBA', (width, height), (255, 255, 255, 255))
    image.paste(strip, (0, 0))
    draw = ImageDraw.Draw(image)
    font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 10)
    factor, offset, label = (1., -273.15, '°C') if units == 'K' else (.01, 0., 'гПа') if units == 'Pa' else (1., 0., 'гПа') if units == 'hPa' else (1000., 0., 'мм') if palette['id'] == 'precip-3h' and units == 'm' else (1., 0., '%' if units == '%' else 'м/с' if units == 'm s**-1' else 'мм' if palette['id'] == 'precip-3h' else units)
    for i in range(4):
        value = (low+(high-low)*i/3)*factor+offset
        text = f'{value:.2f}'.rstrip('0').rstrip('.').replace('.', ',')
        length = draw.textlength(text, font=font)
        x = max(0., min(width-length, (width-1)*i/3-length/2))
        draw.text((x, 24), text, fill='black', font=font)
    draw.text((2, 45), label, fill='black', font=font)
    output = io.BytesIO()
    image.save(output, format='PNG')
    return output.getvalue()
