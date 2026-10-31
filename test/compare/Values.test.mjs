import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import Container from '@teqfw/di';
import knex from 'knex';
import {schema,map,exercise} from '@teqfw/dem/conformance/values';

const run=promisify(execFile);
const idbRoot=process.env.TEQFW_DEM_IDB_ROOT;
if (!idbRoot) throw new Error('TEQFW_DEM_IDB_ROOT must identify the dem-idb checkout with its browser test harness.');
const table=(path,hashed)=>hashed ? 'dem_'+createHash('sha256').update(path).digest('hex').slice(0,32) : 'dem_'+Buffer.from(path).toString('hex');
const connection=prefix=>({host:process.env[prefix+'HOST'],user:process.env[prefix+'USER'],password:process.env[prefix+'PASSWORD'],database:process.env[prefix+'DATABASE']});

test('identical DEM workload has identical logical observations across real engines', {timeout:120000}, async t=>{
    const temp=await mkdtemp(join(tmpdir(),'dem-compare-'));
    try {
        const output=join(temp,'idb.json');
        const childEnv={...process.env,DEM_COMPARE_OUTPUT:output}; delete childEnv.NODE_TEST_CONTEXT;
        await run(process.execPath,['--test',resolve(idbRoot,'test/browser/Runtime.test.mjs')],{cwd:idbRoot,env:childEnv,timeout:90000,maxBuffer:1024*1024});
        const browser=JSON.parse(await readFile(output,'utf8'));
        assert.ok(browser.valueTranscript);
        console.log('IDB baseline:',browser.browser);
        for (const client of ['sqlite3','pg','mysql2']) {
            const config=connection(client==='pg' ? 'TEQFW_DB__PG_' : 'TEQFW_DB__MYSQL_');
            await t.test(client,{skip:client!=='sqlite3' && Object.values(config).some(v=>!v)},async()=>{
                const namespace='dem_compare_'+randomBytes(6).toString('hex');
                const db=knex({client,searchPath:client==='pg' ? [namespace] : undefined,connection:client==='sqlite3' ? {filename:':memory:'} : {...config,...(client==='mysql2' ? {supportBigNumbers:true,bigNumberStrings:true} : {})},useNullAsDefault:true,pool:{min:0,max:client==='sqlite3' ? 1 : 4}});
                let created=false,ownedSchema=false;
                const paths=Object.keys(schema).filter(p=>p.startsWith('/'));
                try {
                    if (client==='pg') {await db.raw('CREATE SCHEMA ??',[namespace]);ownedSchema=true;db.client.config.searchPath=[namespace];}
                    if (client==='mysql2') for (const path of paths) if (await db.schema.hasTable(table(path,true))) throw new Error('Comparison table exists; refusing to modify it.');
                    const c=new Container();
                    c.addNamespaceRoot('TeqFw_Dem_',new URL('../src',import.meta.resolve('@teqfw/dem/conformance')).pathname,'.mjs');
                    c.addNamespaceRoot('TeqFw_DemRdb_',process.env.TEQFW_DEM_RDB_ROOT ? resolve(process.env.TEQFW_DEM_RDB_ROOT,'src') : new URL('../../src',import.meta.url).pathname,'.mjs');
                    const compiler=await c.get('TeqFw_Dem_Compile$');
                    const {model}=await compiler.exec({schemas:[{packageName:'test',filename:'schema.json',document:schema}],map:{packageName:'test',filename:'map.json',document:map}});
                    const adapter=await c.get('TeqFw_DemRdb_Adapter$');
                    const provider=await adapter.open({model,knex:db});
                    await provider.createSchema();created=true;
                    const observed=await exercise({provider,assert});
                    assert.deepEqual(observed,browser.valueTranscript);
                    console.log(client,'matches IndexedDB exactly');
                } finally {
                    if (ownedSchema) await db.raw('DROP SCHEMA ?? CASCADE',[namespace]);
                    else if (created && client==='mysql2') for (const path of paths) await db.schema.dropTable(table(path,true));
                    await db.destroy();
                }
            });
        }
    } finally { await rm(temp,{recursive:true,force:true}); }
});
