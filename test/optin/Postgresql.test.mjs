import assert from 'node:assert/strict';
import {test} from 'node:test';
import Container from '@teqfw/di';
import {readFile} from 'node:fs/promises';
import {register} from '@teqfw/dem/conformance';
import {schema as valueSchema,map as valueMap,exercise,atomicSchema,exerciseAtomic} from '@teqfw/dem/conformance/values';
import {randomBytes} from 'node:crypto';

const connection = {
    ...(process.env.TEQFW_DB__PG_HOST ? {host:process.env.TEQFW_DB__PG_HOST} : {}),
    ...(process.env.TEQFW_DB__PG_PORT ? {port:Number(process.env.TEQFW_DB__PG_PORT)} : {}),
    ...(process.env.TEQFW_DB__PG_USER ? {user:process.env.TEQFW_DB__PG_USER} : {}),
    ...(process.env.TEQFW_DB__PG_PASSWORD ? {password:process.env.TEQFW_DB__PG_PASSWORD} : {}),
    ...(process.env.TEQFW_DB__PG_DATABASE ? {database:process.env.TEQFW_DB__PG_DATABASE} : {}),
};
function container() {
    const result = new Container();
    result.addNamespaceRoot('TeqFw_Dem_RDb_',new URL('../../src',import.meta.url).pathname,'.mjs');
    return result;
}
async function open({schema,map,schemas,trustedPackages=[],createSchema=true,createNamespace=true,ownsNamespace=createNamespace,namespace='dem_rdb_test_' + randomBytes(8).toString('hex')}) {
    const adminContainer=container();
    const adminConnection=await adminContainer.get('TeqFw_Dem_RDb_Connection$');
    let admin;
    let adminReady=false;
    let namespaceOwned=!createNamespace && ownsNamespace;
    let ownedConnection;
    let provider;
    try {
        await adminConnection.init({client:'pg',connection,pool:{min:0,max:1}});
        admin=adminConnection.getClient();
        adminReady=true;
        if (createNamespace) {
            await admin.schema.createSchema(namespace);
            namespaceOwned=true;
        }
        const ownedContainer=container();
        ownedConnection=await ownedContainer.get('TeqFw_Dem_RDb_Connection$');
        await ownedConnection.init({client:'pg',connection,searchPath:[namespace],pool:{min:0,max:3}});
        const db=ownedConnection.getClient();
        const c = new Container();
        c.addNamespaceRoot('TeqFw_Dem_',new URL('../src',import.meta.resolve('@teqfw/dem/conformance')).pathname,'.mjs');
        c.addNamespaceRoot('TeqFw_Dem_RDb_',new URL('../../src',import.meta.url).pathname,'.mjs');
        (await c.get('TeqFw_Dem_Registry$')).finalize();
        const compiler = await c.get('TeqFw_Dem_Compile$');
        const compilation = await compiler.exec({schemas:schemas ?? [{packageName:'test',filename:'schema.json',document:schema}],...(trustedPackages.length ? {trustedPackages} : {}),...(map ? {map:{packageName:'test',filename:'map.json',document:map}} : {})});
        const {model} = compilation;
        const adapter = await c.get('TeqFw_Dem_RDb_Adapter$');
        provider = await adapter.open({model,connection:ownedConnection});
        if (createSchema) await provider.createSchema();
        return {
            provider,model,compilation,compiler,adapter,connection:ownedConnection,db,namespace,
            selection:await c.get('TeqFw_Dem_Dto_Query_Selection__Factory$'),
            close:async({preserveSchema=false}={})=>{
                try { await provider.close(); }
                finally {
                    try { await ownedConnection.disconnect(); }
                    finally {
                        try { if (namespaceOwned && !preserveSchema) await admin.schema.dropSchemaIfExists(namespace,true); }
                        finally { await adminConnection.disconnect(); }
                    }
                }
            },
        };
    } catch (error) {
        try { if (provider) await provider.close(); }
        finally {
            try { if (ownedConnection) await ownedConnection.disconnect(); }
            finally {
                try { if (namespaceOwned && adminReady) await admin.schema.dropSchemaIfExists(namespace,true); }
                finally { await adminConnection.disconnect(); }
            }
        }
        throw error;
    }
}
register({test,assert,open});

test('PostgreSQL initializes confirmed DEM history, persists CRUD and Batch, and rejects a changed model', async () => {
    const infrastructure=JSON.parse(await readFile(new URL('../etc/dem-schema.json',import.meta.resolve('@teqfw/dem/conformance')),'utf8'));
    const schemas=[
        {packageName:'@example/app',filename:'etc/dem-schema.json',document:{$format:2,$namespace:'/app/',item:{attributes:[{name:'id',type:{name:'identity'},generation:true},{name:'name',type:{name:'text'}}]}}},
        {packageName:'@teqfw/dem',filename:'etc/dem-schema.json',document:infrastructure},
    ];
    let first;
    let reopened;
    try {
        first=await open({schemas,trustedPackages:['@teqfw/dem'],createSchema:false});
        const initial=await first.provider.initialize({scope:'pg-e2e',compilation:first.compilation});
        assert.equal(initial.created,true);
        assert.equal(initial.application.scope,'pg-e2e');
        assert.equal(initial.application.source_id,null);
        assert.equal(initial.application.target_id,initial.snapshot.id);
        assert.equal(initial.application.outcome,'confirmed');
        assert.match(initial.application.evidence,/created or verified/i);
        for (const [table,columns] of Object.entries({
            app_item:['id','name'],
            dem_application:['id','scope','source_id','target_id','outcome','evidence'],
            dem_snapshot:['id','canonical','fingerprint','canonicalization','provenance'],
        })) {
            assert.equal(await first.db.schema.hasTable(table),true);
            assert.deepEqual(Object.keys(await first.db(table).columnInfo()),columns);
        }
        const physicalTables=(await first.db.raw('SELECT tablename FROM pg_tables WHERE schemaname=current_schema() ORDER BY tablename')).rows.map(row=>row.tablename);
        assert.deepEqual(physicalTables,['app_item','dem_application','dem_snapshot']);
        const primaryKeys=(await first.db.raw(`SELECT tc.table_name,kcu.column_name FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu USING (constraint_catalog,constraint_schema,constraint_name,table_name)
            WHERE tc.constraint_type='PRIMARY KEY' AND tc.table_schema=current_schema() ORDER BY tc.table_name,kcu.ordinal_position`)).rows;
        assert.deepEqual(primaryKeys.map(row=>[row.table_name,row.column_name]),[['app_item','id'],['dem_application','id'],['dem_snapshot','id']]);
        const foreignKeys=(await first.db.raw(`SELECT tc.table_name,kcu.column_name,ccu.table_name AS target_table,ccu.column_name AS target_column
            FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu
            ON kcu.constraint_schema=tc.constraint_schema AND kcu.constraint_name=tc.constraint_name AND kcu.table_name=tc.table_name
            JOIN information_schema.constraint_column_usage ccu
            ON ccu.constraint_schema=tc.constraint_schema AND ccu.constraint_name=tc.constraint_name
            WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_schema=current_schema() ORDER BY tc.table_name,kcu.column_name`)).rows;
        assert.deepEqual(foreignKeys.map(row=>[row.table_name,row.column_name,row.target_table,row.target_column]),[
            ['dem_application','source_id','dem_snapshot','id'],['dem_application','target_id','dem_snapshot','id'],
        ]);
        const repo=await first.provider.get({path:'/app/item'});
        const saved=(await repo.create({record:{name:'Ada'}})).record;
        assert.equal((await repo.read({key:{kind:'primary',values:{id:saved.id}}})).record.name,'Ada');
        const batch=await first.provider.execute({operations:[{path:'/app/item',method:'list',params:{selection:{}}}]});
        assert.deepEqual(batch.results[0],{records:[saved]});
        const namespace=first.namespace;
        await first.close({preserveSchema:true});
        first=undefined;
        reopened=await open({schemas,trustedPackages:['@teqfw/dem'],createSchema:false,createNamespace:false,ownsNamespace:true,namespace});
        const history=await reopened.provider.initialize({scope:'pg-e2e',compilation:reopened.compilation});
        assert.equal(history.created,false);
        assert.equal(history.application.outcome,'confirmed');
        assert.equal(history.snapshot.fingerprint,reopened.compilation.fingerprint);
        assert.deepEqual((await (await reopened.provider.get({path:'/app/item'})).list({selection:{}})).records,[{id:'1',name:'Ada'}]);
        const beforeSnapshots=(await (await reopened.provider.get({path:'/dem/snapshot'})).list({selection:{}})).records;
        const beforeApplications=(await (await reopened.provider.get({path:'/dem/application'})).list({selection:{}})).records;
        const changed=await reopened.compiler.exec({schemas:[
            {...schemas[0],document:{$format:2,$namespace:'/app/',item:{attributes:[{name:'id',type:{name:'identity'},generation:true},{name:'name',type:{name:'text'}},{name:'category',type:{name:'text'}}]}}},
            schemas[1],
        ],trustedPackages:['@teqfw/dem']});
        const changedBackend=await reopened.adapter.open({model:changed.model,connection:reopened.connection});
        await assert.rejects(()=>changedBackend.initialize({scope:'pg-e2e',compilation:changed}),{name:'DemRepositoryError',code:'UNSUPPORTED'});
        await changedBackend.close();
        assert.deepEqual((await (await reopened.provider.get({path:'/app/item'})).list({selection:{}})).records,[{id:'1',name:'Ada'}]);
        assert.deepEqual((await (await reopened.provider.get({path:'/dem/snapshot'})).list({selection:{}})).records,beforeSnapshots);
        assert.deepEqual((await (await reopened.provider.get({path:'/dem/application'})).list({selection:{}})).records,beforeApplications);
    } finally {
        if (reopened) await reopened.close();
        if (first) await first.close();
    }
});

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
    const connectionContainer=container();
    const conn=await connectionContainer.get('TeqFw_Dem_RDb_Connection$');
    let namespaceCreated=false;
    try {
        await conn.init({client:'pg',connection,searchPath:[namespace],pool:{min:0,max:1}});
        await conn.getClient().schema.createSchema(namespace);
        namespaceCreated=true;
        const c=new Container();
        c.addNamespaceRoot('TeqFw_Dem_',new URL('../src',import.meta.resolve('@teqfw/dem/conformance')).pathname,'.mjs');
        c.addNamespaceRoot('TeqFw_Dem_RDb_',new URL('../../src',import.meta.url).pathname,'.mjs');
        (await c.get('TeqFw_Dem_Registry$')).finalize();
        const compilation=await (await c.get('TeqFw_Dem_Compile$')).exec({schemas:[{packageName:'test',filename:'schema.json',document:schema}]});
        const adapter=await c.get('TeqFw_Dem_RDb_Adapter$');
        await assert.rejects(adapter.open({model:compilation.model,connection:conn}),{code:'UNSUPPORTED'});
        assert.equal(await conn.getClient().schema.hasTable('vendor_feature_customer_identity_record'),false);
    } finally {
        try { if(namespaceCreated) await conn.getClient().schema.dropSchemaIfExists(namespace,true); }
        finally { await conn.disconnect(); }
    }
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
