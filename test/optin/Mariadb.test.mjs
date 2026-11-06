import assert from 'node:assert/strict';
import {test} from 'node:test';
import Container from '@teqfw/di';
import knex from 'knex';
import Connection from '../../src/Connection.mjs';
import {register} from '@teqfw/dem/conformance';
import {schema as valueSchema,map as valueMap,exercise,atomicSchema,exerciseAtomic} from '@teqfw/dem/conformance/values';
import {createHash,randomBytes} from 'node:crypto';

const connection = {host:process.env.TEQFW_DB__MYSQL_HOST,user:process.env.TEQFW_DB__MYSQL_USER,password:process.env.TEQFW_DB__MYSQL_PASSWORD,database:process.env.TEQFW_DB__MYSQL_DATABASE};
if (Object.values(connection).some(value => !value)) throw new Error('MariaDB test connection environment is incomplete.');
const table = path => 'dem_' + createHash('sha256').update(path).digest('hex').slice(0,32);
async function open({schema,map,driverOptions={supportBigNumbers:true,bigNumberStrings:true}}) {
    const ownedConnection=new Connection({knexFactory:knex});
    await ownedConnection.init({client:'mysql2',connection:{...connection,...driverOptions},pool:{min:0,max:4}});
    const db=ownedConnection.getClient();
    try {
        const c = new Container();
        c.addNamespaceRoot('TeqFw_Dem_',new URL('../src',import.meta.resolve('@teqfw/dem/conformance')).pathname,'.mjs');
        c.addNamespaceRoot('TeqFw_Dem_RDb_',new URL('../../src',import.meta.url).pathname,'.mjs');
        (await c.get('TeqFw_Dem_Registry$')).finalize();
        const compiler = await c.get('TeqFw_Dem_Compile$');
        const {model} = await compiler.exec({schemas:[{packageName:'test',filename:'schema.json',document:schema}],...(map ? {map:{packageName:'test',filename:'map.json',document:map}} : {})});
        for (const path of Object.keys(model.entities)) if (await db.schema.hasTable(table(path))) throw new Error('A test table already exists; refusing to modify it.');
        const adapter = await c.get('TeqFw_Dem_RDb_Adapter$');
        const provider = await adapter.open({model,connection:ownedConnection});
        await provider.createSchema();
        return {provider,model,db,selection:await c.get('TeqFw_Dem_Dto_Query_Selection__Factory$'),close:async()=>{
            try {
                for (const [path,entity] of Object.entries(model.entities)) for (const [index,relation] of Object.values(entity.relations).entries())
                    await db.schema.alterTable(table(path), t=>t.dropForeign(relation.attributes,`${table(path)}_f_${index}`));
                for (const path of Object.keys(model.entities).reverse()) await db.schema.dropTable(table(path));
            } finally { await ownedConnection.disconnect(); }
        }};
    } catch (error) { await ownedConnection.disconnect(); throw error; }
}
register({test,assert,open});

test('binary text preserves trailing spaces, case and Unicode order', async () => {
    const env = await open({schema:{$format:2,$namespace:'/app/',item:{attributes:[{name:'name',type:{name:'text'}}],uniqueKeys:{name:['name']}}}});
    try {
        const repo = await env.provider.get({path:'/app/item'});
        for (const name of ['a','a ','A','🌍']) await repo.create({record:{name}});
        assert.deepEqual((await repo.list({selection:{}})).records.map(row=>row.name),['A','a','a ','🌍']);
    } finally { await env.close(); }
});

test('MariaDB retains long unindexed text without the old 512 byte limit', async () => {
    const env = await open({schema:{$format:2,$namespace:'/app/',item:{attributes:[{name:'name',type:{name:'text'}}]}}});
    try {
        const repo = await env.provider.get({path:'/app/item'});
        const text='🌍'.repeat(2000);
        await repo.create({record:{name:text}});
        assert.equal((await repo.list({selection:{}})).records[0].name,text);
        assert.equal((await repo.list({selection:{}})).records.length,1);
    } finally { await env.close(); }
});

test('explicit and concurrent generated MariaDB identities remain unique', async () => {
    const env = await open({schema:{$format:2,$namespace:'/app/',item:{attributes:[{name:'id',type:{name:'identity'},generation:true},{name:'name',type:{name:'text'}}]}}});
    try {
        const repo = await env.provider.get({path:'/app/item'});
        await repo.create({record:{id:'1',name:'explicit'}});
        const records = await Promise.all(Array.from({length:12},(_,i)=>repo.create({record:{name:String(i)}})));
        assert.equal(new Set(records.map(item=>item.record.id)).size,12);
        assert.ok(records.every(item=>item.record.id !== '1'));
    } finally { await env.close(); }
});

test('invalid stored UTF-8 is not silently changed', async () => {
    const env = await open({schema:{$format:2,$namespace:'/app/',item:{attributes:[{name:'name',type:{name:'text'}}]}}});
    try {
        const repo = await env.provider.get({path:'/app/item'});
        await env.db(table('/app/item')).insert({name:Buffer.from([0xff])});
        await assert.rejects(repo.list({selection:{}}),{code:'STORAGE'});
    } finally { await env.close(); }
});

test('cyclic MariaDB relationships can be created and enforced', async () => {
    const schema = {$format:2,$namespace:'/app/',
        a:{attributes:[{name:'id',type:{name:'identity'},generation:true},{name:'b',type:{name:'ref'},nullable:true}],relations:{b:{attributes:['b'],target:{path:'/app/b',attributes:['id']}}}},
        b:{attributes:[{name:'id',type:{name:'identity'},generation:true},{name:'a',type:{name:'ref'},nullable:true}],relations:{a:{attributes:['a'],target:{path:'/app/a',attributes:['id']}}}},
    };
    const env = await open({schema});
    try {
        const a = await env.provider.get({path:'/app/a'}), b = await env.provider.get({path:'/app/b'});
        const first = await a.create({record:{b:null}}), second = await b.create({record:{a:first.record.id}});
        assert.equal((await a.update({key:{kind:'primary',values:{id:first.record.id}},changes:{b:second.record.id}})).record.b,second.record.id);
    } finally { await env.close(); }
});

test('entity containing only a generated identity accepts an empty record', async () => {
    const env = await open({schema:{$format:2,$namespace:'/app/',item:{attributes:[{name:'id',type:{name:'identity'},generation:true}]}}});
    try {
        const repo = await env.provider.get({path:'/app/item'});
        const result = await repo.create({record:{}});
        assert.match(result.record.id,/^[1-9][0-9]*$/);
    } finally { await env.close(); }
});

test('provider rejects an unexpected uniqueness constraint', async () => {
    const env = await open({schema:{$format:2,$namespace:'/app/',item:{attributes:[{name:'name',type:{name:'text'}}]}}});
    try {
        await env.db.schema.alterTable(table('/app/item'), t=>t.unique(['name'],'unexpected_unique'));
        await assert.rejects(env.provider.get({path:'/app/item'}),{code:'UNSUPPORTED'});
    } finally { await env.close(); }
});

test('a failed schema creation removes tables created by the attempt', async () => {
    const suffix = randomBytes(8).toString('hex');
    const first = `/cleanup${suffix}/a`, second = `/cleanup${suffix}/b`;
    const schema = {$format:2,$namespace:`/cleanup${suffix}/`,a:{attributes:[{name:'name',type:{name:'text'}}]},b:{attributes:[{name:'name',type:{name:'text'}}]}};
    const ownedConnection=new Connection({knexFactory:knex});
    await ownedConnection.init({client:'mysql2',connection:{...connection,supportBigNumbers:true,bigNumberStrings:true},pool:{min:0,max:1}});
    const db=ownedConnection.getClient();
    try {
        for (const path of [first,second]) assert.equal(await db.schema.hasTable(table(path)),false);
        const c = new Container();
        c.addNamespaceRoot('TeqFw_Dem_',new URL('../src',import.meta.resolve('@teqfw/dem/conformance')).pathname,'.mjs');
        c.addNamespaceRoot('TeqFw_Dem_RDb_',new URL('../../src',import.meta.url).pathname,'.mjs');
        (await c.get('TeqFw_Dem_Registry$')).finalize();
        const compiler = await c.get('TeqFw_Dem_Compile$');
        const {model} = await compiler.exec({schemas:[{packageName:'test',filename:'schema.json',document:schema}]});
        const provider = await (await c.get('TeqFw_Dem_RDb_Adapter$')).open({model,connection:ownedConnection});
        db.on('query', query => { if (/^create table/i.test(query.sql) && query.sql.includes(table(second))) throw new Error('Injected DDL failure'); });
        await assert.rejects(provider.createSchema(),{code:'STORAGE'});
        for (const path of [first,second]) assert.equal(await db.schema.hasTable(table(path)),false);
    } finally { await ownedConnection.disconnect(); }
});


test('shared all-type value workload uses exact logical observations',async()=>{
    const env=await open({schema:valueSchema,map:valueMap});
    try { await exercise({provider:env.provider,assert}); } finally { await env.close(); }
});


test('SQL casts preserve values even when the driver is configured for numeric conversions',async()=>{
    const env=await open({schema:valueSchema,map:valueMap,driverOptions:{supportBigNumbers:false,bigNumberStrings:false,decimalNumbers:true}});
    try {await exercise({provider:env.provider,assert});} finally {await env.close();}
});

test('MariaDB unsigned native identity boundary is exact and exhausts atomically',async()=>{
    const env=await open({schema:{$format:2,$namespace:'/app/',item:{attributes:[{name:'id',type:{name:'identity'},generation:true}]}}});
    try {
        const repo=await env.provider.get({path:'/app/item'});
        const record={id:'18446744073709551615'};
        assert.deepEqual(await repo.create({record}),{record});
        assert.deepEqual(await repo.read({key:{kind:'primary',values:record}}),{record});
        await assert.rejects(repo.create({record:{id:'18446744073709551616'}}),{code:'UNSUPPORTED'});
        await assert.rejects(repo.create({record:{}}),{code:'STORAGE'});
        assert.deepEqual(await repo.list({selection:{}}),{records:[record]});
    } finally {await env.close();}
});


test('shared atomic batch workload preserves transaction behavior',async()=>{
    const env=await open({schema:atomicSchema});
    try {await exerciseAtomic({provider:env.provider,assert});} finally {await env.close();}
});
