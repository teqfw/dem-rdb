import {test} from 'node:test';
import assert from 'node:assert/strict';
import Adapter from '../../src/Adapter.mjs';
test('adapter rejects a missing connection', async () => {
    const errors={create:({code,message})=>Object.assign(new Error(message),{code})};
    const adapter = new Adapter({normalize:{},selection:{},errors,codec:{},evaluate:{},randomUUID:()=>'',batch:{}});
    await assert.rejects(adapter.open({model:{entities:{}},connection:null}),{code:'INVALID_INPUT'});
    await assert.rejects(adapter.open({model:{entities:{}},knex:null}),{code:'INVALID_INPUT'});
});
test('native vector selection is explicit and bound to a dense float attribute',async()=>{
    const errors={create:({code,message})=>Object.assign(new Error(message),{code})};
    const adapter=new Adapter({normalize:{},selection:{},errors,codec:{},evaluate:{},randomUUID:()=>'',batch:{}});
    const model={entities:{'/app/item':{attributes:[{name:'embedding',type:{name:'vector',params:{element:'float',dimensions:3}}}]}}};
    const connection=null;
    await assert.rejects(adapter.open({model,connection,nativeVectors:{'/app/unknown':{embedding:true}}}),{code:'UNSUPPORTED'});
    await assert.rejects(adapter.open({model,connection,nativeVectors:{'/app/item':{unknown:true}}}),{code:'UNSUPPORTED'});
    await assert.rejects(adapter.open({model,connection,nativeVectors:{'/app/item':{embedding:false}}}),{code:'INVALID_INPUT'});
    await assert.rejects(adapter.open({model,connection,nativeVectors:{'/app/item':{embedding:true}}}),{code:'INVALID_INPUT'});
});
test('native vectors reject invalid dimensions and non-PostgreSQL storage before queries',async()=>{
    const errors={create:({code,message})=>Object.assign(new Error(message),{code})};
    const adapter=new Adapter({normalize:{},selection:{},errors,codec:{},evaluate:{},randomUUID:()=>'',batch:{}});
    const model={entities:{'/app/item':{attributes:[{name:'embedding',type:{name:'vector',params:{element:'float'}}}]}}};
    await assert.rejects(adapter.open({model,connection:null,nativeVectors:{'/app/item':{embedding:true}}}),{code:'UNSUPPORTED'});
    model.entities['/app/item'].attributes[0].type.params.dimensions=3;
    const queries=[];
    const knex=Object.assign(()=>{}, {client:{config:{client:'sqlite3',pool:{max:1}}},raw:async()=>{queries.push('raw');}});
    const connection={getClient:()=>knex};
    await assert.rejects(adapter.open({model,connection,nativeVectors:{'/app/item':{embedding:true}}}),{code:'UNSUPPORTED'});
    assert.deepEqual(queries,[]);
});
test('foreign-key actions are host-selected by effective relation path',async()=>{
    const errors={create:({code,message})=>Object.assign(new Error(message),{code})};
    const adapter=new Adapter({normalize:{},selection:{},errors,codec:{},evaluate:{},randomUUID:()=>'',batch:{}});
    const model={entities:{'/app/child':{attributes:[],relations:{parent:{}}}}};
    await assert.rejects(adapter.open({model,connection:null,foreignKeyActions:{'/app/missing':{parent:{onDelete:'CASCADE'}}}}),{code:'UNSUPPORTED'});
    await assert.rejects(adapter.open({model,connection:null,foreignKeyActions:{'/app/child':{missing:{onDelete:'CASCADE'}}}}),{code:'UNSUPPORTED'});
    await assert.rejects(adapter.open({model,connection:null,foreignKeyActions:{'/app/child':{parent:{onDelete:'SET NULL'}}}}),{code:'INVALID_INPUT'});
    await assert.rejects(adapter.open({model,connection:null,foreignKeyActions:{'/app/child':{parent:{onDelete:'CASCADE'}}}}),{code:'INVALID_INPUT'});
});
test('MariaDB enum models fail fast when CHECK enforcement is disabled',async()=>{
    const errors={create:({code,message})=>Object.assign(new Error(message),{name:'DemRepositoryError',code})};
    const adapter=new Adapter({normalize:{},selection:{},errors,codec:{},evaluate:{},randomUUID:()=>'',batch:{}});
    const model={entities:{'/app/item':{attributes:[{name:'state',type:{name:'enum',params:{values:['open','done']}}}],relations:{},uniqueKeys:{},indexes:{}}}};
    const queries=[];
    const knex=Object.assign(()=>{}, {client:{config:{client:'mysql2',pool:{max:1}}},raw:async sql=>{
        queries.push(sql);
        if (sql.includes('innodb_page_size')) return [[{page_size:16384,sql_mode:'STRICT_TRANS_TABLES',foreign_keys:1}],[]];
        return [[{enabled:0}],[]];
    }});
    await assert.rejects(adapter.open({model,connection:{getClient:()=>knex}}),{code:'UNSUPPORTED'});
    assert.equal(queries.length,2);
});
