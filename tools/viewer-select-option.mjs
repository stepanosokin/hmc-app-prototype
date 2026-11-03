// Shared browser-driver boundary; imported by Node checks without starting a browser.
export async function selectViewerOption(evaluate,selector,value){
    return evaluate(`(()=>{
        const selector=${JSON.stringify(selector)},value=${JSON.stringify(String(value))};
        const control=document.querySelector(selector);
        if(!control||!control.options||![...control.options].some(option=>option.value===value))
            throw Error('Недоступное значение селектора '+selector+': '+value);
        control.value=value;
        if(control.value!==value)throw Error('Селектор не принял значение '+selector);
        control.dispatchEvent(new Event('change',{bubbles:true}));
    })()`);
}
