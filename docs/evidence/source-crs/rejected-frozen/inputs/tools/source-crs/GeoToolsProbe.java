import org.geotools.referencing.CRS;

// Read-only probe in the pinned GeoServer JDK/GeoTools runtime.
class GeoToolsProbe {
    public static void main(String[] args) throws Exception {
        String wkt = "PROJCS[\"HMC rotated\",GEOGCS[\"HMC sphere\",DATUM[\"HMC datum\",SPHEROID[\"HMC sphere\",6371229,0],TOWGS84[0,0,0,0,0,0,0]],PRIMEM[\"Greenwich\",0],UNIT[\"degree\",0.017453292519943295]],PROJECTION[\"General_Oblique\"],PARAMETER[\"central_meridian\",90],PARAMETER[\"latitude_of_origin\",25],PARAMETER[\"scale_factor\",1],PARAMETER[\"false_easting\",0],PARAMETER[\"false_northing\",0],UNIT[\"degree\",1.0]]";
        var transform = CRS.findMathTransform(CRS.parseWKT(wkt), CRS.decode("EPSG:4326", true), false);
        for (double[] point : new double[][]{{0,50},{20,50},{-23.5,29.5},{62.5,70.5}}) {
            double[] result = new double[2];
            transform.transform(point, 0, result, 0, 1);
            System.out.printf("native=(%.9f,%.9f) WGS84=(%.12f,%.12f)%n",point[0],point[1],result[0],result[1]);
        }
    }
}
