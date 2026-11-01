import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {browserObservation} from './Browser.mjs';
import {createHash,randomBytes} from 'node:crypto';
import Container from '@teqfw/di';
import knex from 'knex';
import {schema,map,exercise,atomicSchema,exerciseAtomic,extendedSchema,exerciseExtended,exerciseEvolution} from '@teqfw/dem/conformance/values';
import {harness,enabled,connection} from '../portable/Harness.mjs';

const table=(path,hashed)=>hashed ? 'dem_'+createHash('sha256').update(path).digest('hex').slice(0,32) : 'dem_'+Buffer.from(path).toString('hex');
async function native(client,document,host,runWorkload,expected) {
    const namespace='dem_compare_'+randomBytes(6).toString('hex');
    const db=knex({client,searchPath:client==='pg' ? [namespace] : undefined,connection:client==='sqlite3' ? {filename:':memory:'} : connection(client),useNullAsDefault:true,pool:{min:0,max:client==='sqlite3' ? 1 : 4}});
    let owned=false,created=false;
    const paths=Object.keys(document).filter(p=>p.startsWith('/'));
    try {
        if(client==='pg'){await db.raw('CREATE SCHEMA ??',[namespace]);owned=true;}
        if(client==='mysql2')for(const path of paths)if(await db.schema.hasTable(table(path,true)))throw new Error('Comparison table exists; refusing to modify it.');
        const c=new Container();
        c.addNamespaceRoot('TeqFw_Dem_',new URL('../src',import.meta.resolve('@teqfw/dem/conformance')).pathname,'.mjs');
        c.addNamespaceRoot('TeqFw_DemRdb_',process.env.TEQFW_DEM_RDB_ROOT ? resolve(process.env.TEQFW_DEM_RDB_ROOT,'src') : new URL('../../src',import.meta.url).pathname,'.mjs');
        const compiler=await c.get('TeqFw_Dem_Compile$');
        const {model}=await compiler.exec({schemas:[{packageName:'test',filename:'schema.json',document}],...(host ? {map:{packageName:'test',filename:'map.json',document:host}} : {})});
        const adapter=await c.get('TeqFw_DemRdb_Adapter$'),provider=await adapter.open({model,knex:db});
        await provider.createSchema();created=true;
        assert.deepEqual(await runWorkload({provider,assert}),expected);
    } finally {
        if(owned)await db.raw('DROP SCHEMA ?? CASCADE',[namespace]);
        else if(created && client==='mysql2') {
            for(const path of paths) {const entity=document[path];for(const [i,relation] of Object.values(entity.relations ?? {}).entries())await db.schema.alterTable(table(path,true),t=>t.dropForeign(relation.attributes,table(path,true)+'_f_'+i));}
            for(const path of paths)await db.schema.dropTable(table(path,true));
        }
        await db.destroy();
    }
}

test('real backend transcripts match browser IndexedDB across projections and lifecycle', {timeout:120000}, async t=>{
    const browser=await browserObservation();
    for(const key of ['valueTranscript','atomicTranscript','extendedTranscript','evolutionTranscript'])assert.ok(browser[key]);
    console.log('IDB baseline:',browser.browser);
    for(const client of ['sqlite3','pg','mysql2']) {
        if(!enabled(client)){await t.test(client,{skip:'Test connection is not configured'},()=>{});continue;}
        for(const [label,document,host,runWorkload,expected] of [
            ['values',schema,map,exercise,browser.valueTranscript],
            ['atomic',atomicSchema,undefined,exerciseAtomic,browser.atomicTranscript],
            ['extended',extendedSchema,undefined,exerciseExtended,browser.extendedTranscript],
        ]) {
            if(label!=='extended')await t.test(client+' native '+label,()=>native(client,document,host,runWorkload,expected));
            await t.test(client+' portable '+label,async()=>{
                const h=await harness(client);
                try {const env=await h.open({schema:document,map:host});await env.provider.createSchema();assert.deepEqual(await runWorkload({provider:env.provider,assert}),expected);}
                finally {await h.close();}
            });
        }
        await t.test(client+' portable evolution',async()=>{
            const h=await harness(client);
            try {assert.deepEqual(await exerciseEvolution({assert,open:async document=>(await h.open({schema:document})).provider}),browser.evolutionTranscript);}
            finally {await h.close();}
        });
    }
});
