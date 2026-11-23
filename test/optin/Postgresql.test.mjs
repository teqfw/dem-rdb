import {demNamespace, acquireDemSchema} from '../fixture/Dem/Discovery.mjs';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import Container from '@teqfw/di';

const conformanceContainer = new Container({namespaces:[{prefix:'TeqFw_Dem_',target:demNamespace.dirAbs,defaultExt:'.mjs'}]});
const {register} = await conformanceContainer.get('TeqFw_Dem_Conformance_Repository$');
const {schema:valueSchema,map:valueMap,exercise} = await conformanceContainer.get('TeqFw_Dem_Conformance_Values$');
const {schema:atomicSchema,exercise:exerciseAtomic} = await conformanceContainer.get('TeqFw_Dem_Conformance_Atomic$');

import {randomBytes} from 'node:crypto';

/** @type {Record<string, any>} */
const connection = {
    ...(process.env.TEQFW_DB__PG_HOST ? {host:process.env.TEQFW_DB__PG_HOST} : {}),
    ...(process.env.TEQFW_DB__PG_PORT ? {port:Number(process.env.TEQFW_DB__PG_PORT)} : {}),
    ...(process.env.TEQFW_DB__PG_USER ? {user:process.env.TEQFW_DB__PG_USER} : {}),
    ...(process.env.TEQFW_DB__PG_PASSWORD ? {password:process.env.TEQFW_DB__PG_PASSWORD} : {}),
    ...(process.env.TEQFW_DB__PG_DATABASE ? {database:process.env.TEQFW_DB__PG_DATABASE} : {}),
};
const missingConfiguration=['host','user','password','database'].filter(name=>!connection[name]);
if (missingConfiguration.length)
    throw new Error('PostgreSQL integration requires TEQFW_DB__PG_HOST, TEQFW_DB__PG_USER, TEQFW_DB__PG_PASSWORD and TEQFW_DB__PG_DATABASE; missing: '+missingConfiguration.join(', ')+'.');

function container() {
    return new Container({namespaces:[
        {prefix:'TeqFw_Dem_',target:demNamespace.dirAbs,defaultExt:'.mjs'},
        {prefix:'TeqFw_Dem_RDb_',target:new URL('../../src',import.meta.url).pathname,defaultExt:'.mjs'},
    ]});
}
/** @param {any} options */
async function open({schema,map,schemas,trustedPackages=[],searchPath,createSchema=true,createNamespace=true,ownsNamespace=createNamespace,namespace='dem_rdb_test_' + randomBytes(8).toString('hex')}) {
    const adminContainer=container();
    const adminConnection=/** @type {any} */ (await adminContainer.get('TeqFw_Dem_RDb_Connection$'));
    /** @type {any} */
    let admin;
    let adminReady=false;
    let namespaceOwned=!createNamespace && ownsNamespace;
    /** @type {any} */
    let ownedConnection;
    /** @type {any} */
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
        await ownedConnection.init({client:'pg',connection,searchPath:searchPath ?? [namespace],pool:{min:0,max:3}});
        const db=ownedConnection.getClient();
        const c=container();
        const registry=await c.get('TeqFw_Dem_Registry$');
        registry.register((await c.get('TeqFw_Dem_RDb_Type_Vector_Provider$')).getDefinitions());registry.finalize();
        const compiler = await c.get('TeqFw_Dem_Compile$');
        const compilation = await compiler.exec({schemas:schemas ?? [{packageName:'test',filename:'schema.json',document:schema}],...(trustedPackages.length ? {trustedPackages} : {}),...(map ? {map:{packageName:'test',filename:'map.json',document:map}} : {})});
        const {model} = compilation;
        const vectorHandler=await c.get('TeqFw_Dem_RDb_Type_Vector_Handler$');
        const runtimeService=await c.get('TeqFw_Dem_Repository_Runtime$');
        const bindRuntime=(/** @type {any} */ model)=>runtimeService.bind({model,registry,handlers:[vectorHandler]});
        const runtime=await bindRuntime(model);
        const adapter = await c.get('TeqFw_Dem_RDb_Adapter$');
        provider = await adapter.open({model,connection:ownedConnection,runtime});
        if (createSchema) await provider.createSchema();
        return {
            provider,model,compilation,compiler,adapter,connection:ownedConnection,db,namespace,runtime,bindRuntime,
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
    const infrastructure = await acquireDemSchema(conformanceContainer);
    const schemas=[
        {packageName:'@example/app',filename:'etc/dem-schema.json',document:{$format:2,$namespace:'/app/',item:{attributes:[{name:'id',type:{name:'identity'},generation:true},{name:'name',type:{name:'text'}}]}}},
        infrastructure,
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
        const physicalTables=(await first.db.raw('SELECT tablename FROM pg_tables WHERE schemaname=current_schema() ORDER BY tablename')).rows.map((/** @type {{tablename:string}} */ row)=>row.tablename);
        assert.deepEqual(physicalTables,['app_item','dem_application','dem_snapshot']);
        const primaryKeys=(await first.db.raw(`SELECT tc.table_name,kcu.column_name FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu USING (constraint_catalog,constraint_schema,constraint_name,table_name)
            WHERE tc.constraint_type='PRIMARY KEY' AND tc.table_schema=current_schema() ORDER BY tc.table_name,kcu.ordinal_position`)).rows;
        assert.deepEqual(primaryKeys.map((/** @type {{table_name:string,column_name:string}} */ row)=>[row.table_name,row.column_name]),[['app_item','id'],['dem_application','id'],['dem_snapshot','id']]);
        const foreignKeys=(await first.db.raw(`SELECT tc.table_name,kcu.column_name,ccu.table_name AS target_table,ccu.column_name AS target_column
            FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu
            ON kcu.constraint_schema=tc.constraint_schema AND kcu.constraint_name=tc.constraint_name AND kcu.table_name=tc.table_name
            JOIN information_schema.constraint_column_usage ccu
            ON ccu.constraint_schema=tc.constraint_schema AND ccu.constraint_name=tc.constraint_name
            WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_schema=current_schema() ORDER BY tc.table_name,kcu.column_name`)).rows;
        assert.deepEqual(foreignKeys.map((/** @type {{table_name:string,column_name:string,target_table:string,target_column:string}} */ row)=>[row.table_name,row.column_name,row.target_table,row.target_column]),[
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
        await env.db.schema.alterTable(physical, /** @param {any} t */ t => t.dropUnique(['name'], `${physical}_u_name`));
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
        await env.db.schema.alterTable(physical, /** @param {any} table */ table => table.unique(['name'], {indexName:'extra_unique',useConstraint:false}));
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
        const c=new Container({namespaces:[
            {prefix:'TeqFw_Dem_',target:demNamespace.dirAbs,defaultExt:'.mjs'},
            {prefix:'TeqFw_Dem_RDb_',target:new URL('../../src',import.meta.url).pathname,defaultExt:'.mjs'},
        ]});
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

test('PostgreSQL vectors require a visible pgvector extension before schema changes',async()=>{
    const infrastructure=await acquireDemSchema(conformanceContainer);
    const schemas=[
        {packageName:'@example/app',filename:'etc/dem-schema.json',document:{$format:2,$namespace:'/app/',item:{attributes:[{name:'id',type:{name:'identity'},generation:true},{name:'embedding',type:{name:'teqfw.dem_rdb.vector',params:{dimensions:3}},nullable:true}]}}},
        infrastructure,
    ];
    await assert.rejects(
        open({schemas,trustedPackages:['@teqfw/dem'],createSchema:false}),
        {name:'DemRepositoryError',code:'UNSUPPORTED'},
    );
});

test('PostgreSQL vectors explicitly round to float32 and reject incompatible layouts',async()=>{
    const infrastructure=await acquireDemSchema(conformanceContainer);
    const app={packageName:'@example/app',filename:'etc/dem-schema.json',document:{$format:2,$namespace:'/app/',item:{attributes:[
        {name:'id',type:{name:'identity'},generation:true},
        {name:'embedding',type:{name:'teqfw.dem_rdb.vector',params:{dimensions:3}},nullable:true},
    ]}}};
    const schemas=[app,infrastructure];
    const namespace='dem_rdb_test_'+randomBytes(8).toString('hex');
    let first;
    /** @type {any} */
    let reopened;
    try {
        first=await open({schemas,trustedPackages:['@teqfw/dem'],searchPath:[namespace,'public'],createSchema:false,namespace});
        const initial=await first.provider.initialize({scope:'pg-native-vector',compilation:first.compilation});
        assert.equal(initial.created,true);
        const physical=(await first.db.raw(`SELECT format_type(a.atttypid,a.atttypmod) AS type FROM pg_attribute a
            JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
            WHERE n.nspname=current_schema() AND c.relname='app_item' AND a.attname='embedding'`)).rows[0];
        assert.equal(physical.type,'vector(3)');

        const repo=await first.provider.get({path:'/app/item'});
        const record={embedding:[1.5,0.1,1.401298464324817e-45]};
        const created=(await repo.create({record})).record;
        assert.deepEqual(created.embedding,[1.5,Math.fround(0.1),1.401298464324817e-45]);
        assert.deepEqual((await repo.read({key:{kind:'primary',values:{id:created.id}}})).record,created);
        await assert.rejects(repo.list({selection:{where:{kind:'call',operator:'eq',args:[{kind:'attr',name:'embedding'},{kind:'value',value:record.embedding}]}}}),{code:'INVALID_INPUT'});
        const updated=(await repo.update({key:{kind:'primary',values:{id:created.id}},changes:{embedding:[2,3,4]}})).record;
        assert.deepEqual(updated.embedding,[2,3,4]);
        assert.deepEqual((await first.provider.execute({operations:[{path:'/app/item',method:'list',params:{selection:{}}}]})).results[0].records,[updated]);
        await assert.rejects(repo.create({record:{embedding:[0.1,2]}}),{code:'INVALID_INPUT'});
        await assert.rejects(repo.create({record:{embedding:[Number.MAX_VALUE,0,0]}}),{code:'UNSUPPORTED'});
        assert.deepEqual((await repo.list({selection:{}})).records,[updated]);
        await first.close({preserveSchema:true});
        first=undefined;

        reopened=await open({schemas,trustedPackages:['@teqfw/dem'],searchPath:[namespace,'public'],createSchema:false,createNamespace:false,ownsNamespace:true,namespace});
        const history=await reopened.provider.initialize({scope:'pg-native-vector',compilation:reopened.compilation});
        assert.equal(history.created,false);
        assert.deepEqual((await (await reopened.provider.get({path:'/app/item'})).list({selection:{}})).records,[updated]);

        const before=(await (await reopened.provider.get({path:'/dem/application'})).list({selection:{}})).records;
        await assert.rejects(()=>reopened.adapter.open({model:reopened.model,connection:reopened.connection}),{name:'DemRepositoryError',code:'UNSUPPORTED'});
        assert.deepEqual((await (await reopened.provider.get({path:'/dem/application'})).list({selection:{}})).records,before);

        const changed=await reopened.compiler.exec({schemas:[
            {...app,document:{$format:2,$namespace:'/app/',item:{attributes:[
                {name:'id',type:{name:'identity'},generation:true},
                {name:'embedding',type:{name:'teqfw.dem_rdb.vector',params:{dimensions:2}},nullable:true},
            ]}}},
            infrastructure,
        ],trustedPackages:['@teqfw/dem']});
        const changedBackend=await reopened.adapter.open({model:changed.model,connection:reopened.connection,runtime:reopened.bindRuntime(changed.model)});
        await assert.rejects(()=>changedBackend.initialize({scope:'pg-native-vector',compilation:changed}),{name:'DemRepositoryError',code:'UNSUPPORTED'});
        await changedBackend.close();
        assert.deepEqual((await (await reopened.provider.get({path:'/dem/application'})).list({selection:{}})).records,before);
    } finally {
        if(reopened) await reopened.close();
        if(first) await first.close();
    }
});

test('PostgreSQL DEM relation actions cascade and must match on history reopen',async()=>{
    const infrastructure=await acquireDemSchema(conformanceContainer);
    const app={packageName:'@example/app',filename:'etc/dem-schema.json',document:{$format:2,$namespace:'/app/',
        parent:{attributes:[{name:'id',type:{name:'identity'},generation:true}]},
        child:{attributes:[{name:'id',type:{name:'identity'},generation:true},{name:'parent_id',type:{name:'ref'}}],relations:{parent:{attributes:['parent_id'],onDelete:'cascade',onUpdate:'cascade',target:{path:'/app/parent',attributes:['id']}}}},
    }};
    const schemas=[app,infrastructure];
    const namespace='dem_rdb_test_'+randomBytes(8).toString('hex');
    let first;
    let reopened;
    try {
        first=await open({schemas,trustedPackages:['@teqfw/dem'],searchPath:[namespace],createSchema:false,namespace});
        const initial=await first.provider.initialize({scope:'pg-cascade',compilation:first.compilation});
        assert.equal(initial.created,true);
        const parent=(await (await first.provider.get({path:'/app/parent'})).create({record:{}})).record;
        const child=(await (await first.provider.get({path:'/app/child'})).create({record:{parent_id:parent.id}})).record;
        await assert.rejects(first.db('app_child').insert({id:'900',parent_id:'999'}));
        const actions=(await first.db.raw(`SELECT confupdtype,confdeltype,condeferrable,condeferred FROM pg_constraint WHERE conrelid='app_child'::regclass AND contype='f'`)).rows[0];
        assert.deepEqual(actions,{confupdtype:'c',confdeltype:'c',condeferrable:false,condeferred:false});
        await first.db('app_parent').where({id:parent.id}).update({id:'20'});
        assert.equal(String((await first.db('app_child').where({id:child.id}).first()).parent_id),'20');
        await first.close({preserveSchema:true});
        first=undefined;

        reopened=await open({schemas,trustedPackages:['@teqfw/dem'],searchPath:[namespace],createSchema:false,createNamespace:false,ownsNamespace:true,namespace});
        assert.equal((await reopened.provider.initialize({scope:'pg-cascade',compilation:reopened.compilation})).created,false);
        const before=(await (await reopened.provider.get({path:'/dem/application'})).list({selection:{}})).records;
        const defaultBackend=await reopened.adapter.open({model:reopened.model,connection:reopened.connection,runtime:reopened.runtime});
        await defaultBackend.initialize({scope:'pg-cascade',compilation:reopened.compilation});
        await defaultBackend.close();
        assert.deepEqual((await (await reopened.provider.get({path:'/dem/application'})).list({selection:{}})).records,before);
        await reopened.db('app_parent').where({id:'20'}).delete();
        assert.equal((await reopened.db('app_child').count({count:'*'}).first()).count,'0');
        const [{conname}]= (await reopened.db.raw(`SELECT conname FROM pg_constraint WHERE conrelid='app_child'::regclass AND contype='f'`)).rows;
        await reopened.db.raw('ALTER TABLE ?? ALTER CONSTRAINT ?? DEFERRABLE INITIALLY DEFERRED',['app_child',conname]);
        await assert.rejects(reopened.provider.initialize({scope:'pg-cascade',compilation:reopened.compilation}),{name:'DemRepositoryError',code:'UNSUPPORTED'});
    } finally {
        if(reopened) await reopened.close();
        if(first) await first.close();
    }
});

test('PostgreSQL update result includes values changed by a self-referential cascade',async()=>{
    const schema={$format:2,$namespace:'/app/',node:{
        attributes:[{name:'id',type:{name:'identity'},generation:true},{name:'code',type:{name:'text'}},{name:'parent',type:{name:'text'}}],
        uniqueKeys:{by_code:['code']},
        relations:{parent:{attributes:['parent'],onUpdate:'cascade',target:{path:'/app/node',attributes:['code']}}},
    }};
    const env=await open({schema});
    try {
        const repo=await env.provider.get({path:'/app/node'});
        await repo.create({record:{code:'old',parent:'old'}});
        const updated=await repo.update({key:{kind:'primary',values:{id:'1'}},changes:{code:'new'}});
        assert.equal(updated.record.code,'new');
        assert.equal(updated.record.parent,'new');
        assert.deepEqual((await repo.read({key:{kind:'primary',values:{id:'1'}}})).record,updated.record);
    } finally {await env.close();}
});

test('PostgreSQL enum checks enforce the declared set and reject tampered layouts',async()=>{
    const infrastructure=await acquireDemSchema(conformanceContainer);
    const app={packageName:'@example/app',filename:'etc/dem-schema.json',document:{$format:2,$namespace:'/app/',item:{attributes:[
        {name:'id',type:{name:'identity'},generation:true},
        {name:'state',type:{name:'enum',params:{values:['open',"owner's"]}}},
        {name:'optional_state',type:{name:'enum',params:{values:['open',"owner's"]}},nullable:true},
    ]}}};
    const schemas=[app,infrastructure];
    const namespace='dem_rdb_test_'+randomBytes(8).toString('hex');
    let env;
    try {
        env=await open({schemas,trustedPackages:['@teqfw/dem'],searchPath:[namespace],createSchema:false,namespace});
        const initial=await env.provider.initialize({scope:'pg-enum',compilation:env.compilation});
        assert.equal(initial.created,true);
        const checks=(await env.db.raw(`SELECT conname,convalidated,pg_get_constraintdef(oid) AS definition
            FROM pg_constraint WHERE conrelid='app_item'::regclass AND contype='c' ORDER BY conname`)).rows;
        assert.deepEqual(checks.map((/** @type {{conname:string,convalidated:boolean,definition:string}} */ check)=>[check.conname,check.convalidated,check.definition]),[
            ['app_item_e_optional_state',true,`CHECK ((optional_state = ANY (ARRAY['open'::text, 'owner''s'::text])))`],
            ['app_item_e_state',true,`CHECK ((state = ANY (ARRAY['open'::text, 'owner''s'::text])))`],
        ]);
        const repo=await env.provider.get({path:'/app/item'});
        const saved=(await repo.create({record:{state:"owner's",optional_state:null}})).record;
        await env.db('app_item').insert({id:'900',state:'open',optional_state:'open'});
        await assert.rejects(env.db('app_item').insert({id:'901',state:'invalid',optional_state:null}));
        await assert.rejects(env.db('app_item').where({id:saved.id}).update({state:'invalid'}));
        const before=(await repo.list({selection:{}})).records;
        await assert.rejects(env.db.transaction(async (/** @type {any} */ trx)=>{
            await trx('app_item').insert({id:'902',state:'open'});
            await trx('app_item').insert({id:'903',state:'invalid'});
        }));
        assert.deepEqual((await repo.list({selection:{}})).records,before);

        await env.db.schema.raw('ALTER TABLE ?? DROP CONSTRAINT ??', ['app_item','app_item_e_state']);
        await env.db.schema.raw('ALTER TABLE ?? ADD CONSTRAINT ?? CHECK (state IS NOT NULL)', ['app_item','app_item_e_state']);
        const applications=(await (await env.provider.get({path:'/dem/application'})).list({selection:{}})).records;
        await assert.rejects(env.provider.initialize({scope:'pg-enum',compilation:env.compilation}),{name:'DemRepositoryError',code:'UNSUPPORTED'});
        await assert.deepEqual((await (await env.provider.get({path:'/dem/application'})).list({selection:{}})).records,applications);
    } finally {if(env) await env.close();}
});
