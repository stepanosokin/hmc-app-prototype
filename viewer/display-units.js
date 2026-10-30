// Display conversions never modify published selections, native arrays or API values.
const temperatures=new Set(['T_G','t','2t','min_2t','max_2t','sot','2d']);
export function displaySpec(source={},temperatureUnit='C'){
    const units=source.units??'unknown',short=source.field_short_name??source.field?.split(':')[0];
    if(units==='K'&&temperatures.has(short))return {factor:1,offset:temperatureUnit==='K'?0:-273.15,unit:temperatureUnit==='K'?'K':'°C',temperature:true,note:''};
    if(units==='Pa')return {factor:.01,offset:0,unit:'гПа',note:''};
    if(units==='hPa')return {factor:1,offset:0,unit:'гПа',note:''};
    if(units==='kg kg**-1'&&['q','2sh'].includes(short))return {factor:1000,offset:0,unit:'г/кг',note:''};
    if(units==='m'&&short==='sde')return {factor:100,offset:0,unit:'см',note:''};
    if(units==='kg m**-2 s**-1'){
        if(source.interval?.statistical_process===1)return {factor:1,offset:0,unit:'исх. ед.',note:'Единицы источника противоречат накоплению; показаны исходные числа'};
        return {factor:3600,offset:0,unit:'мм/ч',note:''};
    }
    const known={'m s**-1':'м/с','kg m**-2':'кг/м²','kg kg**-1':'кг/кг',m:'м','%':'%',K:'K'};
    return {factor:1,offset:0,unit:known[units]??(units==='unknown'?'исх. ед.':units),note:units==='unknown'?'Единицы не определены; показаны исходные числа':''};
}
export function displayValue(value,source,temperatureUnit='C'){const s=displaySpec(source,temperatureUnit);return value*s.factor+s.offset;}
export function displayNumber(value,source,temperatureUnit='C',legend=false){
    const s=displaySpec(source,temperatureUnit),v=value*s.factor+s.offset;
    return new Intl.NumberFormat('ru-RU',{useGrouping:false,...(s.temperature?{maximumFractionDigits:2}:
        {maximumSignificantDigits:legend&&s.unit==='г/кг'?3:6})}).format(Object.is(v,-0)?0:v);
}
const intervals={prmsl:[10,5,2],sp:[25,20,5],T_G:[10,5,2],t:[10,5,2],'2t':[10,5,2],sot:[10,5,2],
    min_2t:[10,5,2],max_2t:[10,5,2],'2d':[10,5,2],q:[5,5,2],'2sh':[2,2,1],'2r':[20,20,10],
    ccl:[25,25,20],max_i10fg:[10,5,5],tp:[20,10,5],cp:[20,10,5],lsp:[20,10,5],
    lsfwe:[10,5,5],csfwe:[10,5,5],sde:[50,20,10],sd:[100,50,20],tgrp:[5,2,2],vis:[20000,10000,5000],
    lsrr:[20,10,5],crr:[20,10,5]};
export function contourProfile(source,widthKm){
    const short=source.field_short_name??source.field?.split(':')[0],spec=displaySpec(source,'C');
    let steps=intervals[short];
    const identity=(source.field??'')+' '+(source.field_label??'');
    if(!steps&&/0[.:/]6[.:/]1(?:\D|$)/.test(identity))steps=[25,25,20];
    if(!steps&&/0[.:/]0[.:/]18(?:\D|$)/.test(identity))steps=[10,5,2];
    const index=widthKm>6000?0:widthKm>2000?1:2;
    return {...spec,step:steps?.[index],scale:index,noun:['sp','prmsl'].includes(short)?'Изобары':spec.temperature?'Изотермы':
        short==='max_i10fg'?'Изотахи':['tp','cp','lsp'].includes(short)?'Изогиеты':'Изолинии'};
}
