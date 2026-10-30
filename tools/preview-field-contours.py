"""Read-only design comparisons from local GRIB; never modifies the viewer/QGIS project."""
import argparse
import hashlib
import json
import math
import os
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / (sys.argv[sys.argv.index('--output')+1] if '--output' in sys.argv else
    ('data/reports/contours-20261029-02' if '--cartography' in sys.argv else 'data/reports/contours-20261029-01'))
if not OUT.resolve().is_relative_to((ROOT/'data/reports').resolve()):
    raise ValueError('Preview output must stay under data/reports')
os.environ['MPLCONFIGDIR'] = str(OUT / 'matplotlib-cache')
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.colors import LinearSegmentedColormap
from matplotlib.collections import LineCollection, PolyCollection
import numpy as np
from osgeo import gdal
from pyproj import CRS, Transformer
from scipy.ndimage import map_coordinates
from shapely.geometry import LineString
from matplotlib.path import Path as PlotPath

SOURCE = ROOT / 'data/grib/igfi03000000s.ENA6km.grb'
LAND = ROOT / 'docs/prototypes/assets/land.js'
NODATA = -1e30
gdal.SetConfigOption('GRIB_NORMALIZE_UNITS', 'NO')
gdal.UseExceptions()
PALETTE = LinearSegmentedColormap.from_list('viewer', np.array([
    [114,114,181],[82,154,189],[112,200,178],[214,214,127],[237,171,104],[201,103,97]])/255)
LAEA = CRS.from_proj4('+proj=laea +lat_0=60 +lon_0=90 +datum=WGS84 +units=m')
GEO_TO_MAP = Transformer.from_crs('EPSG:4326', LAEA, always_xy=True)
MAP_TO_GEO = Transformer.from_crs(LAEA, 'EPSG:4326', always_xy=True)
# Each row is a candidate; columns are the three map extents, never raw zoom levels.
STEPS = {
    'temp': [[10,5,2],[5,2,1],[2,1,1]],
    'mslp': [[50,10,5],[10,5,2],[5,2,1]],
    'pres': [[50,20,10],[20,10,5],[10,5,1]],
    'specific': [[5,5,2],[2,2,1],[1,1,1]],
    'percent': [[25,25,20],[20,20,10],[10,10,5]],
    'wind': [[10,5,5],[5,2,2],[2,1,1]],
    'precip': [[20,10,5],[10,5,2],[5,2,1]],
    'snowfall': [[10,5,5],[5,2,2],[2,1,1]],
    'depth': [[50,20,10],[20,10,5],[10,5,1]],
    'swe': [[500,200,100],[100,50,20],[50,20,10]],
    'vis': [[10000,5000,2000],[5000,2000,1000],[2000,1000,500]],
}
# number, Russian caption, units shown, conversion of raw GRIB, interval set, contour noun
FIELDS = [
 (1,'Давление на уровне моря','гПа',.01,0,'mslp','Изобары'),
 (2,'Давление у поверхности','гПа',.01,0,'pres','Изобары'),
 (5,'Порывы ветра · максимум за 1 ч','м/с',1,0,'wind','Изотахи'),
 (6,'Температура воздуха на высоте 2 м','°C',1,-273.15,'temp','Изотермы'),
 (7,'Температура поверхности','°C',1,-273.15,'temp','Изотермы'),
 (8,'Температура почвы','°C',1,-273.15,'temp','Изотермы'),
 (9,'Минимальная температура 2 м · за 3 ч','°C',1,-273.15,'temp','Изотермы'),
 (10,'Максимальная температура 2 м · за 3 ч','°C',1,-273.15,'temp','Изотермы'),
 (11,'Точка росы на высоте 2 м','°C',1,-273.15,'temp','Изотермы'),
 (12,'Удельная влажность у поверхности','г/кг',1000,0,'specific','Изолинии'),
 (13,'Относительная влажность на высоте 2 м','%',1,0,'percent','Изолинии'),
 (14,'Удельная влажность на высоте 2 м','г/кг',1000,0,'specific','Изолинии'),
 (16,'Облачность в слое 0–400 гПа','%',1,0,'percent','Изолинии'),
 (17,'Облачность в слое 400–800 гПа','%',1,0,'percent','Изолинии'),
 (18,'Облачность от 800 гПа до поверхности','%',1,0,'percent','Изолинии'),
 (19,'Суммарные осадки · накопление за 72 ч','кг/м²',1,0,'precip','Изогиеты'),
 (21,'Крупномасштабный снегопад · водный эквивалент за 72 ч','кг/м²',1,0,'snowfall','Изолинии'),
 (23,'Конвективный снегопад · водный эквивалент за 72 ч','кг/м²',1,0,'snowfall','Изолинии'),
 (24,'Высота снежного покрова','см',100,0,'depth','Изолинии'),
 (25,'Водный эквивалент снежного покрова','кг/м²',1,0,'swe','Изолинии'),
 (27,'Конвективные осадки · накопление за 72 ч','кг/м²',1,0,'precip','Изогиеты'),
 (28,'Крупномасштабные осадки · накопление за 72 ч','кг/м²',1,0,'precip','Изогиеты'),
 (29,'Видимость','м',1,0,'vis','Изолинии'),
 (30,'Снежная крупа · накопление за 72 ч','кг/м²',1,0,'snowfall','Изолинии'),
 # Source ambiguity is explicitly retained: no fabricated units or rate conversion.
 (15,'GRIB 0/6/1 · единицы источника не определены','ед. источника',1,0,'percent','Изолинии'),
 (26,'GRIB 0/0/18 · единицы источника не определены','ед. источника',1,0,'temp','Изолинии'),
 (20,'Крупномасштабный дождь · конфликт единиц и накопления','исх. ед.',1,0,'precip','Изолинии'),
 (22,'Конвективный дождь · конфликт единиц и накопления','исх. ед.',1,0,'precip','Изолинии'),
]

def geo_native(lat):
    return np.rad2deg(np.arctan2((1-.0066943799901413165)*np.sin(np.deg2rad(lat)),np.cos(np.deg2rad(lat))))

def native_geo(lat):
    return np.rad2deg(np.arctan2(np.sin(np.deg2rad(lat)),(1-.0066943799901413165)*np.cos(np.deg2rad(lat))))

def setup(source):
    ds = gdal.Open(str(source))
    crs = CRS.from_wkt(ds.GetProjection())
    sphere = CRS.from_proj4('+proj=longlat +R=6371229')
    forward = Transformer.from_crs(sphere, crs, always_xy=True)
    reverse = Transformer.from_crs(crs, sphere, always_xy=True)
    gt=ds.GetGeoTransform()
    width,height=ds.RasterXSize,ds.RasterYSize
    # Perimeter-derived extent, with the same sphere/geodetic latitude relation as the viewer.
    xx=np.linspace(gt[0],gt[0]+gt[1]*width,300)
    yy=np.linspace(gt[3],gt[3]+gt[5]*height,300)
    px=np.r_[xx,xx,np.full(300,xx[0]),np.full(300,xx[-1])]
    py=np.r_[np.full(300,yy[0]),np.full(300,yy[-1]),yy,yy]
    lon,lat=reverse.transform(px,py)
    mx,my=GEO_TO_MAP.transform(lon,native_geo(lat))
    mx,my=np.asarray(mx),np.asarray(my)
    ok=np.isfinite(mx)&np.isfinite(my)
    cx,cy=(mx[ok].min()+mx[ok].max())/2,(my[ok].min()+my[ok].max())/2
    w=max(np.ptp(mx[ok]),np.ptp(my[ok])*1.75)*1.02
    return ds,forward,reverse,gt,(cx,cy,w)

def native_array(ds,band,factor,offset):
    b=ds.GetRasterBand(band)
    raw=b.ReadAsArray().astype(float)
    good=np.isfinite(raw)&(raw!=b.GetNoDataValue())
    # All design fields here use zero-transparent portrayal or absolute temperature positive-K.
    good &= raw>0 if offset==-273.15 else raw!=0
    raw=raw*factor+offset
    raw[~good]=np.nan
    return raw

def sample(raw,forward,gt,bounds,nx=520,ny=298):
    xmin,xmax,ymin,ymax=bounds
    x=np.linspace(xmin,xmax,nx);y=np.linspace(ymin,ymax,ny)
    xx,yy=np.meshgrid(x,y)
    lon,lat=MAP_TO_GEO.transform(xx,yy)
    sx,sy=forward.transform(lon,geo_native(lat))
    col=(np.asarray(sx)-gt[0])/gt[1]-.5
    row=(np.asarray(sy)-gt[3])/gt[5]-.5
    filled=np.nan_to_num(raw,nan=0)
    weight=map_coordinates(np.isfinite(raw).astype(float),[row,col],order=1,mode='constant',cval=0)
    val=map_coordinates(filled,[row,col],order=1,mode='constant',cval=0)
    # Never connect through missing/zero-transparent native cells.
    val[weight<.999999]=np.nan
    return x,y,val

def land_geometry():
    text=LAND.read_text(encoding='utf8')
    land=json.loads(text[text.index('window.land=')+12:].strip().rstrip(';'))
    polys=[];lines=[]
    for polygon in land:
        for ring in polygon:
            coords=np.array(ring)
            x,y=GEO_TO_MAP.transform(coords[:,0],coords[:,1])
            points=np.c_[x,y]
            # Clip discontinuities near the antipode, irrelevant to Asian map coverage.
            if np.isfinite(points).all() and np.max(np.linalg.norm(np.diff(points,axis=0),axis=1))<3e6:
                polys.append(points);lines.append(points)
    return polys,lines

def centre_for(raw,reverse,gt):
    # Choose a data-rich regional centre per quantity; it is identical for all step variants.
    a=raw[::8,::8]
    candidates=[]
    for row in range(28,a.shape[0]-28,7):
        for col in range(35,a.shape[1]-35,9):
            win=a[row-10:row+11,col-16:col+17]
            v=win[np.isfinite(win)]
            if v.size<win.size*.6:continue
            score=np.percentile(v,90)-np.percentile(v,10)
            candidates.append((score,row*8,col*8))
    if not candidates:return 0.,0.
    _,r,c=max(candidates)
    lon,lat=reverse.transform(gt[0]+(c+.5)*gt[1],gt[3]+(r+.5)*gt[5])
    return GEO_TO_MAP.transform(lon,native_geo(lat))

def labels(ax,cs,x,y,z,step):
    # One label per selected contour, at most seven, collision checked in screen coordinates.
    choices=[]
    for level,segments in zip(cs.levels,cs.allsegs):
        for seg in segments:
            if len(seg)<8:continue
            screen=ax.transData.transform(seg)
            distances=np.linalg.norm(np.diff(screen,axis=0),axis=1)
            length=distances.sum()
            if length<75:continue
            arc=np.r_[0,np.cumsum(distances)]
            for f in [.5,.32,.68]:
                at=np.argmin(abs(arc-length*f));p=seg[at];pixel=screen[at]
                box=ax.get_window_extent()
                if box.x0+38<pixel[0]<box.x1-38 and box.y0+20<pixel[1]<box.y1-20:
                    choices.append((length,level,p,pixel))
    choices.sort(key=lambda v:v[0],reverse=True)
    chosen: list[tuple[float, float, np.ndarray, np.ndarray]]=[];seen=set()
    for length,level,p,pixel in choices:
        if level in seen or any(np.linalg.norm(pixel-q[3])<90 for q in chosen):continue
        chosen.append((length,level,p,pixel));seen.add(level)
        if len(chosen)==6:break
    with np.errstate(invalid='ignore'):
        gy,gx=np.gradient(z,y,x)
    records=[]
    if chosen:
        texts=ax.clabel(cs,manual=[tuple(v[2]) for v in chosen],inline=True,inline_spacing=4,
            fontsize=9,fmt=lambda v:f'{v:g}',rightside_up=False)
        for t in texts:
            tx,ty=t.get_position()
            j=int(np.clip(round((tx-x[0])/(x[-1]-x[0])*(len(x)-1)),0,len(x)-1))
            i=int(np.clip(round((ty-y[0])/(y[-1]-y[0])*(len(y)-1)),0,len(y)-1))
            dx,dy=float(gx[i,j]),float(gy[i,j])
            if not np.isfinite(dx+dy) or math.hypot(dx,dy)==0:continue
            angle=math.degrees(math.atan2(-dx,dy))
            t.set_rotation(angle);t.set_transform_rotates_text(False)
            # Baseline-left normal points towards increasing values, even for upside-down text.
            normal=np.array([-math.sin(math.radians(angle)),math.cos(math.radians(angle))])
            alignment=float(normal@np.array([dx,dy])/math.hypot(dx,dy))
            assert alignment>.999999
            records.append({'value':float(t.get_text()),'rotation':angle,'gradient_alignment':alignment})
    assert len(cs.labelTexts)<=7
    return records

def rounded_vertices(points, radius=.6):
    """Round each corner locally; quadratic Bezier stays within radius of its vertex."""
    closed=np.linalg.norm(points[0]-points[-1])<1e-8
    p=points[:-1] if closed else points
    result=[] if closed else [p[0]]
    for i in range(len(p)) if closed else range(1,len(p)-1):
        before=p[(i-1)%len(p)];current=p[i];after=p[(i+1)%len(p)]
        u,v=before-current,after-current
        lu,lv=np.linalg.norm(u),np.linalg.norm(v)
        if min(lu,lv)<1e-8:continue
        incoming=current+u/lu*min(radius,lu*.25)
        outgoing=current+v/lv*min(radius,lv*.25)
        for t in [0,.25,.5,.75,1]:
            result.append((1-t)**2*incoming+2*t*(1-t)*current+t*t*outgoing)
    if closed and result:result.append(result[0])
    elif not closed:result.append(p[-1])
    return np.asarray(result)

def regular_vertices(points):
    """Extra collinear vertices let label placement find the interior of long straight lines."""
    dense: list[np.ndarray]=[]
    for a,b in zip(points[:-1],points[1:]):
        count=max(1,math.ceil(np.linalg.norm(b-a)/4))
        dense.extend(a+(b-a)*t/count for t in range(count))
    dense.append(points[-1])
    return np.asarray(dense)

def refine_contours(ax,cs,minimum_length=60):
    report={'minimum_length_px':minimum_length,'simplification_px':.35,'corner_radius_px':.6,
        'combined_limit_px':1,'original_segments':0,'hidden_segments':0,'retained_segments':0,
        'smoothed_segments':0,'bounded_fallbacks':0,'continuous_symmetric_buffer_checks':0}
    paths=[]
    for segments in cs.allsegs:
        refined=[]
        for seg in segments:
            if len(seg)<2:continue
            report['original_segments']+=1
            screen=ax.transData.transform(seg)
            if np.linalg.norm(np.diff(screen,axis=0),axis=1).sum()<minimum_length:
                report['hidden_segments']+=1;continue
            original=LineString(screen)
            simplified=np.asarray(original.simplify(.35,preserve_topology=True).coords)
            candidate=rounded_vertices(simplified)
            if len(candidate)<2:candidate=screen
            geometry=LineString(candidate)
            # Both continuous polylines must fit inside the other's 1px buffer.
            # Buffer polygons are conservative approximations of the round buffer.
            if original.buffer(1,quad_segs=8).covers(geometry) and geometry.buffer(1,quad_segs=8).covers(original):
                report['smoothed_segments']+=1
                report['continuous_symmetric_buffer_checks']+=1
            else:
                candidate=screen;report['bounded_fallbacks']+=1
            candidate=regular_vertices(candidate)
            refined.append(PlotPath(ax.transData.inverted().transform(candidate)))
            report['retained_segments']+=1
        paths.append(PlotPath.make_compound_path(*refined) if refined else PlotPath(np.empty((0,2))))
    cs.set_paths(paths)
    return report

def render(band,light=False,icon=False,cartography=False):
    source=ROOT/'data/grib/ICON_EU_T_G_2026101500.grib2' if icon else SOURCE
    spec=(1,'Температура поверхности · ICON-EU','°C',1,-273.15,'temp','Изотермы') if icon else next(f for f in FIELDS if f[0]==band)
    band,title,unit,factor,offset,kind,noun=spec
    ds,forward,reverse,gt,overview=setup(source)
    raw=native_array(ds,band,factor,offset)
    if not np.isfinite(raw).any():raise ValueError('No visible source data')
    rcx,rcy=centre_for(raw,reverse,gt)
    cx,cy,w=overview
    widths=[w,w*.32,w*.105]
    centres=[(cx,cy),(rcx,rcy),(rcx,rcy)]
    rasters=[];bounds=[]
    for width,centre in zip(widths,centres):
        px,py=centre;h=width/1.75
        bound=(px-width/2,px+width/2,py-h/2,py+h/2)
        bounds.append(bound);rasters.append(sample(raw,forward,gt,bound))
    v=raw[np.isfinite(raw)]
    vmin,vmax=float(v.min()),float(v.max())
    if vmin==vmax:vmax=vmin+1
    diagnostic=not icon and band in (15,20,22,26)
    bg='#f2f3f5' if light else '#111d2b'
    ink='#182536' if light else '#edf2f7'
    line='#707070' if light else '#000000'
    fig,axes=plt.subplots(3,3,figsize=(17.5,11.7),dpi=120,facecolor=bg)
    fig.subplots_adjust(left=.045,right=.985,top=.87,bottom=.13,wspace=.05,hspace=.23)
    fig.suptitle(title,fontsize=19,color=ink,x=.045,ha='left',y=.98)
    subtitle='Диагностика исходных чисел · физический шаг пока не выбран' if diagnostic else 'Реальный GRIB · варианты шага для выбора · это сравнение оформления'
    fig.text(.045,.935,subtitle,fontsize=11,color=ink)
    fig.text(.045,.91,('Светлая тема · серые изолинии #707070' if light else 'Тёмная тема · чёрные изолинии')+' · верх подписи направлен к большим значениям',fontsize=10,color=ink)
    polys,coasts=land_geometry()
    records: list[dict[str, Any]]=[]
    for row in range(3):
        for col in range(3):
            ax=axes[row,col];ax.set_facecolor('#d6e1e7' if light else '#1b2d3e')
            ax.add_collection(PolyCollection(polys,facecolors='#edf0e4' if light else '#34414a',edgecolors='none',zorder=0))
            xmin,xmax,ymin,ymax=bounds[col]
            x,y,z=rasters[col]
            ax.imshow(np.ma.masked_invalid(z),origin='lower',extent=(xmin,xmax,ymin,ymax),
                cmap=PALETTE,vmin=vmin,vmax=vmax,interpolation='nearest',alpha=.84,zorder=1)
            ax.add_collection(LineCollection(coasts,colors='#6e7b85' if light else '#abb5bc',linewidths=.45,alpha=.6,zorder=2))
            ax.set(xlim=(xmin,xmax),ylim=(ymin,ymax),aspect='equal',xticks=[],yticks=[])
            step=STEPS[kind][row][col]
            if diagnostic and band==26:step=STEPS['temp'][row][col]
            valid=z[np.isfinite(z)]
            levels=np.arange(math.ceil(float(valid.min())/step)*step,float(valid.max())+step*.001,step) if valid.size else np.array([])
            levels=levels[levels!=0] if offset!=-273.15 else levels
            assert len(levels)<2000
            panel={'variant':'ABC'[row],'scale':col,'step':step,'units':unit,'labels':[],'contour_levels':len(levels)}
            if levels.size:
                cs=ax.contour(x,y,np.ma.masked_invalid(z),levels=levels,colors=line,linewidths=.7,zorder=3)
                fig.canvas.draw()
                if cartography:panel['cartography']=refine_contours(ax,cs)
                panel['labels']=labels(ax,cs,x,y,z,step)
            else:
                ax.text(.5,.5,'Нет изолиний с таким шагом',transform=ax.transAxes,color=ink,ha='center',fontsize=9,
                    bbox={'facecolor':bg,'alpha':.8,'edgecolor':'none','pad':5})
            scale=['Мелкий · вся область','Средний · несколько регионов','Крупный · один регион'][col]
            ax.set_title(f'{"ABC"[row]}{col+1}   {scale}',fontsize=10,color=ink,pad=7)
            ax.text(.012,-.07,f'{noun} проведены через {step:g} {unit}',transform=ax.transAxes,fontsize=10,color=ink)
            # A metric scale bar makes the differing extents explicit.
            km=widths[col]/1000/5
            nice=10**math.floor(math.log10(km)); km=max(nice,round(km/nice)*nice)
            length=km*1000
            bx=xmin+(xmax-xmin)*.045;by=ymin+(ymax-ymin)*.07
            ax.plot([bx,bx+length],[by,by],color=ink,lw=2,zorder=6)
            ax.text(bx,by+(ymax-ymin)*.025,f'{km:g} км',fontsize=8,color=ink,zorder=6,
                bbox={'facecolor':bg,'alpha':.65,'edgecolor':'none','pad':1})
            records.append(panel)
    cax=fig.add_axes([.23,.068,.54,.013])
    from matplotlib.cm import ScalarMappable
    from matplotlib.colors import Normalize
    cb=fig.colorbar(ScalarMappable(norm=Normalize(vmin,vmax),cmap=PALETTE),cax=cax,orientation='horizontal')
    cb.ax.tick_params(colors=ink,labelsize=9);cb.set_label(f'Одинаковая цветовая шкала во всех девяти вариантах · {unit}',color=ink,fontsize=10)
    fig.text(.045,.015,('Контуры короче 60 пикселей скрыты · упрощение и сглаживание: суммарно ≤ 1 пикселя' if cartography else 'LAEA — РФ · максимум 7 подписей на каждой карте · A — реже, B — средний шаг, C — чаще'),fontsize=10,color=ink)
    stem='icon-temperature' if icon else f'{band:02d}'
    if light:stem+='-light'
    OUT.mkdir(parents=True,exist_ok=True)
    path=OUT/(stem+'.png');fig.savefig(path,facecolor=bg);plt.close(fig)
    receipt={'source':str(source.relative_to(ROOT)),'band':band,'title':title,'diagnostic':diagnostic,
        'theme':'light' if light else 'dark','display_units':unit,'range':[vmin,vmax],
        'line_color':line,'cartographic_preview':cartography,
        'projection':LAEA.to_string(),'bounds':bounds,'panels':records,
        'image_sha256':hashlib.sha256(path.read_bytes()).hexdigest(),
        'scope':'Design preview; not browser acceptance or scientific decoder validation',
        'cleanup':'No containers, browsers, servers or QGIS project resources created; matplotlib figure closed.'}
    (OUT/(stem+'.json')).write_text(json.dumps(receipt,ensure_ascii=False,indent=2),encoding='utf8')
    print(json.dumps({'image':str(path),'labels':[len(p['labels']) for p in records],'diagnostic':diagnostic}),flush=True)

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('bands',nargs='*',type=int)
    parser.add_argument('--light',action='store_true');parser.add_argument('--icon',action='store_true')
    parser.add_argument('--cartography',action='store_true')
    parser.add_argument('--output',help='Fresh report directory under data/reports')
    args=parser.parse_args()
    if args.icon:render(1,args.light,True,args.cartography)
    else:
        for band in args.bands or [s[0] for s in FIELDS]:render(band,args.light,cartography=args.cartography)
