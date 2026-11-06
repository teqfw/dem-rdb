import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import Portable from '../../src/Portable.mjs';
const errors={create:({code,message})=>Object.assign(new Error(message),{code})};
const portable=new Portable({codec:{},batch:{},normalize:{},errors,randomUUID});
test('unsupported configuration is rejected before touching a database',async()=>{
    await assert.rejects(portable.open({model:{entities:{}},knex:null}),{code:'INVALID_INPUT'});
    const db=()=>assert.fail('no database effects');db.client={config:{client:'sqlite3',pool:{max:1}}};
    await assert.rejects(portable.open({model:{entities:{'/a':{attributes:[{name:'value',type:{name:'date'},generation:true}]}}},knex:db}),{code:'UNSUPPORTED'});
});

test('invalid or ambiguous physical identifiers fail before database access',async()=>{
    const db=()=>assert.fail('no database effects');db.client={config:{client:'sqlite3',pool:{max:1}}};
    const model=(path,name)=>({entities:{[path]:{attributes:[{name,type:{name:'text'}}]}}});
    for(const [path,name] of [['/a_b/c','value'],['/a/b_c','value'],['/'+('a'.repeat(64)),'value'],['/a/b','_dem_row'],['/a/b','_dem_fields'],['/a/b','v'.repeat(64)]])
        await assert.rejects(portable.open({model:model(path,name),knex:db}),{code:'UNSUPPORTED'});
    await assert.rejects(portable.open({model:model('/a/b','value'),knex:db,name:'x'.repeat(60)}),{code:'UNSUPPORTED'});
    const duplicate={entities:{'/a/b':{attributes:[{name:'value',type:{name:'text'}},{name:'value',type:{name:'text'}}]}}};
    await assert.rejects(portable.open({model:duplicate,knex:db}),{code:'UNSUPPORTED'});
});
