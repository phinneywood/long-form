/** Only public web assets are served. The account replay exists in previews. */
import fs from 'node:fs/promises';
const out=new URL('../dist/',import.meta.url),root=new URL('../',import.meta.url);
await fs.rm(out,{recursive:true,force:true});await fs.mkdir(out,{recursive:true});
const assets=['index.html','styles.css','publication.js','publication.css','opml.js','starter-editions.js','privacy.html','terms.html','support.html'];
if(process.env.VERCEL_ENV==='preview')assets.push('developer.html','developer.js');
for(const name of assets)await fs.copyFile(new URL(name,root),new URL(name,out));
console.log(`Built ${assets.length} public assets. Developer replay ${process.env.VERCEL_ENV==='preview'?'included in preview':'excluded'}.`);
