// Public CLI selection shared by the runner and its resource-free checks.
const portrait=[[1440,900,false],[390,844,true],[360,740,true]];
const landscape=[[1038,465],[844,390],[740,360],[667,375],[640,360]];

export function parseOptions(argv){
  const values=new Map(), flags=new Set();
  for(const arg of argv){
    if(['--projections','--mobile-controls','--landscape-only','--help','--plan'].includes(arg)){
      if(flags.has(arg))throw Error('Повторный параметр: '+arg);
      flags.add(arg);
    }else{
      const match=/^--(scenario|viewport|screenshots)=(.+)$/.exec(arg);
      if(!match||values.has(match[1]))throw Error('Неизвестный или повторный параметр: '+arg);
      values.set(match[1],match[2]);
    }
  }
  const legacy=[flags.has('--mobile-controls')?'mobile-controls':null,flags.has('--landscape-only')?'landscape':null].filter(Boolean);
  if(legacy.length>1||values.has('scenario')&&(legacy.length||flags.has('--projections')))throw Error('Несовместимые параметры сценария');
  const scenario=values.get('scenario')||legacy[0]||(flags.has('--projections')?'all':'base');
  if(!['base','all','projections','mobile-controls','landscape'].includes(scenario))throw Error('Неизвестный сценарий: '+scenario);
  const viewport=values.get('viewport')||null;
  const choose=matrix=>matrix.filter(([w,h])=>!viewport||viewport===`${w}x${h}`);
  const baseViewports=['base','all'].includes(scenario)?choose(portrait):[];
  const projectionViewports=['all','projections','mobile-controls'].includes(scenario)?choose(portrait.filter(v=>scenario!=='mobile-controls'||v[2])):[];
  const landscapeViewports=['all','landscape'].includes(scenario)?choose(landscape):[];
  if(!baseViewports.length&&!projectionViewports.length&&!landscapeViewports.length)throw Error('Размер экрана отсутствует в выбранном сценарии: '+viewport);
  const screenshots=values.get('screenshots')||'all';
  if(screenshots.split(',').some(s=>!s||!/^[-\w]+$/.test(s))||screenshots.includes(',')&&screenshots.split(',').some(s=>['all','failure'].includes(s)))throw Error('Ожидается all, failure или фрагменты имён снимков через запятую');
  return {scenario,viewport,screenshots,baseViewports,projectionViewports,landscapeViewports,
    projections:scenario!=='base',controlsOnly:scenario==='mobile-controls',
    acceptance:['base','all'].includes(scenario)&&!viewport&&screenshots==='all',
    help:flags.has('--help'),plan:flags.has('--plan')};
}

export function shouldCapture(options,name){
  return options.screenshots==='all'||options.screenshots!=='failure'&&options.screenshots.split(',').some(part=>name.includes(part));
}

export const usage=`Проверка макета карты (без Compose и сервера).
  node tools/check-weather-prototype.mjs [параметры]
  --scenario=base|all|projections|mobile-controls|landscape
  --viewport=360x740        один размер из матрицы сценария
  --screenshots=all|failure|initial,point  фрагменты имён; ошибка снимается всегда
  --plan                   показать объём без Git, браузера и файлов отчёта
  --help                   эта справка
Без параметров: полная T22; --projections или --scenario=all: полная T24.
Любой фильтр экрана/снимков или отдельный сценарий T24 — Development.
Прежние --mobile-controls и --landscape-only сохранены.
T22_CHROME задаёт Chrome/Edge; T22_REPORT_DIRECTORY — новый каталог попытки.`;
