import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import Container from '@teqfw/di';
import {register} from '@teqfw/dem/conformance';
import {schema as valueSchema,map as valueMap,exercise,atomicSchema,exerciseAtomic} from '@teqfw/dem/conformance/values';

async function open({schema,map,schemas,trustedPackages=[],filename=':memory:',createSchema=true}) {
    const c = new Container();
    c.addNamespaceRoot('TeqFw_Dem_', new URL('../src', import.meta.resolve('@teqfw/dem/conformance')).pathname, '.mjs');
    c.addNamespaceRoot('TeqFw_Dem_RDb_', new URL('../src', import.meta.url).pathname, '.mjs');
    (await c.get('TeqFw_Dem_Registry$')).finalize();
    const compiler = await c.get('TeqFw_Dem_Compile$');
    const compilation = await compiler.exec({schemas:schemas ?? [{packageName:'test',filename:'schema.json',document:schema}],trustedPackages,...(map ? {map:{packageName:'test',filename:'map.json',document:map}} : {})});
    const {model} = compilation;
    const connection = await c.get('TeqFw_Dem_RDb_Connection$');
    await connection.init({client:'sqlite3',connection:{filename},useNullAsDefault:true,pool:{min:1,max:1}});
    const db = connection.getClient();
    const adapter = await c.get('TeqFw_Dem_RDb_Adapter$');
    const provider = await adapter.open({model,connection});
    if (createSchema) await provider.createSchema();
    return {provider,model,compilation,compiler,adapter,db,connection,selection:await c.get('TeqFw_Dem_Dto_Query_Selection__Factory$'),close:()=>connection.disconnect()};
}
register({test,assert,open});

test('SQLite initializes and reopens the same model with ordinary DEM history tables',async()=>{
    const directory=await mkdtemp(join(tmpdir(),'dem-rdb-history-'));
    const filename=join(directory,'history.sqlite');
    const infrastructure=JSON.parse(await readFile(new URL(import.meta.resolve('@teqfw/dem/etc/dem-schema.json')),'utf8'));
    const schemas=[
        {packageName:'@example/app',filename:'etc/dem-schema.json',document:{$format:2,$namespace:'/app/',item:{attributes:[{name:'id',type:{name:'identity'},generation:true},{name:'name',type:{name:'text'}}]}}},
        {packageName:'@teqfw/dem',filename:'etc/dem-schema.json',document:infrastructure},
    ];
    const first=await open({schemas,trustedPackages:['@teqfw/dem'],filename,createSchema:false});
    let second;
    try {
        await assert.rejects(()=>first.provider.get({path:'/app/item'}),{name:'DemRepositoryError',code:'UNSUPPORTED'});
        await assert.rejects(()=>first.provider.execute({operations:[]}),{name:'DemRepositoryError',code:'UNSUPPORTED'});
        const initial=await first.provider.initialize({scope:'test-scope',compilation:first.compilation});
        assert.equal(initial.created,true);
        assert.equal(initial.application.scope,'test-scope');
        assert.equal(initial.application.source_id,null);
        assert.equal(initial.application.target_id,initial.snapshot.id);
        assert.equal(initial.application.outcome,'confirmed');
        assert.match(initial.application.evidence,/created or verified/i);
        assert.equal(initial.snapshot.canonical,JSON.stringify(first.compilation.canonical));
        assert.equal(initial.snapshot.fingerprint,first.compilation.fingerprint);
        assert.equal(initial.snapshot.canonicalization,'dem-logical-1/dem-sha256-1');
        const items=await first.provider.get({path:'/app/item'});
        const saved=(await items.create({record:{name:'Ada'}})).record;
        assert.equal((await items.read({key:{kind:'primary',values:{id:saved.id}}})).record.name,'Ada');
        assert.deepEqual((await first.provider.execute({operations:[{path:'/app/item',method:'list',params:{selection:{}}}]})).results[0],{records:[saved]});
    } finally { await first.provider.close(); await first.close(); }

    second=await open({schemas,trustedPackages:['@teqfw/dem'],filename,createSchema:false});
    try {
        const reopened=await second.provider.initialize({scope:'test-scope',compilation:second.compilation});
        assert.equal(reopened.created,false);
        assert.equal(reopened.snapshot.fingerprint,second.compilation.fingerprint);
        assert.equal(reopened.application.outcome,'confirmed');
        const items=await second.provider.get({path:'/app/item'});
        assert.deepEqual((await items.list({selection:{}})).records,[{id:'1',name:'Ada'}]);
        assert.equal((await (await second.provider.get({path:'/dem/application'})).list({selection:{}})).records.length,1);
        const tables=await second.db('sqlite_master').select('name').where('type','table').whereNot('name','like','sqlite_%').orderBy('name');
        assert.deepEqual(tables.map(row=>row.name),['app_item','dem_application','dem_snapshot']);
        assert.deepEqual((await second.db.raw('SELECT name FROM pragma_table_info(?)',['app_item'])).map(row=>row.name),['id','name']);
        assert.deepEqual((await second.db.raw('SELECT name FROM pragma_table_info(?)',['dem_application'])).map(row=>row.name),['id','scope','source_id','target_id','outcome','evidence']);
        assert.deepEqual((await second.db.raw('SELECT name FROM pragma_table_info(?)',['dem_snapshot'])).map(row=>row.name),['id','canonical','fingerprint','canonicalization','provenance']);

        const changed=await second.compiler.exec({schemas:[
            {...schemas[0],document:{$format:2,$namespace:'/app/',item:{attributes:[{name:'id',type:{name:'identity'},generation:true},{name:'name',type:{name:'text'}},{name:'category',type:{name:'text'}}]}}},
            schemas[1],
        ],trustedPackages:['@teqfw/dem']});
        const changedBackend=await second.adapter.open({model:changed.model,connection:second.connection});
        const snapshotsBefore=(await (await second.provider.get({path:'/dem/snapshot'})).list({selection:{}})).records;
        const applicationsBefore=(await (await second.provider.get({path:'/dem/application'})).list({selection:{}})).records;
        await assert.rejects(()=>changedBackend.initialize({scope:'test-scope',compilation:changed}),{name:'DemRepositoryError',code:'UNSUPPORTED'});
        await changedBackend.close();
        assert.deepEqual((await (await second.provider.get({path:'/app/item'})).list({selection:{}})).records,[{id:'1',name:'Ada'}]);
        assert.deepEqual((await (await second.provider.get({path:'/dem/snapshot'})).list({selection:{}})).records,snapshotsBefore);
        assert.deepEqual((await (await second.provider.get({path:'/dem/application'})).list({selection:{}})).records,applicationsBefore);
    } finally { await second.provider.close(); await second.close(); await rm(directory,{recursive:true,force:true}); }
});

test('schema creation is explicit and rejects an existing target', async () => {
    const env = await open({schema:{$format:2,$namespace:'/app/',item:{attributes:[{name:'name',type:{name:'text'}}]}}});
    try {
        await assert.rejects(env.provider.createSchema(), {name:'DemRepositoryError',code:'CONFLICT'});
        const repo = await env.provider.get({path:'/app/item'});
        assert.deepEqual(await repo.create({record:{name:'preserved'}}), {record:{name:'preserved'}});
    } finally { await env.close(); }
});

test('unsupported model is rejected before database effects', async () => {
    const c = new Container();
    c.addNamespaceRoot('TeqFw_Dem_', new URL('../src', import.meta.resolve('@teqfw/dem/conformance')).pathname, '.mjs');
    c.addNamespaceRoot('TeqFw_Dem_RDb_', new URL('../src', import.meta.url).pathname, '.mjs');
    (await c.get('TeqFw_Dem_Registry$')).finalize();
    const compiler = await c.get('TeqFw_Dem_Compile$');
    const compiled=await compiler.exec({schemas:[{packageName:'test',filename:'schema.json',document:{$format:2,$namespace:'/app/',record:{attributes:[{name:'data',type:{name:'json'}}]}}}]});
    const unsupported=structuredClone(compiled.model);
    unsupported.entities['/app/record'].attributes[0].type.name='unsupported';
    const connection = await c.get('TeqFw_Dem_RDb_Connection$');
    await connection.init({client:'sqlite3',connection:{filename:':memory:'},useNullAsDefault:true,pool:{min:1,max:1}});
    const db = connection.getClient();
    try {
        const adapter = await c.get('TeqFw_Dem_RDb_Adapter$');
        await assert.rejects(adapter.open({model:unsupported,connection}), {name:'DemRepositoryError',code:'UNSUPPORTED'});
        const longPath=await compiler.exec({schemas:[{packageName:'test',filename:'long.json',document:{$format:2,$namespace:`/${'a'.repeat(256)}/`,item:{attributes:[{name:'value',type:{name:'text'}}]}}}]});
        await assert.rejects(adapter.open({model:longPath.model,connection}),{name:'DemRepositoryError',code:'UNSUPPORTED'});
        assert.deepEqual(await db('sqlite_master').select('name').where('type','table'), []);
    } finally { await connection.disconnect(); }
});

test('repository provider obtains the model and connection from its host configuration', async () => {
    const env = await open({schema:{$format:2,$namespace:'/app/',item:{attributes:[{name:'name',type:{name:'text'}}]}}});
    try {
        const Provider = (await import('../src/Provider.mjs')).default;
        let calls = 0;
        const provider = new Provider({configuration:{get:async () => { calls++; return {}; }},connection:env.connection,adapter:{open:async () => ({...env.provider,initialize:async ({scope,compilation})=>({created:false,scope,fingerprint:compilation.fingerprint})})}});
        const repo = await provider.get({path:'/app/item'});
        await repo.create({record:{name:'Ada'}});
        assert.deepEqual(await provider.initialize({scope:'test',compilation:env.compilation}),{created:false,scope:'test',fingerprint:env.compilation.fingerprint});
        assert.equal((await provider.get({path:'/app/item'})) !== null, true);
        assert.equal(calls, 1);
    } finally { await env.close(); }
});

test('canonical nested Format 2 paths resolve', async () => {
    const env = await open({schema:{$format:2,$namespace:'/app/catalog/',item:{attributes:[{name:'name',type:{name:'text'}}]}}});
    try {
        const repo = await env.provider.get({path:'/app/catalog/item'});
        assert.deepEqual(await repo.create({record:{name:'ok'}}), {record:{name:'ok'}});
    } finally { await env.close(); }
});

test('CFG, real DI routing and independent Providers share owned Connections safely', async()=>{
    const c=new Container({
        namespaces:[
            {prefix:'TeqFw_Cfg_',target:new URL('../../cfg/src',import.meta.url).pathname,defaultExt:'.mjs'},
            {prefix:'TeqFw_Dem_',target:new URL('../src',import.meta.resolve('@teqfw/dem/conformance')).pathname,defaultExt:'.mjs'},
            {prefix:'TeqFw_Dem_RDb_',target:new URL('../src',import.meta.url).pathname,defaultExt:'.mjs'},
            {prefix:'Test_',target:new URL('./fixture',import.meta.url).pathname,defaultExt:'.mjs'},
        ],
        preprocessors:['Test_Dem_Preprocessor$'],
    });
    const bootstrap=[];
    const loader=await c.get('TeqFw_Cfg_Loader$');
    await loader.load([{id:'fixture',load:async()=>Object.entries({
        TEQFW_DEM_RDB__CLIENT:'sqlite3',
        TEQFW_DEM_RDB__FILENAME:':memory:',
        TEQFW_DEM_RDB__USE_NULL_AS_DEFAULT:true,
        TEQFW_DEM_RDB__EXTRA:{pool:{min:1,max:1}},
        TEQFW_DEM_RDB__MAIN_CLIENT:'sqlite3',
        TEQFW_DEM_RDB__MAIN_FILENAME:':memory:',
        TEQFW_DEM_RDB__MAIN_EXTRA:{pool:{min:1,max:1},useNullAsDefault:true},
        TEQFW_DEM_RDB__OTHER_CLIENT:'sqlite3',
        TEQFW_DEM_RDB__OTHER_FILENAME:':memory:',
        TEQFW_DEM_RDB__OTHER_EXTRA:{pool:{min:1,max:1},useNullAsDefault:true},
    }).map(([key,value])=>({key,value}))}]);
    bootstrap.push('cfg-loaded');
    const config=await c.get('TeqFw_Dem_RDb_Config$');
    assert.equal(config.get().client,'sqlite3');
    assert.equal(config.get('main').connection.filename,':memory:');
    assert.equal(config.get('other').connection.filename,':memory:');
    const main=await c.get('Test_Dem_Connection_Main$'),other=await c.get('Test_Dem_Connection_Other$');
    const fallback=await c.get('TeqFw_Dem_RDb_Connection$');
    const transientA=await c.get('TeqFw_Dem_RDb_Connection$$'),transientB=await c.get('TeqFw_Dem_RDb_Connection$$');
    const initializationBackends=[];
    let consumerA,consumerB;
    let primaryError,primaryFailed=false;
    try {
    await main.init(config.get('main'));
    await other.init(config.get('other'));
    await fallback.init(config.get());
    await transientA.init(config.get());
    await transientB.init(config.get());
    bootstrap.push('connections-ready');
    assert.notEqual(transientA,transientB);
    assert.notEqual(main,other);
    assert.notEqual(fallback,main);
    const registry=await c.get('TeqFw_Dem_Registry$');registry.finalize();
    const compiler=await c.get('TeqFw_Dem_Compile$');
    const modelA=(await compiler.exec({schemas:[{packageName:'fixture',filename:'a.json',document:{$format:2,$namespace:'/same/',item:{attributes:[{name:'name',type:{name:'text'}}]}}}]})).model;
    const modelB=(await compiler.exec({schemas:[{packageName:'fixture',filename:'b.json',document:{$format:2,$namespace:'/other/',item:{attributes:[{name:'count',type:{name:'integer'}}]}}}]})).model;
    const runtimeFactory=await c.get('TeqFw_Dem_Repository_Runtime$');
    const runtimeA=runtimeFactory.bind({model:modelA,registry}),runtimeB=runtimeFactory.bind({model:modelB,registry});
    bootstrap.push('models-bound');
    const placementA=await c.get('Test_Dem_Config_A$'),placementB=await c.get('Test_Dem_Config_B$');
    placementA.init({model:modelA,runtime:runtimeA});placementB.init({model:modelB,runtime:runtimeB});
    const adapter=await c.get('TeqFw_Dem_RDb_Adapter$');
    for(const placement of [placementA,placementB]) {
        const options=await placement.get();
        const backend=await adapter.open({...options,connection:main});
        const acquired={backend,closed:false};
        initializationBackends.push(acquired);
        let schemaError,closeError,schemaFailed=false,closeFailed=false;
        try { await backend.createSchema(); } catch(error) { schemaFailed=true; schemaError=error; }
        try { await backend.close(); acquired.closed=true; } catch(error) { closeFailed=true; closeError=error; }
        if(schemaFailed && closeFailed)throw new AggregateError([schemaError,closeError],'Schema initialization and backend close failed.',{cause:schemaError});
        if(schemaFailed)throw schemaError;
        if(closeFailed)throw closeError;
    }
    bootstrap.push('schemas-ready');
    const bootstrapClientAccesses=main.getClientCalls();
        consumerA=await c.get('Test_Dem_Consumer_A$');
        consumerB=await c.get('Test_Dem_Consumer_B$');
        bootstrap.push('consumers-active');
        assert.deepEqual(bootstrap,['cfg-loaded','connections-ready','models-bound','schemas-ready','consumers-active']);
        assert.equal(consumerA.provider,consumerA.batch);
        assert.equal(consumerB.provider,consumerB.batch);
        assert.notEqual(consumerA.provider,consumerB.provider);
        const repoA=await consumerA.provider.get({path:'/same/item'});
        assert.equal(main.getClientCalls(),bootstrapClientAccesses+1);
        await repoA.create({record:{name:'Ada'}});
        const batchB=await consumerB.batch.execute({operations:[{path:'/other/item',method:'create',params:{record:{count:7}}}]});
        assert.equal(main.getClientCalls(),bootstrapClientAccesses+2);
        assert.equal(batchB.results[0].record.count,'7');
        assert.deepEqual((await repoA.list({selection:{}})).records,[{name:'Ada'}]);
        assert.deepEqual((await (await consumerB.provider.get({path:'/other/item'})).list({selection:{}})).records,[{count:'7'}]);
        assert.notEqual(initializationBackends[0].backend,initializationBackends[1].backend);
        const consumerOther=await c.get('Test_Dem_Consumer_Other$');
        assert.equal(consumerOther.connection,other);
        assert.notEqual(other.getClient(),main.getClient());
        assert.notEqual(fallback.getClient(),main.getClient());
        assert.notEqual(transientA.getClient(),transientB.getClient());
        await consumerA.provider.close();
        await assert.rejects(repoA.list({selection:{}}),{code:'STORAGE'});
        assert.deepEqual((await (await consumerB.provider.get({path:'/other/item'})).list({selection:{}})).records,[{count:'7'}]);
        assert.equal(main.getClient().client.config.client,'sqlite3');
    } catch(error) {
        primaryFailed=true;
        primaryError=error;
    } finally {
        const failures=[];
        const close=async(label,operation)=>{try {await operation();} catch(error) {failures.push(new Error(`${label} failed during fixture cleanup.`,{cause:error}));}};
        for(const [label,provider] of [['Provider A',consumerA?.provider],['Provider B',consumerB?.provider]])if(provider)await close(label,()=>provider.close());
        for(const [index,item] of initializationBackends.entries())if(!item.closed)await close(`Initialization backend ${index+1}`,()=>item.backend.close());
        for(const [label,connection] of [['main Connection',main],['other Connection',other],['fallback Connection',fallback],['transient Connection A',transientA],['transient Connection B',transientB]])await close(label,()=>connection.disconnect());
        if(failures.length) {
            if(primaryFailed)throw new AggregateError([primaryError,...failures],'Fixture failed and one or more cleanup operations failed.',{cause:primaryError});
            throw new AggregateError(failures,'Fixture bootstrap cleanup failed.');
        }
    }
    if(primaryFailed)throw primaryError;
});

test('DI routing rejects an unmatched repository consumer',async()=>{
    const c=new Container({namespaces:[
        {prefix:'Test_',target:new URL('./fixture',import.meta.url).pathname,defaultExt:'.mjs'},
    ],preprocessors:['Test_Dem_Preprocessor$']});
    await assert.rejects(c.get('Test_Dem_Consumer_Unmatched$'),/explicit fixture consumer/);
});

test('partial connection bootstrap failure disconnects every resolved Connection',async()=>{
    const c=new Container({namespaces:[
        {prefix:'TeqFw_Cfg_',target:new URL('../../cfg/src',import.meta.url).pathname,defaultExt:'.mjs'},
        {prefix:'TeqFw_Dem_RDb_',target:new URL('../src',import.meta.url).pathname,defaultExt:'.mjs'},
        {prefix:'Test_',target:new URL('./fixture',import.meta.url).pathname,defaultExt:'.mjs'},
    ]});
    const loader=await c.get('TeqFw_Cfg_Loader$');
    await loader.load([{id:'failure',load:async()=>[
        {key:'TEQFW_DEM_RDB__MAIN_CLIENT',value:'sqlite3'},
        {key:'TEQFW_DEM_RDB__MAIN_FILENAME',value:':memory:'},
        {key:'TEQFW_DEM_RDB__MAIN_EXTRA',value:{pool:{min:1,max:1}}},
        {key:'TEQFW_DEM_RDB__BROKEN_CLIENT',value:'not-a-knex-client'},
    ]}]);
    const config=await c.get('TeqFw_Dem_RDb_Config$');
    const main=await c.get('Test_Dem_Connection_Main$'),broken=await c.get('Test_Dem_Connection_Other$');
    try {
        await main.init(config.get('main'));
        await assert.rejects(broken.init(config.get('broken')),/Unknown configuration option/);
    } finally {
        const results=await Promise.allSettled([main.disconnect(),broken.disconnect()]);
        const failures=results.filter(result=>result.status==='rejected').map(result=>result.reason);
        if(failures.length)throw new AggregateError(failures,'Fixture Connection cleanup failed.');
    }
    assert.throws(()=>main.getClient());
    assert.throws(()=>broken.getClient());
});

test('writes fail before effects when foreign keys have been disabled', async () => {
    const env = await open({schema:{$format:2,$namespace:'/app/',item:{attributes:[{name:'name',type:{name:'text'}}]}}});
    try {
        const repo = await env.provider.get({path:'/app/item'});
        await env.db.raw('PRAGMA foreign_keys = OFF');
        await assert.rejects(repo.create({record:{name:'unsafe'}}), {name:'DemRepositoryError',code:'UNSUPPORTED'});
        const rows = await env.db('sqlite_master').select('name').where('type','table');
        assert.equal(rows.length,1);
        await env.db.raw('PRAGMA foreign_keys = ON');
        assert.deepEqual(await repo.list({selection:{}}),{records:[]});
    } finally { await env.close(); }
});

test('declared DEM indexes project to ordered SQLite index columns', async () => {
    const env = await open({schema:{$format:2,$namespace:'/app/',item:{attributes:[{name:'a',type:{name:'text'}},{name:'b',type:{name:'integer'}}],indexes:{lookup:{attributes:['b','a']}}}}});
    try {
        const index = await env.db('sqlite_master').select('name').where({type:'index'}).first();
        assert.ok(index);
        const columns = await env.db.raw('SELECT name FROM pragma_index_info(?) ORDER BY seqno',[index.name]);
        assert.deepEqual(columns.map(row => row.name),['b','a']);
    } finally { await env.close(); }
});

test('unique key and index may share a logical name', async () => {
    const env = await open({schema:{$format:2,$namespace:'/app/',item:{attributes:[{name:'a',type:{name:'text'}},{name:'b',type:{name:'text'}}],uniqueKeys:{lookup:['a']},indexes:{lookup:{attributes:['b']}}}}});
    try {
        const indexes = await env.db('sqlite_master').select('name').where({type:'index'});
        assert.equal(indexes.length,2);
        const repo = await env.provider.get({path:'/app/item'});
        await repo.create({record:{a:'a',b:'b'}});
        await assert.rejects(repo.create({record:{a:'a',b:'c'}}),{code:'CONFLICT'});
    } finally { await env.close(); }
});

test('provider rejects a missing or incompatible physical table', async () => {
    const env = await open({schema:{$format:2,$namespace:'/app/',item:{attributes:[{name:'name',type:{name:'text'}}]}}});
    try {
        const physical = 'app_item';
        await env.db.schema.dropTable(physical);
        await assert.rejects(env.provider.get({path:'/app/item'}),{code:'UNSUPPORTED'});
        await env.db.schema.createTable(physical, table => table.integer('name'));
        await assert.rejects(env.provider.get({path:'/app/item'}),{code:'UNSUPPORTED'});
    } finally { await env.close(); }
});

test('provider rejects missing uniqueness and foreign key constraints', async () => {
    const schema = {$format:2,$namespace:'/app/',
        parent:{attributes:[{name:'id',type:{name:'identity'},generation:true},{name:'name',type:{name:'text'}}],uniqueKeys:{name:['name']}},
        child:{attributes:[{name:'id',type:{name:'identity'},generation:true},{name:'owner',type:{name:'ref'}}],relations:{owner:{attributes:['owner'],target:{path:'/app/parent',attributes:['id']}}}},
    };
    const env = await open({schema});
    try {
        const parentTable = 'app_parent';
        const childTable = 'app_child';
        await env.db.schema.raw('DROP INDEX ??', [`${parentTable}_u_name`]);
        await assert.rejects(env.provider.get({path:'/app/parent'}),{code:'UNSUPPORTED'});
        await env.db.schema.dropTable(childTable);
        await env.db.schema.createTable(childTable, table => { table.increments('id'); table.integer('owner').notNullable(); });
        await assert.rejects(env.provider.get({path:'/app/child'}),{code:'UNSUPPORTED'});
    } finally { await env.close(); }
});


test('all core DEM values round-trip with exact selection semantics',async()=>{
    const env=await open({schema:valueSchema,map:valueMap});
    try { await exercise({provider:env.provider,assert}); } finally { await env.close(); }
});


test('SQLite identity boundary is exact and exhaustion leaves contents unchanged',async()=>{
    const env=await open({schema:{$format:2,$namespace:'/app/',item:{attributes:[{name:'id',type:{name:'identity'},generation:true}]}}});
    try {
        const repo=await env.provider.get({path:'/app/item'});
        const record={id:'9223372036854775807'};
        assert.deepEqual(await repo.create({record}),{record});
        assert.deepEqual(await repo.read({key:{kind:'primary',values:record}}),{record});
        await assert.rejects(repo.create({record:{id:'9223372036854775808'}}),{code:'UNSUPPORTED'});
        await assert.rejects(repo.create({record:{}}),{code:'STORAGE'});
        assert.deepEqual(await repo.list({selection:{}}),{records:[record]});
    } finally {await env.close();}
});


test('atomic batches commit all commands or leave the original state intact',async()=>{
    const env=await open({schema:atomicSchema});
    try {await exerciseAtomic({provider:env.provider,assert});} finally {await env.close();}
});
