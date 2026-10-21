// Local geographic context shares the weather layer's orthographic camera.
// Canvas paths are clipped on the sphere; forecast values remain on WebGL2.
export class OrthographicContext {
    constructor(map, coverage) {
        this.water = '#314d5b';
        this.landColor = '#52615e';
        this.map = map;
        this.coverage = coverage;
        this.canvas = document.createElement('canvas');
        Object.assign(this.canvas.style, { position: 'absolute', inset: '0', pointerEvents: 'none', zIndex: '0' });
        this.canvas.dataset.role = 'orthographic-basemap';
        map.getContainer().prepend(this.canvas);
        Object.assign(map.getCanvasContainer().style, { position: 'absolute', inset: '0', zIndex: '1' });
        this.land = { type: 'MultiPolygon', coordinates: window.land };
        this.projection = d3.geoOrthographic().clipAngle(90).precision(.5);
        this.context = this.canvas.getContext('2d');
        this.path = d3.geoPath(this.projection, this.context);
    }
    render(view, center) {
        const canvas = this.canvas, ctx = this.context;
        const key = JSON.stringify([view, center]);
        if (key === this.last)
            return;
        this.last = key;
        if (canvas.width !== view.width)
            canvas.width = view.width;
        if (canvas.height !== view.height)
            canvas.height = view.height;
        this.projection.rotate([-center[0], -center[1]]).translate(view.origin).scale(6378137 * view.scale);
        canvas.style.width = this.map.getContainer().clientWidth + 'px';
        canvas.style.height = this.map.getContainer().clientHeight + 'px';
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.beginPath();
        this.path({ type: 'Sphere' });
        ctx.fillStyle = this.water ?? '#314d5b';
        ctx.fill();
        ctx.beginPath();
        this.path(this.land);
        ctx.fillStyle = this.landColor ?? '#52615e';
        ctx.fill();
        ctx.beginPath();
        this.path(this.coverage);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5 * canvas.width / this.map.getContainer().clientWidth;
        ctx.stroke();
    }
    remove() { this.canvas.remove(); }
}
