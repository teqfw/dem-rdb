import {test} from 'node:test';
import assert from 'node:assert/strict';
import Adapter from '../../src/Adapter.mjs';
test('adapter rejects a missing connection', async () => {
    const errors={create:({code,message})=>Object.assign(new Error(message),{code})};
    const adapter = new Adapter({normalize:{},selection:{},errors,codec:{},evaluate:{},randomUUID:()=>'',batch:{}});
    await assert.rejects(adapter.open({model:{entities:{}},connection:null}),{code:'INVALID_INPUT'});
    await assert.rejects(adapter.open({model:{entities:{}},knex:null}),{code:'INVALID_INPUT'});
});
test('removed host vector-selection configuration is rejected',async()=>{
    const errors={create:({code,message})=>Object.assign(new Error(message),{code})};
    const adapter=new Adapter({normalize:{},selection:{},errors,codec:{},evaluate:{},randomUUID:()=>'',batch:{}});
    await assert.rejects(adapter.open({model:{entities:{}},connection:{},nativeVectors:{'/app/item':{embedding:true}}}),{code:'INVALID_INPUT'});
});
test('removed host foreign-key policy configuration is rejected',async()=>{
    const errors={create:({code,message})=>Object.assign(new Error(message),{code})};
    const adapter=new Adapter({normalize:{},selection:{},errors,codec:{},evaluate:{},randomUUID:()=>'',batch:{}});
    await assert.rejects(adapter.open({model:{entities:{}},connection:{},foreignKeyActions:{'/app/child':{parent:{onDelete:'CASCADE'}}}}),{code:'INVALID_INPUT'});
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

test('MariaDB rejects self-referential update cascades before storage access',async()=>{
    const errors={create:({code,message})=>Object.assign(new Error(message),{name:'DemRepositoryError',code})};
    const adapter=new Adapter({normalize:{},selection:{},errors,codec:{},evaluate:{},randomUUID:()=>'',batch:{}});
    const model={entities:{'/app/node':{
        attributes:[{name:'id',type:{name:'integer'}},{name:'code',type:{name:'text'}},{name:'parent',type:{name:'text'}}],
        relations:{parent:{attributes:['parent'],onUpdate:'cascade',target:{path:'/app/node',attributes:['code']}}},
        uniqueKeys:{by_code:['code']},indexes:{},primaryKey:['id'],
    }}};
    const knex=Object.assign(()=>{}, {client:{config:{client:'mysql2',pool:{max:1}}},raw:async()=>assert.fail('Storage must not be accessed.')});
    await assert.rejects(adapter.open({model,connection:{getClient:()=>knex}}),{
        name:'DemRepositoryError',code:'UNSUPPORTED',message:'MariaDB does not support self-referential ON UPDATE CASCADE.',
    });
});
