import {test} from 'node:test';
import assert from 'node:assert/strict';
import {register} from '@teqfw/dem/conformance';
import {schema,map,exercise,atomicSchema,exerciseAtomic,extendedSchema,exerciseExtended,exerciseEvolution,evolutionSchemas} from '@teqfw/dem/conformance/values';
import {harness,enabled} from './Harness.mjs';

for(const client of ['sqlite3','pg','mysql2']) {
    if(!enabled(client)) {test(client+' portable integration',{skip:'Test connection environment is not configured'},()=>{});continue;}
    const open=async params=>{
        const h=await harness(client);
        try {const env=await h.open(params);await env.provider.createSchema();return env;}
        catch(error) {await h.close();throw error;}
    };
    register({test:(name,body)=>test(client+' portable '+name,body),assert,open});
    for(const [label,document,host,run] of [['values',schema,map,exercise],['atomic batch',atomicSchema,undefined,exerciseAtomic],['long keys and Unicode',extendedSchema,undefined,exerciseExtended]]) {
        test(client+' portable '+label,async()=>{
            const env=await open({schema:document,map:host});
            try {await run({provider:env.provider,assert});} finally {await env.close();}
        });
    }
    test(client+' portable structural evolution and retained history',async()=>{
        const h=await harness(client);
        try {await exerciseEvolution({assert,open:async schema=>(await h.open({schema})).provider});}
        finally {await h.close();}
    });
    test(client+' portable failed schema publication preserves data and prior snapshot',async()=>{
        const h=await harness(client);let listener;
        try {
            const schemas=evolutionSchemas();const first=await h.open({schema:schemas[0]});await first.provider.createSchema();
            await (await first.provider.get({path:'/evolution/item'})).create({record:{name:'before'}});
            const next=await h.open({schema:schemas[1]});
            listener=query=>{if(query.method==='insert' && query.sql.includes(h.prefix+'_history')) {h.db.removeListener('query',listener);throw new Error('Injected history publication failure');}};
            h.db.on('query',listener);
            await assert.rejects(next.provider.createSchema(),{code:'STORAGE'});
            assert.equal((await first.provider.getSchemaHistory()).schemas.length,1);
            assert.equal((await (await first.provider.get({path:'/evolution/item'})).list({selection:{}})).records[0].name,'before');
            assert.equal((await next.provider.createSchema()).version,2);
        } finally {if(listener)h.db.removeListener('query',listener);await h.close();}
    });
    test(client+' portable descriptive relation profile accepts missing targets',async()=>{
        const env=await open({schema:atomicSchema,enforceRelations:false});
        try {const result=await (await env.provider.get({path:'/batch/entry'})).create({record:{account:'999',amount:'1'}});assert.equal(result.record.account,'999');}
        finally {await env.close();}
    });
}
