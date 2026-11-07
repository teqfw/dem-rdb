import assert from 'node:assert/strict';
import {test} from 'node:test';
import Container from '@teqfw/di';
import knex from 'knex';
import Connection from '../../src/Connection.mjs';
import {register} from '@teqfw/dem/conformance';
import {schema as valueSchema,map as valueMap,exercise,atomicSchema,exerciseAtomic} from '@teqfw/dem/conformance/values';
import {randomBytes} from 'node:crypto';

const connection = {host:process.env.TEQFW_DB__PG_HOST,user:process.env.TEQFW_DB__PG_USER,password:process.env.TEQFW_DB__PG_PASSWORD,database:process.env.TEQFW_DB__PG_DATABASE};
if (Object.values(connection).some(value => !value)) throw new Error('PostgreSQL test connection environment is incomplete.');
async function open({schema,map}) {
    const namespace = 'dem_rdb_test_' + randomBytes(8).toString('hex');
    const adminConnection=new Connection({knexFactory:knex});
    await adminConnection.init({client:'pg',connection,pool:{min:0,max:1}});
    const admin=adminConnection.getClient();
    await admin.schema.createSchema(namespace);
    const ownedConnection=new Connection({knexFactory:knex});
    await ownedConnection.init({client:'pg',connection,searchPath:[namespace],pool:{min:0,max:3}});
    const db=ownedConnection.getClient();
    try {
        const c = new Container();
        c.addNamespaceRoot('TeqFw_Dem_',new URL('../src',import.meta.resolve('@teqfw/dem/conformance')).pathname,'.mjs');
        c.addNamespaceRoot('TeqFw_Dem_RDb_',new URL('../../src',import.meta.url).pathname,'.mjs');
        (await c.get('TeqFw_Dem_Registry$')).finalize();
        const compiler = await c.get('TeqFw_Dem_Compile$');
        const {model} = await compiler.exec({schemas:[{packageName:'test',filename:'schema.json',document:schema}],...(map ? {map:{packageName:'test',filename:'map.json',document:map}} : {})});
        const adapter = await c.get('TeqFw_Dem_RDb_Adapter$');
        const provider = await adapter.open({model,connection:ownedConnection});
        await provider.createSchema();
        return {provider,model,db,selection:await c.get('TeqFw_Dem_Dto_Query_Selection__Factory$'),close:async()=>{await ownedConnection.disconnect();await admin.schema.dropSchemaIfExists(namespace,true);await adminConnection.disconnect();}};
    } catch (error) { await ownedConnection.disconnect(); await admin.schema.dropSchemaIfExists(namespace,true); await adminConnection.disconnect(); throw error; }
}
register({test,assert,open});

test('generated identity avoids an explicitly supplied identity', async () => {
    const env = await open({schema:{$format:2,$namespace:'/app/',item:{attributes:[{name:'id',type:{name:'identity'},generation:true},{name:'name',type:{name:'text'}}]}}});
    try {
        const repo = await env.provider.get({path:'/app/item'});
        await repo.create({record:{id:'1',name:'first'}});
        const result = await repo.create({record:{name:'second'}});
        assert.notEqual(result.record.id,'1');
    } finally { await env.close(); }
});

test('out-of-range identity is rejected without an insert', async () => {
    const env = await open({schema:{$format:2,$namespace:'/app/',item:{attributes:[{name:'id',type:{name:'identity'},generation:true},{name:'name',type:{name:'text'}}]}}});
    try {
        const repo = await env.provider.get({path:'/app/item'});
        await assert.rejects(repo.create({record:{id:'9223372036854775808',name:'bad'}}),{code:'UNSUPPORTED'});
        assert.deepEqual(await repo.list({selection:{}}),{records:[]});
    } finally { await env.close(); }
});

test('parallel generated identities are unique', async () => {
    const env = await open({schema:{$format:2,$namespace:'/app/',item:{attributes:[{name:'id',type:{name:'identity'},generation:true},{name:'name',type:{name:'text'}}]}}});
    try {
        const repo = await env.provider.get({path:'/app/item'});
        const results = await Promise.all(Array.from({length:12}, (_,i) => repo.create({record:{name:String(i)}})));
        assert.equal(new Set(results.map(result=>result.record.id)).size,12);
    } finally { await env.close(); }
});

test('provider detects missing unique constraints', async () => {
    const env = await open({schema:{$format:2,$namespace:'/app/',item:{attributes:[{name:'name',type:{name:'text'}}],uniqueKeys:{name:['name']}}}});
    try {
        const physical = 'app_item';
        await env.db.schema.alterTable(physical, t => t.dropUnique(['name'], `${physical}_u_name`));
        await assert.rejects(env.provider.get({path:'/app/item'}),{code:'UNSUPPORTED'});
    } finally { await env.close(); }
});

test('cyclic relationships are created after both tables', async () => {
    const schema = {$format:2,$namespace:'/app/',
        a:{attributes:[{name:'id',type:{name:'identity'},generation:true},{name:'b',type:{name:'ref'},nullable:true}],relations:{b:{attributes:['b'],target:{path:'/app/b',attributes:['id']}}}},
        b:{attributes:[{name:'id',type:{name:'identity'},generation:true},{name:'a',type:{name:'ref'},nullable:true}],relations:{a:{attributes:['a'],target:{path:'/app/a',attributes:['id']}}}},
    };
    const env = await open({schema});
    try {
        const a = await env.provider.get({path:'/app/a'}), b = await env.provider.get({path:'/app/b'});
        const first = await a.create({record:{b:null}});
        const second = await b.create({record:{a:first.record.id}});
        const updated = await a.update({key:{kind:'primary',values:{id:first.record.id}},changes:{b:second.record.id}});
        assert.equal(updated.record.b,second.record.id);
    } finally { await env.close(); }
});

test('provider rejects unmodelled unique indexes', async () => {
    const env = await open({schema:{$format:2,$namespace:'/app/',item:{attributes:[{name:'name',type:{name:'text'}}]}}});
    try {
        const physical = 'app_item';
        await env.db.schema.alterTable(physical, table => table.unique(['name'], {indexName:'extra_unique',useConstraint:false}));
        await assert.rejects(env.provider.get({path:'/app/item'}),{code:'UNSUPPORTED'});
    } finally { await env.close(); }
});

test('long generated constraint names fail before schema creation', async () => {
    const schema={$format:2,$namespace:'/vendor/feature/','customer/identity/record':{attributes:[{name:'name',type:{name:'text'}}],uniqueKeys:{a_very_long_unique_key_name_for_customer:['name']}}};
    const namespace='dem_rdb_test_'+randomBytes(8).toString('hex');
    const conn=new Connection({knexFactory:knex});
    await conn.init({client:'pg',connection,searchPath:[namespace],pool:{min:0,max:1}});
    try {
        await conn.getClient().schema.createSchema(namespace);
        const c=new Container();
        c.addNamespaceRoot('TeqFw_Dem_',new URL('../src',import.meta.resolve('@teqfw/dem/conformance')).pathname,'.mjs');
        c.addNamespaceRoot('TeqFw_Dem_RDb_',new URL('../../src',import.meta.url).pathname,'.mjs');
        (await c.get('TeqFw_Dem_Registry$')).finalize();
        const compilation=await (await c.get('TeqFw_Dem_Compile$')).exec({schemas:[{packageName:'test',filename:'schema.json',document:schema}]});
        const adapter=await c.get('TeqFw_Dem_RDb_Adapter$');
        await assert.rejects(adapter.open({model:compilation.model,connection:conn}),{code:'UNSUPPORTED'});
        assert.equal(await conn.getClient().schema.hasTable('vendor_feature_customer_identity_record'),false);
    } finally { await conn.getClient().schema.dropSchemaIfExists(namespace,true); await conn.disconnect(); }
});


test('shared all-type value workload uses exact logical observations',async()=>{
    const env=await open({schema:valueSchema,map:valueMap});
    try { await exercise({provider:env.provider,assert}); } finally { await env.close(); }
});


test('PostgreSQL generated identity exhaustion rolls back without precision loss',async()=>{
    const env=await open({schema:{$format:2,$namespace:'/app/',item:{attributes:[{name:'id',type:{name:'identity'},generation:true}]}}});
    try {
        const repo=await env.provider.get({path:'/app/item'});
        const record={id:'9223372036854775807'};
        assert.deepEqual(await repo.create({record}),{record});
        await assert.rejects(repo.create({record:{}}),{code:'STORAGE'});
        assert.deepEqual(await repo.list({selection:{}}),{records:[record]});
    } finally {await env.close();}
});


test('shared atomic batch workload preserves transaction behavior',async()=>{
    const env=await open({schema:atomicSchema});
    try {await exerciseAtomic({provider:env.provider,assert});} finally {await env.close();}
});
