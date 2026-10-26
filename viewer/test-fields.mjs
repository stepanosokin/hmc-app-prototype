import test from 'node:test';
import assert from 'node:assert/strict';
import {fieldPresentation,modelFields,fieldUnits,fieldNumber} from './fields.ts';
const group=(field,short,levelType,level=0,extra={})=>({key:field+':'+(extra.revision??'r1'),selection:{
    field,field_short_name:short,field_level_type:levelType,level,model:'ENA',run:'ENA/2026-10-21',revision:'r1',...extra},times:[],start:0});
test('temperature variants keep their actual surface and height, including 5 m',()=>{
    assert.equal(fieldPresentation(group('a','t','surface').selection).label,'Температура поверхности');
    assert.equal(fieldPresentation(group('b','t','heightAboveGround',5).selection).label,'Температура на высоте 5 м');
    assert.equal(fieldPresentation(group('c','min_2t','heightAboveGround',2).selection).label,'Минимальная температура на высоте 2 м');
});
test('field groups isolate the model and prefer the current exact revision',()=>{
    const current=group('t','t','surface'),later=group('t','t','surface',0,{revision:'r2'});
    const pressure=group('p','prmsl','meanSea'),humidity=group('h','2r','heightAboveGround',2);
    const other=group('foreign','sp','surface',0,{model:'OTHER'});
    const options=modelFields([later,current,pressure,humidity,other],current);
    assert.deepEqual(options.map(o=>o.id),['temperature','pressure','humidity']);
    assert.equal(options[0].target,current);
    assert.equal(options[1].label,'Давление на уровне моря');
});
test('one paired wind entry represents U/V and unknown indicators stay explicit',()=>{
    const u=group('u','10u','heightAboveGround',10,{wind_axis:'u',wind_v:{field:'v'}});
    const v=group('v','10v','heightAboveGround',10,{wind_axis:'v'});
    const unknown=group('unknown','unknown','surface',0,{field_label:'Поле GRIB 0.6.1'});
    const options=modelFields([u,v,unknown],u);
    assert.equal(options.length,2);assert.equal(options[0].label,'Ветер на высоте 10 м');
    assert.equal(options[1].id,'other');assert.match(options[1].label,/GRIB 0\.6\.1/);
    assert.equal(fieldUnits('m s**-1'),'м/с');assert.equal(fieldUnits('unknown'),'единицы не определены');
});
test('small moisture and rain values remain nonzero in source units',()=>{
    assert.equal(fieldNumber(.003,'kg kg**-1'),'0,003');
    assert.match(fieldNumber(.000000123,'kg m**-2 s**-1'),/1,23/);
    assert.equal(fieldNumber(280.125,'K'),'280.13');
});
test('cloud layers show both real pressure bounds, including the surface',()=>{
    const pressure=value=>({type:100,scale_factor:0,scaled_value:value,value});
    const layer=(first,second)=>fieldPresentation(group('c','ccl','unknown',800,{field_surfaces:[first,second]}).selection).label;
    assert.equal(layer(pressure(0),pressure(40000)),'Облачность · слой 0–400 гПа');
    assert.equal(layer(pressure(40000),pressure(80000)),'Облачность · слой 400–800 гПа');
    assert.equal(layer(pressure(80000),{type:1,scale_factor:0,scaled_value:0,value:0}),'Облачность · слой 800 гПа — поверхность');
    assert.match(layer(pressure(80000),{type:241,scale_factor:255,scaled_value:4294967295,value:null}),/тип GRIB 241.*не задано/);
});
