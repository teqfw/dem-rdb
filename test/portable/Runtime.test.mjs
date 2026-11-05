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

test('portable Runtime binding validates model identity and isolates overlapping Core paths',async()=>{
    const h=await harness('sqlite3');
    try {
        const firstSchema={$format:2,$namespace:'/shared/',item:{attributes:[{name:'name',type:{name:'text'}}]}};
        const secondSchema={$format:2,$namespace:'/shared/',item:{attributes:[{name:'count',type:{name:'integer'}}]}};
        const firstModel=await h.compile({schema:firstSchema}),secondModel=await h.compile({schema:secondSchema});
        const first=await h.attach({model:firstModel,runtime:h.bind(firstModel),name:'runtime_first'});
        const second=await h.attach({model:secondModel,runtime:h.bind(secondModel),name:'runtime_second'});
        await first.createSchema();await second.createSchema();
        const firstRepo=await first.get({path:'/shared/item'}),secondRepo=await second.get({path:'/shared/item'});
        await firstRepo.create({record:{name:'Ada'}});await secondRepo.create({record:{count:7}});
        assert.deepEqual((await firstRepo.list({selection:{}})).records,[{name:'Ada'}]);
        assert.deepEqual((await secondRepo.list({selection:{}})).records,[{count:'7'}]);
        const batch=await first.execute({operations:[
            {path:'/shared/item',method:'create',params:{record:{name:'Grace'}}},
            {path:'/shared/item',method:'list',params:{selection:{}}},
        ]});
        assert.deepEqual(batch.results[0],{record:{name:'Grace'}});
        assert.deepEqual(batch.results[1].records,[{name:'Ada'},{name:'Grace'}]);

        let queries=0;const count=query=>{queries++;};h.db.on('query',count);
        await assert.rejects(h.attach({model:firstModel,runtime:h.bind(secondModel),name:'mismatch'}),{name:'DemRepositoryError',code:'INVALID_INPUT'});
        h.db.removeListener('query',count);
        assert.equal(queries,0);
    } finally {await h.close();}
});

test('portable rejects registered idb.CryptoKey as SQL-unsupported, separately from missing Runtime',async()=>{
    const definition={name:'idb.CryptoKey',parameters:{},normalizeParams:params=>{if(Object.keys(params).length)throw new TypeError();return {};},valueDomain:'A genuine native Web Crypto CryptoKey.',preservation:'Preserve native key capabilities and metadata through structured clone.',valueHandling:'Validate and copy native CryptoKey values.'};
    const h=await harness('sqlite3',{definitions:[definition]});
    try {
        const schema={$format:2,$namespace:'/crypto/',item:{attributes:[{name:'id',type:{name:'text'}},{name:'key',type:{name:'idb.CryptoKey'}}],primaryKey:['id']}};
        const model=await h.compile({schema});
        assert.throws(()=>h.bind(model),{name:'DemRepositoryError',code:'UNSUPPORTED'});
        let queries=0;const count=query=>{queries++;};h.db.on('query',count);
        await assert.rejects(h.attach({model,name:'crypto_missing'}),{name:'DemRepositoryError',code:'UNSUPPORTED'});
        const runtime=h.bind(model,{'idb.CryptoKey':{normalize:value=>value,copy:value=>value}});
        await assert.rejects(h.attach({model,runtime,name:'crypto_bound'}),{name:'DemRepositoryError',code:'UNSUPPORTED'});
        h.db.removeListener('query',count);
        assert.equal(queries,0);
    } finally {await h.close();}
});

test('portable failed batch rolls back generated identities and allocation counters',async()=>{
    const h=await harness('sqlite3');
    try {
        const env=await h.open({schema:{$format:2,$namespace:'/allocation/',item:{
            attributes:[{name:'id',type:{name:'identity'},generation:true},{name:'label',type:{name:'text'}}],
            uniqueKeys:{label:['label']},
        }}});
        await env.provider.createSchema();
        await assert.rejects(env.provider.execute({operations:[
            {path:'/allocation/item',method:'create',params:{record:{label:'duplicate'}}},
            {path:'/allocation/item',method:'create',params:{record:{label:'duplicate'}}},
        ]}),{code:'CONFLICT'});
        const repo=await env.provider.get({path:'/allocation/item'});
        assert.deepEqual(await repo.list({selection:{}}),{records:[]});
        assert.deepEqual(await repo.create({record:{label:'committed'}}),{record:{id:'1',label:'committed'}});
    } finally {await h.close();}
});

test('portable schema publication is idempotent, records complete snapshots and invalidates stale providers',async()=>{
    const h=await harness('sqlite3');
    try {
        const oldSchema={$format:2,$namespace:'/evolution/',item:{attributes:[{name:'name',type:{name:'text'}}]}};
        const newSchema={$format:2,$namespace:'/evolution/',item:{attributes:[{name:'name',type:{name:'text'}},{name:'category',type:{name:'text'},default:'general'}]}};
        const oldModel=await h.compile({schema:oldSchema}),newModel=await h.compile({schema:newSchema});
        const oldProvider=await h.attach({model:oldModel,name:'evolution'});
        assert.deepEqual(await oldProvider.createSchema(),{version:1});
        const oldRepository=await oldProvider.get({path:'/evolution/item'});
        await oldRepository.create({record:{name:'retained'}});
        assert.deepEqual(await oldProvider.createSchema(),{version:1});
        const nextProvider=await h.attach({model:newModel,name:'evolution'});
        assert.deepEqual(await nextProvider.createSchema(),{version:2});
        const history=await nextProvider.getSchemaHistory();
        assert.deepEqual(history.schemas,[{version:1,model:oldModel},{version:2,model:newModel}]);
        await assert.rejects(oldRepository.list({selection:{}}),{code:'STORAGE'});
        const reopened=await h.attach({model:newModel,name:'evolution'});
        assert.deepEqual(await reopened.createSchema(),{version:2});
        assert.equal((await reopened.getSchemaHistory()).schemas.length,2);
        assert.deepEqual((await (await reopened.get({path:'/evolution/item'})).list({selection:{}})).records,[{name:'retained',category:'general'}]);
    } finally {await h.close();}
});

test('portable stale schema publisher cannot replace the current model',async()=>{
    const h=await harness('sqlite3');
    try {
        const oldSchema={$format:2,$namespace:'/stale/',item:{attributes:[{name:'name',type:{name:'text'}}]}};
        const newSchema={$format:2,$namespace:'/stale/',item:{attributes:[{name:'name',type:{name:'text'}},{name:'category',type:{name:'text'},default:'general'}]}};
        const oldModel=await h.compile({schema:oldSchema}),newModel=await h.compile({schema:newSchema});
        const oldProvider=await h.attach({model:oldModel,name:'stale_publisher'});
        assert.deepEqual(await oldProvider.createSchema(),{version:1});
        const oldRepository=await oldProvider.get({path:'/stale/item'});
        await oldRepository.create({record:{name:'retained'}});

        const currentProvider=await h.attach({model:newModel,name:'stale_publisher'});
        assert.deepEqual(await currentProvider.createSchema(),{version:2});
        await assert.rejects(oldProvider.createSchema(),{code:'STORAGE'});

        const history=await currentProvider.getSchemaHistory();
        assert.deepEqual(history.schemas,[{version:1,model:oldModel},{version:2,model:newModel}]);
        const currentRepository=await currentProvider.get({path:'/stale/item'});
        assert.deepEqual((await currentRepository.list({selection:{}})).records,[{name:'retained',category:'general'}]);
        assert.deepEqual(await currentProvider.createSchema(),{version:2});
        assert.deepEqual((await currentProvider.getSchemaHistory()).schemas,history.schemas);
    } finally {await h.close();}
});
