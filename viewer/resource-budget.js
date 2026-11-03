import {viewerConfig} from './viewer-config.js';

// Shared managed map resources, not total browser/process memory.
export const DEFAULT_MAP_RESOURCE_BUDGET_MIB=256;
export function mapResourceBudgetBytes(mib){
    if(!Number.isSafeInteger(mib)||mib<1||!Number.isSafeInteger(mib*1024**2))
        throw Error('Лимит памяти карты должен быть положительным целым числом МиБ без переполнения.');
    return mib*1024**2;
}
export function parseViewerConfigModule(source){
    const match=/^export const viewerConfig\s*=\s*(\{[^\n]*\});?\s*$/.exec(source);
    if(!match)throw Error('Некорректный формат настройки просмотрщика.');
    let config;try{config=JSON.parse(match[1]);}catch{throw Error('Некорректная настройка просмотрщика.');}
    if(Object.keys(config).some(key=>key!=='map_memory_mib'))throw Error('Неизвестная настройка просмотрщика.');
    mapResourceBudgetBytes(Object.hasOwn(config,'map_memory_mib')?config.map_memory_mib:DEFAULT_MAP_RESOURCE_BUDGET_MIB);
    return config;
}
export const MAP_RESOURCE_BUDGET_BYTES=mapResourceBudgetBytes(viewerConfig.map_memory_mib??DEFAULT_MAP_RESOURCE_BUDGET_MIB);
