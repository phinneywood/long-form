import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import {execFileSync} from 'node:child_process';
test('public builds exclude the developer replay; previews include it',async()=>{
 const root=new URL('../',import.meta.url);const run=env=>execFileSync(process.execPath,['scripts/build-web.mjs'],{cwd:root,env:{...process.env,VERCEL_ENV:env}});
 run('production');const production=await fs.readdir(new URL('dist/',root));assert.ok(production.includes('index.html'));assert.ok(production.includes('support.html'));assert.ok(!production.includes('developer.html'));assert.ok(!production.includes('developer.js'));
 run('preview');const preview=await fs.readdir(new URL('dist/',root));assert.ok(preview.includes('developer.html'));assert.ok(preview.includes('developer.js'));
 run('');assert.ok(!(await fs.readdir(new URL('dist/',root))).includes('developer.html'),'Missing build environment fails closed');
});
