// Rebuild the pinned palette fixture offline from the archived reference asset.
import ts from '../viewer/node_modules/typescript/lib/typescript.js';
import fs from 'node:fs';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
const filename=process.argv[2];
if(!filename)throw Error('Usage: node tools/extract-earth-palettes.mjs <archived-main~PFYJS5Q4.js> [output.json]');
if(createHash('sha256').update(fs.readFileSync(filename)).digest('hex')!=='628b05efe787d2590a68f7413f89b7e60ce128a923bb87c07bce63d48e7dc5f0')
    throw Error('Reference asset differs from the pinned earth palette source.');
const program=ts.createProgram([filename],{allowJs:true,noResolve:true,target:ts.ScriptTarget.ESNext});
const checker=program.getTypeChecker(),source=program.getSourceFile(filename),selected=new Set();
const top=node=>{while(node&&node.parent!==source)node=node.parent;return node;};
function include(node){
 node=top(node);if(!node||selected.has(node))return;selected.add(node);
 function walk(child){if(ts.isIdentifier(child))for(const decl of checker.getSymbolAtLocation(child)?.declarations??[]){if(decl.getSourceFile()===source)include(decl);}ts.forEachChild(child,walk);}
 walk(node);
}
const names=['Vu','q0','z0','$0','J0'];
for(const statement of source.statements)if(ts.isFunctionDeclaration(statement)&&names.includes(statement.name?.text))include(statement);
for(let round=0;round<8;round++)for(const statement of source.statements){
 if(!ts.isExpressionStatement(statement)&&!(ts.isVariableStatement(statement)&&statement.getText(source).includes('.prototype')))continue;
 let needed=false;
 function refs(child){if(ts.isIdentifier(child))for(const decl of checker.getSymbolAtLocation(child)?.declarations??[])if(decl.getSourceFile()===source&&selected.has(top(decl)))needed=true;ts.forEachChild(child,refs);}
 refs(statement);if(needed)include(statement);
}
const code=source.statements.filter(s=>selected.has(s)).map(s=>s.getText(source)).join('\n');
const results=vm.runInNewContext(code+'\nObject.fromEntries([Vu,q0,z0,$0,J0].map((f,i)=>{const s=f();return [paletteNames[i],{range:s.bounds,colors:Array.from(s.colors)}]}))',{paletteNames:['temperature','relative-humidity','mslp','precip-3h','wind']}, {timeout:10000});
const output={version:'earth-palette/1',source:{url:'https://earth.nullschool.net/src/main~PFYJS5Q4.js',sha256:createHash('sha256').update(fs.readFileSync(filename)).digest('hex'),observed:'2026-10-30'},palettes:results};
fs.writeFileSync(process.argv[3]??'config/earth-palettes.json',JSON.stringify(output)+'\n');
console.log(Object.fromEntries(Object.entries(results).map(([k,v])=>[k,{range:v.range,size:v.colors.length}])));
