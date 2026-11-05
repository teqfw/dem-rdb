import assert from 'node:assert/strict';
import {test} from 'node:test';
import Container from '@teqfw/di';
import knex from 'knex';
import {register} from '@teqfw/dem/conformance';
import {schema as valueSchema,map as valueMap,exercise,atomicSchema,exerciseAtomic} from '@teqfw/dem/conformance/values';

async function open({schema,map}) {
    const c = new Container();
    c.addNamespaceRoot('TeqFw_Dem_', new URL('../src', import.meta.resolve('@teqfw/dem/conformance')).pathname, '.mjs');
    c.addNamespaceRoot('TeqFw_Dem_RDb_', new URL('../src', import.meta.url).pathname, '.mjs');
    (await c.get('TeqFw_Dem_Registry$')).finalize();
    const compiler = await c.get('TeqFw_Dem_Compile$');
    const {model} = await compiler.exec({schemas:[{packageName:'test',filename:'schema.json',document:schema}],...(map ? {map:{packageName:'test',filename:'map.json',document:map}} : {})});
    const db = knex({client:'sqlite3',connection:{filename:':memory:'},useNullAsDefault:true,pool:{min:1,max:1}});
    const adapter = await c.get('TeqFw_Dem_RDb_Adapter$');
    const provider = await adapter.open({model,knex:db});
    await provider.createSchema();
    return {provider,model,db,selection:await c.get('TeqFw_Dem_Dto_Query_Selection__Factory$'),close:()=>db.destroy()};
}
register({test,assert,open});

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
    const {model} = await compiler.exec({schemas:[{packageName:'test',filename:'schema.json',document:{$format:2,$namespace:'/app/',record:{attributes:[{name:'data',type:{name:'json'},generation:true}]}}}]});
    const db = knex({client:'sqlite3',connection:{filename:':memory:'},useNullAsDefault:true,pool:{min:1,max:1}});
    try {
        const adapter = await c.get('TeqFw_Dem_RDb_Adapter$');
        await assert.rejects(adapter.open({model,knex:db}), {name:'DemRepositoryError',code:'UNSUPPORTED'});
        assert.deepEqual(await db('sqlite_master').select('name').where('type','table'), []);
    } finally { await db.destroy(); }
});

test('repository provider obtains the model and connection from its host configuration', async () => {
    const env = await open({schema:{$format:2,$namespace:'/app/',item:{attributes:[{name:'name',type:{name:'text'}}]}}});
    try {
        const Provider = (await import('../src/Provider.mjs')).default;
        let calls = 0;
        const provider = new Provider({configuration:{get:async () => { calls++; return {}; }},adapter:{open:async () => env.provider}});
        const repo = await provider.get({path:'/app/item'});
        await repo.create({record:{name:'Ada'}});
        assert.equal((await provider.get({path:'/app/item'})) !== null, true);
        assert.equal(calls, 1);
    } finally { await env.close(); }
});

test('host DI selects the relational provider through DEM contract', async () => {
    const env = await open({schema:{$format:2,$namespace:'/app/',item:{attributes:[{name:'name',type:{name:'text'}}]}}});
    try {
        const c = new Container({preprocessors:['Test_Preprocessor$']});
        c.addNamespaceRoot('Test_',new URL('./fixture',import.meta.url).pathname,'.mjs');
        c.addNamespaceRoot('TeqFw_Dem_',new URL('../src',import.meta.resolve('@teqfw/dem/conformance')).pathname,'.mjs');
        c.addNamespaceRoot('TeqFw_Dem_RDb_',new URL('../src',import.meta.url).pathname,'.mjs');
        c.enableTestMode();
        c.register('TeqFw_Dem_RDb_Api_Configuration$', {get:async()=>({model:env.model,knex:env.db})});
        const provider = await c.get('TeqFw_Dem_Api_RepositoryProvider$');
        const atomic=await c.get('TeqFw_Dem_Api_RepositoryBatch$');assert.equal(atomic,provider);
        assert.equal((await atomic.execute({operations:[{path:'/app/item',method:'create',params:{record:{name:'batch DI'}}}]})).results[0].record.name,'batch DI');
        const repo = await provider.get({path:'/app/item'});
        assert.deepEqual(await repo.create({record:{name:'Ada'}}),{record:{name:'Ada'}});
    } finally { await env.close(); }
});

test('canonical nested Format 2 paths resolve', async () => {
    const env = await open({schema:{$format:2,$namespace:'/app/catalog/',item:{attributes:[{name:'name',type:{name:'text'}}]}}});
    try {
        const repo = await env.provider.get({path:'/app/catalog/item'});
        assert.deepEqual(await repo.create({record:{name:'ok'}}), {record:{name:'ok'}});
    } finally { await env.close(); }
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
        const physical = 'dem_' + Buffer.from('/app/item').toString('hex');
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
        const parentTable = 'dem_' + Buffer.from('/app/parent').toString('hex');
        const childTable = 'dem_' + Buffer.from('/app/child').toString('hex');
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


test('SQLite native identity boundary is exact and exhaustion leaves contents unchanged',async()=>{
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
