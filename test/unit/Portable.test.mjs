import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import Portable from '../../src/Portable.mjs';
const errors={create:({code,message})=>Object.assign(new Error(message),{code})};
const portable=new Portable({codec:{},batch:{},normalize:{},errors,createHash,randomUUID});
test('unsupported configuration is rejected before touching a database',async()=>{
    await assert.rejects(portable.open({model:{entities:{}},knex:null}),{code:'INVALID_INPUT'});
    const db=()=>assert.fail('no database effects');db.client={config:{client:'sqlite3',pool:{max:1}}};
    await assert.rejects(portable.open({model:{entities:{'/a':{attributes:[{name:'value',type:{name:'date'},generation:true}]}}},knex:db}),{code:'UNSUPPORTED'});
});
