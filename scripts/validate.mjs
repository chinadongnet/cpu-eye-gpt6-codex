import { readFile, readdir, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
const html=await readFile('dist/index.html','utf8');
for(const [,path]of html.matchAll(/(?:src|href)="\.\/([^"]+)"/g))await access(resolve('dist',path));
for(const file of await readdir('dist'))if(file.endsWith('.js')){const result=spawnSync(process.execPath,['--check',resolve('dist',file)],{encoding:'utf8'});if(result.status!==0)throw new Error(result.stderr);}
const manifest=JSON.parse(await readFile('.openai/hosting.json','utf8'));if(manifest.static.directory!=='dist')throw new Error('Invalid static output directory');
console.log('Static entrypoint, local assets, JavaScript syntax, and hosting manifest validated.');
