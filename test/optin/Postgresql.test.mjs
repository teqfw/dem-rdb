import assert from 'node:assert/strict';
import {test} from 'node:test';
import Container from '@teqfw/di';
import knex from 'knex';
import {register} from '@teqfw/dem/conformance';
import {schema as valueSchema,map as valueMap,exercise} from '@teqfw/dem/conformance/values';
import {createHash, randomBytes} from 'node:crypto';

const connection = {host:process.env.TEQFW_DB__PG_HOST,user:process.env.TEQFW_DB__PG_USER,password:process.env.TEQFW_DB__PG_PASSWORD,database:process.env.TEQFW_DB__PG_DATABASE};
if (Object.values(connection).some(value => !value)) throw new Error('PostgreSQL test connection environment is incomplete.');
async function open({schema,map}) {
    const namespace = 'dem_rdb_test_' + randomBytes(8).toString('hex');
    const admin = knex({client:'pg',connection,pool:{min:0,max:1}});
    await admin.schema.createSchema(namespace);
    const db = knex({client:'pg',connection,searchPath:[namespace],pool:{min:0,max:3}});
    try {
        const c = new Container();
        c.addNamespaceRoot('TeqFw_Dem_',new URL('../src',import.meta.resolve('@teqfw/dem/conformance')).pathname,'.mjs');
        c.addNamespaceRoot('TeqFw_DemRdb_',new URL('../../src',import.meta.url).pathname,'.mjs');
        const compiler = await c.get('TeqFw_Dem_Compile$');
        const {model} = await compiler.exec({schemas:[{packageName:'test',filename:'schema.json',document:schema}],...(map ? {map:{packageName:'test',filename:'map.json',document:map}} : {})});
        const adapter = await c.get('TeqFw_DemRdb_Adapter$');
        const provider = await adapter.open({model,knex:db});
        await provider.createSchema();
        return {provider,model,db,selection:await c.get('TeqFw_Dem_Dto_Query_Selection__Factory$'),close:async()=>{await db.destroy();await admin.schema.dropSchemaIfExists(namespace,true);await admin.destroy();}};
    } catch (error) { await db.destroy(); await admin.schema.dropSchemaIfExists(namespace,true); await admin.destroy(); throw error; }
}
register({test,assert,open});

test('generated identity avoids an explicitly supplied identity', async () => {
    const env = await open({schema:{$format:1,'/app/item':{attributes:[{name:'id',type:{name:'identity'},generation:true},{name:'name',type:{name:'text'}}]}}});
    try {
        const repo = await env.provider.get({path:'/app/item'});
        await repo.create({record:{id:'1',name:'first'}});
        const result = await repo.create({record:{name:'second'}});
        assert.notEqual(result.record.id,'1');
    } finally { await env.close(); }
});

test('out-of-range identity is rejected without an insert', async () => {
    const env = await open({schema:{$format:1,'/app/item':{attributes:[{name:'id',type:{name:'identity'},generation:true},{name:'name',type:{name:'text'}}]}}});
    try {
        const repo = await env.provider.get({path:'/app/item'});
        await assert.rejects(repo.create({record:{id:'2147483648',name:'bad'}}),{code:'UNSUPPORTED'});
        assert.deepEqual(await repo.list({selection:{}}),{records:[]});
    } finally { await env.close(); }
});

test('parallel generated identities are unique', async () => {
    const env = await open({schema:{$format:1,'/app/item':{attributes:[{name:'id',type:{name:'identity'},generation:true},{name:'name',type:{name:'text'}}]}}});
    try {
        const repo = await env.provider.get({path:'/app/item'});
        const results = await Promise.all(Array.from({length:12}, (_,i) => repo.create({record:{name:String(i)}})));
        assert.equal(new Set(results.map(result=>result.record.id)).size,12);
    } finally { await env.close(); }
});

test('provider detects missing unique constraints', async () => {
    const env = await open({schema:{$format:1,'/app/item':{attributes:[{name:'name',type:{name:'text'}}],uniqueKeys:{name:['name']}}}});
    try {
        const physical = 'dem_' + createHash('sha256').update('/app/item').digest('hex').slice(0,32);
        await env.db.schema.alterTable(physical, t => t.dropUnique(['name'], `${physical}_u_${createHash('sha256').update('name').digest('hex').slice(0,16)}`));
        await assert.rejects(env.provider.get({path:'/app/item'}),{code:'UNSUPPORTED'});
    } finally { await env.close(); }
});

test('cyclic relationships are created after both tables', async () => {
    const schema = {$format:1,
        '/app/a':{attributes:[{name:'id',type:{name:'identity'},generation:true},{name:'b',type:{name:'ref'},nullable:true}],relations:{b:{attributes:['b'],target:{path:'/app/b',attributes:['id']}}}},
        '/app/b':{attributes:[{name:'id',type:{name:'identity'},generation:true},{name:'a',type:{name:'ref'},nullable:true}],relations:{a:{attributes:['a'],target:{path:'/app/a',attributes:['id']}}}},
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
    const env = await open({schema:{$format:1,'/app/item':{attributes:[{name:'name',type:{name:'text'}}]}}});
    try {
        const physical = 'dem_' + createHash('sha256').update('/app/item').digest('hex').slice(0,32);
        await env.db.schema.alterTable(physical, table => table.unique(['name'], {indexName:'extra_unique',useConstraint:false}));
        await assert.rejects(env.provider.get({path:'/app/item'}),{code:'UNSUPPORTED'});
    } finally { await env.close(); }
});

test('long logical paths and key names map to valid physical identifiers', async () => {
    const path = '/vendor/feature/customer_identity_record';
    const schema = {$format:1,[path]:{attributes:[{name:'name',type:{name:'text'}}],uniqueKeys:{a_very_long_unique_key_name_for_customer:['name']}}};
    const env = await open({schema});
    try {
        const repo = await env.provider.get({path});
        assert.deepEqual(await repo.create({record:{name:'ok'}}),{record:{name:'ok'}});
        await assert.rejects(repo.create({record:{name:'ok'}}),{code:'CONFLICT'});
    } finally { await env.close(); }
});


test('shared all-type value workload uses exact logical observations',async()=>{
    const env=await open({schema:valueSchema,map:valueMap});
    try { await exercise({provider:env.provider,assert}); } finally { await env.close(); }
});
