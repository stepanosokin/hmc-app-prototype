-- Local project SRID, not an EPSG registry assignment. Prototype datum hypothesis.
INSERT INTO public.spatial_ref_sys(srid,auth_name,auth_srid,srtext,proj4text)
VALUES(100001,'HMC',100001,
 'GEOGCS["ICON native sphere 6371229",DATUM["ICON native datum",SPHEROID["ICON sphere",6371229,0],TOWGS84[0,0,0,0,0,0,0]],PRIMEM["Greenwich",0],UNIT["degree",0.017453292519943295],AXIS["Longitude",EAST],AXIS["Latitude",NORTH]]',
 '+proj=longlat +R=6371229 +towgs84=0,0,0,0,0,0,0 +no_defs')
ON CONFLICT(srid) DO NOTHING;
